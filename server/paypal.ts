import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import type { Invoice, Purchase } from "../shared/model.js";
import { AppError, ensure } from "./errors.js";

const BASE = "https://api-m.sandbox.paypal.com";
type PayPalInvoice = {
  id: string;
  status: string;
  detail: {
    reference?: string;
    currency_code: string;
    metadata?: { recipient_view_url?: string };
  };
  invoicer?: { email_address?: string };
  primary_recipients?: { billing_info?: { email_address?: string } }[];
  amount?: { value: string; currency_code: string };
  due_amount?: { value: string; currency_code: string };
  payments?: {
    paid_amount?: { value: string; currency_code: string };
    transactions?: {
      type: string;
      payment_id?: string;
      amount?: { value: string; currency_code: string };
    }[];
  };
  links?: { rel: string; href: string }[];
};
const dollars = (cents: number) => (cents / 100).toFixed(2);
function cents(value: string | undefined) {
  if (value === undefined || !/^\d+\.\d{2}$/.test(value)) return null;
  const [whole, fraction] = value.split(".");
  const n = Number(whole) * 100 + Number(fraction);
  return Number.isSafeInteger(n) ? n : null;
}
export function inspectInvoice(
  raw: PayPalInvoice,
  p: Purchase,
  expected: Invoice,
): Invoice {
  const errors: string[] = [];
  if (raw.id !== expected.id) errors.push("Invoice identity does not match");
  if (raw.detail.reference !== expected.reference)
    errors.push("Award reference does not match");
  if (raw.detail.currency_code !== "USD" || raw.amount?.currency_code !== "USD")
    errors.push("Invoice currency is not USD");
  if (cents(raw.amount?.value) !== expected.expectedCents)
    errors.push("Requested deposit differs from the human-approved amount");
  if (
    raw.invoicer?.email_address?.toLowerCase() !==
    expected.merchantEmail.toLowerCase()
  )
    errors.push("Supplier account does not match the configured merchant");
  if (
    raw.primary_recipients?.[0]?.billing_info?.email_address?.toLowerCase() !==
    expected.buyerEmail.toLowerCase()
  )
    errors.push("Invoice recipient does not match the approved buyer");
  if (expected.awardId !== p.award?.id)
    errors.push("The invoice is bound to a different award");
  let state: Invoice["state"] = "unknown";
  if (raw.status === "DRAFT") state = "draft";
  else if (["SENT", "UNPAID", "SCHEDULED"].includes(raw.status)) state = "sent";
  else if (["PAYMENT_PENDING"].includes(raw.status)) state = "pending";
  else if (raw.status === "PARTIALLY_PAID") state = "partial";
  else if (raw.status === "CANCELLED") state = "cancelled";
  else if (["REFUNDED", "PARTIALLY_REFUNDED"].includes(raw.status))
    state = "refunded";
  const paypalTransactions =
    raw.payments?.transactions?.filter(
      (t) => t.type === "PAYPAL" && t.payment_id,
    ) || [];
  const paid = paypalTransactions.reduce(
    (sum, t) =>
      sum +
      (t.amount?.currency_code === "USD" ? (cents(t.amount.value) ?? 0) : 0),
    0,
  );
  if (
    raw.status === "PAID" &&
    !errors.length &&
    cents(raw.due_amount?.value) === 0 &&
    raw.due_amount?.currency_code === "USD" &&
    cents(raw.payments?.paid_amount?.value) === expected.expectedCents &&
    raw.payments?.paid_amount?.currency_code === "USD" &&
    paid === expected.expectedCents
  )
    state = "paid";
  else if (raw.status === "PAID") state = "pending";
  const payerUrl =
    raw.links?.find((link) => link.rel === "payer-view")?.href ||
    raw.detail.metadata?.recipient_view_url;
  let safePayerUrl: string | undefined;
  try {
    if (
      payerUrl &&
      new URL(payerUrl).protocol === "https:" &&
      new URL(payerUrl).hostname === "www.sandbox.paypal.com" &&
      new URL(payerUrl).pathname.startsWith("/invoice/")
    )
      safePayerUrl = payerUrl;
  } catch {
    /* A malformed upstream link is never exposed to the buyer. */
  }
  return {
    ...expected,
    requestedCents: cents(raw.amount?.value) ?? 0,
    state: errors.length ? "mismatch" : state,
    mismatch: errors,
    paymentId: state === "paid" ? paypalTransactions[0]?.payment_id : undefined,
    payerUrl: errors.length ? undefined : safePayerUrl,
    lastReconciledAt: new Date().toISOString(),
  };
}
export class PayPal {
  private tokens = new Map<string, { token: string; until: number }>();
  constructor(
    private config: Config,
    private request: typeof fetch = fetch,
  ) {}
  private merchant(id: string) {
    const merchant = this.config.vendors[id];
    ensure(
      merchant,
      "This supplier has no configured sandbox merchant connection. No payment was initiated.",
      503,
    );
    return merchant;
  }
  private async token(id: string) {
    const cached = this.tokens.get(id);
    if (cached && cached.until > Date.now()) return cached.token;
    const merchant = this.merchant(id);
    const response = await this.request(`${BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${merchant.clientId}:${merchant.secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new AppError(503, "PayPal sandbox authentication failed.");
    const body = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.tokens.set(id, {
      token: body.access_token,
      until: Date.now() + Math.max(0, body.expires_in - 120) * 1000,
    });
    return body.access_token;
  }
  private async call(
    id: string,
    path: string,
    method = "GET",
    body?: unknown,
    requestId?: string,
  ): Promise<unknown> {
    const token = await this.token(id);
    const response = await this.request(BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new AppError(
        503,
        `PayPal sandbox operation failed (${response.status}). Reconcile before retrying.`,
        "PAYPAL_UNCERTAIN",
      );
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  async draft(
    p: Purchase,
    vendorId: string,
    requestId: string,
    requestedCents: number,
  ): Promise<Invoice> {
    ensure(p.award, "An approved award is required.");
    const merchant = this.merchant(vendorId);
    const reference = `BC-${p.award.id}`;
    const body = this.invoiceBody(p, reference, requestedCents);
    const raw = (await this.call(
      vendorId,
      "/v2/invoicing/invoices",
      "POST",
      body,
      requestId,
    )) as PayPalInvoice;
    ensure(
      /^INV2-[A-Z0-9-]+$/.test(raw.id),
      "PayPal did not return a valid invoice identity.",
      503,
    );
    return this.read(p, vendorId, {
      id: raw.id,
      provider: "paypal-sandbox",
      proposalId: p.award.proposalId,
      awardId: p.award.id,
      expectedCents: p.award.depositCents,
      requestedCents,
      currency: "USD",
      reference,
      merchantEmail: merchant.email,
      buyerEmail: p.buyerEmail,
      state: "draft",
      mismatch: [],
      lastReconciledAt: new Date().toISOString(),
    });
  }
  private invoiceBody(p: Purchase, reference: string, amount: number) {
    return {
      detail: {
        currency_code: "USD",
        reference,
        note: `Deposit for approved award ${p.award!.id}. Snapshot ${p.award!.snapshotHash.slice(0, 16)}. Synthetic sandbox transaction; no real money.`,
        payment_term: { term_type: "DUE_ON_RECEIPT" },
      },
      primary_recipients: [{ billing_info: { email_address: p.buyerEmail } }],
      items: [
        {
          name: `Approved project deposit: ${p.title}`.slice(0, 127),
          quantity: "1",
          unit_amount: { currency_code: "USD", value: dollars(amount) },
        },
      ],
      configuration: {
        allow_tip: false,
        partial_payment: { allow_partial_payment: false },
        tax_calculated_after_discount: false,
      },
    };
  }
  async read(p: Purchase, vendorId: string, invoice: Invoice) {
    ensure(
      /^INV2-[A-Z0-9-]+$/.test(invoice.id),
      "Invalid stored invoice identity.",
    );
    return inspectInvoice(
      (await this.call(
        vendorId,
        `/v2/invoicing/invoices/${invoice.id}`,
      )) as PayPalInvoice,
      p,
      invoice,
    );
  }
  async correct(p: Purchase, vendorId: string, invoice: Invoice) {
    const current = (await this.call(
      vendorId,
      `/v2/invoicing/invoices/${invoice.id}`,
    )) as PayPalInvoice;
    ensure(
      current.status === "DRAFT",
      "Only a supplier draft can be corrected in this workflow.",
    );
    await this.call(
      vendorId,
      `/v2/invoicing/invoices/${invoice.id}`,
      "PUT",
      this.invoiceBody(p, invoice.reference, invoice.expectedCents),
    );
    return this.read(p, vendorId, invoice);
  }
  async send(p: Purchase, vendorId: string, invoice: Invoice) {
    const verified = await this.read(p, vendorId, invoice);
    ensure(
      verified.state === "draft" && !verified.mismatch.length,
      "The invoice does not match the approved award. Publication is blocked.",
    );
    await this.call(
      vendorId,
      `/v2/invoicing/invoices/${invoice.id}/send`,
      "POST",
      { send_to_recipient: false, send_to_invoicer: false },
    );
    return this.read(p, vendorId, invoice);
  }
  async verifyWebhook(
    vendorId: string,
    headers: Record<string, string | undefined>,
    event: unknown,
  ) {
    const merchant = this.merchant(vendorId);
    ensure(merchant.webhookId, "Webhook verification is not configured.", 503);
    const result = (await this.call(
      vendorId,
      "/v1/notifications/verify-webhook-signature",
      "POST",
      {
        auth_algo: headers["paypal-auth-algo"],
        cert_url: headers["paypal-cert-url"],
        transmission_id: headers["paypal-transmission-id"],
        transmission_sig: headers["paypal-transmission-sig"],
        transmission_time: headers["paypal-transmission-time"],
        webhook_id: merchant.webhookId,
        webhook_event: event,
      },
    )) as { verification_status: string };
    ensure(
      result.verification_status === "SUCCESS",
      "Webhook signature verification failed.",
      400,
    );
  }
}
export function simulatedInvoice(p: Purchase, mismatch: boolean): Invoice {
  ensure(
    p.synthetic && p.award,
    "The supplier simulator only accepts synthetic approved awards.",
  );
  const vendor = p.proposals.find((x) => x.id === p.award!.proposalId)!;
  return {
    id: `SIM-${randomUUID()}`,
    provider: "simulation",
    proposalId: vendor.id,
    awardId: p.award.id,
    expectedCents: p.award.depositCents,
    requestedCents: mismatch
      ? Math.round(p.award.totalCents / 2)
      : p.award.depositCents,
    currency: "USD",
    reference: `BC-${p.award.id}`,
    merchantEmail: vendor.identity.email,
    buyerEmail: p.buyerEmail,
    state: mismatch ? "mismatch" : "draft",
    mismatch: mismatch
      ? ["Requested deposit differs from the human-approved amount"]
      : [],
    lastReconciledAt: new Date().toISOString(),
  };
}
