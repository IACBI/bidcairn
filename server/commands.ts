import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  factKeys,
  rubricSchema,
  type Proposal,
  type Purchase,
} from "../shared/model.js";
import { scoreProposal } from "../shared/scoring.js";
import { ensure } from "./errors.js";
import { hash, validateEvidence } from "./evidence.js";

export function record(
  p: Purchase,
  actor: string,
  type: string,
  detail: string,
) {
  p.events.push({
    id: randomUUID(),
    actor,
    type,
    detail,
    at: new Date().toISOString(),
    version: p.version + 1,
  });
}
export function mutable(p: Purchase) {
  ensure(
    !p.award && !p.invoice,
    "An approved award is immutable. Create a new purchase for revised terms.",
  );
}
export function proposalById(p: Purchase, id: string) {
  const proposal = p.proposals.find((x) => x.id === id);
  ensure(proposal, "Proposal not found.", 404);
  return proposal;
}
function invalidate(p: Purchase) {
  p.assessment = undefined;
  p.explanation = undefined;
  p.status = "review";
}
export function commitBrief(p: Purchase, input: unknown, actor: string) {
  mutable(p);
  const body = z
    .object({
      title: z.string().trim().min(3).max(120),
      buyerEmail: z.string().email(),
      rubric: rubricSchema,
    })
    .strict()
    .parse(input);
  const changedRequirements =
    JSON.stringify(p.rubric.requirements) !==
    JSON.stringify(body.rubric.requirements);
  p.title = body.title;
  p.buyerEmail = body.buyerEmail;
  p.rubric = body.rubric;
  p.rubricRevision++;
  p.rubricCommitted = true;
  if (changedRequirements)
    for (const proposal of p.proposals) {
      proposal.requirements = body.rubric.requirements.map((req) => ({
        requirementId: req.id,
        status: "unclear",
        evidence: null,
        confirmed: false,
      }));
      if (proposal.provenance === "uploaded") {
        proposal.status = "unanalysed";
        proposal.analysis = undefined;
      }
    }
  invalidate(p);
  record(
    p,
    actor,
    "rubric.committed",
    `Rubric revision ${p.rubricRevision} committed. Any earlier assessment is invalidated.`,
  );
}
const correctionSchema = z
  .object({
    value: z.number().nonnegative().nullable(),
    reason: z.string().trim().min(12).max(1000),
  })
  .strict();
export function confirmProposal(
  p: Purchase,
  id: string,
  input: unknown,
  actor: string,
) {
  mutable(p);
  const proposal = proposalById(p, id);
  ensure(
    proposal.status === "ready",
    "Analyze the proposal before confirming evidence.",
  );
  const body = z
    .object({
      corrections: z
        .partialRecord(z.enum(factKeys), correctionSchema)
        .default({}),
      requirementCorrections: z
        .array(
          z
            .object({
              id: z.string(),
              status: z.enum(["supported", "contradicted", "unclear"]),
              reason: z.string().trim().min(12).max(1000),
            })
            .strict(),
        )
        .default([]),
    })
    .strict()
    .parse(input);
  for (const key of factKeys) {
    const correction = body.corrections[key];
    if (correction) {
      if (key === "totalCents")
        ensure(
          correction.value === null || Number.isSafeInteger(correction.value),
          "Total must use whole cents.",
          422,
        );
      if (key === "depositPercent")
        ensure(
          correction.value === null ||
            (correction.value <= 100 &&
              Math.abs(
                correction.value * 100 - Math.round(correction.value * 100),
              ) < 0.00001),
          "Deposit must be between 0 and 100, to two decimal places.",
          422,
        );
      proposal.facts[key] = {
        value: correction.value,
        evidence: null,
        confirmed: true,
        correction: correction.reason,
      };
    } else if (proposal.facts[key].value !== null)
      proposal.facts[key].confirmed = true;
  }
  for (const requirement of proposal.requirements) {
    const correction = body.requirementCorrections.find(
      (x) => x.id === requirement.requirementId,
    );
    if (correction) {
      requirement.status = correction.status;
      requirement.evidence = null;
      record(
        p,
        actor,
        "requirement.corrected",
        `${proposal.alias}, ${requirement.requirementId}: ${correction.reason}`,
      );
    }
    requirement.confirmed = true;
  }
  invalidate(p);
  record(
    p,
    actor,
    "evidence.confirmed",
    `${proposal.alias}: facts and requirement evidence reviewed by a human. ${Object.keys(body.corrections).length} explicit corrections.`,
  );
}
export function proposalDigest(p: Purchase) {
  return hash(
    p.proposals.map((x) => ({
      id: x.id,
      documentHash: x.documentHash,
      facts: x.facts,
      requirements: x.requirements,
      risks: x.risks,
    })),
  );
}
export function freezeAssessment(p: Purchase, input: unknown, actor: string) {
  mutable(p);
  ensure(p.rubricCommitted, "Commit the rubric first.");
  ensure(
    p.status === "review",
    "Complete the review before recording a blind assessment.",
  );
  ensure(p.proposals.length >= 2, "At least two proposals are required.");
  ensure(
    p.proposals.every((x) => x.status === "ready"),
    "Every proposal must finish analysis before freezing the comparison.",
  );
  const body = z
    .object({
      proposalId: z.string(),
      rationale: z.string().trim().min(12).max(2000),
    })
    .strict()
    .parse(input);
  const selected = proposalById(p, body.proposalId);
  ensure(
    scoreProposal(selected, p.rubric).feasibility === "eligible",
    "Resolve the selected proposal’s mandatory scope and financial feasibility first.",
  );
  p.assessment = {
    ...body,
    actor,
    at: new Date().toISOString(),
    rubricRevision: p.rubricRevision,
    proposalHash: proposalDigest(p),
  };
  p.status = "frozen";
  record(p, actor, "assessment.frozen", `${selected.alias}: ${body.rationale}`);
}
export function revealIdentities(p: Purchase, actor: string) {
  ensure(
    p.status === "frozen" && p.assessment,
    "Record the blind assessment before revealing identities.",
  );
  p.status = "revealed";
  for (const proposal of p.proposals) proposal.priorIdentityExposure = true;
  record(
    p,
    actor,
    "identity.revealed",
    "Supplier identities revealed for human due diligence. This is not a purchasing approval.",
  );
}
export function approveAward(p: Purchase, input: unknown, actor: string) {
  ensure(
    p.status === "revealed" && p.assessment && !p.award,
    "Reveal and check supplier identities before approving the award.",
  );
  ensure(
    p.assessment.proposalHash === proposalDigest(p) &&
      p.assessment.rubricRevision === p.rubricRevision,
    "The assessment is stale. Review the current evidence.",
  );
  const body = z
    .object({
      proposalId: z.string(),
      rationale: z.string().trim().min(12).max(2000),
      identityChecked: z.literal(true),
    })
    .strict()
    .parse(input);
  const proposal = proposalById(p, body.proposalId),
    score = scoreProposal(proposal, p.rubric);
  ensure(
    score.feasibility === "eligible" && score.depositCents !== null,
    "The proposal does not satisfy the approved purchasing limits.",
  );
  const award = {
    id: randomUUID(),
    rubricRevision: p.rubricRevision,
    proposalHash: proposalDigest(p),
    proposalId: proposal.id,
    rationale: body.rationale,
    at: new Date().toISOString(),
    actor,
    supplierName: proposal.identity.name,
    totalCents: proposal.facts.totalCents.value!,
    depositCents: score.depositCents,
  };
  p.award = {
    ...award,
    snapshotHash: hash({
      ...award,
      rubric: p.rubric,
      facts: proposal.facts,
      requirements: proposal.requirements,
    }),
  };
  p.status = "awarded";
  record(
    p,
    actor,
    "award.approved",
    `${proposal.identity.name}: ${body.rationale}. Human decision; no payment initiated.`,
  );
}
export function assertExtracted(proposal: Proposal, p: Purchase) {
  validateEvidence(
    {
      facts: Object.fromEntries(
        factKeys.map((key) => [
          key,
          {
            value: proposal.facts[key].value,
            evidence: proposal.facts[key].evidence,
          },
        ]),
      ) as never,
      requirements: proposal.requirements,
      risks: proposal.risks,
    },
    proposal.pages,
    p.rubric.requirements.map((x) => x.id),
  );
}
export function publicPurchase(p: Purchase): Purchase {
  const clone = structuredClone(p);
  const revealed = p.status === "revealed" || p.status === "awarded";
  for (const proposal of clone.proposals) {
    if (!revealed) {
      proposal.identity = { name: "", email: "", filename: "" };
      proposal.vendorId = "";
    }
    proposal.originalPages = [];
  }
  return clone;
}
