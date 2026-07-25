# Platform and repository setup

## GitHub repository

- Canonical repository: `Anthonysu798/DJL`
- Default workflow permissions: read-only
- Required main check: `Desktop checks`
- Production environment: `production`
- Required reviewer: Anthony Su
- Prevent self-review: disabled
- Deployment branch: protected `main` only

Enable secret scanning, push protection, private vulnerability reporting, dependency alerts, and
the release-sensitive `CODEOWNERS` rules before the first public release.

## macOS

Repository secrets:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY` containing the App Store Connect private-key contents
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

Never use a maintainer-specific key path in source or workflow configuration. The workflow writes
the API key to a runner-temporary file with restricted permissions.

ARM64 builds run on `macos-14`; Intel builds run on `macos-15-intel`. Both must pass Developer ID
authority, Team ID, notarization, stapling, Gatekeeper, deep signature, native architecture,
`onnxruntime-node` `1.23.2`, updater-origin, and embedded OpenCode checks.

## Windows x64

Windows builds run on `windows-2022`. They must clear Apple and Azure Trusted Signing variables
before packaging. Until the release policy changes, the final NSIS installer must return
`NotSigned` from `Get-AuthenticodeSignature`, and release notes must disclose SmartScreen.

## Legacy bridge and emergency VPS access

No local paths or hosts have defaults. Supply these values explicitly:

- `DJL_RELEASE_HOST`
- `DJL_RELEASE_SSH_KEY`
- `DJL_RELEASE_ROOT`
- `DJL_RELEASE_VERSION`
- `DJL_RELEASE_ASSET_DIR`

Use them only to promote already-verified canonical bytes. Never paste a private key into chat,
source, workflow inputs, or logs.
