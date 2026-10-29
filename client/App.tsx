import { Modal, DialogErrorContext } from "./components/Modal.js";
import { EvidenceDialog } from "./components/EvidenceDialog.js";
import { RubricDialog } from "./components/RubricDialog.js";
import { UploadDialog } from "./components/UploadDialog.js";
import { money, labels, formatFact, Mark } from "./components/presentation.js";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Database,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  Layers3,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  Plus,
  Scale,
  Settings2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import type { Capability, Purchase } from "../shared/model.js";
import { factKeys } from "../shared/fields.js";
import { depositCents, scoreProposal } from "../shared/scoring.js";
import { api, session, signIn } from "./api.js";

const steps = [
  { name: "Brief", icon: ClipboardCheck },
  { name: "Evidence", icon: FileText },
  { name: "Compare", icon: Scale },
  { name: "Award", icon: ShieldCheck },
  { name: "Payment", icon: Wallet },
];
type Stage = (typeof steps)[number]["name"];

export function App() {
  const [purchase, setPurchase] = useState<Purchase | null>(null),
    [capabilities, setCapabilities] = useState<Capability | null>(null);
  const [list, setList] = useState<
    { id: string; title: string; status: string }[]
  >([]);
  const [stage, setStage] = useState<Stage>("Compare"),
    [booting, setBooting] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [reviewId, setReviewId] = useState<string | null>(null),
    [audit, setAudit] = useState(false),
    [upload, setUpload] = useState(false),
    [rubricOpen, setRubricOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false),
    [deleteOpen, setDeleteOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState(""),
    [loginPassword, setLoginPassword] = useState(""),
    [deleteText, setDeleteText] = useState("");
  const [selected, setSelected] = useState(""),
    [rationale, setRationale] = useState(""),
    [identityChecked, setIdentityChecked] = useState(false),
    [cashCap, setCashCap] = useState<number | null>(null);
  const currentVersion = useRef(purchase);
  currentVersion.current = purchase;
  async function refreshList() {
    setList(await api("/purchases"));
  }
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await session();
        const [items, caps] = await Promise.all([
          api<typeof list>("/purchases"),
          api<Capability>("/capabilities"),
        ]);
        if (!active) return;
        setList(items);
        setCapabilities(caps);
        const id = localStorage.getItem("bidcairn-purchase");
        const item = items.find((x) => x.id === id) || items[0];
        if (item) setPurchase(await api(`/purchases/${item.id}`));
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setBooting(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  async function work(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create(reference: boolean) {
    await work(async () => {
      const p = await api<Purchase>("/purchases", {
        method: "POST",
        body: JSON.stringify({ reference }),
      });
      setPurchase(p);
      localStorage.setItem("bidcairn-purchase", p.id);
      setStage(reference ? "Compare" : "Brief");
      setSelected("");
      setCashCap(null);
      await refreshList();
    });
  }
  async function command(path: string, body: unknown = {}) {
    const p = currentVersion.current!;
    const next = await api<Purchase>(`/purchases/${p.id}${path}`, {
      method: "POST",
      headers: { "If-Match": String(p.version) },
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
    setPurchase(next);
    return next;
  }
  const previewRubric = useMemo(
    () =>
      purchase
        ? {
            ...purchase.rubric,
            maxUpfrontCents: cashCap ?? purchase.rubric.maxUpfrontCents,
          }
        : null,
    [purchase, cashCap],
  );
  const scores =
    purchase && previewRubric
      ? purchase.proposals.map((p) => ({
          proposal: p,
          score: scoreProposal(p, previewRubric),
        }))
      : [];
  const confirmed =
    purchase?.proposals.reduce(
      (n, p) => n + factKeys.filter((key) => p.facts[key].confirmed).length,
      0,
    ) || 0;
  const revealed =
    purchase?.status === "revealed" || purchase?.status === "awarded";
  const review = purchase?.proposals.find((x) => x.id === reviewId);
  const role = purchase?.accessRole || "owner";
  const can = (expected: "curator" | "reviewer" | "approver") =>
    role === "owner" || role === expected;

  return (
    <DialogErrorContext.Provider value={error}>
      <div className="app-shell">
        <aside className="sidebar">
          <a className="brand" href="/" aria-label="Bidcairn home">
            <img src="/favicon.svg" alt="" />
            <span>
              bidcairn<span className="brand-dot">.</span>
            </span>
          </a>
          <div className="workspace-label">
            <span className="workspace-avatar">W</span>
            <div>
              Workspace<span>Service purchasing</span>
            </div>
            <ChevronDown size={15} />
          </div>
          <p className="nav-caption">WORKSPACE</p>
          <button
            className={`nav-item ${stage === "Compare" ? "active" : ""}`}
            onClick={() => setStage("Compare")}
          >
            <LayoutDashboard size={17} />
            Overview
          </button>
          <button
            className={`nav-item ${stage === "Evidence" ? "active" : ""}`}
            onClick={() => setStage("Evidence")}
          >
            <Layers3 size={17} />
            Proposal evidence
            <span className="nav-count">{purchase?.proposals.length || 0}</span>
          </button>
          <button
            className="nav-item"
            onClick={() => setAudit(true)}
            disabled={!purchase}
          >
            <FileCheck2 size={17} />
            Decision record
          </button>
          <div className="sidebar-divider" />
          <div className="nav-caption row-between">
            PURCHASES
            <button
              className="small-icon"
              aria-label="New purchase"
              onClick={() => void create(false)}
              disabled={busy}
            >
              <Plus size={14} />
            </button>
          </div>
          {list.map((item) => (
            <button
              key={item.id}
              className={`purchase-nav ${item.id === purchase?.id ? "selected" : ""}`}
              onClick={() =>
                void work(async () => {
                  setPurchase(await api(`/purchases/${item.id}`));
                  localStorage.setItem("bidcairn-purchase", item.id);
                  setCashCap(null);
                  setSelected("");
                  setStage("Compare");
                })
              }
            >
              <span className="nav-dot" />
              {item.title}
            </button>
          ))}
          <div className="sidebar-bottom">
            <div className="principle-card">
              <ShieldCheck size={19} />
              <strong>
                Your decision.
                <br />A clearer foundation.
              </strong>
              <p>
                Evidence supports the choice.
                <br />
                People make it.
              </p>
            </div>
            <div className="local-status">
              <span className="green-dot" />
              {capabilities?.mode === "supabase"
                ? "Private hosted storage"
                : "Local evaluation workspace"}
              <CircleHelp size={14} />
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              Workspace
              <ChevronRight size={13} />
              <span>Service purchase</span>
            </div>
            <div className="topbar-right">
              <span className="sandbox-badge">
                <span />
                Sandbox environment
              </span>
              <button
                className="avatar"
                aria-label="Workspace account"
                onClick={() => setAccountOpen(true)}
              >
                YO
              </button>
            </div>
          </header>
          <main>
            {error && (
              <div className="error-banner" role="alert">
                <TriangleAlert size={18} />
                <span>{error}</span>
                <button
                  className="small-icon"
                  onClick={() => setError("")}
                  aria-label="Dismiss error"
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {booting ? (
              <div className="empty-state">
                <Loader2 className="spin" />
                <h2>Opening your workspace</h2>
              </div>
            ) : !purchase ? (
              <div className="welcome">
                <span className="eyebrow">EVIDENCE BEFORE COMMITMENT</span>
                <h1>
                  A clearer view.
                  <br />A considered decision.
                </h1>
                <p>
                  Compare proposals on their merits, understand the trade-offs,
                  <br className="desktop-only" /> and carry your decision all
                  the way to payment.
                </p>
                <div className="welcome-actions">
                  <button
                    className="button primary"
                    onClick={() => void create(true)}
                    disabled={busy}
                  >
                    Explore the reference purchase
                    <ArrowRight size={17} />
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => void create(false)}
                    disabled={busy}
                  >
                    <Plus size={17} />
                    Start a purchase
                  </button>
                </div>
                <div className="welcome-grid">
                  <article>
                    <EyeOff />
                    <h3>Evidence before identity</h3>
                    <p>
                      A committed rubric and a blinded comparison help you
                      examine the terms first.
                    </p>
                  </article>
                  <article>
                    <Scale />
                    <h3>Trade-offs you can inspect</h3>
                    <p>
                      Clear calculations, cited clauses and visible uncertainty.
                      No unexplained AI grades.
                    </p>
                  </article>
                  <article>
                    <Wallet />
                    <h3>Approval through payment</h3>
                    <p>
                      Check the supplier’s deposit invoice against the terms a
                      person approved.
                    </p>
                  </article>
                </div>
                <div className="reference-note">
                  <Database size={15} />
                  The reference purchase uses original synthetic proposals and
                  curated facts. It is not a live AI run.
                </div>
              </div>
            ) : (
              <>
                <div className="purchase-heading">
                  <div>
                    <div className="eyebrow">
                      <span className="green-dot" />
                      SERVICE PURCHASE{" "}
                      <span className="purchase-id">
                        / BC-{purchase.id.slice(0, 6).toUpperCase()}
                      </span>
                    </div>
                    <h1>{purchase.title}</h1>
                    <p className="muted">
                      Compare what matters. Keep the evidence.
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => setAudit(true)}
                  >
                    <ArrowDownToLine size={16} />
                    Decision record
                  </button>
                </div>
                <div className="stepper" aria-label="Purchase workflow">
                  {steps.map(({ name, icon: Icon }, index) => (
                    <button
                      key={name}
                      onClick={() => setStage(name)}
                      className={`step ${stage === name ? "current" : ""}`}
                    >
                      <span className="step-number">
                        {index === 0 && purchase.rubricCommitted ? (
                          <Check size={15} />
                        ) : (
                          <Icon size={15} />
                        )}
                      </span>
                      <span>{name}</span>
                      <span className="step-index">0{index + 1}</span>
                    </button>
                  ))}
                </div>
                <div className="reference-strip">
                  <span>
                    <Database size={14} />
                    {purchase.synthetic
                      ? "Synthetic evaluation workspace"
                      : "Private service purchase"}
                  </span>
                  <span>
                    {purchase.proposals.some((p) => p.analysis)
                      ? "Runtime analysis is labeled per proposal"
                      : purchase.proposals.some(
                            (p) => p.provenance === "reference",
                          )
                        ? "Curated reference facts · no runtime AI inference"
                        : "No runtime analysis yet"}
                  </span>
                  <button className="strip-link" onClick={() => setAudit(true)}>
                    View provenance
                    <ArrowUpRight size={13} />
                  </button>
                </div>
                {stage === "Brief" && (
                  <section className="panel brief-panel">
                    <div className="section-heading">
                      <div>
                        <span className="eyebrow">
                          01 / DEFINE THE PURCHASE
                        </span>
                        <h2>Set the terms of a good decision.</h2>
                        <p className="muted">
                          Commit your criteria before reviewing proposals.
                          Changes are versioned.
                        </p>
                      </div>
                      <ClipboardCheck className="section-icon" />
                    </div>
                    <div className="brief-summary">
                      <article>
                        <span>Approved budget</span>
                        <strong>{money(purchase.rubric.budgetCents)}</strong>
                      </article>
                      <article>
                        <span>Latest delivery</span>
                        <strong>{purchase.rubric.badDays} days</strong>
                      </article>
                      <article>
                        <span>Upfront cash limit</span>
                        <strong>
                          {money(purchase.rubric.maxUpfrontCents)}
                        </strong>
                      </article>
                    </div>
                    <h3>Required scope</h3>
                    <ul className="requirements-list">
                      {purchase.rubric.requirements.map((r) => (
                        <li key={r.id}>
                          <Check size={15} />
                          {r.label}
                          <span>{r.mandatory ? "Required" : "Preferred"}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      className="button primary"
                      onClick={() => setRubricOpen(true)}
                      disabled={Boolean(purchase.award)}
                    >
                      <Settings2 size={16} />
                      {purchase.rubricCommitted
                        ? "Edit brief & rubric"
                        : "Commit brief & rubric"}
                    </button>
                  </section>
                )}
                {stage === "Evidence" && (
                  <section className="panel">
                    <div className="section-heading">
                      <div>
                        <span className="eyebrow">02 / REVIEW THE SOURCE</span>
                        <h2>A claim is only as useful as its evidence.</h2>
                        <p className="muted">
                          Inspect the cited terms, correct mistakes and confirm
                          what the proposal establishes.
                        </p>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() => setUpload(true)}
                        disabled={
                          purchase.proposals.length >= 3 ||
                          !purchase.rubricCommitted ||
                          Boolean(purchase.award)
                        }
                      >
                        <Upload size={16} />
                        Add proposal
                      </button>
                    </div>
                    <div className="evidence-grid">
                      {purchase.proposals.map((p) => (
                        <article className="evidence-card" key={p.id}>
                          <div className="row-between">
                            <div className="file-icon">
                              <FileText size={25} />
                            </div>
                            <span className="badge">
                              {p.provenance === "reference"
                                ? "Reference PDF"
                                : "Uploaded PDF"}
                            </span>
                          </div>
                          <h3>{p.alias}</h3>
                          <p>
                            {p.pages.length} pages ·{" "}
                            {p.analysis
                              ? `${p.analysis.provider} analysis`
                              : p.provenance === "reference"
                                ? "Curated reference facts"
                                : "Awaiting runtime analysis"}
                          </p>
                          <div className="evidence-card-stats">
                            <span>
                              {
                                factKeys.filter((key) => p.facts[key].confirmed)
                                  .length
                              }
                              /{factKeys.length} facts confirmed
                            </span>
                            <span>{p.risks.length} observations</span>
                          </div>
                          <button
                            className="button secondary full"
                            onClick={() => setReviewId(p.id)}
                          >
                            Review {p.alias.toLowerCase()}
                            <ArrowRight size={15} />
                          </button>
                          {p.status !== "ready" && (
                            <button
                              className="button text full"
                              disabled={busy || !capabilities?.ai.qualified}
                              onClick={() =>
                                void work(async () => {
                                  await command(`/proposals/${p.id}/analyze`);
                                })
                              }
                            >
                              {busy
                                ? "Analyzing…"
                                : capabilities?.ai.qualified
                                  ? "Run evidence analysis"
                                  : "Runtime provider not qualified"}
                            </button>
                          )}
                        </article>
                      ))}
                      {purchase.proposals.length === 0 && (
                        <div className="empty-state">
                          <Upload />
                          <h3>Add the first proposal</h3>
                          <p>
                            Text-based PDFs only. The hosted evaluation accepts
                            synthetic documents.
                          </p>
                          <button
                            className="button secondary"
                            onClick={() => setUpload(true)}
                            disabled={!purchase.rubricCommitted}
                          >
                            Upload a proposal
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                )}
                {stage === "Compare" && (
                  <>
                    <div className="summary-grid">
                      <article>
                        <span>
                          <Wallet size={14} />
                          PURCHASE BUDGET
                        </span>
                        <strong>{money(purchase.rubric.budgetCents)}</strong>
                        <small>All-inclusive · USD only</small>
                      </article>
                      <article>
                        <span>
                          <Clock3 size={14} />
                          LATEST DELIVERY
                        </span>
                        <strong>
                          {purchase.rubric.badDays}
                          <em> days</em>
                        </strong>
                        <small>From deposit payment</small>
                      </article>
                      <article>
                        <span>
                          <FileCheck2 size={14} />
                          EVIDENCE REVIEW
                        </span>
                        <strong>
                          {confirmed}
                          <em> / {purchase.proposals.length * 5} facts</em>
                        </strong>
                        <small>Confirmed by a human</small>
                      </article>
                      <article>
                        <span>
                          {revealed ? <Eye size={14} /> : <EyeOff size={14} />}
                          IDENTITY STATUS
                        </span>
                        <strong className="text-medium">
                          {revealed ? "Revealed" : "Blinded"}
                        </strong>
                        <small>
                          {revealed
                            ? "Due diligence before approval"
                            : "Supplier names hidden in review"}
                        </small>
                      </article>
                    </div>
                    <div className="comparison-layout">
                      <section className="panel comparison-panel">
                        <div className="section-heading">
                          <div>
                            <h2>
                              Proposal comparison
                              <span className="count-badge">
                                {purchase.proposals.length}
                              </span>
                            </h2>
                            <p className="muted">
                              The same criteria. A clear view of the
                              differences.
                            </p>
                          </div>
                          <button
                            className="button text compact"
                            onClick={() => setRubricOpen(true)}
                            disabled={Boolean(purchase.award)}
                          >
                            <Settings2 size={14} />
                            Rubric v{purchase.rubricRevision}
                          </button>
                        </div>
                        {purchase.proposals.length ? (
                          <div className="table-scroll">
                            <table className="comparison-table">
                              <thead>
                                <tr>
                                  <th>
                                    <span className="table-caption">
                                      EVALUATION CRITERIA
                                    </span>
                                  </th>
                                  {scores.map(({ proposal: p, score }) => (
                                    <th key={p.id}>
                                      <div
                                        className={`proposal-symbol symbol-${purchase.proposals.indexOf(p)}`}
                                      >
                                        {p.alias.slice(-1)}
                                      </div>
                                      <h3>
                                        {revealed ? p.identity.name : p.alias}
                                      </h3>
                                      <span
                                        className={`feasibility ${score.feasibility}`}
                                      >
                                        <span />
                                        {score.feasibility === "eligible"
                                          ? "Within requirements"
                                          : score.feasibility === "blocked"
                                            ? "Outside limits"
                                            : "Needs confirmation"}
                                      </span>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {factKeys.map((key) => (
                                  <tr key={key}>
                                    <th>
                                      {labels[key]}
                                      <small>
                                        {key === "totalCents"
                                          ? "Quoted, all-inclusive"
                                          : key === "depositPercent"
                                            ? "Due on approval"
                                            : key === "slaHours"
                                              ? "Quoted SLA commitment"
                                              : "Quoted commitment"}
                                      </small>
                                    </th>
                                    {purchase.proposals.map((p) => (
                                      <td key={p.id}>
                                        <span
                                          className={`${key === "totalCents" ? "price" : "fact-value"} ${p.facts[key].value === null ? "unknown-text" : ""}`}
                                        >
                                          {formatFact(key, p.facts[key].value)}
                                        </span>
                                        <button
                                          className={`citation ${p.facts[key].confirmed ? "confirmed" : ""}`}
                                          onClick={() => setReviewId(p.id)}
                                          aria-label={`Review ${labels[key]} for ${p.alias}`}
                                        >
                                          {p.facts[key].confirmed ? (
                                            <CheckCheck size={11} />
                                          ) : (
                                            <FileText size={11} />
                                          )}
                                          {p.facts[key].correction
                                            ? "Human correction"
                                            : p.facts[key].evidence
                                              ? `p. ${p.facts[key].evidence!.page} · ${p.facts[key].confirmed ? "Confirmed" : "Review"}`
                                              : "Evidence gap"}
                                        </button>
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                                <tr>
                                  <th>
                                    Scope coverage
                                    <small>Explicit requirement matches</small>
                                  </th>
                                  {purchase.proposals.map((p) => (
                                    <td key={p.id}>
                                      <span className="fact-value">
                                        {
                                          p.requirements.filter(
                                            (r) => r.status === "supported",
                                          ).length
                                        }
                                        <span className="muted">
                                          {" "}
                                          /{" "}
                                          {purchase.rubric.requirements.length}
                                        </span>
                                      </span>
                                      <span className="cell-note">
                                        {p.requirements.some(
                                          (r) => !r.confirmed,
                                        )
                                          ? "Awaiting review"
                                          : p.requirements.some(
                                                (r) => r.status === "unclear",
                                              )
                                            ? "Unresolved scope remains"
                                            : "Coverage confirmed"}
                                      </span>
                                    </td>
                                  ))}
                                </tr>
                                <tr className="score-row">
                                  <th>
                                    Fit under your rubric
                                    <small>Calculated, never an AI grade</small>
                                  </th>
                                  {scores.map(({ proposal: p, score }) => (
                                    <td key={p.id}>
                                      <span className="score-value">
                                        {Math.round(score.lower)}
                                        {Math.round(score.lower) !==
                                        Math.round(score.upper)
                                          ? `–${Math.round(score.upper)}`
                                          : ""}
                                        <small>/100</small>
                                      </span>
                                      <div className="score-track">
                                        <span
                                          style={{ width: `${score.lower}%` }}
                                        />
                                      </div>
                                      <span className="cell-note">
                                        {score.coverage}% evidence coverage
                                      </span>
                                    </td>
                                  ))}
                                </tr>
                                <tr className="table-actions">
                                  <th />
                                  <>
                                    {purchase.proposals.map((p) => (
                                      <td key={p.id}>
                                        <button
                                          className="button text"
                                          onClick={() => setReviewId(p.id)}
                                        >
                                          Review evidence
                                          <ArrowUpRight size={13} />
                                        </button>
                                      </td>
                                    ))}
                                  </>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="empty-state">
                            <FileText />
                            <h3>No proposals yet</h3>
                            <p>
                              Commit your brief, then add two or three
                              proposals.
                            </p>
                            <button
                              className="button primary"
                              onClick={() => setStage("Brief")}
                            >
                              Set up the purchase
                              <ArrowRight size={15} />
                            </button>
                          </div>
                        )}
                        <div className="table-footnote">
                          <ShieldCheck size={14} />
                          Unconfirmed terms create a score range. A high score
                          never overrides a purchasing limit.
                        </div>
                      </section>
                      <aside className="scenario-panel">
                        <div className="scenario-heading">
                          <span className="scenario-icon">
                            <Wallet size={18} />
                          </span>
                          <span className="eyebrow">A PRACTICAL WHAT-IF</span>
                        </div>
                        <h2>
                          What can you
                          <br />
                          commit upfront?
                        </h2>
                        <p>
                          See how the cash limit changes your options, without
                          changing the evidence.
                        </p>
                        <div className="cash-amount">
                          {money(cashCap ?? purchase.rubric.maxUpfrontCents)}
                          <span>upfront limit</span>
                        </div>
                        <input
                          aria-label="Explore upfront cash limit"
                          type="range"
                          min="0"
                          max={purchase.rubric.budgetCents}
                          step="10000"
                          value={cashCap ?? purchase.rubric.maxUpfrontCents}
                          onChange={(e) => setCashCap(Number(e.target.value))}
                        />
                        <div className="range-labels">
                          <span>$0</span>
                          <span>{money(purchase.rubric.budgetCents)}</span>
                        </div>
                        <div className="cash-options">
                          {purchase.proposals.map((p) => {
                            const total = p.facts.totalCents.value,
                              percent = p.facts.depositPercent.value;
                            const amount =
                              total !== null && percent !== null
                                ? depositCents(total, percent)
                                : null;
                            const over =
                              amount !== null &&
                              amount >
                                (cashCap ?? purchase.rubric.maxUpfrontCents);
                            return (
                              <div key={p.id} className="cash-option">
                                <div>
                                  <span>{p.alias}</span>
                                  <strong>
                                    {amount === null
                                      ? "Unknown"
                                      : money(amount)}
                                  </strong>
                                </div>
                                <div
                                  className={`cash-track ${over ? "over" : ""}`}
                                >
                                  <span
                                    style={{
                                      width: `${amount === null ? 0 : Math.min(100, (amount / purchase.rubric.budgetCents) * 100)}%`,
                                    }}
                                  />
                                </div>
                                <small>
                                  {amount === null
                                    ? "Deposit terms missing"
                                    : over
                                      ? "Above this cash limit"
                                      : "Within this cash limit"}
                                  {!p.facts.depositPercent.confirmed &&
                                    " · quoted"}
                                </small>
                              </div>
                            );
                          })}
                        </div>
                        {cashCap !== null &&
                        cashCap !== purchase.rubric.maxUpfrontCents ? (
                          <div className="scenario-notice">
                            Scenario only.{" "}
                            <button
                              onClick={() => setRubricOpen(true)}
                              disabled={Boolean(purchase.award)}
                            >
                              Commit a rubric revision
                            </button>{" "}
                            to use it for an award.
                          </div>
                        ) : (
                          <div className="scenario-notice">
                            <LockKeyhole size={13} />
                            Your committed limit is versioned with the rubric.
                          </div>
                        )}
                      </aside>
                    </div>
                    <div className="bottom-grid">
                      <section className="panel observations">
                        <div className="section-heading">
                          <div>
                            <h3>Read between the line items.</h3>
                            <p className="muted">
                              Commercial observations grounded in the proposals.
                            </p>
                          </div>
                          <TriangleAlert size={18} />
                        </div>
                        {purchase.proposals.map(
                          (p) =>
                            p.risks[0] && (
                              <button
                                key={p.id}
                                className="observation"
                                onClick={() => setReviewId(p.id)}
                              >
                                <span
                                  className={`risk-icon ${p.risks[0].severity}`}
                                >
                                  <TriangleAlert size={15} />
                                </span>
                                <div>
                                  <span className="eyebrow">
                                    {p.alias} · PAGE {p.risks[0].evidence.page}
                                  </span>
                                  <strong>{p.risks[0].title}</strong>
                                </div>
                                <ChevronRight size={16} />
                              </button>
                            ),
                        )}
                      </section>
                      <section className="next-card">
                        <div className="eyebrow">THE NEXT CONSIDERED STEP</div>
                        <h2>
                          A decision worth
                          <br />
                          standing behind.
                        </h2>
                        <p>
                          Review the evidence, record your blind assessment,
                          then check the supplier identity before approving an
                          award.
                        </p>
                        <button
                          className="button primary"
                          onClick={() => setStage("Award")}
                        >
                          Review & record a decision
                          <ArrowRight size={16} />
                        </button>
                      </section>
                    </div>
                  </>
                )}
                {stage === "Award" && (
                  <section className="panel award-panel">
                    <div className="section-heading">
                      <div>
                        <span className="eyebrow">04 / HUMAN DECISION</span>
                        <h2>
                          {purchase.award
                            ? "A considered decision, on record."
                            : purchase.status === "frozen"
                              ? "Your blind assessment is preserved."
                              : revealed
                                ? "Check the identity. Make the final call."
                                : "Record your assessment before the reveal."}
                        </h2>
                        <p className="muted">
                          AI does not select or approve a supplier. Your
                          rationale is part of the record.
                        </p>
                      </div>
                      <ShieldCheck className="section-icon" />
                    </div>
                    {purchase.award ? (
                      <>
                        <div className="approved-card">
                          <Mark>HUMAN-APPROVED AWARD</Mark>
                          <h2>{purchase.award.supplierName}</h2>
                          <p>{purchase.award.rationale}</p>
                          <div className="brief-summary">
                            <article>
                              <span>Approved total</span>
                              <strong>
                                {money(purchase.award.totalCents)}
                              </strong>
                            </article>
                            <article>
                              <span>Approved deposit</span>
                              <strong>
                                {money(purchase.award.depositCents)}
                              </strong>
                            </article>
                            <article>
                              <span>Rubric revision</span>
                              <strong>v{purchase.award.rubricRevision}</strong>
                            </article>
                          </div>
                          <small className="muted">
                            Snapshot {purchase.award.snapshotHash.slice(0, 24)}{" "}
                            · {new Date(purchase.award.at).toLocaleString()}
                          </small>
                        </div>
                        <button
                          className="button primary"
                          onClick={() => setStage("Payment")}
                        >
                          Check the supplier invoice
                          <ArrowRight size={16} />
                        </button>
                      </>
                    ) : purchase.status === "frozen" ? (
                      <>
                        <div className="notice">
                          <LockKeyhole size={19} />
                          <div>
                            <strong>
                              Assessment frozen · rubric v
                              {purchase.assessment!.rubricRevision}
                            </strong>
                            <p>{purchase.assessment!.rationale}</p>
                            <span>
                              Your assessment will remain in the record after
                              identity reveal.
                            </span>
                          </div>
                        </div>
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() =>
                            void work(async () => {
                              await command("/reveal");
                              setSelected(purchase.assessment!.proposalId);
                              setRationale("");
                            })
                          }
                        >
                          <Eye size={16} />
                          Reveal supplier identities
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="award-options">
                          {scores.map(({ proposal: p, score }) => (
                            <label
                              key={p.id}
                              className={`award-option ${selected === p.id ? "chosen" : ""}`}
                            >
                              <input
                                type="radio"
                                name="supplier"
                                value={p.id}
                                checked={selected === p.id}
                                onChange={() => setSelected(p.id)}
                                disabled={score.feasibility !== "eligible"}
                              />
                              <div>
                                <strong>
                                  {revealed ? p.identity.name : p.alias}
                                </strong>
                                <span>
                                  {score.feasibility === "eligible"
                                    ? `${money(score.depositCents!)} deposit · fits the committed limits`
                                    : score.blockers[0] ||
                                      "Confirm critical evidence before selection"}
                                </span>
                                {revealed && <small>{p.identity.email}</small>}
                              </div>
                              <span
                                className={`badge ${score.feasibility === "eligible" ? "green" : ""}`}
                              >
                                {score.feasibility === "eligible"
                                  ? "Eligible"
                                  : "Review needed"}
                              </span>
                            </label>
                          ))}
                        </div>
                        {revealed && (
                          <label className="checkbox-line">
                            <input
                              type="checkbox"
                              checked={identityChecked}
                              onChange={(e) =>
                                setIdentityChecked(e.target.checked)
                              }
                            />
                            I checked the supplier identity and relevant
                            commercial risks. I am authorized to make this
                            decision.
                          </label>
                        )}
                        <label className="field">
                          <span>
                            {revealed
                              ? "Final award rationale"
                              : "Provisional blind assessment"}
                            <small>Required · at least 12 characters</small>
                          </span>
                          <textarea
                            value={rationale}
                            onChange={(e) => setRationale(e.target.value)}
                            placeholder="Explain the trade-offs that matter to this purchase, including any unresolved non-mandatory terms."
                            rows={4}
                            maxLength={2000}
                          />
                        </label>
                        <div className="row-between">
                          <p className="small muted">
                            {revealed
                              ? "The award freezes the reviewed commercial terms."
                              : "Names remain hidden until you save this assessment."}
                          </p>
                          <button
                            className="button primary"
                            disabled={
                              busy ||
                              !can(revealed ? "approver" : "reviewer") ||
                              !selected ||
                              rationale.trim().length < 12 ||
                              (revealed && !identityChecked)
                            }
                            onClick={() =>
                              void work(async () => {
                                await command(revealed ? "/award" : "/freeze", {
                                  proposalId: selected,
                                  rationale,
                                  ...(revealed
                                    ? { identityChecked: true }
                                    : {}),
                                });
                              })
                            }
                          >
                            {revealed
                              ? "Approve this award"
                              : "Freeze blind assessment"}
                            <ArrowRight size={16} />
                          </button>
                        </div>
                      </>
                    )}
                  </section>
                )}
                {stage === "Payment" && (
                  <section className="panel payment-panel">
                    <div className="section-heading">
                      <div>
                        <span className="eyebrow">
                          05 / TERMS THROUGH PAYMENT
                        </span>
                        <h2>Pay what you actually approved.</h2>
                        <p className="muted">
                          The supplier issues the invoice. Bidcairn checks it
                          against your award.
                        </p>
                      </div>
                      <Wallet className="section-icon" />
                    </div>
                    {!purchase.award ? (
                      <div className="empty-state">
                        <LockKeyhole />
                        <h3>Approval comes first.</h3>
                        <p>
                          A human-approved award is required before an invoice
                          can be created.
                        </p>
                        <button
                          className="button secondary"
                          onClick={() => setStage("Award")}
                        >
                          Go to the decision
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="brief-summary">
                          <article>
                            <span>Supplier</span>
                            <strong className="text-medium">
                              {purchase.award.supplierName}
                            </strong>
                          </article>
                          <article>
                            <span>Approved project total</span>
                            <strong>{money(purchase.award.totalCents)}</strong>
                          </article>
                          <article>
                            <span>Approved deposit</span>
                            <strong>
                              {money(purchase.award.depositCents)}
                            </strong>
                          </article>
                        </div>
                        {!purchase.invoice ? (
                          <>
                            {purchase.proposals.find(
                              (p) => p.id === purchase.award!.proposalId,
                            )?.provenance === "uploaded" &&
                              !purchase.proposals.find(
                                (p) => p.id === purchase.award!.proposalId,
                              )?.vendorId && (
                                <div className="notice">
                                  <LockKeyhole size={20} />
                                  <div>
                                    <strong>
                                      Connect the approved supplier
                                    </strong>
                                    <p>
                                      Choose its configured sandbox merchant.
                                      The supplier email reviewed in the award
                                      must match the merchant account email.
                                    </p>
                                    <div className="button-row">
                                      {capabilities?.paypal.configuredVendors.map(
                                        (id) => (
                                          <button
                                            className="button secondary compact"
                                            key={id}
                                            disabled={busy || !can("approver")}
                                            onClick={() =>
                                              void work(async () => {
                                                await command("/merchant", {
                                                  vendorId: id,
                                                });
                                              })
                                            }
                                          >
                                            Bind connection {id}
                                          </button>
                                        ),
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                            <div className="notice">
                              <Database size={20} />
                              <div>
                                <strong>Supplier sandbox console</strong>
                                <p>
                                  Explore an intentionally incorrect deposit,
                                  then correct it. Simulation never creates a
                                  payment or a paid receipt.
                                </p>
                              </div>
                            </div>
                            <div className="button-row">
                              <button
                                className="button secondary"
                                disabled={busy || !can("approver")}
                                onClick={() =>
                                  void work(async () => {
                                    await command("/invoice", {
                                      mode: "simulation",
                                      mismatch: true,
                                    });
                                  })
                                }
                              >
                                Load mismatch simulation
                                <ArrowRight size={15} />
                              </button>
                              <button
                                className="button primary"
                                disabled={
                                  busy ||
                                  !can("approver") ||
                                  !capabilities?.paypal.configuredVendors.includes(
                                    purchase.proposals.find(
                                      (p) =>
                                        p.id === purchase.award!.proposalId,
                                    )?.vendorId || "",
                                  )
                                }
                                onClick={() =>
                                  void work(async () => {
                                    await command("/invoice", {
                                      mode: "paypal-sandbox",
                                      mismatch: true,
                                    });
                                  })
                                }
                              >
                                Create real sandbox draft
                                <ArrowUpRight size={15} />
                              </button>
                            </div>
                            {!capabilities?.paypal.configuredVendors.length && (
                              <p className="small muted">
                                PayPal merchant credentials are not configured.
                                The genuine sandbox feasibility gate has not
                                passed.
                              </p>
                            )}
                          </>
                        ) : (
                          <>
                            <div
                              className={`invoice-card ${purchase.invoice.mismatch.length ? "mismatched" : ""}`}
                            >
                              <div className="row-between">
                                <span className="badge">
                                  {purchase.invoice.provider === "simulation"
                                    ? "SIMULATION · NO PAYPAL CALL"
                                    : "REAL PAYPAL SANDBOX"}
                                </span>
                                <span
                                  className={`badge ${purchase.invoice.state === "paid" ? "green" : ""}`}
                                >
                                  {purchase.invoice.state.toUpperCase()}
                                </span>
                              </div>
                              <h3>Deposit invoice</h3>
                              <code>{purchase.invoice.id}</code>
                              <div className="invoice-amounts">
                                <div>
                                  <span>Human-approved deposit</span>
                                  <strong>
                                    {money(purchase.invoice.expectedCents)}
                                  </strong>
                                </div>
                                <ArrowRight size={20} />
                                <div>
                                  <span>Supplier invoice requests</span>
                                  <strong>
                                    {money(purchase.invoice.requestedCents)}
                                  </strong>
                                </div>
                              </div>
                              {purchase.invoice.mismatch.length ? (
                                <div className="mismatch-notice" role="status">
                                  <TriangleAlert size={20} />
                                  <div>
                                    <strong>Payment action blocked</strong>
                                    {purchase.invoice.mismatch.map(
                                      (message) => (
                                        <p key={message}>{message}</p>
                                      ),
                                    )}
                                    <small>
                                      Correct the draft. The approved award
                                      cannot be silently changed.
                                    </small>
                                  </div>
                                </div>
                              ) : (
                                <div className="matching-notice">
                                  <CheckCheck size={18} />
                                  Invoice terms match the approved deposit.
                                </div>
                              )}
                              <p className="small muted">
                                Last checked{" "}
                                {new Date(
                                  purchase.invoice.lastReconciledAt,
                                ).toLocaleString()}{" "}
                                · Award {purchase.invoice.awardId.slice(0, 8)}
                              </p>
                            </div>
                            <div className="button-row">
                              {purchase.invoice.mismatch.length > 0 && (
                                <button
                                  className="button primary"
                                  disabled={busy || !can("approver")}
                                  onClick={() =>
                                    void work(async () => {
                                      await command("/invoice/correct");
                                    })
                                  }
                                >
                                  Correct supplier draft
                                  <ArrowRight size={15} />
                                </button>
                              )}
                              {purchase.invoice.state === "draft" && (
                                <button
                                  className="button primary"
                                  disabled={busy || !can("approver")}
                                  onClick={() =>
                                    void work(async () => {
                                      await command("/invoice/send");
                                    })
                                  }
                                >
                                  {purchase.invoice.provider === "simulation"
                                    ? "Simulate invoice publication"
                                    : "Publish checked invoice"}
                                  <ArrowRight size={15} />
                                </button>
                              )}
                              <button
                                className="button secondary"
                                disabled={busy || !can("approver")}
                                onClick={() =>
                                  void work(async () => {
                                    await command("/invoice/refresh");
                                  })
                                }
                              >
                                Reconcile invoice
                              </button>
                              {purchase.invoice.provider === "paypal-sandbox" &&
                                purchase.invoice.state === "sent" && (
                                  <button
                                    className="button primary"
                                    disabled={busy || !can("approver")}
                                    onClick={() =>
                                      void work(async () => {
                                        const p = currentVersion.current!;
                                        const result = await api<{
                                          url: string;
                                        }>(
                                          `/purchases/${p.id}/invoice/pay-link`,
                                          {
                                            method: "POST",
                                            headers: {
                                              "If-Match": String(p.version),
                                            },
                                            body: "{}",
                                          },
                                        );
                                        window.open(
                                          result.url,
                                          "_blank",
                                          "noopener,noreferrer",
                                        );
                                        setPurchase(
                                          await api(`/purchases/${p.id}`),
                                        );
                                      })
                                    }
                                  >
                                    Review & pay on PayPal
                                    <ArrowUpRight size={15} />
                                  </button>
                                )}
                            </div>
                            {purchase.invoice.provider === "simulation" && (
                              <div className="notice">
                                <ShieldCheck size={20} />
                                <div>
                                  <strong>Nothing has been paid.</strong>
                                  <p>
                                    A simulation cannot produce a verified
                                    PayPal receipt. Real settlement requires
                                    actual sandbox checkout and authoritative
                                    reconciliation.
                                  </p>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </section>
                )}
                {stage === "Compare" && (
                  <section className="panel explanation-panel">
                    <div className="section-heading">
                      <div>
                        <h2>Evidence-backed trade-offs</h2>
                        <p className="muted">
                          Optional AI prose about confirmed evidence and
                          committed calculations. Review every claim.
                        </p>
                      </div>
                      <button
                        className="button secondary compact"
                        disabled={
                          busy ||
                          !can("reviewer") ||
                          !capabilities?.ai.qualified ||
                          confirmed === 0 ||
                          Boolean(purchase.explanation)
                        }
                        onClick={() =>
                          void work(async () => {
                            await command("/explain");
                          })
                        }
                      >
                        <Sparkles size={15} />
                        {purchase.explanation
                          ? "Saved explanation"
                          : "Explain confirmed evidence"}
                      </button>
                    </div>
                    {purchase.explanation ? (
                      <>
                        <p className="small muted">
                          {purchase.explanation.analysis.provider} /{" "}
                          {purchase.explanation.analysis.model} ·{" "}
                          {new Date(
                            purchase.explanation.analysis.at,
                          ).toLocaleString()}{" "}
                          · committed rubric v{purchase.rubricRevision}
                        </p>
                        {purchase.explanation.items.map((item, i) => (
                          <article className="explanation-item" key={i}>
                            <p>{item.text}</p>
                            <details>
                              <summary>
                                Inspect supporting evidence (
                                {item.evidenceIds.length})
                              </summary>
                              {item.evidenceIds.map((id) => {
                                const source =
                                  purchase.explanation!.sources.find(
                                    (s) => s.id === id,
                                  )!;
                                return (
                                  <blockquote key={id}>
                                    <strong>
                                      {source.alias} · {source.label}:{" "}
                                      {source.value}
                                    </strong>
                                    <p>
                                      {source.evidence
                                        ? `Page ${source.evidence.page}: “${source.evidence.quote}”`
                                        : "Human-confirmed structured value. Inspect the evidence review and correction record."}
                                    </p>
                                  </blockquote>
                                );
                              })}
                            </details>
                          </article>
                        ))}
                      </>
                    ) : (
                      <p className="muted small">
                        {capabilities?.ai.qualified
                          ? "Confirm the cited terms before generating an explanation. No model chooses a supplier."
                          : "A qualified runtime provider is required. The reference pack does not contain generated AI explanations."}
                      </p>
                    )}
                  </section>
                )}
                <footer className="main-footer">
                  <span>
                    <ShieldCheck size={14} />
                    Auditable decision support. Human authority, always.
                  </span>
                  <span>
                    USD · Sandbox only<span className="footer-dot">·</span>
                    Bidcairn v0.1
                  </span>
                  {role === "owner" && (
                    <button
                      className="button text compact"
                      onClick={() => {
                        setDeleteText("");
                        setDeleteOpen(true);
                      }}
                    >
                      Delete purchase
                    </button>
                  )}
                </footer>
              </>
            )}
          </main>
        </div>
        {busy && (
          <div className="working-toast" role="status">
            <Loader2 size={16} className="spin" />
            Saving a considered step…
          </div>
        )}
        {accountOpen && (
          <Modal
            title="Workspace access"
            subtitle="Judge sessions are isolated. Team accounts are provisioned by an administrator."
            onClose={() => setAccountOpen(false)}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void work(async () => {
                  await signIn(loginEmail, loginPassword);
                  setLoginPassword("");
                  setPurchase(null);
                  localStorage.removeItem("bidcairn-purchase");
                  await refreshList();
                  setAccountOpen(false);
                });
              }}
            >
              <div className="modal-body">
                <p>
                  Current purchase role: <strong>{role}</strong>. Owners manage
                  the workflow; curators prepare proposals, reviewers confirm
                  evidence, and approvers authorize the award and invoice
                  actions.
                </p>
                {capabilities?.mode === "supabase" ? (
                  <>
                    <label className="field">
                      <span>Team account email</span>
                      <input
                        required
                        type="email"
                        autoComplete="username"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Password</span>
                      <input
                        required
                        type="password"
                        autoComplete="current-password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  <p className="muted">
                    Local evaluation uses a temporary browser session. Hosted
                    team sign-in becomes available with Supabase Auth.
                  </p>
                )}
              </div>
              {capabilities?.mode === "supabase" && (
                <div className="modal-foot">
                  <button
                    type="submit"
                    className="button primary"
                    disabled={busy}
                  >
                    Sign in to team account
                  </button>
                </div>
              )}
            </form>
          </Modal>
        )}
        {deleteOpen && purchase && (
          <Modal
            title="Delete this purchase?"
            subtitle="This permanently removes the application record and queues its private PDFs for deletion."
            onClose={() => setDeleteOpen(false)}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void work(async () => {
                  const result = await api<{ documentCleanupPending: boolean }>(
                    `/purchases/${purchase.id}`,
                    {
                      method: "DELETE",
                      headers: { "If-Match": String(purchase.version) },
                      body: JSON.stringify({ confirm: deleteText }),
                    },
                  );
                  setPurchase(null);
                  setDeleteOpen(false);
                  localStorage.removeItem("bidcairn-purchase");
                  await refreshList();
                  if (result.documentCleanupPending)
                    setError(
                      "Purchase deleted. Private file cleanup is queued and will retry automatically.",
                    );
                });
              }}
            >
              <div className="modal-body">
                <p>
                  <strong>{purchase.title}</strong>
                </p>
                <p>
                  Export any decision record you need first. Deletion does not
                  cancel a PayPal invoice, reverse a payment, or erase a
                  provider’s retained records.
                </p>
                <label className="field">
                  <span>Type DELETE to confirm</span>
                  <input
                    required
                    value={deleteText}
                    onChange={(e) => setDeleteText(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </div>
              <div className="modal-foot">
                <button
                  type="submit"
                  className="button primary"
                  disabled={busy || deleteText !== "DELETE"}
                >
                  Permanently delete purchase
                </button>
              </div>
            </form>
          </Modal>
        )}
        {review && purchase && (
          <EvidenceDialog
            proposal={review}
            purchase={purchase}
            busy={busy || !can("reviewer")}
            onClose={() => setReviewId(null)}
            onConfirm={(body) =>
              void work(async () => {
                await command(`/proposals/${review.id}/confirm`, body);
                setReviewId(null);
              })
            }
          />
        )}
        {rubricOpen && purchase && (
          <RubricDialog
            purchase={purchase}
            scenarioCash={cashCap}
            busy={busy || !can("curator")}
            onClose={() => setRubricOpen(false)}
            onSave={(body) =>
              void work(async () => {
                await command("/brief", body);
                setRubricOpen(false);
                setCashCap(null);
              })
            }
          />
        )}
        {upload && purchase && (
          <UploadDialog
            busy={busy || !can("curator")}
            onClose={() => setUpload(false)}
            onUpload={(body) =>
              void work(async () => {
                await command("/proposals", body);
                setUpload(false);
                setStage("Evidence");
              })
            }
          />
        )}
        {audit && purchase && (
          <Modal
            title="Decision record"
            subtitle="Evidence, human decisions and payment observations in one traceable record."
            onClose={() => setAudit(false)}
          >
            <div className="audit-summary">
              <Mark>APPLICATION AUDIT TRAIL</Mark>
              <p>
                This is an inspectable application record, not tamper-proof
                certification. Reference and simulated events are labeled.
              </p>
            </div>
            <ol className="audit-list">
              {purchase.events.map((event) => (
                <li key={event.id}>
                  <span className="audit-dot" />
                  <div>
                    <span className="eyebrow">
                      {event.type.replaceAll(".", " / ")}
                    </span>
                    <p>{event.detail}</p>
                    <small>
                      {new Date(event.at).toLocaleString()} · revision{" "}
                      {event.version}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
            <div className="modal-foot">
              <a
                className="button primary"
                href={`/api/purchases/${purchase.id}/export`}
                download
              >
                <ArrowDownToLine size={16} />
                Export decision record
              </a>
            </div>
          </Modal>
        )}
      </div>
    </DialogErrorContext.Provider>
  );
}
