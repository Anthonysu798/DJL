# Harness accounts in DJL

DJL has new native integration code for Codex, Claude Code, Cursor, Grok Build, and Kimi Code alongside its active OpenCode runtime. These bridges do not reactivate the historical adapters. The Accounts screen is available in Electron; its authenticated RPC contracts are shared with the backend for a future iOS interface.

## Connect an account

1. Open **Settings → Accounts**.
2. Install the provider's official command-line tool if the screen reports it missing. Each row links to its setup instructions. OpenCode is installed separately; DJL does not bundle its executable.
3. Choose **Sign in** and complete the provider's own flow in the dedicated terminal or browser it opens.
4. Close the sign-in terminal and refresh. Select the harness and model in a new chat, or choose **Use for new chats**.

The native runtimes retain their own authentication and credential storage. DJL runs the official tools with the configured native profile; it does not copy their OAuth tokens into an API proxy. A successful sign-in does not change the provider's plan limits or billing rules.

## Chinese models and coding plans

Accounts includes direct connections for these officially supported plans:

| Plan | Connection |
| --- | --- |
| GLM international | Z.AI Coding Plan through OpenCode |
| GLM mainland China | Zhipu AI Coding Plan through OpenCode; separate credentials and coding endpoint |
| Kimi membership | Kimi Code's official OAuth login, or a Kimi For Coding key through OpenCode |
| MiniMax international / China | Separate Token Plan provider entries through OpenCode |
| GitHub Copilot / GitLab Duo | The installed OpenCode CLI's advertised sign-in methods |
| Grok | Official Grok Build login and ACP runtime; provider eligibility and limits apply |

For Kimi OAuth, choose **Use existing CLI region**, **International**, or **Mainland China** before signing in. The default preserves the installed CLI's region. Explicit region selections use the official `kimi.ai` or `kimi.com` authentication and coding endpoints, respectively. DJL waits for the selection to save before enabling sign-in. The current Node-based `@moonshot-ai/kimi-code` runtime is supported; legacy Python kimi-cli credentials are not silently copied or migrated.

Grok defaults to the currently advertised `grok-4.6` model. Grok and Kimi model pickers prioritize their runtime catalogs while keeping explicit custom model choices.

The sign-in terminal identifies the selected provider and scrolls into view. Closing it cancels an unfinished login and refreshes provider status. OAuth-only providers remain discoverable before their first login; Accounts requests fresh authentication state instead of using an older model-catalog snapshot. Other providers, including Qwen offerings, remain available through the installed OpenCode runtime when supported by that provider and plan.

Some plans use API keys, while other providers offer OAuth. Existing **Models & API keys** connections remain available. OpenCode installation checks, login, model discovery, chat, and auxiliary generation use the same configured executable (or `opencode` on PATH). DJL shares the installed CLI's normal credentials and configuration. Signing in or removing a saved login affects that CLI too. Existing CLI logins are recognized automatically, including OAuth and custom provider connections.

For older DJL-only logins, Accounts offers **Copy saved DJL logins to OpenCode**. This is an explicit action: existing CLI provider entries win, and the original file and a private backup are retained. Existing conversations migrate on first resume using the official CLI's export/import commands and a consistent SQLite backup; DJL verifies the original session ID and transcript before continuing. A failed migration retains the source and reports an error instead of replacing the conversation.

## Provider tool updates

Provider tools shows installed/latest versions for Codex, Claude Code, OpenCode, Grok Build, Kimi Code, and Cursor. **Update all** updates installed, supported, outdated tools sequentially and shows individual results. Missing tools are installed only through an explicit Install action. Custom or unrecognized installations retain their setup guide instead of updating a different installation.

**Automatically update provider tools** is off by default and saved on the server. When enabled, DJL checks every six hours and defers maintenance while chats are running or terminals are open. Closing Settings does not stop the scheduler. This controls DJL's scheduler; official CLIs can also have their own update policies.

Updates use the detected package manager or vendor installer/updater. Cursor's date-and-build version is compared as a release identifier, not as a semantic-version prerelease hash. Kimi native updates preserve the install root and skip shell-profile changes. Grok uses its official stable feed. The controller verifies the resulting version and reports unknown/offline results or failures rather than claiming success. OpenCode protocol compatibility is checked separately from its version.

- [OpenCode provider guide](https://opencode.ai/docs/providers/)
- [Kimi in OpenCode](https://www.kimi.com/code/docs/en/third-party-tools/opencode.html)
- [Cursor authentication](https://cursor.com/docs/cli/reference/authentication)
- [Claude Code authentication and credential use](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)

## Current native bridge scope

The fresh native bridges support text chats in Chats/Projects, native tool execution, streamed responses, approval prompts, interruption, and resuming their own saved sessions. Explicit Codex permission policies survive recovery. The other native runtimes use their provider permission systems; DJL does not claim that those are an OS sandbox.

Work tasks continue through OpenCode because the new native bridges do not yet implement `WorkTurnPolicy`. Attachments and richer operations such as native review, steering, conversation rewind, and compaction are not implemented in these new bridges and fail explicitly when requested. Historical inactive harnesses are still excluded from new turns.

## Local development

Run `bun run electron:dev` from the repository root. The standard renderer port is 5733. The iOS project is `apps/ios/DJL.xcodeproj`, scheme `DJL`; it can be built and launched independently in Simulator.

Validation for this change includes native protocol fixtures, real message-ingestion/SQLite tests, account and terminal lifecycle tests, shared command-contract tests, and browser picker checks. Live account verification is separate: Codex and Claude each completed a minimal native turn with the exact response `DJL OK`. The final Electron end-to-end check also rendered `DJL UI OK` from Codex in a real standalone chat, after resolving its materialized workspace directory. Cursor's official agent CLI was installed through its existing desktop launcher and passed ACP initialization; its account still requires sign-in, so a Cursor model turn remains unverified. Those observations are not a guarantee for another account or machine.

## Subscription integration verification (2026-09-07)

The implementation is covered by protocol fixtures, real SQLite ingestion for Grok and Kimi, regional endpoint tests, installer/maintenance tests, and rendered account controls. A separate Electron QA instance used official OpenCode 1.18.29, Grok 1.0.13, Kimi Code 0.41.0, and Cursor 2026.09.02-c22c1a3. Installed/latest version displays matched those runtimes. The China GLM action reached the API-key prompt with `zhipuai-coding-plan`; Kimi international login reached its official device-authorization page. Both test logins were cancelled without submitting credentials. Automatic-update and region settings persisted through the real backend. Authenticated paid generation for those new accounts was not exercised; users must complete the provider's login and have an eligible plan.

Official references: [GLM international](https://docs.z.ai/devpack/tool/opencode), [GLM China](https://docs.bigmodel.cn/cn/guide/develop/opencode), [Kimi CLI](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html), [Kimi environment settings](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/env-vars.html), [Grok Build](https://docs.x.ai/build/overview), [Cursor installation and updates](https://cursor.com/docs/cli/installation).
