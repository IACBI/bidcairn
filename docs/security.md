# Security and reliability boundaries

- Browser writes require a same-origin check, a session-bound CSRF token and the expected purchase revision. Cookies are HttpOnly and SameSite=Strict; hosted cookies are Secure.
- Local sessions use random 256-bit tokens stored as hashes. Hosted identity is verified through Supabase Auth; a browser-supplied owner/merchant identifier is never trusted.
- Every purchase and original-document lookup is scoped to the authenticated workspace. Missing and unauthorized objects both return 404.
- Workspace memberships are administrator-provisioned. Server routes enforce curator/reviewer/approver capabilities; the owner may perform all roles for a small team or evaluation. This is role separation, not mandatory dual authorization. Identity reveal is a shared workspace event.
- Blind projections exclude supplier identity, internal merchant IDs and original page text. Configured names, emails, links and international phone patterns are masked before provider calls. Unique content can still identify a supplier.
- PDFs are capped at 10 MB and 20 pages, parsed in a bounded worker with a deadline and without embedded JavaScript execution. OCR and remote-URL ingestion are excluded.
- API credentials remain in server configuration. Logs contain request IDs, status and duration, not request bodies, URLs containing identifiers, documents or raw upstream errors.
- Analysis is untrusted until schema/citation validation and subsequent human confirmation. The model cannot invoke tools or money operations.
- Explanation prose receives only confirmed structured values and deterministic comparisons. Saved source IDs point back to evidence; ID validation does not establish semantic correctness of prose.
- Numeric scores are deterministic and disclose their anchors; unconfirmed terms produce intervals. Purchasing gates cannot be overridden by a high score.
- Award snapshots and existing audit events are immutable through save operations. Infrastructure administrators can still alter stored data; this is not tamper-proof evidence.
- PayPal base URLs are fixed to sandbox. Invoice payer links must use HTTPS and the sandbox PayPal invoice path. Webhook postback verification uses the stored merchant-specific webhook ID.
- Webhooks reread the authoritative invoice. Events are deduplicated by their IDs in the purchase record. State is not inferred from delivery order or the event name alone.
- Public synthetic evaluation has request/purchase/input caps and a durable global inference budget. This does not establish DDoS resistance or an enterprise SLA.
- Explicit owner deletion atomically removes the purchase and queues its private files. Failed file cleanup retries every minute while the service runs. Usage accounting remains to prevent deletion from resetting quotas; upstream PayPal/AI records and provider backups have their own retention.

## Unverified release requirements

Hosted RLS/storage and role enforcement, real webhook delivery, provider account retention, external AI topology, free-credit expiration and operational recovery must still be verified in the deployed environment. Do not use confidential proposal data before these requirements and processor terms have been reviewed.
