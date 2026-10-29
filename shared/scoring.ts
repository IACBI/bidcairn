import type { Criterion, Proposal, Rubric, Score } from "./model.js";

export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function depositCents(total: number, percent: number): number {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100 ||
    Math.abs(percent * 100 - Math.round(percent * 100)) > 0.00001
  )
    throw new Error("Invalid deposit terms.");
  return Number(
    (BigInt(total) * BigInt(Math.round(percent * 100)) + 5000n) / 10000n,
  );
}
export function scoreProposal(p: Proposal, r: Rubric): Score {
  const known = (key: keyof Proposal["facts"]) =>
    p.facts[key].confirmed ? p.facts[key].value : null;
  const total = known("totalCents"),
    days = known("deliveryDays"),
    warranty = known("warrantyDays"),
    percent = known("depositPercent");
  const deposit =
    total === null || percent === null ? null : depositCents(total, percent);
  const requirements = r.requirements.map((req) => ({
    req,
    result: p.requirements.find((x) => x.requirementId === req.id),
  }));
  const supported = requirements.filter(
    (x) => x.result?.confirmed && x.result.status === "supported",
  ).length;
  const unresolved = requirements.filter(
    (x) => !x.result?.confirmed || x.result.status === "unclear",
  ).length;
  const utilities: Record<Criterion, [number, number, string]> = {
    price:
      total === null
        ? [0, 1, "Unconfirmed total: full score range"]
        : [
            clamp(
              (r.budgetCents - total) / (r.budgetCents - r.targetPriceCents),
            ),
            clamp(
              (r.budgetCents - total) / (r.budgetCents - r.targetPriceCents),
            ),
            "(budget − total) / (budget − target), bounded 0–1",
          ],
    scope: [
      supported / requirements.length,
      (supported + unresolved) / requirements.length,
      "Confirmed supported deliverables / all requested deliverables",
    ],
    delivery:
      days === null
        ? [0, 1, "Unconfirmed delivery: full score range"]
        : [
            clamp((r.badDays - days) / (r.badDays - r.goodDays)),
            clamp((r.badDays - days) / (r.badDays - r.goodDays)),
            "(latest − delivery days) / (latest − target days), bounded 0–1",
          ],
    warranty:
      warranty === null
        ? [0, 1, "Unconfirmed warranty: full score range"]
        : [
            clamp(
              (warranty - r.badWarranty) / (r.goodWarranty - r.badWarranty),
            ),
            clamp(
              (warranty - r.badWarranty) / (r.goodWarranty - r.badWarranty),
            ),
            "(warranty days − minimum) / (target − minimum), bounded 0–1",
          ],
    upfront:
      deposit === null
        ? [0, 1, "Unconfirmed deposit: full score range"]
        : [
            r.maxUpfrontCents === 0
              ? Number(deposit === 0)
              : clamp(1 - deposit / r.maxUpfrontCents),
            r.maxUpfrontCents === 0
              ? Number(deposit === 0)
              : clamp(1 - deposit / r.maxUpfrontCents),
            "1 − deposit / upfront cap, bounded 0–1",
          ],
  };
  const contributions = Object.fromEntries(
    Object.entries(utilities).map(([key, [low, high, formula]]) => [
      key,
      {
        lower: low * r.weights[key as Criterion],
        upper: high * r.weights[key as Criterion],
        weight: r.weights[key as Criterion],
        formula,
      },
    ]),
  ) as Score["contributions"];
  const blockers: string[] = [];
  if (total !== null && total > r.budgetCents)
    blockers.push("Total exceeds the purchase budget");
  if (deposit !== null && deposit > r.maxUpfrontCents)
    blockers.push("Deposit exceeds the upfront cash limit");
  if (days !== null && days > r.badDays)
    blockers.push("Delivery exceeds the latest acceptable date");
  for (const { req, result } of requirements)
    if (req.mandatory && result?.confirmed && result.status === "contradicted")
      blockers.push(`Required scope excluded: ${req.label}`);
  const mandatoryUnknown = requirements.some(
    (x) =>
      x.req.mandatory &&
      (!x.result?.confirmed || x.result.status === "unclear"),
  );
  return {
    lower: Object.values(contributions).reduce((a, x) => a + x.lower, 0),
    upper: Object.values(contributions).reduce((a, x) => a + x.upper, 0),
    coverage: Object.values(contributions)
      .filter((x) => x.lower === x.upper)
      .reduce((a, x) => a + x.weight, 0),
    depositCents: deposit,
    feasibility: blockers.length
      ? "blocked"
      : total === null || days === null || deposit === null || mandatoryUnknown
        ? "unknown"
        : "eligible",
    blockers,
    contributions,
  };
}
