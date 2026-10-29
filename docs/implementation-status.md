# Bidcairn implementation record

The approved original plan and its sponsor amendment remain the implementation baseline.

## Required external gates — not passed

- PayPal: a genuine supplier-issued sandbox deposit invoice, actual buyer payment, verified webhook and authoritative reconciliation. No merchant credentials are available in the current environment. Local adapter tests do not count as passing this gate.
- AI: Astropods grant/expiry/rates/retention and external gateway access; labeled model qualification; or Groq Free with verified account limits and retention controls. No provider credentials are available. A fixture is never described as a model call.
- Publication: Bidcairn exact-name web searches returned no indexed conflict. Official trademark and domain registration clearance remains unverified. No domain will be bought without that check.
- Naming update: the direct USPTO Wordmark search returned no results. Authoritative RDAP shows `bidcairn.com` is already registered; this is a material availability/discoverability risk. International/fuzzy trademark clearance remains pending. See `docs/naming-check.md`.
- Deployment: redeem and check Render credits through December 15; establish Supabase; validate hosted security and judge access. No claim of a deployed application is made.

## Execution decision

Build and verify the independent application, policy engine and sandbox adapters while external credentials remain unavailable. Keep provider access fail-closed. A clearly labeled synthetic reference pack supports local workflow testing without claiming that either external gate has passed. Submission readiness is not achieved until those gates and release artifacts are verified.

## Scope invariants

AI extracts and explains evidence. Application code calculates scores and cash feasibility. Humans select and approve suppliers. PayPal supplies the actual sandbox invoicing and payment lifecycle. No autonomous spending, live money, OCR, ERP, multi-currency, escrow, supplier onboarding platform or extra sponsor integrations.

## Verified local implementation

- Typed React/Express application, deterministic scoring and separate feasibility gates; source evidence review, reasoned corrections, scope editing, frozen assessment, identity reveal and explicit human award.
- Server-enforced owner/curator/reviewer/approver memberships, private bounded PDF parsing/storage, CSRF/origin checks, revision checks, immutable award/audit prefix, explicit deletion and durable file-cleanup retries.
- Configurable strict-schema runtime adapter, literal source validation, cached extraction/explanations, bounded retries and durable free-usage reservations. The synthetic regression runner is ready but has **not run against a real provider**.
- Sandbox-only PayPal adapter, durable draft attempt, invoice mismatch checks, controlled correction/publication, safe payer link, signature verification and authoritative reconciliation. Real merchant lifecycle remains unverified.
- 37 unit/integration tests and 3 browser tests passed locally; production build and strict TypeScript checks passed. Production dependency audit reports zero known vulnerabilities after the PDF.js security update.
- GitHub Advanced Security content scanning was unavailable for this repository; local source-pattern checks are supplementary, not a complete secret/security certification. Local credentials and generated data are excluded from publication.

These results do not pass the external gates. No deployed service, real AI result, sandbox settlement or final video is claimed.
