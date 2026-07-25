---
name: djl-desktop-release
description: Build, validate, publish, recover, or bridge DJL desktop releases through the canonical GitHub Actions workflow. Use when asked to release, ship, publish, verify, roll back, or diagnose a DJL Windows or macOS desktop version.
---

# DJL Desktop Release

Use the canonical `Anthonysu798/DJL` GitHub workflow for production desktop releases. Treat
[the repository release runbook](../../release.md) as authoritative. Use the VPS only for the
one-time legacy bridge or explicit emergency recovery.

## Scope

Automate only the DJL desktop product:

- Electron shell and preload
- renderer and bundled backend
- contracts/shared runtime
- local remote gateway/protocol
- `effect-acp`
- release helpers
- OpenCode only as the embedded DJL dependency

Never add iOS, remote-relay deployment, landing, marketing, Linux installers, npm publication, or
standalone OpenCode CI to a desktop release.

## Release contract

Require one explicit version in `X.Y.Z` or `X.Y.Z-prerelease` form. Do not choose a production
version silently.

- Repository and updater origin: `Anthonysu798/DJL`
- Source: current protected `main` commit
- macOS: ARM64 on `macos-14`, x64 on `macos-15-intel`
- Windows: x64 on `windows-2022`
- macOS policy: Developer ID signed, notarized, stapled, Gatekeeper verified
- Windows policy: intentionally unsigned; Authenticode status must be `NotSigned`
- Inventory: exactly 15 release assets
- Promotion: protected `production` environment

Normal publication uses the same-repository `GITHUB_TOKEN`. Never request or restore a permanent
cross-repository release token.

## Before dispatch

1. Read [platform and repository setup](references/platform-setup.md).
2. Confirm the repository is exactly `Anthonysu798/DJL`.
3. Confirm the requested commit is current protected `main`.
4. Confirm full **Desktop CI** succeeded for that exact commit, including all three package smokes.
5. Confirm the requested version and tag are unused.
6. Confirm the version is newer than the canonical releases, `DJL-Releases`, and both VPS
   manifests.
7. Confirm all five Apple secrets exist. Never print their values.
8. Confirm the `production` environment requires Anthony Su and allows self-review.

Do not bypass a failing preflight by editing workflow conditions or manually creating a tag.

## Dispatch and monitor

When the user explicitly authorizes the production release, dispatch:

```bash
gh workflow run desktop-release.yml \
  --repo Anthonysu798/DJL \
  --ref main \
  -f version=X.Y.Z
```

Find the resulting run and monitor it through completion. Expect this order:

1. preflight;
2. private draft creation;
3. three concurrent native builds;
4. direct payload upload from native runners;
5. receipt/manifests finalization;
6. exact 15-asset draft verification;
7. human approval on `production`;
8. stable Latest or prerelease publication.

Leave approval requests for the user. Do not approve on their behalf through another identity.

## Required verification

Require the workflow evidence for:

- Mac signing authority and Team ID `U76N9JSK4M`;
- notarization, stapling, Gatekeeper, deep signature, architecture, native dependencies, and
  canonical updater origin on both Macs;
- `onnxruntime-node` `1.23.2` on Intel;
- embedded OpenCode launch on both Mac targets;
- Apple and Azure signing variables absent from Windows;
- Windows `Get-AuthenticodeSignature` result `NotSigned`;
- three valid schema-version-1 receipts;
- GitHub-reported names, positive sizes, and SHA-256 digests;
- six updater manifests uploaded last;
- exactly 15 final assets;
- stable releases set as Latest and prereleases excluded from Latest.

After publication, inspect the GitHub Release and verify `SHA256SUMS` plus both updater manifests.

## Failure handling

Failures before promotion must leave a private draft. Never publish a partial feed and never
delete a failed draft automatically.

- Diagnose from the first failed job and preserve the draft for evidence.
- Do not upload missing updater manifests by hand.
- Delete a failed draft/tag only after the cause is understood and the user authorizes cleanup.
- Rerun from the same protected commit only if the one-day receipts still exist; otherwise rebuild.
- Never overwrite an existing tag or asset.

For a bad public release, stop discovery by returning it to draft only with explicit user approval,
then publish a strictly newer fixed version. Do not replace bytes under the old version.

## One-time legacy bridge

Run the bridge only when the user explicitly requests the migration.

1. Prefer `v0.5.5` only if it is unused and newer than canonical, legacy, and both VPS feeds.
2. Otherwise call `selectBridgeVersion` from `scripts/lib/release-update-policy.ts`.
3. Publish the bridge through the canonical workflow with updater origin `Anthonysu798/DJL`.
4. Download and verify the canonical 15 assets.
5. Mirror those exact bytes to `DJL-Releases` with a temporary fine-grained token.
6. Revoke the token immediately.
7. Promote the same bytes to the VPS with explicit legacy environment variables.
8. Test installed-client updates from every legacy feed.
9. Archive `DJL-Releases` but retain all release and VPS bytes indefinitely.

Never rebuild for a mirror.

## External repository boundary

Preparing source does not authorize renaming a repository, creating a GitHub repository, pushing a
history-free snapshot, changing visibility, configuring secrets, or archiving `DJL-Releases`.
Perform those actions only when the user explicitly requests them.

Report the source commit, workflow run, version/tag, signing status, unsigned Windows status,
15-asset verification, updater state, bridge/mirror state when applicable, and any remaining
limitation.
