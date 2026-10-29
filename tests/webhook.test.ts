import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { loadConfig } from "../server/config.js";
import { LocalStore } from "../server/store.js";
import { createPurchase } from "../server/reference.js";
import {
  confirmProposal,
  freezeAssessment,
  revealIdentities,
  approveAward,
} from "../server/commands.js";
import type { Invoice } from "../shared/model.js";

const headers = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url":
    "https://api.sandbox.paypal.com/v1/notifications/certs/test",
  "paypal-transmission-id": "synthetic-transmission",
  "paypal-transmission-sig": "mocked-signature",
  "paypal-transmission-time": "2026-10-29T20:00:00Z",
};
async function setup(verified = true, authoritativeStatus = "PAID") {
  const owner = randomUUID(),
    p = createPurchase(owner),
    store = new LocalStore(":memory:");
  const proposal = p.proposals.find((x) => x.vendorId === "B")!;
  for (const candidate of p.proposals)
    confirmProposal(p, candidate.id, {}, owner);
  freezeAssessment(
    p,
    {
      proposalId: proposal.id,
      rationale: "The confirmed terms satisfy our cash limits.",
    },
    owner,
  );
  revealIdentities(p, owner);
  approveAward(
    p,
    {
      proposalId: proposal.id,
      rationale: "Identity and commercial terms reviewed by a human.",
      identityChecked: true,
    },
    owner,
  );
  const invoice: Invoice = {
    id: "INV2-MOCK-ONLY",
    provider: "paypal-sandbox",
    proposalId: proposal.id,
    awardId: p.award!.id,
    expectedCents: 220000,
    requestedCents: 220000,
    currency: "USD",
    reference: `BC-${p.award!.id}`,
    merchantEmail: "merchant-b@example.com",
    buyerEmail: p.buyerEmail,
    state: "sent",
    mismatch: [],
    lastReconciledAt: "",
  };
  p.invoice = invoice;
  await store.save(p, null);
  const calls = { verify: 0, read: 0 };
  const { app } = createApp(
    loadConfig({
      PAYPAL_VENDOR_B_CLIENT_ID: "placeholder",
      PAYPAL_VENDOR_B_CLIENT_SECRET: "placeholder",
      PAYPAL_VENDOR_B_EMAIL: invoice.merchantEmail,
      PAYPAL_VENDOR_B_WEBHOOK_ID: "webhook-b",
    }),
    store,
    async (url, options) => {
      const path = String(url);
      if (path.endsWith("/v1/oauth2/token"))
        return Response.json({
          access_token: "mocked-access-token",
          expires_in: 3600,
        });
      if (path.endsWith("/verify-webhook-signature")) {
        calls.verify++;
        expect(JSON.parse(String(options?.body)).webhook_id).toBe("webhook-b");
        return Response.json({
          verification_status: verified ? "SUCCESS" : "FAILURE",
        });
      }
      if (path.endsWith(`/v2/invoicing/invoices/${invoice.id}`)) {
        calls.read++;
        return Response.json({
          id: invoice.id,
          status: authoritativeStatus,
          detail: { currency_code: "USD", reference: invoice.reference },
          invoicer: { email_address: invoice.merchantEmail },
          primary_recipients: [
            { billing_info: { email_address: invoice.buyerEmail } },
          ],
          amount: { value: "2200.00", currency_code: "USD" },
          due_amount: {
            value: authoritativeStatus === "PAID" ? "0.00" : "2200.00",
            currency_code: "USD",
          },
          payments: {
            paid_amount: { value: "2200.00", currency_code: "USD" },
            transactions: [
              {
                type: "PAYPAL",
                payment_id: "mocked-payment",
                amount: { value: "2200.00", currency_code: "USD" },
              },
            ],
          },
        });
      }
      throw new Error("Unexpected upstream path");
    },
  );
  const event = {
    id: "WH-SYNTHETIC-1",
    event_type: "INVOICING.INVOICE.PAID",
    resource: { id: invoice.id },
  };
  return { app, store, p, owner, calls, event };
}
describe("webhook adapter contract with mocked PayPal verification", () => {
  it("verifies, rereads the invoice, and deduplicates an accepted replay", async () => {
    const f = await setup();
    const send = () =>
      request(f.app).post("/api/webhooks/paypal/B").set(headers).send(f.event);
    expect((await send()).status).toBe(200);
    const stored = await f.store.get(f.p.id, f.owner);
    expect(stored.invoice?.state).toBe("paid");
    expect(
      stored.events.filter((e) => e.id === `paypal:${f.event.id}`),
    ).toHaveLength(1);
    expect((await send()).body.duplicate).toBe(true);
    expect(f.calls).toEqual({ verify: 2, read: 1 });
  });
  it("rejects failed signature verification before reading or changing the invoice", async () => {
    const f = await setup(false);
    const result = await request(f.app)
      .post("/api/webhooks/paypal/B")
      .set(headers)
      .send(f.event);
    expect(result.status).toBe(400);
    expect(f.calls.read).toBe(0);
    expect((await f.store.get(f.p.id, f.owner)).invoice?.state).toBe("sent");
  });
  it("does not infer settlement from a PAID event name", async () => {
    const f = await setup(true, "SENT");
    expect(
      (
        await request(f.app)
          .post("/api/webhooks/paypal/B")
          .set(headers)
          .send(f.event)
      ).status,
    ).toBe(200);
    expect((await f.store.get(f.p.id, f.owner)).invoice?.state).toBe("sent");
  });
  it("rejects missing signature headers without a provider call", async () => {
    const f = await setup();
    expect(
      (await request(f.app).post("/api/webhooks/paypal/B").send(f.event))
        .status,
    ).toBe(400);
    expect(f.calls).toEqual({ verify: 0, read: 0 });
  });
});
