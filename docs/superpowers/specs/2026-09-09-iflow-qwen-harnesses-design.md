# iFlow CLI and Qwen Code native harnesses

**Date:** 2026-09-09
**Status:** Implemented on `feat/iflow-qwen-harnesses`

## Why

The Subscriptions panel offers Z.AI, Zhipu, Kimi For Coding and MiniMax plans as
plan keys through OpenCode because those vendors deliver their coding plans as a
subscription key and ship no official coding CLI with a machine protocol. The two
Chinese CLIs that do ship account login plus the Agent Client Protocol are
Alibaba's iFlow CLI and Qwen Code. This adds both as native harnesses that reuse
the CLI's own stored setup, the same way Codex, Claude Code, Cursor, Grok Build
and Kimi Code work.

Correction found during live verification: both vendors retired their account
logins in April 2026. Qwen Code's OAuth free tier ended on 2026-04-15, and iFlow
CLI gates every method except OpenAI-compatible behind a 2026-04-16 sunset date
(`Auth method has been deprecated. Please reconfigure with OpenAI Compatible
API.`). Each CLI therefore stores an OpenAI-compatible endpoint and key; DJL
reuses that stored setup and never takes a key itself.

## Verified runtime behaviour (iFlow CLI 0.5.19, Qwen Code 0.23.2)

|                                 | iFlow CLI                                                                                                | Qwen Code                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ACP entry                       | `iflow --experimental-acp`                                                                               | `qwen --acp`                                                                                |
| Auth methods advertised         | `oauth-iflow`, `iflow`, `openai-compatible`; only `openai-compatible` is accepted after 2026-04-16       | `openai` only; Qwen OAuth free tier discontinued 2026-04-15                                 |
| Stored-login signal             | `initialize` returns `isAuthenticated`                                                                   | `session/new` fails with `Authentication required`                                          |
| Model catalog                   | `session/new._meta.models.availableModels[{id,name}]`                                                    | `configOptions[category=model]`                                                             |
| Modes                           | `smart`, `yolo`, `default`, `plan`                                                                       | `plan`, `default`, `auto-edit`, `auto`, `yolo`                                              |
| Login command                   | none; interactive CLI opens its OpenAI-compatible setup dialog (verified live in DJL's sign-in terminal) | none; interactive CLI shows its auth dialog, `/auth` when signed in                         |
| Env that overrides stored login | `IFLOW_API_KEY`, `IFLOW_BASE_URL`                                                                        | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `QWEN_MODEL`, `QWEN_DEFAULT_AUTH_TYPE` |

## Design

- Harness ids `iflow` and `qwen` join every provider registry (contracts,
  server adapters, status cache, settings, web pickers, i18n audit allowlist).
- Drivers reuse `createNativeAcpDriver`. iFlow's driver refuses to start unless
  `isAuthenticated` is true and never calls `authenticate`, which would open a
  browser. Qwen's driver has no authenticate step and surfaces the runtime's own
  sign-in error. Both strip the override environment variables above.
- `readAcpModels` learns iFlow's `_meta.models` catalog shape.
- Account probes: iFlow reads `isAuthenticated` from initialize; Qwen attempts
  `session/new` and maps an authentication error to "required".
- Sign-in opens the interactive CLI in the embedded terminal with no arguments.
- Provider tools treats both as npm-managed packages with no vendor updater.
- No region setting: neither CLI has a regional endpoint choice.

## Not done

- Live authenticated turns need a user with an iFlow account or a Qwen Coding
  Plan; fixtures cover the protocol paths and the real CLIs were probed unauthenticated.
- Z.AI, Zhipu and MiniMax stay on the plan-key route until they ship an official
  CLI with a protocol.

## Addendum: CodeBuddy Code and Pi (same day)

Verified against the official docs and the installed CLIs (CodeBuddy Code 2.148.0, Pi 0.85.1).

|              | CodeBuddy Code                                                                                                                                                                                                                    | Pi                                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Entry        | `codebuddy --acp` (ACP on stdio)                                                                                                                                                                                                  | `pi --mode rpc --session-id <uuid>` (Pi JSONL RPC)                                                                                      |
| Login        | TUI `/login` picker: Google/GitHub (international), WeChat (China), iOA, enterprise domain                                                                                                                                        | TUI `/login <provider>`: Claude Pro/Max, ChatGPT Plus/Pro, GitHub Copilot, xAI, OpenRouter, Radius, plus API keys                       |
| Status probe | `initialize` + `session/new`; `Authentication required` means sign in                                                                                                                                                             | `get_available_models` empty means sign in                                                                                              |
| Never do     | call ACP `authenticate` (logs the account out and re-authenticates)                                                                                                                                                               | call `pi auth print-*` (prints secrets)                                                                                                 |
| Permissions  | ACP `session/request_permission` with `allow_always`/`allow`/`reject`                                                                                                                                                             | none built in; DJL loads an extension (`-e`) that confirms `bash`/`write`/`edit` through `extension_ui_request`/`extension_ui_response` |
| Models       | advertised in `session/new`                                                                                                                                                                                                       | `provider/model` ids from `get_available_models`; thinking level via `set_thinking_level`                                               |
| Resume       | `session/load`                                                                                                                                                                                                                    | `--session-id` is open-or-create; the file only exists after the first assistant message                                                |
| Env stripped | `CODEBUDDY_API_KEY`, `CODEBUDDY_AUTH_TOKEN`, `CODEBUDDY_BASE_URL`, `CODEBUDDY_INTERNET_ENVIRONMENT` (+ misspelt variants), `CODEBUDDY_MODEL`, `CODEBUDDY_CUSTOM_HEADERS`; sets `DISABLE_AUTOUPDATER=1`, `CODEBUDDY_DISABLE_IDE=1` | none removed (Pi's own auth file already outranks env keys); sets `PI_OFFLINE=1`                                                        |

Pi returns to the active harness list. The SDK-based historical `PiAdapter` stays disabled; the new
driver talks to the official CLI's RPC mode, in line with the fresh-harness policy.
