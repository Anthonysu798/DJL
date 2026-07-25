# DJL open-source launch checklist

This runbook prepares a history-free `Anthonysu798/DJL` without changing the current repository's
name, visibility, or remote. The existing repository remains private and will be renamed
`DJL-private-archive` only by the maintainer during launch.

## 1. Freeze and audit the source tree

Start from the reviewed release-architecture change. Preserve the intended `AGENTS.md`,
`CLAUDE.md`, `LICENSE`, and `TODO.md` working-tree decisions.

```sh
bun install --frozen-lockfile
bun run public-source:check
bun run brand:check
bun run ci:desktop:release-tests
```

Confirm the two Ghostty archives are ordinary Git blobs, not LFS pointers:

```sh
git check-attr filter -- \
  apps/ios/DJL/Terminal/Vendor/GhosttyKit.xcframework/ios-arm64/libghostty-fat.a \
  apps/ios/DJL/Terminal/Vendor/GhosttyKit.xcframework/ios-arm64-simulator/libghostty-fat.a
git lfs ls-files
```

Both `filter` results must be `unspecified`; `git lfs ls-files` must be empty. Each archive is about
23 MB and remains below GitHub's 100 MB regular-file limit.

## 2. Create the local clean snapshot

Export only reviewed files from the final source commit. Do not copy `.git`, ignored runtime state,
dependencies, build output, caches, or release artifacts.

```sh
snapshot="$(mktemp -d "${TMPDIR:-/tmp}/djl-open-source.XXXXXX")"
git archive HEAD | tar -x -C "$snapshot"
git -C "$snapshot" init -b main
git -C "$snapshot" add --all
git -C "$snapshot" commit -m "Initial open-source release"
```

Do not use the old repository's commit graph as a remote or graft. The clean repository must have
one root commit:

```sh
test "$(git -C "$snapshot" rev-list --count HEAD)" = "1"
test -z "$(git -C "$snapshot" rev-list --parents HEAD | awk 'NF > 1')"
```

## 3. Scan the clean repository

Run audits against the clean root commit and working tree:

```sh
git -C "$snapshot" ls-files -z |
  xargs -0 -n 1 sh -c 'test "$(wc -c < "$1")" -lt 100000000' sh
if git -C "$snapshot" grep -Il \
  '^version https://git-lfs.github.com/spec/v1$' -- .
then
  echo "Git LFS pointer found" >&2
  exit 1
fi
gitleaks git "$snapshot" --redact --no-banner
```

Also run the repository's `public-source:check` from the clean snapshot. Publication is blocked by
any unresolved secret, private runtime path, key material, LFS pointer, oversized file, missing
third-party license, or broken README image.

## 4. Maintainer-controlled GitHub launch

Stop here until Anthony Su performs the external repository operations.

1. Rename the current private repository to `DJL-private-archive`; keep it private.
2. Create a new private, empty `Anthonysu798/DJL` with no generated README, license, or `.gitignore`.
3. Add that new repository as the clean snapshot's `origin` and push only `main`.
4. Configure the ruleset, `production` environment, Apple secrets, security features, labels, and
   private vulnerability reporting from [docs/release.md](release.md).
5. Run manual **Desktop CI** and require all three native package smokes to pass in private.
6. Resolve every secret-scanning or license finding.
7. Verify the README image and links in GitHub's renderer.
8. Make the new repository public only after those checks pass.

Do not rename repositories, create the GitHub repository, push the snapshot, or change visibility
as part of source preparation.

## 5. First public release

After public launch, dispatch **Desktop Release** with the mechanically selected bridge version.
Verify both Mac installers, unsigned Windows, exact 15-asset inventory, Latest/prerelease state,
legacy-repository byte mirroring, VPS promotion, and installed-client updates from both legacy
feeds. Then archive `DJL-Releases` while retaining all old release and VPS bytes indefinitely.
