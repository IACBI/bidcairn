import { randomUUID } from "node:crypto";
import type {
  Fact,
  FactKey,
  Proposal,
  Purchase,
  Rubric,
} from "../shared/model.js";
import { hash, maskIdentity } from "./evidence.js";

export const defaultRubric: Rubric = {
  budgetCents: 1_250_000,
  targetPriceCents: 900_000,
  goodDays: 20,
  badDays: 30,
  goodWarranty: 60,
  badWarranty: 7,
  maxUpfrontCents: 300_000,
  weights: { price: 30, scope: 30, delivery: 15, warranty: 15, upfront: 10 },
  requirements: [
    {
      id: "migration",
      label: "Migrate all existing website content",
      mandatory: true,
    },
    {
      id: "redirects",
      label: "Provide a complete redirect map",
      mandatory: true,
    },
    {
      id: "handover",
      label: "Hand over administrator access and documentation",
      mandatory: true,
    },
    {
      id: "testing",
      label: "Complete acceptance testing before launch",
      mandatory: true,
    },
    {
      id: "rollback",
      label: "Include a tested rollback plan",
      mandatory: false,
    },
  ],
};
export const blankFacts = () =>
  Object.fromEntries(
    [
      "totalCents",
      "deliveryDays",
      "warrantyDays",
      "depositPercent",
      "slaHours",
    ].map((key) => [key, { value: null, evidence: null, confirmed: false }]),
  ) as Record<FactKey, Fact>;

export function createPurchase(
  workspaceId: string,
  reference = true,
): Purchase {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    workspaceId,
    version: 1,
    title: reference
      ? "Website migration partner"
      : "Untitled service purchase",
    buyerEmail: "buyer@example.com",
    status: reference ? "review" : "draft",
    synthetic: true,
    rubric: structuredClone(defaultRubric),
    rubricRevision: 1,
    rubricCommitted: reference,
    proposals: reference ? referenceProposals() : [],
    events: [
      {
        id: randomUUID(),
        type: reference ? "reference.loaded" : "purchase.created",
        at: now,
        actor: workspaceId,
        detail: reference
          ? "Original synthetic reference pack loaded. Curated reference facts, not an AI analysis."
          : "A new service purchase was created.",
        version: 1,
      },
    ],
    createdAt: now,
  };
}

function referenceProposals(): Proposal[] {
  const sources = [
    {
      vendorId: "A",
      name: "Northline Studio",
      email: "northline@example.com",
      total: 900000,
      days: 20,
      warranty: 30,
      percent: 80,
      sla: 8,
      commercial:
        "Fixed all-inclusive project price: USD 9,000.00. An 80% deposit is due on approval; the remaining 20% is due after acceptance. Delivery: 20 calendar days from deposit payment. Defect warranty: 30 days. Support response: 8 hours.",
      scope:
        "Scope includes migration of all existing website content, a complete redirect map, administrator access and documentation handover, acceptance testing before launch, and a tested rollback plan.",
      risk: "An 80% deposit is due on approval; the remaining 20% is due after acceptance.",
      riskTitle: "Most of the fee is payable before delivery",
      severity: "warning" as const,
    },
    {
      vendorId: "B",
      name: "Fieldwork Digital",
      email: "fieldwork@example.com",
      total: 1100000,
      days: 25,
      warranty: 60,
      percent: 20,
      sla: 4,
      commercial:
        "Fixed all-inclusive project price: USD 11,000.00. A 20% deposit is due on approval; the remaining 80% is due after written acceptance. Delivery: 25 calendar days from deposit payment. Defect warranty: 60 days. Support response: 4 hours.",
      scope:
        "Scope includes migration of all existing website content, a complete redirect map, administrator access and documentation handover, acceptance testing before launch, and a tested rollback plan.",
      risk: "Delivery: 25 calendar days from deposit payment.",
      riskTitle: "Delivery starts after the deposit is paid",
      severity: "info" as const,
    },
    {
      vendorId: "C",
      name: "Copper Finch",
      email: "copperfinch@example.com",
      total: 1050000,
      days: 28,
      warranty: 7,
      percent: 25,
      sla: null,
      commercial:
        "Fixed all-inclusive project price: USD 10,500.00. A 25% deposit is due on approval; the remaining 75% is due after launch. Delivery: 28 calendar days from deposit payment. Defect warranty: 7 days. Support is provided on a best-effort basis; no response-time commitment is stated.",
      scope:
        "Scope includes migration of all existing website content, a complete redirect map, administrator access and documentation handover, and acceptance testing before launch. Rollback support can be scoped separately after discovery.",
      risk: "Rollback support can be scoped separately after discovery.",
      riskTitle: "Rollback scope and its possible fee are unresolved",
      severity: "warning" as const,
    },
  ];
  // The aliases are intentionally assigned independently of supplier identity.
  const shuffled = sources
    .map((source) => ({ source, order: randomUUID() }))
    .sort((a, b) => a.order.localeCompare(b.order));
  return shuffled.map(({ source: s }, i) => {
    const originalPages = [
      {
        page: 1,
        text: `${s.name}\n${s.email}\nWebsite migration proposal\n${s.commercial}`,
      },
      { page: 2, text: `${s.name}\nStatement of work\n${s.scope}` },
    ];
    const pages = originalPages.map((p) => ({
      ...p,
      text: maskIdentity(p.text, [s.name]),
    }));
    const fact = (value: number | null, quote: string): Fact => ({
      value,
      evidence: value === null ? null : { page: 1, quote },
      confirmed: false,
    });
    return {
      id: randomUUID(),
      alias: `Proposal ${String.fromCharCode(65 + i)}`,
      vendorId: s.vendorId,
      identity: {
        name: s.name,
        email: s.email,
        filename: `${s.name.toLowerCase().replaceAll(" ", "-")}.pdf`,
      },
      pages,
      originalPages,
      documentHash: hash(originalPages),
      provenance: "reference",
      status: "ready",
      priorIdentityExposure: false,
      facts: {
        totalCents: fact(s.total, s.commercial.split(".00.")[0] + ".00."),
        deliveryDays: fact(
          s.days,
          `Delivery: ${s.days} calendar days from deposit payment.`,
        ),
        warrantyDays: fact(s.warranty, `Defect warranty: ${s.warranty} days.`),
        depositPercent: fact(
          s.percent,
          s.commercial.match(/(?:An? )\d+% deposit[^.]+\./)![0],
        ),
        slaHours: fact(
          s.sla,
          s.sla === null ? "" : `Support response: ${s.sla} hours.`,
        ),
      },
      requirements: defaultRubric.requirements.map((req) => ({
        requirementId: req.id,
        status:
          s.vendorId === "C" && req.id === "rollback"
            ? ("unclear" as const)
            : ("supported" as const),
        evidence: { page: 2, quote: s.scope },
        confirmed: false,
      })),
      risks: [
        {
          title: s.riskTitle,
          severity: s.severity,
          explanation:
            s.vendorId === "C"
              ? "The proposal does not establish a fixed rollback scope or price. Clarify before relying on it."
              : s.vendorId === "A"
                ? "The stated deposit increases upfront cash exposure. Its feasibility is calculated separately against your cash limit."
                : "Confirm that the deposit timing leaves enough time before the required launch.",
          evidence: { page: s.vendorId === "C" ? 2 : 1, quote: s.risk },
        },
      ],
    };
  });
}
