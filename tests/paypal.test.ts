import { describe, expect, it } from "vitest";
import { inspectInvoice, PayPal } from "../server/paypal.js";
import { createPurchase } from "../server/reference.js";
import {
  confirmProposal,
  freezeAssessment,
  revealIdentities,
  approveAward,
} from "../server/commands.js";
import type { Invoice } from "../shared/model.js";
import { loadConfig } from "../server/config.js";
function fixture() {
  const p = createPurchase("owner"),
    proposal = p.proposals.find((x) => x.vendorId === "B")!;
  for (const candidate of p.proposals)
    confirmProposal(p, candidate.id, {}, "owner");
  freezeAssessment(
    p,
    {
      proposalId: proposal.id,
      rationale: "The deposit and scope are acceptable.",
    },
    "owner",
  );
  revealIdentities(p, "owner");
  approveAward(
    p,
    {
      proposalId: proposal.id,
      rationale: "Identity checked and final terms approved.",
      identityChecked: true,
    },
    "owner",
  );
  const expected: Invoice = {
    id: "INV2-ABCD-EFGH-IJKL-MNOP",
    provider: "paypal-sandbox",
    proposalId: proposal.id,
    awardId: p.award!.id,
    expectedCents: 220000,
    requestedCents: 220000,
    currency: "USD",
    reference: `BC-${p.award!.id}`,
    merchantEmail: "merchant@example.com",
    buyerEmail: "buyer@example.com",
    state: "draft",
    mismatch: [],
    lastReconciledAt: "",
  };
  const raw = {
    id: expected.id,
    status: "PAID",
    detail: { reference: expected.reference, currency_code: "USD" },
    invoicer: { email_address: expected.merchantEmail },
    primary_recipients: [
      { billing_info: { email_address: expected.buyerEmail } },
    ],
    amount: { value: "2200.00", currency_code: "USD" },
    due_amount: { value: "0.00", currency_code: "USD" },
    payments: {
      paid_amount: { value: "2200.00", currency_code: "USD" },
      transactions: [
        {
          type: "PAYPAL",
          payment_id: "PAYMENT-1",
          amount: { value: "2200.00", currency_code: "USD" },
        },
      ],
    },
  };
  return { p, expected, raw };
}
describe("authoritative invoice reconciliation", () => {
  it("accepts only full matching PayPal settlement", () => {
    const f = fixture();
    expect(inspectInvoice(f.raw, f.p, f.expected).state).toBe("paid");
  });
  it.each(["PARTIALLY_PAID", "PAYMENT_PENDING", "SENT"])(
    "does not treat %s as settlement",
    (status) => {
      const f = fixture();
      f.raw.status = status;
      expect(inspectInvoice(f.raw, f.p, f.expected).state).not.toBe("paid");
    },
  );
  it("rejects an external mark-as-paid record", () => {
    const f = fixture();
    f.raw.payments.transactions[0].type = "EXTERNAL";
    expect(inspectInvoice(f.raw, f.p, f.expected).state).toBe("pending");
  });
  it("blocks a changed deposit even if the invoice says paid", () => {
    const f = fixture();
    f.raw.amount.value = "5500.00";
    const result = inspectInvoice(f.raw, f.p, f.expected);
    expect(result.state).toBe("mismatch");
    expect(result.payerUrl).toBeUndefined();
  });
  it("blocks wrong currency, buyer, merchant and award reference", () => {
    const f = fixture();
    f.raw.detail.currency_code = "EUR";
    f.raw.detail.reference = "another-award";
    f.raw.invoicer.email_address = "attacker@example.com";
    f.raw.primary_recipients[0].billing_info.email_address =
      "other@example.com";
    expect(inspectInvoice(f.raw, f.p, f.expected).mismatch).toHaveLength(4);
  });
  it("handles a refund as a current state, not permanent paid status", () => {
    const f = fixture();
    f.raw.status = "REFUNDED";
    expect(inspectInvoice(f.raw, f.p, f.expected).state).toBe("refunded");
  });
  it("fails closed when merchant credentials are absent", async () => {
    const f = fixture();
    const paypal = new PayPal(loadConfig({}), async () => {
      throw new Error("Network must not be called");
    });
    await expect(paypal.draft(f.p, "B", "attempt", 220000)).rejects.toThrow(
      /no configured/,
    );
  });
});
