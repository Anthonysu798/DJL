# Subscription integrations — implementation and verification

**Goal:** Connect officially supported AI subscriptions in DJL, including international and mainland-China GLM/Kimi and Grok, with installed-tool version detection, automatic updates, and Update all.

**Status:** Implementation and verification complete in the local working tree. Provider credentials and eligible subscriptions remain user-supplied; no paid generation was exercised for the new accounts.

## Requirements audit

- [x] Regional coding-plan connections: Accounts targets the exact official OpenCode IDs for Z.AI, Zhipu AI, Kimi For Coding, and international/mainland-China MiniMax. These do not fall back to general API providers.
- [x] OAuth subscriptions: native Kimi Code and Grok Build use the official CLI login flows and shared native ACP bridge. GitHub Copilot and GitLab Duo use the installed OpenCode CLI's advertised methods. Disconnected OAuth-only providers are discoverable.
- [x] Kimi regions: Existing CLI region is the default; explicit International/Mainland China selections persist before sign-in, use the official kimi.ai/kimi.com endpoints, and travel in the native session profile.
- [x] Provider-owned credentials: native drivers validate cached authentication; sign-in is explicit. Grok does not fall back to an inherited API key. Kimi selects managed subscription models. No custom token proxy or browser-cookie extraction is used.
- [x] Native chat: model discovery, streamed responses, approval handling, cancellation, and resume are covered by protocol fixtures. Grok and Kimi events pass through real SQLite orchestration ingestion tests. Work mode retains the existing OpenCode route.
- [x] Current models: Kimi supports ACP configOptions model catalogs. Grok defaults to the actually advertised grok-4.6. Current native runtime catalogs supersede retired built-in suggestions while retaining explicit custom models.
- [x] Tool maintenance: Codex, Claude Code, Cursor, OpenCode, Grok, and Kimi have installed/latest version status and applicable install/update actions. Update all includes every supported installed outdated tool and reports individual results.
- [x] Automatic maintenance: server-persisted opt-in, six-hour scheduling, active-chat/terminal deferral, shared mutation locking, post-command verification, and visible failure results. Missing tools are not automatically installed.
- [x] Installation boundaries: updates use the detected package manager or official vendor installer/updater. Kimi native updates pin the version, preserve the install root, and skip shell-profile modification. Unrecognized custom installations remain manual. Cursor date/build identifiers are not compared as semantic-version prerelease hashes.
- [x] Login lifecycle: different provider targets cannot reuse the wrong sign-in session; cancellation and late-result cleanup are covered. The sign-in section identifies the target and scrolls into view. Accounts forces a fresh provider query after CLI credential changes instead of returning an old persisted catalog.
- [x] Localization: all new UI messages are present in the seven existing locale catalogs; brand-name exceptions in the source audit are explicit.
- [x] Verification: tests, typechecks, scoped lint, production web build, server/Electron bundles, and live Electron interactions completed. Existing user sessions were kept separate from the temporary QA instance.

## Final checks

| Check | Observed result |
| --- | --- |
| Web unit suite | 2,828 passed |
| Targeted server suite (harnesses, registry, health, OpenCode catalog/adapter, settings) | 313 passed, 1 skipped |
| Shared-library suite | 330 passed, 1 skipped |
| Contracts suite | 175 passed |
| Accounts/model-provider browser tests | 16 passed |
| Desktop workspace typechecks | 8 of 8 passed |
| Scoped lint | 0 warnings, 0 errors |
| Web, server, Electron builds | Passed |

Total: 3,662 passing tests. Loopback socket tests required execution outside the filesystem sandbox; the rerun passed. The builds retain existing bundle-size and Electron original-fs external-module warnings.

## Live evidence

A separate Electron app identity and temporary profile were used so the existing DJL session was not restarted. The fresh backend displayed installed/latest versions for official OpenCode 1.18.29, Grok 1.0.13, Kimi Code 0.41.0, and Cursor 2026.09.02-c22c1a3. OpenCode protocol compatibility passed.

- China GLM: the UI reached the API-key prompt; the running command's provider argument was zhipuai-coding-plan.
- Kimi International: the saved region was global, and the real CLI opened the official kimi.ai device-authorization flow.
- Copilot: the row became connectable before login and reached the official GitHub deployment-selection prompt after the cache/metadata fix.
- Automatic updates: the switch persisted true in the QA backend's settings file, then was restored to false.
- Grok: the real CLI returned currentVersion=latestVersion=1.0.13 and advertised grok-4.6/grok-4.5. The noninteractive account probe correctly required sign-in.

All test sign-ins were cancelled before credentials were submitted. The temporary Electron instance was closed. Authenticated paid model generation is not claimed by these checks.

Logs are under /tmp/djl-subscriptions-final-{web,server,shared,contracts,browser,types}.log. Build logs are /tmp/djl-subscriptions-web-build.log and /tmp/djl-qa-{server,desktop}-build.log. Source and user instructions are documented in docs/harness-accounts.md.

## Official references

- https://docs.z.ai/devpack/tool/opencode
- https://docs.bigmodel.cn/cn/guide/develop/opencode
- https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html
- https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html
- https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/env-vars.html
- https://www.kimi.com/code/docs/en/third-party-tools/opencode.html
- https://platform.minimax.io/docs/token-plan/other-tools
- https://platform.minimaxi.com/docs/token-plan/other-tools
- https://docs.x.ai/build/overview
- https://docs.x.ai/build/cli/reference
- https://docs.x.ai/build/cli/headless-scripting
- https://cursor.com/docs/cli/installation
- https://opencode.ai/docs/providers/

The official Kimi 0.41.0 package was also inspected to verify regional profiles, managed model IDs, and ACP behavior. Official installer scripts were inspected to verify version/install-directory parameters. Temporary CLI downloads were not added to the repository.
