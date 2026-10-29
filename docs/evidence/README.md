# Release evidence

Copy `docs/release-evidence.example.json` to the ignored root file `release-evidence.local.json`. Complete entries only after directly observing the required behavior. Set `reviewedBy`, timestamp and artifact paths under this directory; then run `npm run verify:gates`.

Commit only redacted, synthetic evidence: test summaries, provider qualification metrics, hosted isolation/recovery results, naming checks and public submission links. Never commit API keys, buyer passwords, merchant credentials or private account screenshots. Review artifacts before publication.

Configuration alone cannot pass a gate. A manually recorded check is an auditable attestation, not independent verification by the script. A local simulator, mocked provider test or hosted configuration screenshot cannot substitute for the actual PayPal/AI acceptance evidence.
