# Submission requirements and remaining evidence

This is a release audit, not a completed submission or a redesign of the approved product. The connected Devpost API returned the PayPal AI Hackathon requirements (event 31302, `paypalaihackathon`) and dates on October 29, 2026 UTC. The public event is [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

Submission closes **November 12, 2026 at 20:00 UTC / 23:00 Istanbul time**. Judging runs December 1 at 22:00 UTC through December 15 at 16:00 UTC. Runtime, credits and judge access must remain available through judging.

## Required deliverables

| Requirement | Current evidence | Still needed |
| --- | --- | --- |
| Central PayPal sandbox integration | Supplier invoice adapter, award binding, mismatch checks, receipt persistence, recovery, verified-webhook path and mocked transport tests | Real supplier credentials, actual buyer checkout, verified delivery and authoritative reconciliation |
| Meaningful runtime AI | Configurable extraction/explanation adapter, strict schemas, citation checks, usage budgets and regression runner | Real provider qualification and recorded analysis; development assistance and curated fixtures do not prove runtime AI |
| Functional demo | Runnable local build, source/setup instructions and browser tests | Complete the genuine PayPal/AI flow; verify hosted judge access under the approved Render/Supabase plan |
| Public open-source repository | https://github.com/IACBI/bidcairn, root MIT license, source and setup instructions | Preserve redaction, license visibility and source/runtime instructions in the final revision |
| Public YouTube video under 3 minutes | `docs/demo-script.md`, target 2:45 | Record the actual functioning application after external gates pass; publish a public YouTube link |
| Accurate tool disclosure | README labels references, simulations, development assistance and runtime adapters | Name only the provider/model and sponsors actually used, with their roles and observed results |
| Eligibility and registration | Both currently connected Devpost account listings were checked; neither returned this event as registered | Confirm the participant account, registration and the required personal/team eligibility declarations |
| Product naming | Exact USPTO wordmark search found no result; `.com` RDAP showed registration | Review similar/international marks and acknowledge domain risk before broader publication |

The prose accepts complete repository run instructions or a hosted demo. The current form also has a required working-demo/test-build URL. The approved hosted judge experience remains the target; a localhost link is not accessible to remote judges. No zip upload is required.

## Current custom fields

Field IDs come from `get_submission_requirements`, not guessed labels. Keep these IDs current when preparing final answers. This file does not submit or certify any answer.

| ID | Field | Answer authority / readiness |
| --- | --- | --- |
| 28778 | Submitter Type | Participant confirms Individual, Team or Organization |
| 28779 | Submitter Country of Residence | Participant confirms; do not infer from timezone |
| 28780 | Canadian province, or N/A | Participant confirms |
| 28781 | Organization name, or N/A | Participant confirms |
| 28782 | New or existing before Oct 1, 2026, 09:15 PT | Repository implementation began during this event; participant confirms any earlier project work |
| 28783 | Earlier work and changes, or N/A for new | Match the confirmed project history |
| 28784 | Main technology requirement | Describe the actual PayPal sandbox lifecycle and qualified runtime AI; incomplete until both gates pass |
| 28786 | Additional sponsor tools | Select only tools actually used; do not select Render/Astropods based only on planned use |
| 28788 | Public repository URL | https://github.com/IACBI/bidcairn |
| 28787 | Working demo, hosted application or test-build URL | Hosted judge URL pending |
| 28798 | Judge testing instructions/credentials (optional) | Use isolated synthetic workspaces; never publish merchant secrets or buyer account passwords |
| 28790 | PayPal integration experience, 1–10 | Participant's own rating after genuine integration |
| 28791 | Rating feedback | Participant's own experience; explain real issues and fixes |
| 28792 | Permission to contact for feedback | Participant chooses Yes or No |
| 28793 | APIMatic experience (optional) | Omit unless actually used |
| 28799 | AG Grid experience (optional) | Omit unless actually used |
| 28794 | Age of majority declaration | Participant confirms for every teammate |
| 28795 | Eligible jurisdiction declaration | Participant confirms for every teammate against official rules |
| 28796 | Promotion-entity employee/agent declaration | Participant confirms for every teammate |
| 29053 | AI tools used during the project | Distinguish OpenAI Codex development assistance from any actual runtime model/service; confirm exact development model from app settings rather than inventing it |
| 29054 | Learning derived: None, Moderate or Significant | Participant's own assessment |
| 29055 | Career value from AI: Yes or No | Participant's own assessment |

The required video URL and normal project title/description belong to the submission deliverables in addition to the custom fields above. The current custom fields do not ask for a Codex session ID; do not inspect or publish unrelated session histories.

## Release decision

Keep `submissionReady=false` until the actual evidence exists. Green CI, source publication and local simulator behavior cannot substitute for real PayPal/AI acceptance. Complete `release-evidence.local.json` from the example only after observation and review. The public submission itself is a separate final action; no Devpost registration, project creation or submission has been performed by this audit.
