import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { loadConfig } from "../server/config.js";
import { LocalStore } from "../server/store.js";
import { createPurchase } from "../server/reference.js";
import {
  approveAward,
  confirmProposal,
  freezeAssessment,
  revealIdentities,
} from "../server/commands.js";
import type { Purchase } from "../shared/model.js";

const origin = "http://localhost:3000";
type Failure = "read" | "create" | "missing" | "ambiguous" | "wrong-reference";
async function setup(failure: Failure) {
  const store = new LocalStore(":memory:");
  const calls = { create: 0, read: 0, search: 0 };
  let submitted:
    | {
        detail: { invoice_number: string; reference: string };
        invoicer: { email_address: string };
      }
    | undefined;
  let purchase: Purchase;
  const id = "INV2-RECOVERY-TEST";
  const { app } = createApp(
    loadConfig({
      PAYPAL_VENDOR_B_CLIENT_ID: "placeholder",
      PAYPAL_VENDOR_B_CLIENT_SECRET: "placeholder",
      PAYPAL_VENDOR_B_EMAIL: "merchant-b@example.com",
    }),
    store,
    async (url, options) => {
      const path = String(url);
      if (path.endsWith("/v1/oauth2/token"))
        return Response.json({
          access_token: "mocked-token",
          expires_in: 3600,
        });
      if (
        path.endsWith("/v2/invoicing/invoices") &&
        options?.method === "POST"
      ) {
        calls.create++;
        submitted = JSON.parse(String(options.body));
        expect(
          new Headers(options.headers).get("PayPal-Request-Id"),
        ).toBeTruthy();
        expect(submitted!.detail.invoice_number).toHaveLength(25);
        expect(submitted!.invoicer.email_address).toBe(
          "merchant-b@example.com",
        );
        if (failure !== "read") return Response.json({}, { status: 503 });
        return Response.json({ id });
      }
      if (path.includes("/v2/invoicing/search-invoices?")) {
        calls.search++;
        const search = JSON.parse(String(options?.body));
        expect(search).toEqual({
          invoice_number: submitted!.detail.invoice_number,
          reference: submitted!.detail.reference,
        });
        if (failure === "missing")
          return Response.json({ total_items: 0, items: [] });
        const result = {
          id,
          detail: {
            invoice_number: submitted!.detail.invoice_number,
            reference:
              failure === "wrong-reference"
                ? "another-award"
                : submitted!.detail.reference,
          },
        };
        return Response.json({
          total_items: failure === "ambiguous" ? 2 : 1,
          items:
            failure === "ambiguous"
              ? [result, { ...result, id: "INV2-SECOND-TEST" }]
              : [result],
        });
      }
      if (path.endsWith(`/v2/invoicing/invoices/${id}`)) {
        calls.read++;
        const stored = await store.get(purchase.id, purchase.workspaceId);
        expect(stored.invoice?.id).toBe(id);
        expect(stored.invoice?.state).toBe("unknown");
        if (failure === "read" && calls.read === 1)
          return Response.json({}, { status: 503 });
        return Response.json({
          id,
          status: "DRAFT",
          detail: { ...submitted!.detail, currency_code: "USD" },
          invoicer: { email_address: "merchant-b@example.com" },
          primary_recipients: [
            { billing_info: { email_address: purchase.buyerEmail } },
          ],
          amount: { value: "2200.00", currency_code: "USD" },
        });
      }
      throw new Error("Unexpected upstream call");
    },
  );
  const agent = request.agent(app);
  const session = await agent
    .post("/api/session")
    .set("Origin", origin)
    .send({});
  const csrf = session.body.csrf;
  const identity = await agent.get("/api/session");
  purchase = createPurchase(identity.body.userId);
  for (const p of purchase.proposals)
    confirmProposal(purchase, p.id, {}, purchase.workspaceId);
  const proposal = purchase.proposals.find((p) => p.vendorId === "B")!;
  const decision = {
    proposalId: proposal.id,
    rationale: "Confirmed scope and deposit satisfy the purchasing limits.",
  };
  freezeAssessment(purchase, decision, purchase.workspaceId);
  revealIdentities(purchase, purchase.workspaceId);
  approveAward(
    purchase,
    { ...decision, identityChecked: true },
    purchase.workspaceId,
  );
  await store.save(purchase, null);
  const mutate = async (action = "") => {
    const latest = await store.get(purchase.id, purchase.workspaceId);
    return agent
      .post(`/api/purchases/${purchase.id}/invoice${action}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .set("If-Match", String(latest.version))
      .send(action ? {} : { mode: "paypal-sandbox" });
  };
  return { store, purchase, calls, mutate };
}
describe("supplier invoice recovery with mocked PayPal transport", () => {
  it("persists the returned invoice ID before a failing read and later reconciles without recreating", async () => {
    const f = await setup("read");
    const first = await f.mutate();
    expect(first.status).toBe(200);
    expect(first.body.invoice.state).toBe("unknown");
    expect(first.body.invoice.lastReconciledAt).toBe("");
    expect(first.body.invoice.payerUrl).toBeUndefined();
    expect((await f.mutate()).body.invoice.id).toBe(first.body.invoice.id);
    const refreshed = await f.mutate("/refresh");
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.invoice.state).toBe("draft");
    expect(f.calls).toEqual({ create: 1, read: 2, search: 0 });
  });
  it("recovers a lost create response by exact award and invoice number without a second create", async () => {
    const f = await setup("create");
    expect((await f.mutate()).status).toBe(503);
    const uncertain = await f.store.get(f.purchase.id, f.purchase.workspaceId);
    expect(uncertain.invoiceAttempt?.state).toBe("uncertain");
    expect(uncertain.invoice).toBeUndefined();
    const recovered = await f.mutate();
    expect(recovered.status).toBe(200);
    expect(recovered.body.invoice.state).toBe("draft");
    expect(f.calls).toEqual({ create: 1, read: 1, search: 1 });
  });
  it.each(["missing", "ambiguous", "wrong-reference"] as const)(
    "blocks %s search results without issuing another create",
    async (failure) => {
      const f = await setup(failure);
      expect((await f.mutate()).status).toBe(503);
      expect((await f.mutate()).status).toBe(409);
      expect(f.calls).toEqual({ create: 1, read: 0, search: 1 });
      expect(
        (await f.store.get(f.purchase.id, f.purchase.workspaceId)).invoice,
      ).toBeUndefined();
    },
  );
});
