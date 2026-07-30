# Releasing model updates

1. Review the upstream model card, training/evaluation disclosures, license, repository ownership, and artifact format.
2. Pin an immutable revision. Download every required runtime file, measure exact bytes, calculate SHA-256, and update the manifest and notices.
3. Test clean install, interruption, untrusted redirects, oversized/corrupt files, offline inference, removal, and upgrade/rollback on every packaged OS/architecture.
4. Create a new calibration version; never change thresholds under an existing version.
5. Run the representative English/Chinese benchmark and security/file fixtures twice. Review false positives and coverage regressions.
6. Update architecture, licenses, benchmark results, limitations, and release notes.
7. Ship behind the Beta label unless all accuracy, privacy, security, performance, accessibility, packaging, and independent-review gates pass.

Rollback by restoring the prior pinned manifest/calibration version. Cache keys include every artifact fingerprint, the output contract, and complete calibration bands as well as version labels, so results cannot cross model or policy changes.
