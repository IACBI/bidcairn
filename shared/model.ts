import { z } from "zod";

import { criterionKeys, factKeys } from "./fields.js";
export { criterionKeys, factKeys };
export type Criterion = (typeof criterionKeys)[number];
export type FactKey = (typeof factKeys)[number];
export const evidenceSchema = z
  .object({
    page: z.number().int().positive(),
    quote: z.string().min(1).max(1000),
  })
  .strict();
export type Evidence = z.infer<typeof evidenceSchema>;
export const extractedFactSchema = z
  .object({
    value: z.number().nonnegative().nullable(),
    evidence: evidenceSchema.nullable(),
  })
  .strict();
export const extractionSchema = z
  .object({
    facts: z
      .object({
        totalCents: extractedFactSchema,
        deliveryDays: extractedFactSchema,
        warrantyDays: extractedFactSchema,
        depositPercent: extractedFactSchema,
        slaHours: extractedFactSchema,
      })
      .strict(),
    requirements: z
      .array(
        z
          .object({
            requirementId: z.string(),
            status: z.enum(["supported", "contradicted", "unclear"]),
            evidence: evidenceSchema.nullable(),
          })
          .strict(),
      )
      .max(20),
    risks: z
      .array(
        z
          .object({
            title: z.string().max(140),
            severity: z.enum(["info", "warning", "critical"]),
            explanation: z.string().max(600),
            evidence: evidenceSchema,
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export type Extraction = z.infer<typeof extractionSchema>;
export const explanationSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            text: z.string().min(1).max(500),
            evidenceIds: z.array(z.string()).min(1).max(4),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();
export interface TradeoffExplanation {
  items: z.infer<typeof explanationSchema>["items"];
  inputHash: string;
  sources: {
    id: string;
    alias: string;
    label: string;
    value: string;
    evidence: Evidence | null;
  }[];
  analysis: NonNullable<Proposal["analysis"]>;
}
export interface Fact {
  value: number | null;
  evidence: Evidence | null;
  confirmed: boolean;
  correction?: string;
}
export interface Requirement {
  id: string;
  label: string;
  mandatory: boolean;
}
export const rubricSchema = z
  .object({
    budgetCents: z.number().int().positive().max(100_000_000),
    targetPriceCents: z.number().int().nonnegative(),
    goodDays: z.number().int().nonnegative(),
    badDays: z.number().int().positive(),
    goodWarranty: z.number().int().positive(),
    badWarranty: z.number().int().nonnegative(),
    maxUpfrontCents: z.number().int().nonnegative(),
    weights: z
      .object({
        price: z.number().int().nonnegative(),
        scope: z.number().int().nonnegative(),
        delivery: z.number().int().nonnegative(),
        warranty: z.number().int().nonnegative(),
        upfront: z.number().int().nonnegative(),
      })
      .strict(),
    requirements: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            label: z.string().min(1).max(300),
            mandatory: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (Object.values(r.weights).reduce((a, b) => a + b, 0) !== 100)
      ctx.addIssue({ code: "custom", message: "Weights must total 100." });
    if (
      r.targetPriceCents >= r.budgetCents ||
      r.goodDays >= r.badDays ||
      r.badWarranty >= r.goodWarranty
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Each scoring anchor must have a non-zero, correctly ordered range.",
      });
    if (new Set(r.requirements.map((x) => x.id)).size !== r.requirements.length)
      ctx.addIssue({
        code: "custom",
        message: "Requirement identifiers must be unique.",
      });
  });
export type Rubric = z.infer<typeof rubricSchema>;
export interface Proposal {
  id: string;
  alias: string;
  vendorId: string;
  identity: { name: string; email: string; filename: string };
  pages: { page: number; text: string }[];
  originalPages: { page: number; text: string }[];
  documentId?: string;
  documentHash: string;
  provenance: "reference" | "uploaded";
  analysis?: {
    provider: string;
    model: string;
    at: string;
    inputHash: string;
    promptVersion: string;
    schemaVersion: string;
    inputTokens?: number;
    outputTokens?: number;
  };
  facts: Record<FactKey, Fact>;
  requirements: (Extraction["requirements"][number] & { confirmed: boolean })[];
  risks: Extraction["risks"];
  status: "ready" | "unanalysed" | "processing" | "failed";
  error?: string;
  priorIdentityExposure: boolean;
}
export interface Assessment {
  rubricRevision: number;
  proposalHash: string;
  proposalId: string;
  rationale: string;
  at: string;
  actor: string;
}
export interface Award extends Assessment {
  id: string;
  supplierName: string;
  totalCents: number;
  depositCents: number;
  snapshotHash: string;
}
export interface Invoice {
  id: string;
  provider: "simulation" | "paypal-sandbox";
  proposalId: string;
  awardId: string;
  expectedCents: number;
  requestedCents: number;
  currency: string;
  reference: string;
  merchantEmail: string;
  buyerEmail: string;
  state:
    | "draft"
    | "sent"
    | "pending"
    | "partial"
    | "paid"
    | "cancelled"
    | "refunded"
    | "mismatch"
    | "unknown";
  mismatch: string[];
  payerUrl?: string;
  paymentId?: string;
  lastReconciledAt: string;
}
export interface Purchase {
  accessRole?: WorkspaceRole;
  explanation?: TradeoffExplanation;
  id: string;
  workspaceId: string;
  version: number;
  title: string;
  buyerEmail: string;
  status: "draft" | "review" | "frozen" | "revealed" | "awarded";
  synthetic: boolean;
  rubric: Rubric;
  rubricRevision: number;
  rubricCommitted: boolean;
  proposals: Proposal[];
  assessment?: Assessment;
  award?: Award;
  invoice?: Invoice;
  events: AuditEvent[];
  createdAt: string;
  invoiceAttempt?: {
    requestId: string;
    requestedCents: number;
    state: "pending" | "uncertain" | "complete";
  };
}
export type WorkspaceRole = "owner" | "curator" | "reviewer" | "approver";
export interface AuditEvent {
  id: string;
  type: string;
  at: string;
  actor: string;
  detail: string;
  version: number;
}
export interface Score {
  lower: number;
  upper: number;
  coverage: number;
  depositCents: number | null;
  feasibility: "eligible" | "blocked" | "unknown";
  blockers: string[];
  contributions: Record<
    Criterion,
    { lower: number; upper: number; weight: number; formula: string }
  >;
}
export interface Capability {
  mode: "local" | "supabase";
  ai: {
    provider: string;
    configured: boolean;
    qualified: boolean;
    reason: string;
  };
  paypal: { configuredVendors: string[]; qualified: boolean };
  syntheticOnly: boolean;
}
