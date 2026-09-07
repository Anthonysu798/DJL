# Harness accounts in DJL

DJL has new native integration code for Codex, Claude Code, and Cursor alongside its active OpenCode runtime. These bridges do not reactivate the historical adapters. The Accounts screen is available in Electron; its authenticated RPC contracts are shared with the backend for a future iOS interface.

## Connect an account

1. Open **Settings → Accounts**.
2. Install the provider's official command-line tool if the screen reports it missing. Each row links to its setup instructions. OpenCode is installed separately; DJL does not bundle its executable.
3. Choose **Sign in** and complete the provider's own flow in the dedicated terminal or browser it opens.
4. Close the sign-in terminal and refresh. Select the harness and model in a new chat, or choose **Use for new chats**.

Codex, Claude Code, and Cursor retain their own authentication and credential storage. DJL runs the official tools with the configured native profile; it does not copy their OAuth tokens into an API proxy. A successful sign-in does not change the provider's plan limits or billing rules.

## Chinese models and coding plans

OpenCode's provider login offers the authentication methods supported by the installed official CLI. For GLM coding-plan access, choose **Z.AI Coding Plan**. Kimi For Coding and MiniMax coding-plan access use their provider-specific credentials. Qwen and other Chinese models depend on the selected provider and plan; a general web-chat subscription is not automatically an API or coding-plan entitlement.

Some plans use API keys, while other providers offer OAuth. Existing **Models & API keys** connections remain available. OpenCode installation checks, login, model discovery, chat, and auxiliary generation use the same configured executable (or `opencode` on PATH). DJL shares the installed CLI's normal credentials and configuration. Signing in or removing a saved login affects that CLI too. Existing CLI logins are recognized automatically, including OAuth and custom provider connections.

For older DJL-only logins, Accounts offers **Copy saved DJL logins to OpenCode**. This is an explicit action: existing CLI provider entries win, and the original file and a private backup are retained. Existing conversations migrate on first resume using the official CLI's export/import commands and a consistent SQLite backup; DJL verifies the original session ID and transcript before continuing. A failed migration retains the source and reports an error instead of replacing the conversation.

Tools reports protocol compatibility separately from the installed version. If Node.js/npm is unavailable or the selected executable is custom, use its setup guide instead of silently modifying another installation.

- [OpenCode provider guide](https://opencode.ai/docs/providers/)
- [Kimi in OpenCode](https://www.kimi.com/code/docs/en/third-party-tools/opencode.html)
- [Cursor authentication](https://cursor.com/docs/cli/reference/authentication)
- [Claude Code authentication and credential use](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)

## Current native bridge scope

The fresh native bridges support text chats in Chats/Projects, native tool execution, streamed responses, approval prompts, structured questions, interruption, and resuming their own saved sessions. Explicit Codex permission policies survive recovery. Claude and Cursor use their native permission systems; DJL does not claim that those are an OS sandbox.

Work tasks continue through OpenCode because the new native bridges do not yet implement `WorkTurnPolicy`. Attachments and richer operations such as native review, steering, conversation rewind, and compaction are not implemented in these new bridges and fail explicitly when requested. Historical inactive harnesses are still excluded from new turns.

## Local development

Run `bun run electron:dev` from the repository root. The standard renderer port is 5733. The iOS project is `apps/ios/DJL.xcodeproj`, scheme `DJL`; it can be built and launched independently in Simulator.

Validation for this change includes native protocol fixtures, real message-ingestion/SQLite tests, account and terminal lifecycle tests, shared command-contract tests, and browser picker checks. Live account verification is separate: Codex and Claude each completed a minimal native turn with the exact response `DJL OK`. The final Electron end-to-end check also rendered `DJL UI OK` from Codex in a real standalone chat, after resolving its materialized workspace directory. Cursor's official agent CLI was installed through its existing desktop launcher and passed ACP initialization; its account still requires sign-in, so a Cursor model turn remains unverified. Those observations are not a guarantee for another account or machine.
