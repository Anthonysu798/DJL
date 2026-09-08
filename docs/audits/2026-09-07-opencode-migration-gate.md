# Installed OpenCode migration: compatibility gate

## Historical decision

This records the initial failed direct-cutover probe. The later compatibility implementation and vendor removal are documented in [the completion report](2026-09-07-installed-opencode.md).

The production cutover is blocked. Do not delete the vendor or redirect login/chat yet.
The approved plan explicitly requires preserving fork-specific behavior before removing it.
Official OpenCode 1.17.18 and current npm release 1.18.29 do not preserve three tested Work
guarantees even when documented session permissions reproduce the tool allowlist.

This is evidence against a direct replacement, not a claim that a future DJL compatibility
layer is impossible. No production provider routing, login environment, packaging, user data,
or vendor files were changed in this implementation stage.

## Implemented

- `scripts/probe-installed-opencode.ts`: a repeatable live CLI probe using an explicit binary,
  temporary home/project, authenticated loopback OpenCode server, and local fake model endpoint.
  It exercises real OpenCode prompt processing without a model subscription or user credentials.
  The server processes and temporary data are cleaned up after the probe.
- `scripts/lib/opencode-compatibility.ts`: evaluates observed model requests and completed tool
  results. Exit status does not rely on HTTP success or a version string.
- `scripts/opencode-compatibility.test.ts`: four tests covering success, the observed direct
  replacement failure, missing observations, and the native-permission partial improvement.
- `2026-09-07-opencode-patch-inventory.json`: source comparison with the manifest's pinned upstream
  commit, including the downloaded archive digest. Symlinks are compared as links.

The fixture asks OpenCode to expose only `read`, require a local-model tool call, and suppress
inherited instructions. Its project AGENTS.md contains a unique marker. The mock model returns
text-form read-tool JSON of the kind repaired by DJL's fork, then ordinary text if a subsequent
model request occurs. A pass requires a completed read tool result containing the fixture marker.

Run with a separately installed official CLI (Node 24):

```sh
node scripts/probe-installed-opencode.ts /absolute/path/to/opencode
node scripts/probe-installed-opencode.ts /absolute/path/to/opencode --native-permissions
bun run --cwd scripts test -- opencode-compatibility.test.ts
```

The native-permissions variant creates a session with deny-all permissions plus an explicit read
allowance. The default variant sends the current DJL per-turn fields unchanged. Compatibility
failures print a structured report and exit 1. Infrastructure failures also exit nonzero and must
not be interpreted as a completed compatibility observation. Loopback listening must be allowed.

## Observed results

| CLI and probe | Exposed tools | Local tool choice | Inherits AGENTS.md | Text tool call executed | Exit |
|---|---|---|---|---|---|
| Official 1.17.18, current DJL fields | 11 built-ins | auto | Yes | No | 1 |
| Official 1.17.18, native permissions | read only | auto | Yes | No | 1 |
| Official 1.18.29, native permissions | read only | auto | Yes | No | 1 |

Both permission probes made one model request and returned the malformed tool JSON as text.
They did not produce a completed read tool result. The 1.17.18 direct probe exposed bash, edit,
glob, grep, question, read, skill, task, todowrite, webfetch, and write.

Official packages were downloaded from npm into `/tmp/djl-opencode-migration`, with package
installation scripts disabled. The platform binary was invoked directly. No global package
installation or account login occurred. The selected shared-login behavior remains the target;
it has not been activated while this gate is red.

## Fork inventory and replacement requirements

Compared against upstream commit `b1fc8113948b518835c2a39ece49553cffe9b30c`:
3,418 byte-different regular files, 10 substantively changed files, 7 added files, no removed
files, and no changed symlink targets. The remaining 3,408 differences were classified as
formatting after normalization and inspection; this classification is not a formal equivalence proof.

| Fork behavior | Location under vendor/opencode | Replacement requirement |
|---|---|---|
| Target OS/architecture build flags | packages/opencode/script/build.ts | Remove when bundled artifacts are retired. |
| Managed credentials and provider credential filtering | packages/opencode/src/provider/provider.ts | Intentionally replace with shared CLI auth after migration tests; do not merge credentials silently. |
| Per-turn policy persistence and transport | packages/schema/src/v1/session.ts; packages/sdk/js/src/v2/gen/types.gen.ts; packages/opencode/src/session/prompt.ts | Preserve equivalent behavior without assuming custom fields are honored. |
| Tool filtering, managed MCP tool aliases, first-step local tool choice | packages/opencode/src/session/tools.ts; packages/opencode/src/session/prompt.ts | Native permissions prove filtering only; aliases and required local tool choice still need verified replacements. |
| Suppression of inherited instruction files | packages/opencode/src/session/prompt.ts | Preserve Work isolation while retaining shared account configuration. |
| Small-local-model system prompt and no-tool model handling | packages/opencode/src/session/llm/request.ts; added local-model-prompt.ts | Preserve readable chat and prevent unsupported tool definitions from reaching small models. |
| Text/JSON/DSML tool-call recovery for Ollama, LM Studio, DeepSeek | packages/opencode/src/session/llm.ts; added local-tool-call-middleware.ts | Convert malformed streamed text into real runtime tool calls before execution/continuation. This is not equivalent to hiding text in DJL. |
| Web retrieval timestamps | packages/opencode/src/tool/websearch.ts and its test | Preserve source-retrieval evidence used by Work results. |

The seven additions comprise the provenance manifest, two runtime helpers and four regression
test files. The complete substantive path list is in the adjacent JSON inventory.

The inspected plugin interface exposes system/messages transforms and text completion hooks,
but no LanguageModelMiddleware.wrapStream equivalent. A system-transform plugin is a possible
instruction-isolation implementation; it has not been validated. Merely sending permission
rules or rejecting the turn afterward cannot reproduce the fork's stream-to-tool conversion.
Do not claim the whole migration is impossible, or replace it with prompt-only instructions.

## Validation and remaining work

- Fresh baseline: 172 contract tests passed; all 8 desktop typecheck tasks passed. The previous
  missing-export and schema-cycle failures were already resolved by ongoing work before this stage.
- New gate: all 4 unit tests passed; scripts typecheck passed; new files have 0 lint warnings/errors
  and pass formatting checks. Live official-CLI gate failures are the expected findings above.
- The probe covers four necessary conditions, not all upgrade or runtime acceptance criteria.
  Managed MCP aliases, model-specific recovery formats, chat-only models, retrieval evidence,
  authentication transfer, session export/import and resume, Windows, Electron UI and packaging
  remain unverified. No release was attempted.

Before continuing the cutover, implement and prove a DJL-owned compatibility layer that restores
instruction isolation, first-step local tool choice, and stream-level tool-call recovery through
supported upstream extensions. Then extend the live fixtures to every inventoried behavior and
complete the approved session/credential migration tests. If no supported extension can provide
the required stream behavior, that capability needs upstream support or a separately designed
model-transport adapter; do not delete the fork under the current preservation requirement.

Only after these gates pass should executable resolution, shared login, UI statuses, packaging
and vendor deletion be switched together. Shipping a split installation/login path would retain
the original problem.
