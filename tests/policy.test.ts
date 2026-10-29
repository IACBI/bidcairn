import { describe, expect, it } from "vitest";
import { createPurchase } from "../server/reference.js";
import {
  confirmProposal,
  freezeAssessment,
  revealIdentities,
  approveAward,
  commitBrief,
  publicPurchase,
  assertExtracted,
} from "../server/commands.js";
import { depositCents, scoreProposal } from "../shared/scoring.js";
import { maskIdentity } from "../server/evidence.js";

function reviewed() {
  const p = createPurchase("reviewer");
  for (const proposal of p.proposals)
    confirmProposal(p, proposal.id, {}, "reviewer");
  return p;
}
describe("deterministic purchasing policy", () => {
  it("retains the full score interval before confirmation", () => {
    const p = createPurchase("owner");
    for (const proposal of p.proposals) {
      const score = scoreProposal(proposal, p.rubric);
      expect(score.lower).toBe(0);
      expect(score.upper).toBe(100);
      expect(score.feasibility).toBe("unknown");
    }
  });
  it("blocks the cheapest proposal for exceeding upfront cash, regardless of its score", () => {
    const p = reviewed();
    const proposal = p.proposals.find((x) => x.vendorId === "A")!;
    const result = scoreProposal(proposal, p.rubric);
    expect(result.depositCents).toBe(720000);
    expect(result.feasibility).toBe("blocked");
    expect(() =>
      freezeAssessment(
        p,
        {
          proposalId: proposal.id,
          rationale: "I prefer the cheapest supplier.",
        },
        "reviewer",
      ),
    ).toThrow(/financial feasibility/);
  });
  it("makes a cash scenario deterministic without mutating the committed rubric", () => {
    const p = reviewed();
    const proposal = p.proposals.find((x) => x.vendorId === "A")!;
    expect(
      scoreProposal(proposal, { ...p.rubric, maxUpfrontCents: 800000 })
        .feasibility,
    ).toBe("eligible");
    expect(p.rubric.maxUpfrontCents).toBe(300000);
  });
  it("rounds deposits to cents and rejects invalid amounts", () => {
    expect(depositCents(101, 50)).toBe(51);
    expect(depositCents(1100000, 20)).toBe(220000);
    expect(() => depositCents(100, 120)).toThrow();
    expect(() => depositCents(1.5, 10)).toThrow();
  });
  it("requires assessment, reveal and explicit human identity check before award", () => {
    const p = reviewed(),
      proposal = p.proposals.find((x) => x.vendorId === "B")!;
    expect(() => revealIdentities(p, "reviewer")).toThrow();
    expect(() => approveAward(p, {}, "reviewer")).toThrow();
    freezeAssessment(
      p,
      {
        proposalId: proposal.id,
        rationale: "The lower deposit and stronger warranty fit our purchase.",
      },
      "reviewer",
    );
    revealIdentities(p, "reviewer");
    expect(() =>
      approveAward(
        p,
        {
          proposalId: proposal.id,
          rationale: "A considered supplier selection.",
        },
        "reviewer",
      ),
    ).toThrow();
    approveAward(
      p,
      {
        proposalId: proposal.id,
        rationale:
          "Identity checked and the contractual trade-offs are accepted.",
        identityChecked: true,
      },
      "reviewer",
    );
    expect(p.award?.depositCents).toBe(220000);
    expect(p.award?.snapshotHash).toHaveLength(64);
    expect(() => commitBrief(p, {}, "reviewer")).toThrow(/immutable/);
  });
  it("invalidates a frozen assessment when a rubric changes", () => {
    const p = reviewed(),
      proposal = p.proposals.find((x) => x.vendorId === "B")!;
    freezeAssessment(
      p,
      {
        proposalId: proposal.id,
        rationale: "The proposal fits the reviewed purchase.",
      },
      "reviewer",
    );
    commitBrief(
      p,
      {
        title: p.title,
        buyerEmail: p.buyerEmail,
        rubric: { ...p.rubric, maxUpfrontCents: 200000 },
      },
      "reviewer",
    );
    expect(p.assessment).toBeUndefined();
    expect(p.status).toBe("review");
    expect(p.rubricRevision).toBe(2);
  });
  it("hides identities, original source text and merchant mapping before reveal", () => {
    const p = createPurchase("owner");
    const projected = publicPurchase(p);
    for (const proposal of projected.proposals) {
      expect(proposal.vendorId).toBe("");
      expect(proposal.identity.name).toBe("");
      expect(proposal.originalPages).toEqual([]);
      expect(proposal.pages[0].text).toContain("[supplier hidden]");
    }
    expect(JSON.stringify(projected)).not.toMatch(
      /Northline|Fieldwork Digital|Copper Finch|northline@example/,
    );
  });
  it("provides verifiable original citations in every reference proposal", () => {
    const p = createPurchase("owner");
    for (const proposal of p.proposals)
      expect(() => assertExtracted(proposal, p)).not.toThrow();
  });
  it("masks configured names with regex characters and contact links", () => {
    expect(
      maskIdentity("A+B hello@example.com https://example.com", ["A+B"]),
    ).toBe("[supplier hidden] [contact hidden] [link hidden]");
  });
  it("preserves uncertainty for missing SLA instead of manufacturing a term", () => {
    const p = reviewed();
    const proposal = p.proposals.find((x) => x.vendorId === "C")!;
    expect(proposal.facts.slaHours.value).toBeNull();
    expect(proposal.facts.slaHours.confirmed).toBe(false);
    expect(
      proposal.requirements.find((x) => x.requirementId === "rollback")?.status,
    ).toBe("unclear");
  });
});
