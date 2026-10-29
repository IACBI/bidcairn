import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import type { Purchase, Rubric } from "../../shared/model.js";
import { criterionKeys } from "../../shared/fields.js";
import { scoreProposal } from "../../shared/scoring.js";
import { Modal } from "./Modal.js";
import { criterionLabels } from "./presentation.js";
export function RubricDialog({
  purchase,
  scenarioCash,
  busy,
  onClose,
  onSave,
}: {
  purchase: Purchase;
  scenarioCash: number | null;
  busy: boolean;
  onClose: () => void;
  onSave: (body: unknown) => void;
}) {
  const [rubric, setRubric] = useState<Rubric>({
    ...purchase.rubric,
    maxUpfrontCents: scenarioCash ?? purchase.rubric.maxUpfrontCents,
  });
  const [title, setTitle] = useState(purchase.title),
    [email, setEmail] = useState(purchase.buyerEmail);
  const weightTotal = Object.values(rubric.weights).reduce((a, b) => a + b, 0);
  function field(key: keyof Rubric, label: string, currency = false) {
    return (
      <label className="field">
        <span>{label}</span>
        <input
          type="number"
          min="0"
          step={currency ? ".01" : "1"}
          value={Number(rubric[key]) / (currency ? 100 : 1)}
          onChange={(e) =>
            setRubric({
              ...rubric,
              [key]: Math.round(Number(e.target.value) * (currency ? 100 : 1)),
            })
          }
        />
      </label>
    );
  }
  return (
    <Modal
      title="Commit the purchasing rubric"
      subtitle="Changes create a new version and invalidate the previous blind assessment."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ title, buyerEmail: email, rubric });
        }}
      >
        <div className="modal-body">
          <label className="field">
            <span>Purchase title</span>
            <input
              required
              minLength={3}
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Sandbox buyer email</span>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <div className="form-grid">
            {field("budgetCents", "Maximum total (USD)", true)}
            {field("targetPriceCents", "Good price anchor (USD)", true)}
            {field("maxUpfrontCents", "Upfront cash limit (USD)", true)}
            {field("goodDays", "Good delivery anchor (days)")}
            {field("badDays", "Latest delivery (days)")}
            {field("goodWarranty", "Good warranty anchor (days)")}
            {field("badWarranty", "Minimum warranty anchor (days)")}
          </div>
          <h3>Required deliverables</h3>
          <p className="small muted">
            Changing scope clears previous requirement confirmations. Uploaded
            proposals need reanalysis.
          </p>
          <div className="requirements-editor">
            {rubric.requirements.map((requirement, index) => (
              <div className="requirement-edit" key={requirement.id}>
                <label className="field">
                  <span>Deliverable {index + 1}</span>
                  <input
                    required
                    maxLength={300}
                    value={requirement.label}
                    onChange={(e) =>
                      setRubric({
                        ...rubric,
                        requirements: rubric.requirements.map((r) =>
                          r.id === requirement.id
                            ? { ...r, label: e.target.value }
                            : r,
                        ),
                      })
                    }
                  />
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={requirement.mandatory}
                    onChange={(e) =>
                      setRubric({
                        ...rubric,
                        requirements: rubric.requirements.map((r) =>
                          r.id === requirement.id
                            ? { ...r, mandatory: e.target.checked }
                            : r,
                        ),
                      })
                    }
                  />
                  Mandatory
                </label>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Remove deliverable ${index + 1}`}
                  disabled={rubric.requirements.length === 1}
                  onClick={() =>
                    setRubric({
                      ...rubric,
                      requirements: rubric.requirements.filter(
                        (r) => r.id !== requirement.id,
                      ),
                    })
                  }
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              className="button secondary compact"
              type="button"
              disabled={rubric.requirements.length >= 20}
              onClick={() =>
                setRubric({
                  ...rubric,
                  requirements: [
                    ...rubric.requirements,
                    { id: crypto.randomUUID(), label: "", mandatory: true },
                  ],
                })
              }
            >
              <Plus size={15} />
              Add deliverable
            </button>
          </div>
          <h3>
            Weights{" "}
            <span className={weightTotal === 100 ? "muted" : "error-text"}>
              {weightTotal}/100
            </span>
          </h3>
          <div className="weights-form">
            {criterionKeys.map((key) => (
              <label key={key}>
                <span>{criterionLabels[key]}</span>
                <input
                  type="number"
                  aria-label={`${criterionLabels[key]} weight`}
                  min="0"
                  max="100"
                  value={rubric.weights[key]}
                  onChange={(e) =>
                    setRubric({
                      ...rubric,
                      weights: {
                        ...rubric.weights,
                        [key]: Number(e.target.value),
                      },
                    })
                  }
                />
                <span>%</span>
              </label>
            ))}
          </div>
          <details className="formula-details">
            <summary>Inspect the calculation rules</summary>
            <p>
              Numeric criteria use the committed good/bad anchors, bounded from
              zero to one, multiplied by their weights. Scope uses confirmed
              matches. Unknown or unconfirmed inputs contribute their full
              possible range. Mandatory scope and purchasing limits are separate
              eligibility gates.
            </p>
            {purchase.proposals[0] &&
              criterionKeys.map((key) => (
                <p key={key}>
                  <strong>{criterionLabels[key]}:</strong>{" "}
                  {
                    scoreProposal(purchase.proposals[0], rubric).contributions[
                      key
                    ].formula
                  }
                </p>
              ))}
          </details>
        </div>
        <div className="modal-foot">
          <span className="small muted">
            Weights must total 100. Original source files do not change.
          </span>
          <button
            className="button primary"
            type="submit"
            disabled={busy || weightTotal !== 100}
          >
            Commit rubric v{purchase.rubricRevision + 1}
            <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
