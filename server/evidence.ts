import { createHash } from "node:crypto";
import type { Extraction, Proposal } from "../shared/model.js";
import { AppError } from "./errors.js";
export const hash = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export const normalize = (value: string) =>
  value.normalize("NFKC").replace(/\s+/g, " ").trim();
export function maskIdentity(text: string, names: string[]): string {
  let result = text
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[contact hidden]")
    .replace(/https?:\/\/[^\s)]+/gi, "[link hidden]")
    .replace(/(?:\+\d[\d ().-]{7,}\d)/g, "[phone hidden]");
  for (const name of [...names]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length))
    result = result.replace(
      new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
      "[supplier hidden]",
    );
  return result;
}
export function validateEvidence(
  extraction: Extraction,
  pages: Proposal["pages"],
  requirementIds: string[],
): void {
  const citations = [
    ...Object.values(extraction.facts)
      .filter((x) => x.value !== null)
      .map((x) => x.evidence),
    ...extraction.requirements
      .filter((x) => x.status !== "unclear")
      .map((x) => x.evidence),
    ...extraction.risks.map((x) => x.evidence),
  ];
  for (const evidence of citations) {
    if (
      !evidence ||
      !pages.some(
        (page) =>
          page.page === evidence.page &&
          normalize(page.text).includes(normalize(evidence.quote)),
      )
    )
      throw new AppError(
        422,
        "An analysis citation could not be verified against its source page.",
        "INVALID_EVIDENCE",
      );
  }
  if (
    extraction.facts.totalCents.value !== null &&
    !Number.isSafeInteger(extraction.facts.totalCents.value)
  )
    throw new AppError(422, "Total must be an integer number of cents.");
  const percent = extraction.facts.depositPercent.value;
  if (
    percent !== null &&
    (percent > 100 ||
      Math.abs(percent * 100 - Math.round(percent * 100)) > 0.00001)
  )
    throw new AppError(422, "Invalid extracted deposit percentage.");
  if (
    extraction.requirements.length !== requirementIds.length ||
    new Set(extraction.requirements.map((x) => x.requirementId)).size !==
      requirementIds.length ||
    extraction.requirements.some(
      (x) => !requirementIds.includes(x.requirementId),
    )
  )
    throw new AppError(
      422,
      "The analysis must account for every requested requirement exactly once.",
    );
}
