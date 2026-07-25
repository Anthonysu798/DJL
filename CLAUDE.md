Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

State your assumptions explicitly. If uncertain, ask.
If multiple interpretations exist, present them - don't pick silently.
If a simpler approach exists, say so. Push back when warranted.
If something is unclear, stop. Name what's confusing. Ask.
2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

No features beyond what was asked.
No abstractions for single-use code.
No "flexibility" or "configurability" that wasn't requested.
No error handling for impossible scenarios.
If you write 200 lines and it could be 50, rewrite it.
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:

Don't "improve" adjacent code, comments, or formatting.
Don't refactor things that aren't broken.
Match existing style, even if you'd do it differently.
If you notice unrelated dead code, mention it - don't delete it.
When your changes create orphans:

Remove imports/variables/functions that YOUR changes made unused.
Don't remove pre-existing dead code unless asked.
The test: Every changed line should trace directly to the user's request.

4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

"Add validation" → "Write tests for invalid inputs, then make them pass"
"Fix the bug" → "Write a test that reproduces it, then make it pass"
"Refactor X" → "Ensure tests pass before and after"
For multi-step tasks, state a brief plan:

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
---

## Shipping a production release

When the user says "ship it" (optionally "ship it minor|major|rc"):

1. Write user-facing release notes to a scratch file from the commits since the last `v*` tag.
   Group as `### Added` / `### Fixed` / `### Changed`, skip internal churn, never invent changes.
2. Run `bun run ship [minor|major|rc] --notes-file <path>` (default bump is patch). Add `--dry-run`
   first to show the computed version.
3. The script fails closed: clean tree, on `main`, synced with `origin/main`, `main` protected, a
   successful full Desktop CI run for that exact commit, and an unused version newer than every live
   feed. Fix the cause of a refusal; never bypass it.
4. The pushed tag triggers `.github/workflows/desktop-release.yml`. Tell the user to approve the
   `production` environment — nothing is published until they do, and a failed run leaves a private
   draft rather than a partial updater feed.

The annotated tag message becomes the published release body, so the notes you write in step 1 are
what users read. The landing page resolves the newest release automatically; it needs no edit.
