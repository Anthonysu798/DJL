# DJL OpenCode upstream manifest

- Repository: https://github.com/anomalyco/opencode
- Version: `1.17.18`
- Tag: `v1.17.18`
- Commit: `b1fc8113948b518835c2a39ece49553cffe9b30c`
- Git tree: `d47e0f4006aefaab6a2f9afc476c41f7107fec5f`
- Upstream tag archive SHA-256: `8155624b66f03615101d9b9584de5ffd891bf3f0e39bb12009d5c50061d0a71f`
- License: MIT (`LICENSE` in this directory)
- Imported: 2026-07-12

DJL vendors the complete upstream source tree so its headless OpenCode runtime can be built,
audited, and extended with the application. The root DJL workspace does not treat this nested
repository as a workspace; OpenCode keeps its own lockfile and build toolchain.

## Local patches

DJL-specific changes are marked with `DJL_MANAGED_AUTH` and must remain narrowly scoped. Managed
mode prevents host environment credentials and config-embedded API keys from making providers
appear connected. Credentials are instead written through OpenCode's auth API into DJL's isolated
XDG data directory.

The headless build script accepts DJL target OS/architecture flags for release packaging. DJL's
preparation command installs the pinned workspace without lifecycle scripts because the runtime is
compiled into one binary and OpenCode's root postinstall is not needed for that build. The build
uses Bun `1.3.14`, matching the pinned upstream toolchain requirement.

## Updating

1. Fetch and verify the desired stable OpenCode tag and commit.
2. Replace this directory with `git archive <commit>` from upstream.
3. Reapply the documented managed-auth and build-target patches.
4. Update the exact `@opencode-ai/sdk` version in `apps/server/package.json`.
5. Run the focused OpenCode runtime, adapter, RPC, web, and desktop packaging tests.
