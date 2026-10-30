# Deployment and recovery

Apply the three SQL migrations in order, using the Supabase SQL editor or the authenticated project migration tool. Never run a schema migration against an unrelated existing project. Back up an existing application database first. This repository has not yet verified a real hosted project.

Enable anonymous Auth for synthetic judge sessions. For a team, provision confirmed email/password users through Supabase Auth. Obtain each Auth UUID from the project dashboard. The workspace UUID is its owner’s Auth UUID; insert a `workspace_members` row with `workspace`, `user_id` and `role` (`curator`, `reviewer` or `approver`). Only a project administrator using server privileges may do this. No public table grants or browser-facing membership mutation endpoint exists.

| Action | Owner | Curator | Reviewer | Approver |
| --- | --- | --- | --- | --- |
| Read comparison and audit | Yes | Yes | Yes | Yes |
| Commit brief, upload, analyze | Yes | Yes | — | — |
| Confirm facts, explain, freeze | Yes | — | Yes | — |
| Reveal, award, bind merchant, invoice | Yes | — | — | Yes |
| Delete purchase | Yes | — | — | — |

Uploaded synthetic proposals use their reviewed supplier email to bind to a configured sandbox merchant after award approval. The email must match the server-configured merchant. Reference suppliers have fixed internal bindings independent of randomized aliases. These connections represent explicit supplier sandbox authorization; this is not marketplace merchant onboarding.

The Render blueprint selects Starter to avoid free web-service sleeping. Verify hackathon credits, expiry and billing controls before provisioning it. Redeemed credits do not impose an automatic spending cap. Keep a documented service availability check through the judging period; verify the Supabase project has not paused. All persistent state belongs in Supabase, not Render’s ephemeral disk.

The health endpoint checks database access. Logs contain request ID, HTTP method, status and duration; they intentionally omit bodies and credentials. Use the response `X-Request-ID` to correlate failures. Configure platform health alerts without uploading documents into error telemetry.

If AI is unavailable, cached evidence and comparisons remain usable. Do not reset reservation tables to recover quota. Qualification failures keep the production switch disabled; do not silently change provider/model. Store the redacted qualification report and account policy evidence in release records.

After a PayPal timeout, inspect the saved invoice attempt and sandbox merchant dashboard. If an invoice ID is already recorded, use Reconcile invoice: it rereads that identity. If the creation response was lost, Recover sandbox invoice searches for an exact award-derived invoice number and reference. It attaches a unique match and verifies its terms; zero, multiple or inconsistent matches block recovery and never create another invoice. A delayed search index may require waiting and retrying recovery. A legacy attempt without the newer invoice number requires manual investigation. Never mark payment paid from an event name, a screenshot, or a client redirect. A verified webhook triggers another authoritative invoice read. Sandbox buyer checkout is the external acceptance test.

The request/response contract follows the official [invoice creation](https://developer.paypal.com/api/invoicing/v2/invoices-create) and [invoice search](https://developer.paypal.com/api/invoicing/v2/invoices-search-invoices) references. Recovery does not assume that PayPal retains an idempotency key forever.

Deleting a purchase removes its application record immediately and enqueues document cleanup in the same transaction. The server retries queued private file deletions every minute. Keep the service running until the queue is empty; inspect `document_deletions` if storage is unavailable. Provider AI retention, database backups and PayPal records are outside this queue. Review those policies before any confidential pilot.

Recovery testing before release: restore a test database backup, confirm a stale version is rejected, verify a nonmember cannot retrieve a record or private PDF, interrupt file storage during deletion then observe cleanup recovery, interrupt an AI request without refunding its reservation, and replay an already accepted webhook without duplicating events.
