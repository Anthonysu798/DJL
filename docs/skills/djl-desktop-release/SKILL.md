---
name: djl-desktop-release
description: Ship, validate, recover, or diagnose a DJL desktop release. Use when asked to ship it, cut a release, publish a version, bump the version, tag a release, or investigate a failed or partial DJL Windows/macOS release.
---

# DJL Desktop Release

Ship production desktop releases with `bun run ship`. It computes the next version, refuses to tag
anything unverified, writes the release notes into the tag, and pushes — the pushed tag is what
starts `.github/workflows/desktop-release.yml`.

Treat [the release runbook](../../release.md) as authoritative; this skill is the operating
procedure. Use the VPS only for explicit emergency recovery.

## Ship it

When the user says "ship it" (optionally "ship it minor", "major", or "rc"):

**1. Write the release notes first.** They become the published release body, so write for someone
deciding whether to update.

```bash
git log --no-merges --format='- %s' "$(git describe --tags --abbrev=0 --match 'v*')..HEAD"
```

Write to a scratch file, grouped as `### Added` / `### Fixed` / `### Changed`. Skip internal churn
(test refactors, CI plumbing) unless behaviour changed. Five useful lines beat twenty mechanical
ones. Never invent a change; if everything is internal, say "Maintenance and stability release."

**2. Show the computed version, then ship.**

```bash
bun run ship --dry-run --notes-file NOTES.md     # prints the version, tags nothing
bun run ship --notes-file NOTES.md               # next patch
bun run ship minor --notes-file NOTES.md         # next minor
bun run ship major --notes-file NOTES.md         # next major
bun run ship rc --notes-file NOTES.md            # next release candidate
```

**3. Monitor, then hand off the approval.**

```bash
gh run list --repo Anthonysu798/DJL --workflow desktop-release.yml --limit 1
```

## How the version is chosen

`ship` never reads a version from the tree. It takes the highest version observed across canonical
GitHub releases, the legacy `DJL-Releases` repository, and both live VPS manifests, then bumps it:

| Argument | 0.5.6 becomes | Notes |
| --- | --- | --- |
| *(none)* | `0.5.7` | default |
| `minor` | `0.6.0` | |
| `major` | `1.0.0` | |
| `rc` | `0.5.7-rc.1` | a further `rc` gives `-rc.2` |

A release candidate resolves to its own line: `0.6.0-rc.2` with no argument becomes `0.6.0`, so a
finished candidate ships as the version it was testing. Because the highest *live* version is the
input, the sequence self-corrects even if a release was skipped or published elsewhere.

## What ship refuses

Fail-closed. Fix the cause; never work around a refusal.

- uncommitted changes in the working tree
- a branch other than `main`, or `main` out of sync with `origin/main`
- `main` not protected — run `bun run release:protect-main`
- no successful full **Desktop CI** run for the exact `HEAD` commit
- a version already tagged or released, or not newer than every live feed

## Release contract

- Repository and updater origin: `Anthonysu798/DJL`
- Source: a commit contained in protected `main` with full Desktop CI success
- macOS ARM64 on `macos-14`, macOS x64 on `macos-15-intel`, Windows x64 on `windows-2022`
- macOS: Developer ID signed, notarized, stapled, Gatekeeper verified
- Windows: intentionally unsigned; Authenticode must report `NotSigned`
- Installers carry Sigstore build provenance
- Inventory: exactly **13** assets — 8 payloads, 4 updater manifests, `SHA256SUMS`
- Promotion: protected `production` environment

Publication uses the same-repository `GITHUB_TOKEN`. Never request a permanent cross-repository
release token.

## Pipeline order

1. preflight — annotated tag, protected-main membership, CI success, credentials, version, notes
2. private draft creation
3. three concurrent native builds, each attesting and uploading its own payloads
4. finalize — receipts validated against GitHub digests, `SHA256SUMS` then manifests uploaded last
5. exact 13-asset inventory verification
6. `production` approval
7. publication as Latest, or as a prerelease excluded from Latest

Approval is the user's to give. Only approve on their behalf when they have explicitly authorized
it for that release.

## Hard rules

1. **Green or stop.** Never tag or promote while a required check is red, pending, or skipped.
2. **Never mutate a release out of band.** No `PATCH` on a draft, no hand-uploaded assets, no
   publishing from the UI. A body-only `PATCH` silently rewrites a draft's `tag_name` to
   `untagged-<hash>`, and every later upload fails with a misleading `release not found`.
3. **Notes live in the tag.** To change them, delete the tag and retag — never edit the draft.
4. **Tag with `--cleanup=verbatim`.** Git otherwise strips every `#` markdown heading from the body.
   `ship` does this; a manual `git tag` must too.
5. **Bundle checks belong in `scripts/verify-macos-app-bundle.sh`**, which both the release build and
   the CI package smokes run. A check added only to the release workflow is unproven until a real
   release has already paid for signing and notarization.
6. **Grep `file -b`, never `file`.** `file` prints the path, so `.../koffi/linux_arm64/...` satisfies
   a grep for `arm64` whatever the binary is.
7. **Report evidence, not expectation.** "CI is green" means you read the conclusion.

## Verification after publication

```bash
gh release view vX.Y.Z --repo Anthonysu798/DJL --json assets --jq '.assets|length'   # 13
gh attestation verify DJL-X.Y.Z-x64.exe --repo Anthonysu798/DJL
curl -sI https://slcor.com/download/windows                                          # 307 to the new version
```

Confirm both macOS builds report the Developer ID authority and Team ID `U76N9JSK4M`, Windows
reports `NotSigned`, three schema-version-1 receipts validated, four manifests uploaded last, and
stable releases set as Latest.

The landing site needs no change: its Download buttons resolve the newest release at request time
and follow automatically.

## Failure handling

A failure before promotion leaves a private draft. Never publish a partial feed.

- Diagnose from the first failed job; keep the draft as evidence.
- Never hand-upload a missing manifest or asset.
- To retry: delete the draft **and** the tag, fix the cause, push the fix, wait for CI, retag.
- Never overwrite an existing tag or asset.

For a bad published release, return it to draft only with explicit user approval, then ship a
strictly newer fixed version. Never replace bytes under an existing version.

## Scope

Desktop product only: Electron shell and preload, renderer, bundled backend, contracts/shared
runtime, local remote gateway/protocol, `effect-acp`, release helpers, and OpenCode as the embedded
dependency. Never add iOS, remote-relay deployment, marketing, Linux installers, npm publication, or
standalone OpenCode CI to a desktop release.

The landing site deploys through its own `landing-deploy.yml` on pushes touching `apps/landing/**`
and is not part of a desktop release.

## Boundaries

Preparing a release does not authorize renaming or creating repositories, changing visibility,
configuring secrets, or archiving `DJL-Releases`. Do those only on explicit request.

Report the source commit, workflow run, version and tag, signing status, unsigned Windows status,
13-asset verification, provenance, updater state, and any remaining limitation.
