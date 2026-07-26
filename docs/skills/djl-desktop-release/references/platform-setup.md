# Platform and repository setup

## GitHub repository

- Canonical repository: `Anthonysu798/DJL` (public)
- Default workflow permissions: read-only
- Required status check on `main`: **`desktop-ci`** — the small aggregate job that depends on all
  five lanes. It is deliberately the only required context; the lanes themselves are not listed.
- Branch protection is codified in `scripts/setup-release-branch-protection.sh`
  (`bun run release:protect-main`), so the setting the release preflight depends on is reviewable
  and re-runnable rather than a one-off console click. It sets no force-pushes, no deletions,
  linear history, and leaves admin enforcement off so the maintainer keeps direct-to-main pushes.

Enable secret scanning, push protection, private vulnerability reporting, dependency alerts, and the
release-sensitive `CODEOWNERS` rules.

## Production environment

- Name: `production`, gating only the `promote` job
- Required reviewer: Anthony Su; prevent self-review disabled
- Deployment branch policies: **`main` (branch) and `v*` (tag)**

The tag policy is required, not optional. The release workflow is triggered by a tag push, so
`promote` runs on a tag ref; with only a branch policy configured GitHub rejects the deployment and
the release stops after all three native builds have already been paid for.

## Release trigger

`desktop-release.yml` triggers **only** on pushing an annotated `v*.*.*` tag. It has no
`workflow_dispatch`, and a guard test asserts it never gains one — a release must be traceable to a
tag. Do not attempt `gh workflow run desktop-release.yml`; it will fail. Use `bun run ship`.

## macOS

Repository secrets:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY` containing the App Store Connect private-key contents
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

Never use a maintainer-specific key path in source or workflow configuration. The workflow writes the
API key to a runner-temporary file with restricted permissions.

ARM64 builds run on `macos-14`, Intel on `macos-15-intel`. Both must pass Developer ID authority,
Team ID `U76N9JSK4M`, notarization, stapling, Gatekeeper, and deep signature verification in the
release workflow, plus the shared bundle contract in `scripts/verify-macos-app-bundle.sh`:
architecture, Mach-O native slices, the pinned `onnxruntime-node` and OpenCode versions, and
canonical updater origin. That script also runs in the CI package smokes, so bundle defects surface
on every push to `main` rather than mid-release.

Version pins are read from `scripts/lib/desktop-stage-dependency-overrides.ts` and
`scripts/lib/vendored-opencode.ts`, never repeated in a workflow or the verifier.

Expect Intel to be the long pole: roughly 20–23 minutes, since notarization is a round-trip to Apple
and the runner is slower than ARM64.

## Windows x64

Windows builds run on `windows-2022` and must clear Apple and Azure Trusted Signing variables before
packaging. Until the policy changes, the final NSIS installer must return `NotSigned` from
`Get-AuthenticodeSignature`, and release notes must disclose SmartScreen.

Windows has no code-signing trust anchor, which is why installers carry Sigstore build provenance:

```bash
gh attestation verify DJL-X.Y.Z-x64.exe --repo Anthonysu798/DJL
```

`SHA256SUMS` proves a download matches what the release lists; it cannot prove origin, because the
same pipeline writes both. Provenance binds the binary to this repository, commit, and workflow.

## Landing site

The site is edited in `apps/landing` and deployed by Vercel from `Anthonysu798/DJL_landing_website`.
`landing-deploy.yml` tests and builds it, then mirrors it across.

- Requires `LANDING_MIRROR_TOKEN`: a fine-grained token with Contents read/write on the deployment
  repository. Without it the workflow verifies but reports that it could not deploy.
- Mirror commits must be authored as the repository owner. Vercel blocks deployments whose git
  author it cannot link to an account member, producing a successful push and a
  `Deployment was blocked` status that reads like a build failure but is not.
- A manual `workflow_dispatch` pushes an empty commit, which is how to force a redeploy after a
  Vercel-side failure.

## Emergency VPS access

No local paths or hosts have defaults. Supply explicitly:

- `DJL_RELEASE_HOST`
- `DJL_RELEASE_SSH_KEY`
- `DJL_RELEASE_ROOT`
- `DJL_RELEASE_VERSION`
- `DJL_RELEASE_ASSET_DIR`

Use them only to promote already-verified canonical bytes. Never paste a private key into chat,
source, workflow inputs, or logs. The VPS is a download fallback only; the landing routes prefer
GitHub Releases and degrade to it when the GitHub API is unreachable.
