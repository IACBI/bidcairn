import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  CheckCheck,
  FileText,
  TriangleAlert,
} from "lucide-react";
import type { FactKey, Proposal, Purchase } from "../../shared/model.js";
import { factKeys } from "../../shared/fields.js";
import { Modal } from "./Modal.js";
import { labels, formatFact } from "./presentation.js";
export function EvidenceDialog({
  proposal,
  purchase,
  busy,
  onClose,
  onConfirm,
}: {
  proposal: Proposal;
  purchase: Purchase;
  busy: boolean;
  onClose: () => void;
  onConfirm: (body: unknown) => void;
}) {
  const [page, setPage] = useState(1),
    [edit, setEdit] = useState(false),
    [corrections, setCorrections] = useState<
      Partial<Record<FactKey, { value: number | null; reason: string }>>
    >({});
  const [requirementCorrections, setRequirementCorrections] = useState<
    Record<string, { status: string; reason: string }>
  >({});
  const source = proposal.pages.find((p) => p.page === page);
  const isLocked = Boolean(purchase.award) || proposal.status !== "ready";
  const invalidCorrection =
    Object.values(corrections).some((c) => !c || c.reason.trim().length < 12) ||
    Object.values(requirementCorrections).some(
      (c) => c.reason.trim().length < 12,
    );
  return (
    <Modal
      title={proposal.alias}
      subtitle={`${proposal.pages.length} source pages · ${proposal.analysis ? `${proposal.analysis.provider} / ${proposal.analysis.model}` : "Curated reference facts, not an AI analysis"}`}
      onClose={onClose}
      wide
    >
      <div className="evidence-dialog-grid">
        <div className="evidence-fields">
          <div className="row-between">
            <h3>Facts to verify</h3>
            <button
              className="button text compact"
              onClick={() => setEdit(!edit)}
              disabled={isLocked}
            >
              {edit ? "Finish editing" : "Correct a fact"}
            </button>
          </div>
          {factKeys.map((key) => (
            <div className="review-fact" key={key}>
              <div className="row-between">
                <span>{labels[key]}</span>
                <strong>
                  {formatFact(
                    key,
                    corrections[key]?.value ?? proposal.facts[key].value,
                  )}
                </strong>
              </div>
              {proposal.facts[key].evidence ? (
                <button
                  className="quote-button"
                  onClick={() => setPage(proposal.facts[key].evidence!.page)}
                >
                  “{proposal.facts[key].evidence!.quote}”
                  <span>
                    Source page {proposal.facts[key].evidence!.page}
                    <ArrowUpRight size={12} />
                  </span>
                </button>
              ) : (
                <p className="small muted">
                  {proposal.facts[key].correction ||
                    "No supporting commitment was found. This remains unknown."}
                </p>
              )}
              {edit && (
                <div className="correction-inputs">
                  <input
                    aria-label={`Correct ${labels[key]}`}
                    placeholder={key === "totalCents" ? "USD amount" : "Value"}
                    type="number"
                    min="0"
                    step={
                      key === "totalCents" || key === "depositPercent"
                        ? ".01"
                        : "1"
                    }
                    onChange={(e) =>
                      setCorrections({
                        ...corrections,
                        [key]: {
                          value:
                            e.target.value === ""
                              ? null
                              : key === "totalCents"
                                ? Math.round(Number(e.target.value) * 100)
                                : Number(e.target.value),
                          reason: corrections[key]?.reason || "",
                        },
                      })
                    }
                  />
                  <input
                    aria-label={`Reason for correcting ${labels[key]}`}
                    placeholder="Reason and supporting clarification (12+ characters)"
                    onChange={(e) =>
                      setCorrections({
                        ...corrections,
                        [key]: {
                          value:
                            corrections[key]?.value ??
                            proposal.facts[key].value,
                          reason: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              )}
            </div>
          ))}
          <h3 className="section-subtitle">Requirement evidence</h3>
          {purchase.rubric.requirements.map((req) => {
            const result = proposal.requirements.find(
              (x) => x.requirementId === req.id,
            );
            return (
              <div className="requirement-evidence" key={req.id}>
                <div className="row-between">
                  <strong>{req.label}</strong>
                  <span
                    className={`badge ${result?.status === "supported" ? "green" : ""}`}
                  >
                    {result?.status || "unclear"}
                  </span>
                </div>
                {result?.evidence && (
                  <button
                    className="quote-button"
                    onClick={() => setPage(result.evidence!.page)}
                  >
                    “{result.evidence.quote}”
                  </button>
                )}
                {edit && (
                  <>
                    <select
                      aria-label={`Correct ${req.label}`}
                      value={
                        requirementCorrections[req.id]?.status ||
                        result?.status ||
                        "unclear"
                      }
                      onChange={(e) =>
                        setRequirementCorrections({
                          ...requirementCorrections,
                          [req.id]: {
                            status: e.target.value,
                            reason:
                              requirementCorrections[req.id]?.reason || "",
                          },
                        })
                      }
                    >
                      <option value="supported">Supported</option>
                      <option value="contradicted">Contradicted</option>
                      <option value="unclear">Unclear</option>
                    </select>
                    {requirementCorrections[req.id] && (
                      <input
                        placeholder="Supporting clarification (12+ characters)"
                        aria-label={`Reason for ${req.label}`}
                        onChange={(e) =>
                          setRequirementCorrections({
                            ...requirementCorrections,
                            [req.id]: {
                              ...requirementCorrections[req.id],
                              reason: e.target.value,
                            },
                          })
                        }
                      />
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
        <aside className="source-view">
          <div className="source-toolbar">
            <span>
              <FileText size={14} />
              Sanitized source text
            </span>
            <div>
              {proposal.pages.map((p) => (
                <button
                  key={p.page}
                  className={page === p.page ? "active" : ""}
                  onClick={() => setPage(p.page)}
                  aria-label={`Show source page ${p.page}`}
                >
                  {p.page}
                </button>
              ))}
            </div>
          </div>
          <div className="source-paper">
            <span className="eyebrow">
              {proposal.alias.toUpperCase()} · PAGE {page}
            </span>
            <pre>{source?.text}</pre>
            <div className="source-watermark">
              SYNTHETIC DOCUMENT · IDENTITY MASKED
            </div>
          </div>
          <p className="small muted">
            Names, configured identity terms, contact details and links are
            masked. Distinctive language may still reveal a supplier.
          </p>
          {proposal.priorIdentityExposure && (
            <p className="small exposure-note">
              <TriangleAlert size={14} />
              Prior identity exposure is recorded for this proposal.
            </p>
          )}
          {["revealed", "awarded"].includes(purchase.status) && (
            <a
              className="button text"
              href={`/api/purchases/${purchase.id}/proposals/${proposal.id}/document`}
              download
            >
              Download original PDF
              <ArrowDownToLine size={14} />
            </a>
          )}
        </aside>
      </div>
      <div className="modal-foot">
        <p className="small muted">
          Confirmation records your review. Unknown terms remain unknown.
        </p>
        <button
          className="button primary"
          disabled={busy || isLocked || invalidCorrection}
          onClick={() =>
            onConfirm({
              corrections,
              requirementCorrections: Object.entries(
                requirementCorrections,
              ).map(([id, value]) => ({ id, ...value })),
            })
          }
        >
          <CheckCheck size={16} />
          Confirm reviewed evidence
        </button>
      </div>
    </Modal>
  );
}
