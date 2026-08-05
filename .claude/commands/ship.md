---
description: Ship a verified production release of the DJL desktop app
---

Ship the current `main` as a production release.

## Steps

1. **Write the release notes first.** Read `git log $(git describe --tags --abbrev=0 --match 'v*')..HEAD`
   and write user-facing notes to a scratch file. These become the published release body, so write
   for someone deciding whether to update — not a commit dump:
   - Lead with what changed for the user. Group as `### Added` / `### Fixed` / `### Changed`.
   - Skip pure-internal churn (test refactors, CI plumbing) unless it changed behaviour.
   - Keep it short. Five good lines beat twenty mechanical ones.
   - Never invent changes. If the commits are all internal, say "Maintenance and stability release."

2. **Run the ship command** with the bump level the user asked for:
   - "ship it" → `bun run ship --notes-file <path>`
   - "ship it minor" → `bun run ship minor --notes-file <path>`
   - "ship it major" → `bun run ship major --notes-file <path>`
   - "ship it rc" → `bun run ship rc --notes-file <path>`
   Add `--dry-run` first if you want to show the user the computed version before tagging.

3. **The script refuses to ship** unless the tree is clean, you are on `main`, local matches
   `origin/main`, `main` is protected, the exact commit has a successful full Desktop CI run, and the
   version is unused and newer than every canonical GitHub release. Do not work around a refusal —
   fix the cause.
   If CI has not finished for the current commit, wait for it.

4. **After the tag is pushed**, watch the release:
   `gh run list --repo Anthonysu798/DJL --workflow desktop-release.yml --limit 1`
   Report progress through preflight → draft → the three native builds → finalize.

5. **Tell the user to approve the `production` environment.** The promote job waits for a human
   there. Nothing becomes public until they approve, and a failed run leaves a private draft rather
   than a partial updater feed.

## Notes

- Never edit the draft release's body through the API to fix notes. A `PATCH` without `tag_name`
  resets the draft's tag to `untagged-<hash>` and every subsequent upload fails with
  `release not found`. Fix notes by deleting the tag and retagging.
- The landing page's Download buttons resolve the newest release automatically, so no site change is
  needed after shipping.
- If a release fails midway, delete the draft release and the tag before retrying — the preflight
  rejects duplicates by design.
