# Bidcairn

**Evidence before commitment.** A focused service-procurement workbench that carries a human purchasing decision from proposal evidence to a checked PayPal deposit invoice.

## Current release status

Working local evaluation build. **Not submission-ready yet.** Live AI qualification, genuine PayPal buyer checkout/signed webhook, hosted deployment, naming clearance and the final video remain external release gates. See [the implementation record](docs/implementation-status.md).

Source repository: [IACBI/bidcairn](https://github.com/IACBI/bidcairn). The working name’s `.com` is already registered; the exact USPTO search found no results, while full trademark clearance remains pending. See [the naming check](docs/naming-check.md).

The original synthetic reference proposals and curated facts are labeled as such. They are **not** an AI run. The invoice simulator cannot create a payment or mark an invoice paid. Tests with mocked providers are not proof of a live integration.

## Run locally

Requires Node.js **24+** and npm. Docker is not required for local evaluation.

```sh
npm ci
npm run build
npm start
```

Open **http://localhost:3000**. Select **Explore the reference purchase**. Data persists in the ignored `.data/` directory using Node's built-in SQLite. Each browser session gets an isolated workspace. Local mode binds to loopback and must not be exposed as a hosted service.

For development, `npm run dev` watches the backend and serves the latest built frontend. Run `npm run dev:client` in a second terminal for frontend hot reload at http://localhost:5173.

Copy `config.example.txt` to `.env` to configure integrations (the existing local `.env.example` is also a template). Never commit credentials. The default is `AI_PROVIDER=none`: no inference, paid fallback or live money movement is enabled.

## Judge walkthrough

1. Open the reference purchase. Inspect its committed rubric and source provenance.
2. Review each proposal’s quoted evidence and confirm the reviewed facts. Unknown SLA/scope terms stay unknown. Human corrections require a reason.
3. Explore the upfront cash limit. This does not call a model or silently change the committed rubric.
4. Record a provisional blind assessment. Reveal supplier identities for due diligence.
5. Explicitly approve an award and its rationale. The award freezes price, deposit and evidence versions.
6. Open Payment and load the **mismatch simulation**. A requested 50% deposit is checked against the approved 20%; invoice publication is blocked.
7. Correct the synthetic supplier draft. Its publication is still a simulation, not settlement.
8. Export the decision record. Reference, simulation, human and real-provider events have distinct provenance.

Actual sandbox checkout requires the merchant connections below. There is intentionally no “pretend paid” button.

## PayPal sandbox

Only `https://api-m.sandbox.paypal.com` is supported. The supplier is the seller. The application does not collect funds as though it supplied the service.

Configure each of the three fictional suppliers with its own sandbox merchant application credentials and email, using `PAYPAL_VENDOR_A_*`, `PAYPAL_VENDOR_B_*` and `PAYPAL_VENDOR_C_*`. Merchant IDs are bound server-side, not supplied by the model or a browser request. Set the brief’s buyer email to a **sandbox personal buyer account** before freezing the assessment. Supplier aliases are randomized; the merchant binding stays internal until reveal.

For each merchant application, register the HTTPS webhook endpoint:

```text
https://YOUR_HOST/api/webhooks/paypal/A
https://YOUR_HOST/api/webhooks/paypal/B
https://YOUR_HOST/api/webhooks/paypal/C
```

Subscribe to `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.UPDATED`, `INVOICING.INVOICE.CANCELLED` and `INVOICING.INVOICE.REFUNDED`; set the corresponding webhook ID. A local tunnel requires its own security review; never expose SQLite local evaluation publicly.

After human award approval, create a real sandbox draft from the supplier console. Inspect the mismatch, correct the draft, publish it, and choose **Review & pay on PayPal**. Complete checkout as the sandbox buyer. Reconcile, or wait for a genuine signature-verified webhook. `PAID` requires matching merchant, recipient, reference, USD amount, zero amount due and PayPal payment records. A partial/pending event or an external mark-as-paid is not settlement.

Durable request IDs are stored before creating invoices. An uncertain outcome reuses the original attempt; it does not create a new financial action blindly. Notifications to invoice recipients are suppressed in the synthetic sandbox workflow.

## Runtime AI

Astropods is the sponsor-first candidate. Groq Free (`openai/gpt-oss-120b`) is the independent no-payment fallback. Neither is automatically activated or selected as a fallback. Set one provider explicitly, record qualification, then set `AI_QUALIFIED=true`.

Before enabling Astropods, verify its account-specific free grant, expiry through **December 15, 2026**, inference rates, retention, quotas and permission to call the gateway from the backend. If that topology is not supported, use the qualified direct Groq path rather than introducing a proxy service or changing hosting. The gateway must support the configured strict schema request; no downgrade to unvalidated JSON happens silently.

AI extracts facts, maps requirements to cited evidence, identifies ambiguous commercial terms and writes optional, cached trade-off explanations. **Application logic alone computes scores and feasibility. Humans alone choose and approve suppliers.** The model has no tools or PayPal credentials. Explanation source IDs are validated; a valid citation does not prove that the generated prose correctly interprets it. Humans inspect the attached source evidence.

The application validates schema and verbatim page quotations. Astropods permits one bounded repair; Groq avoids immediate repair to respect its minute token allowance. Each analysis scope permits at most two reserved calls, including failed or uncertain requests. Free-provider input ceilings can be lower than the PDF page limit; oversized text is rejected, never truncated. The token preflight includes the schema and repair allowance in its conservative UTF-8 byte bound. Accepted analysis is persisted per proposal/requirement revision. UI scenario changes never rerun extraction or explanation.

Generate original synthetic upload PDFs with `npm run demo:pdfs`. Run the explicit, bounded provider regression corpus only after checking the account’s free tier: `npm run qualify:ai -- --acknowledge-free-tier`. It makes up to 16 primary calls, with minute spacing on Groq, and writes a local report. It does not enable the provider or qualify account privacy by itself.

Astropods requires explicit free credit, expiry and event budget. Keep its account without a payment method. Keep Groq on Free and enable the appropriate data-retention controls. The application reserves worst-case usage atomically and retains reservations after uncertain failures. Provider exhaustion disables new inference, not existing decisions or PayPal reconciliation.

## Hosted deployment

The approved topology remains **Render + Supabase**. Apply all `supabase/migrations/*.sql` in filename order, enable Supabase anonymous sign-in for isolated synthetic judge workspaces, and configure the private `proposals` bucket. Application tables have RLS enabled and no browser table grants; privileged operations run behind server-side authentication, workspace roles and optimistic versions. The service-role key never reaches the browser.

`render.yaml` describes a Starter service with automatic deployment disabled. **Redeem and verify the $50 hackathon credit and its expiry first.** Starter is a paid resource even if credits cover it; credits are not a hard billing cap. Do not activate billing or assume a payment method is authorized merely by checking this file in.

Production startup requires Supabase mode, an HTTPS `APP_ORIGIN` and a 32+ character session secret. Local SQLite mode refuses production startup. Configure secrets through the hosting dashboard, not repository files. Smoke-test auth, storage and database access through judging; Supabase Free may pause after inactivity.

## Verification

```sh
npm test
npm run build
npm run test:e2e
npm run verify:gates
```

The last command intentionally exits non-zero while external evidence is incomplete. On Windows, the browser test uses installed Microsoft Edge. CI installs Chromium. For Linux local testing set `CI=1` and install Chromium with `npx playwright install chromium`.

Tests cover score intervals, cash limits, human approval order, stale revisions, identity leakage, session isolation, CSRF, evidence fabrication, budget reservations, merchant mismatch and partial/pending/external payment states. See [security boundaries](docs/security.md) and [the demo script](docs/demo-script.md).

## Limits and privacy

This hosted evaluation accepts **synthetic data only**. Blinding reduces identity visibility in the review UI; it does not remove bias or erase an uploader’s prior knowledge. Logs exclude proposal text, credentials and raw provider errors. Original PDFs are private and unavailable through the review API before reveal. Audit exports are inspectable application records, not tamper-proof or legal certification.

Owners can run the complete demonstration. Curators prepare the brief and uploads; reviewers confirm evidence and freeze the comparison; approvers reveal identities, approve awards and operate sandbox invoices. Hosted team accounts and `workspace_members` are provisioned manually by an administrator; invitations and self-service role changes are excluded. Open Workspace account to sign into a provisioned team account. See [operations](docs/operations.md).

An owner may explicitly delete a purchase. Its private PDFs enter a durable deletion queue and are removed immediately when possible, with minute retries by the running server. Usage reservations survive deletion to prevent quota resets. Deletion does not cancel PayPal invoices or erase upstream provider retention/backups. Do not claim enterprise authorization, supplier onboarding, escrow, legal compliance or production-payment readiness.

Original source and synthetic reference content are licensed under MIT. Dependency licenses remain their owners’ licenses. No third-party logo or music is needed for the demo. Runtime models and development assistance must be disclosed accurately in the submission.
