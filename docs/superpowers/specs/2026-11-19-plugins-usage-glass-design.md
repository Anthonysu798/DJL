# DJL plugins, usage ring and liquid-glass redesign

## Context

DJL's Plugins page today shows only three hardcoded built-in plugins. There is no way to add a
plugin, sign in to one, uninstall it, manage MCP servers, or see connection state, and DJL's own
tools reach only the Codex, Claude and DJL Cloud agents. The user wants DJL to match the Codex
desktop app: a plugin directory with one-click add and sign-in, per-plugin detail and settings
pages, a manage view with Plugins / Apps / MCPs / Skills tabs, a usage ring above the avatar, a
redesigned avatar menu, and a macOS liquid-glass look on floating surfaces and buttons.

Decisions the user made:

- **DJL-owned plugins.** DJL ships its own catalog (bundled in the app), runs sign-in itself, and
  gives connected plugins to every agent, including group-chat members.
- **No DJL Cloud account needed.** Tokens stay on the user's machine.
- **First catalog:** developer tools, team chat and docs, Google apps, Microsoft and Apple.
- **Add menu:** custom MCP server, add a marketplace, create / upload plugin, create a skill.
- **Settings stays a full page;** only the avatar menu becomes a glass popover.
- **Glass scope:** dialogs, popovers, menus, tooltips, toasts and buttons. Sidebar, transcript and
  page backgrounds stay solid.
- **Usage ring** shows the lowest remaining percentage across connected subscriptions.
- **Delivery:** three phases, plugins first, one PR per phase.

Calls I made (correct any of these):

- Agents reach plugins through one local DJL gateway, so the agent CLIs never hold the real tokens.
- The gateway is a plain pass-through: it forwards a harness's MCP traffic to the real server and
  adds the credentials there. It needs no MCP library, so no new dependency was added (changed
  during slice 3; the first draft of this plan used `@modelcontextprotocol/sdk`).
- Tokens are stored the way DJL already stores secrets (`ServerSecretStore`, 0600 files), not in
  the OS keychain.
- The provider dropdown on the Plugins page goes away; the catalog is the same for every agent.
- Codex's "Record a skill" screen recorder is out of scope; "Create a skill" is a form.
- Icons and catalog text are DJL's own; nothing is copied from the Codex catalog.

Changed while building slice 4:

- No push stream. The plugin pages re-read the snapshot every 1.5 s only while a sign-in is under
  way, which was all the stream was needed for.
- Sign-in registers a new DJL client with the vendor on every Connect, so the gateway's port does
  not have to stay the same between runs.
- Figma is out of the first catalog: it answers but refuses DJL's registration (403). The other
  ten hosted vendors accepted it when checked on 2026-11-19.
- Disconnect deletes the tokens on this machine; it does not ask the vendor to revoke them.

Catalog widened on 2026-11-20 (the user asked for "every public plugin", naming Stripe, PayPal,
WordPress, PowerPoint, PDF and Word):

- 131 public servers were checked with DJL's own sign-in code. 76 registered DJL and returned a
  sign-in page. Each was then sent the token request DJL makes after sign-in, with a made-up
  code: Mercado Pago answered "invalid_client" and was dropped, Jotform (502) and Plaid (empty 400) were inconclusive and kept, the rest rejected only the code. With the 10 from slice 4
  that makes 85 sign-in plugins.
- 15 servers that need no sign-in were added (`auth: "none"`): Context7, DeepWiki, GitMCP,
  Microsoft Learn, Cloudflare Docs, AWS Knowledge, Astro Docs, Exa, Hugging Face, Convex,
  Excalidraw, GoDaddy, Instacart, Kiwi.com, Crypto.com. They are not on by default: each added
  server puts its tool list into every new chat and sends the agent's queries to that vendor.
  All 15 answered real `initialize` and `tools/list` calls through DJL's gateway.
- Word, PowerPoint, Excel and PDF are DJL's own plugins (`documentPlugins.ts`). They have no tool
  server: mentioning one gives the agent written instructions for building the file locally with
  python-docx, python-pptx, openpyxl, reportlab and pypdf. They are built in, so always on.
- Hosted entries moved to `apps/server/src/plugins/hostedPlugins.ts`; its header lists the
  vendors left out and why. Descriptions and example prompts for sign-in servers describe the
  product; their tool lists cannot be read without an account and were not checked.
- Privacy and terms links are shown only where the page loaded on the vendor's own domain with a
  matching title; the rest show the website link only.
- Still blocked on DJL registering a client with the vendor first: GitHub, Slack, Asana, HubSpot,
  Box, Figma, Xero, Zendesk, PagerDuty, DocuSign, Salesforce and others. API-key vendors
  (Firecrawl, Browserbase, Telnyx, Render) wait for the API-key dialog in slice 7.

Built on 2026-11-20 after the first real sign-in (Linear) and a real chat tool call worked:

- Slice 5. Group-chat members share the group's plugin access (`group` is a plugin provider and
  passes its session to each member's driver). ACP agents (Cursor, Gemini, Grok, Kimi, iFlow,
  Qwen, CodeBuddy) get the gateway as HTTP tool servers when they advertise
  `mcpCapabilities.http`; one that does not starts without plugins. There is no stdio bridge:
  both agents installed here (Cursor, Grok) advertise HTTP, and Cursor called the gateway when a
  session opened. OpenCode and Kilo get the servers through `client.mcp.add`.
- Not given plugins: Pi (no tool servers), Droid (not wired), and DJL Cloud. DJL Cloud runs tools
  in DJL's own loop with no approval step, which is not acceptable for third-party write tools;
  it needs an approval design first.
- The composer's "@" menu lists DJL plugins that are ready in that chat
  (`composerPluginSuggestions`); agents without tool servers are offered only the plugins that
  have none, such as the document plugins.
- Slice 6. Settings → Plugins (`PluginsSettingsPanel`): tabs for plugins (with an on/off
  switch), apps (connect buttons), tool servers given to agents, and skills. It is a section in
  the existing "DJL" group, not a new "Integrations" group. The old Skills section is unchanged.
- Slice 7, partly. "Add MCP server" adds a server by address after checking it answers, and
  classifies it as open, access token, or browser sign-in; it becomes a plugin in a "Personal"
  source and uninstalling removes it. "Create a skill" writes `SKILL.md` into DJL's skills folder.
  Not built: "Add a marketplace" and "Create / upload plugin". Both need a manifest format and a
  decision on how a listed server's sign-in type is established, so they are their own slice.

Phases 2 and 3 were built on 2026-11-20 as well. Where they differ from the sections below:

- Usage ring: it reads the live usage snapshot only, so it can differ from Settings → Usage,
  which also merges thread-activity and archive fallbacks. Opening the popover also refetches
  DJL Cloud status when it is older than 60 s. "Usage source" shows the server's raw identifier
  (for example `codex-wham-usage`), which reads as jargon and is a candidate to drop.
- Avatar menu: the Settings shortcut hint follows the platform ("⌘," on macOS, "Ctrl+," on
  Windows, hidden on Linux, where no accelerator is registered).
- Glass scrim is dim-only (`--glass-scrim-filter: none`): the rounded-corner clip could not be
  tested outside Electron, so the fallback named under Risks was taken from the start.
- `tint` mode is fully solid, not near-solid: at 97% the text behind a panel showed through.
- Sheets are not glass. They are attached to a window edge and touch its corners, and one of
  them is the mobile sidebar, which stays solid. They get the scrim, border colour and shadow.
- Blur applies on macOS in the web build too; it does not require Electron. Windows and Linux
  popups are solid now (they had a blur before).
- Buttons: `secondary` and `subtle` gained a hairline border; `secondary` text uses the
  foreground colour (the old token was close to unreadable in the default dark theme);
  `destructive-outline` lost its red hover fill and keeps a red hover border.
- The toast surface is shared with the inline provider-health banner and the command approval
  card, so those are glass too.
- `MenuItem variant="destructive"` used `--destructive-foreground`, which the theme engine sets
  to the surface colour, so the text was invisible. It now uses `--destructive`.
- Not verified for either phase: the real Electron window, theme packs other than the default
  light and dark, Windows or Linux, macOS Reduce Transparency toggled live, blur over the
  embedded browser and terminal views, and performance (no trace was taken).

Outside the code, and blocking parts of Phase 1 slice 8:

- DJL must register OAuth apps with Google and Microsoft.
- Gmail and Drive need Google's restricted-scope review; until it passes, Google caps the app at
  100 test users and shows an "unverified app" warning.
- iCloud has no browser sign-in; it needs an app-specific password typed into DJL.

---

## Phase 1: plugin platform (PR 1)

### Architecture

New `PluginGateway` service in `apps/server/src/plugins/`, modelled on
`apps/server/src/work/Layers/WorkMcpServer.ts` (loopback listener, Host check, per-session bearer).

- Routes: `/mcp/<appKey>` (POST, GET and DELETE are forwarded to the real server unchanged) and,
  from slice 4, `GET /oauth/callback`.
- `registerSession({ threadId })` returns `{ bearerToken, servers: [{ name, url }] }`, one entry
  per enabled and connected app.
- Passed to drivers as a new optional fourth `NativeDriverFactory` argument
  (`apps/server/src/harnesses/native/types.ts`), registered for every provider in
  `native/layer.ts` and threaded through `group/groupDriver.ts` → `group/childSession.ts` so group
  members get it too.

| Agent                                              | How it receives plugins                                                                                                          |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Codex                                              | extra `mcp_servers` entries in `native/codex.ts`; extend the elicitation branch (L232–245) to allow gateway servers              |
| Claude                                             | extra http `mcpServers` entries in `native/claude.ts`                                                                            |
| OpenCode                                           | extra `client.mcp.add` entries in `provider/Layers/OpenCodeAdapter.ts`                                                           |
| DJL Cloud                                          | gateway tools appended in `native/djlCloud.ts`                                                                                   |
| Cursor, Gemini, Grok, Kimi, iFlow, Qwen, CodeBuddy | one change in `native/acp.ts`: http entry if the agent advertises it, otherwise a small stdio bridge (`plugins/stdioBridge.mjs`) |
| Pi                                                 | no MCP support; UI says "Plugins aren't available in Pi yet"                                                                     |

A chat reads its plugin list when it starts, so after a connect the UI says "Available in new chats".

### Data and API

- `packages/contracts/src/plugins.ts`: `PluginCatalogEntry`, `PluginApp` (transport + auth type
  `oauth | apiKey | none`), `PluginAppConnection`
  (`not_connected | connecting | connected | expired | error`), `PluginsSnapshot`.
- Storage: catalog in `apps/server/src/plugins/catalog.ts`; install and enable state, custom MCP
  servers and marketplaces in `<stateDir>/plugins.json`; tokens in `ServerSecretStore` as
  `plugin.<pluginId>.<appId>.*`; personal plugins in `<baseDir>/plugins/<id>/`.
- RPC namespace `plugins.*` (`getSnapshot`, `install`, `uninstall`, `setEnabled`, `connectApp`,
  `cancelConnect`, `disconnectApp`, `saveCustomMcpServer`, `removeCustomMcpServer`,
  `addMarketplace`, `removeMarketplace`, `refresh`, `importPersonalPlugin`, `createSkill`) plus
  one stream `plugins.subscribe`, added through the existing path: `contracts/src/ws.ts` →
  `rpc.ts` → `ipc.ts` → `apps/server/src/wsRpc.ts` → `apps/web/src/wsNativeApi.ts` /
  `wsTransport.ts`. Stream template: `localModels.subscribe`.
- `@plugin` mentions: `resolveDjlPluginReferences`, called next to `resolveBuiltInPluginReferences`
  in `ProviderCommandReactor.ts` (~L1164), so the native bridge no longer rejects them.

### Sign-in

- OAuth with PKCE and a loopback redirect to the gateway's `/oauth/callback`; state handling
  copied from `startBrowserSignIn` in `apps/server/src/cloud/account.ts`. Dynamic client
  registration where the vendor supports it, a DJL client id from the catalog where it does not.
- API-key apps: a dialog collects the key, the server probes `tools/list`, then stores it.
- Expiry: refresh when under 60 s from expiry; on a 401 refresh once; if that fails the app
  becomes `expired`, the button reads **Reconnect**, and the agent gets a tool error saying so.
- Button per app: `not_connected` → Connect, `expired` / `error` → Reconnect, `connected` →
  Disconnect. Uninstall deletes the tokens.

### Screens

Routes follow the `_chat.automations*` precedent; components in `apps/web/src/components/plugins/`.

- `/plugins` — directory: title, search, Refresh, gear (opens the manage view), Add menu;
  Public / Personal tabs (plus one per added marketplace); category sections in a two-column grid;
  "+" adds and starts sign-in, "…" on added plugins.
- `/plugins/$pluginId` — detail: header with "…", Manage, Try now; three example prompts (reuses
  the composer handoff from `PluginLibrary.tsx` L527–559); description; Apps list with the connect
  button; Information list.
- `/plugins/$pluginId/manage` — plugin settings: View details, Uninstall, a row per app, About table.
- Settings → new **Integrations** group → **Plugins**: tabs Plugins / Apps / MCPs / Skills with
  counts, search and toggles; MCPs split into "Servers" (user-added) and "From plugins"; the Skills
  tab reuses `SkillsSettingsPanel`, and the old Skills section links to it.
- Add menu dialogs: custom MCP server, add marketplace, create / upload plugin, create a skill.
- `PluginLibrary.tsx` and its browser test are replaced. Every new string goes into all seven
  locale files (`i18n/catalogEquality.test.ts`).

### Slices (app works after each)

1. Contracts, bundled catalog, read-only directory and detail. _Check:_ catalog schema unit test;
   browser test for sections and search.
2. `PluginStore`, install / uninstall / enable, the stream. _Check:_ store unit test; browser test
   that "+" becomes "…" and survives reload.
3. Gateway with Codex and Claude, using a no-auth fixture server. _Check:_ gateway test (401
   without bearer, `tools/call` forwarded); extended `drivers.test.ts`; a real tool call in a
   Codex chat in the dev app.
4. OAuth connect / reconnect / disconnect on Linear, Notion and Sentry. _Check:_ unit test with a
   fake authorization server (refresh, failed refresh → `expired`); manual sign-in.
5. ACP agents, OpenCode, DJL Cloud, group members, mention resolution. _Check:_ `acp` test for the
   http-versus-stdio choice; per-agent "list your tools" in the dev app.
6. Settings → Integrations → Plugins with its four tabs. _Check:_ browser test.
7. Add menu: custom MCP, create skill, import plugin, marketplace. _Check:_ unit tests for manifest
   parsing and the skill writer.
8. Google, Microsoft, Apple apps as local tool handlers under `apps/server/src/plugins/local/`.
   Ships as far as the outside approvals above allow.

Each catalog entry is added only after its sign-in has been run for real; which vendors accept a
loopback redirect without a pre-registered client is not known from the code.

---

## Phase 2: usage ring and avatar menu (PR 2)

No server work. `W` = `apps/web/src`.

### Usage ring

- `W/lib/usageRing.ts` (pure): `deriveUsageRingEntries` and `selectLowestUsageRow`, built on the
  existing `normalizeServerProviderUsageRateLimit`, `deriveProviderUsageDisplayRows` and
  `selectPrimaryProviderUsageDisplayRow`. Rows are derived per provider, never merged, so Codex
  "Weekly" and Claude "Weekly" stay separate.
- Data per provider: Codex (5h, Weekly, credits), Claude (5h, Weekly, Sonnet, Opus, extra usage),
  Cursor (current period, on-demand, credits), Gemini (per-model quota), DJL Cloud (5-hour and
  weekly windows plus credits from `cloud.getStatus()`, same maths as `DjlCloudAccountCard.tsx`
  L266–271). Signed-in agents with no limit data (iFlow, Qwen, CodeBuddy, Pi, Kimi, Grok, Droid,
  Kilo, OpenCode) are listed as "No limit data" and never feed the ring.
- `W/components/UsageRingButton.tsx`: SVG ring in a `.djl-desktop-rail-button`, coloured by the
  existing `remainingTone` thresholds; tooltip "{provider} · {window} · {n}% left"; click opens a
  popover with one block per subscription (icon, name, plan, `ProviderUsageLimitRows`, credits,
  "Usage source: …") and a "Manage usage" row that opens Settings → Usage.
- Placement: new `usage` prop on `W/components/DesktopShellChrome.tsx`, rendered between
  `{props.update}` and `{props.account}` (L80–81), passed from `Sidebar.tsx` (~L6893). Web build:
  beside `DjlAccountEntry` in the footer (~L7568).
- Refresh: usage is not polled anywhere today outside Settings → Usage, so the ring is the first
  always-on fetch. It shares the `allProviderUsage` query with a 5-minute interval, refetches on
  popover open if older than 60 s, never forces a refresh, and does not poll in the background.
- States: loading (muted track), nothing connected (muted ring, "No limit data"), a provider that
  needs sign-in or errored (existing status pill, excluded from the ring), DJL Cloud signed out
  (its block is omitted; other subscriptions still show).

### Avatar menu (`W/components/DjlAccountEntry.tsx` L87–138)

- Identity row (avatar, email, plan), Usage with credits, Your DJL account, Settings with the ⌘,
  hint on desktop, New user tutorial, separator, Sign out. Signed out it stays "Sign in to DJL".
- Remove the forced opaque background on `.djl-desktop-account-menu` (`index.css` L3022–3028) so
  it picks up the shared popup surface (glass in Phase 3). Keep the existing test id and
  onboarding targets.

### Slices

1. `usageRing.ts`. _Check:_ unit tests (lowest across providers, cloud folding, zero limit,
   errored providers excluded, no-data never numeric).
2. `UsageRingButton` plus rail and web wiring. _Check:_ new `UsageRingButton.browser.tsx`; extend
   `DesktopShellChrome.browser.tsx` for ordering.
3. Avatar menu. _Check:_ new `DjlAccountEntry.browser.tsx`, signed in and signed out.

---

## Phase 3: liquid glass (PR 3)

### Tokens and mode

- Tokens in `W/index.css` (`:root` and dark), derived from `--popover` and `--foreground` so theme
  packs carry through: `--glass-fill`, `--glass-fill-strong`, `--glass-filter`, `--glass-border`,
  `--glass-highlight`, `--glass-shadow`, `--glass-scrim`, `--glass-scrim-filter`,
  `--glass-control-fill` (+ hover, pressed).
- Utilities: `.glass-surface` (blur on `::before`, so text never sits on the filtered layer),
  `.glass-surface-strong`, `.glass-surface-solid`, `.glass-scrim`, `.glass-control` (no blur).
- `resolveGlassMode` in `W/theme/theme.logic.ts`, applied as `data-glass` by `W/hooks/useTheme.ts`:
  `blur` on macOS with a translucent theme, `tint` (near-solid, no filter) on Windows, Linux and
  theme packs with `opaqueWindows`. `tint` also applies under `prefers-reduced-transparency` and
  `prefers-contrast: more`. Debug override: `localStorage["djl.debug.glass"]`.

### Where it lands

1. `W/components/chat/composerPickerStyles.ts` L159–185: rebase the shared popup surface on
   `.glass-surface`. Covers popovers, menus, composer pickers, selects, tooltips, hover cards.
2. `W/components/ui/dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `command.tsx`: backdrop becomes
   `.glass-scrim`, popup becomes `.glass-surface-strong`.
3. `W/components/ui/notificationSurface.ts` (toasts).
4. Hand-rolled surfaces: `confirmDialogFallback.ts`, `contextMenuFallback.ts`,
   `RecentViewSwitcher.tsx`, `ui/preview-card.tsx`, `ui/autocomplete.tsx`; opaque call-site
   overrides in `Sidebar.tsx` (L1010, L1072, L1169) and `DebugFeatureFlagsMenu.tsx`.
5. Buttons in `W/components/ui/button.tsx`: `outline`, `secondary`, `subtle` and the `*-outline`
   variants become `.glass-control`; `default` and `destructive` keep their solid fill with an
   inset highlight and pressed state; `ghost`, `chrome`, `prominent`, `link` stay flat. Raw
   `<button>`s are not changed in bulk; only the shared classes `.djl-desktop-rail-button`,
   `.djl-desktop-tab-add`, `.djl-desktop-header-icon`, `.sidebar-icon-button`, the select trigger
   and `toggle.tsx`.

Stays opaque on purpose: the composer command menu and environment panel (they float over the
transcript), and the 11 `surface="solid"` form dialogs (they get the glass border, shadow and
radius only). Native right-click and app menus cannot be restyled.

### Slices

1. Tokens, `resolveGlassMode`, `data-glass`. _Check:_ `theme.logic.test.ts`.
2. Shared popup surface. _Check:_ browser test that computed `backdrop-filter` is `none` under
   `data-glass="tint"`; existing menu browser tests.
3. Dialogs, sheet, command palette, toasts. _Check:_ existing dialog and toast browser tests.
4. Buttons and shared raw classes. 5. Hand-rolled surfaces. _Check for both:_ visual pass.

Every slice: dev desktop app in light and dark, one `opaqueWindows` theme pack, the forced `tint`
flag for the Windows look, and macOS Reduce Transparency on.

### Risks

- A full-window blurred scrim may escape the macOS rounded-corner clip (documented at
  `index.css` L143–146). Fallback: dim-only scrim.
- Blur over the embedded browser and terminal views is untested.
- Contrast on user theme packs needs a manual pass on the lightest and darkest packs.
- Performance: at most scrim + popup + one tooltip filtered at once; never on list rows. Compare
  a DevTools performance trace before and after (command palette over a streaming chat, model
  picker scroll, rail tooltip sweep).

---

## Order of work

0. Save this design to `docs/superpowers/specs/2026-11-19-plugins-usage-glass-design.md`.
1. Phase 1 slices 1–8 on this branch → PR 1.
2. Phase 2 → PR 2. 3. Phase 3 → PR 3.

## Verification (all phases)

- `bun run typecheck`, lint and the affected unit and browser tests after every slice.
- Run the dev desktop app from this worktree (recipe in memory: build desktop first,
  `SYNARA_PORT_OFFSET`, separate user-data dir) and exercise each slice's manual check.
- Before each PR: full Desktop CI green on the branch.

## Change log: 2026-11-20, limits ring refresh and guided account sign-in

Both came from the user trying the dev app.

- **Limits ring was stale.** It polled every five minutes and nothing told it a chat had spent
  quota. It now keeps a one-minute pace while any turn runs and for 90 seconds after, and when a
  turn ends it reads that agent's limits past the server's 60-second cache (at most once per 20
  seconds per agent) and re-reads the DJL Cloud balance after a DJL Cloud or group turn. Idle
  pace is still five minutes. The numbers are only as fresh as each vendor's own usage endpoint;
  how quickly those reflect a finished turn was not measured.
- **Accounts sign-in is a guided dialog** (`HarnessSignInDialog`) instead of a raw terminal at
  the bottom of the page: three steps, the sign-in page as a button once the agent prints its
  link, and it notices a connected account by itself (when the agent's sign-in command exits,
  and when the window regains focus). The agent's own screen is folded away for Codex, Claude
  Code, Cursor, Grok and Kimi and shown for the agents that ask a question first (Gemini, iFlow,
  Qwen, OpenCode pick an option; CodeBuddy and Pi need `/login`). It still runs each vendor's own
  sign-in command; nothing about how credentials are stored changed.
- **Accounts rows** show the agent's icon, a coloured status, and one fitting action: "Sign in"
  when it is needed, "Sign in again" when connected, only the setup guide when not installed.
- The account check runs every agent's status command, so the dialog does not poll it on a timer.
- Not verified: any of this in the real app window, and a real sign-in through the new dialog
  with each agent (the per-agent guidance for Gemini, iFlow, Qwen and Kimi is from DJL's own code
  comments, not from watching those sign-ins).

## Change log: 2026-11-20, GitHub by token, plugin manifests and marketplaces

### Access-token apps, and GitHub

- Catalog apps can have `auth: "apiKey"` with a `tokenUrl` and `tokenScopes`. Connect opens a
  dialog that links to the vendor's token page, lists the scopes to pick, and checks the pasted
  token by calling `initialize` with it (`probeCustomServer`) before keeping it with the
  existing static-token secret (`plugin.<id>.<app>.token`). Connected shows Disconnect, which
  deletes it. A token the vendor later revokes still reads as Connected: unlike OAuth apps, a
  refused call does not mark it expired.
- **GitHub** is in the catalog this way: `https://api.githubcopilot.com/mcp/` with a classic
  personal access token (`repo`, `read:org`, `read:user`, pre-ticked by the link). Checked live:
  no token gets 401 "missing required Authorization header", a made-up token gets 401 "token
  authentication failed", and GitHub's MCP README documents `Authorization: Bearer <PAT>`. No
  real token was ever sent.
- Not added, and why (checked live without a token, and against the vendors' own docs):
  - **Figma**: its remote server rejects personal access tokens. A `figd_` token in
    `Authorization` gets "figd\_ tokens must be passed via X-Figma-Token header", and in
    `X-Figma-Token` gets 401. Figma's forum says the remote server is OAuth only, and its docs
    limit it to clients in Figma's MCP catalog.
  - **Slack**: `mcp.slack.com/mcp` wants OAuth from a registered Slack app. Slack's docs require
    a fixed app id, allow only directory-published or internal apps, and support no dynamic
    registration.
  - **Google** (Gmail, Drive, Calendar, Docs, Sheets, Slides, Chat): the Workspace servers take
    only OAuth access tokens, which expire after an hour. They answer `initialize` and
    `tools/list` without a token and refuse `tools/call` with 401. A manifest that lists one
    would therefore be classified "none" and fail at the first call.
  - **Microsoft 365**: Microsoft's own MCP servers (Work IQ) are a preview that needs a
    Microsoft 365 Copilot licence and an Entra app. Entra does not support dynamic registration.

### What the owner must register for the rest

DJL's sign-in sends the browser back to `http://127.0.0.1:<port>/oauth/callback`, and the port
changes on every run. Each client below must therefore be a public "desktop" client that allows
any loopback port, use PKCE, and need no client secret. DJL also needs a small change to use a
fixed client id from the catalog for these vendors instead of registering itself.

- **GitHub (OAuth, optional; tokens already work)**: github.com/settings/developers → OAuth Apps
  → New. Callback `http://127.0.0.1/oauth/callback`; GitHub allows any port on a loopback
  callback. Scopes: `repo read:org read:user`. Store the client id in the catalog. GitHub
  OAuth apps also issue a secret; check whether `api.githubcopilot.com` accepts their tokens
  before shipping.
- **Slack**: api.slack.com/apps → Create app. MCP access needs the app published in the Slack
  Marketplace, or installed as an internal app per workspace. Redirect URL
  `http://127.0.0.1/oauth/callback`. User scopes from `mcp.slack.com`'s metadata, as needed:
  `search:read.public search:read.private search:read.im search:read.mpim search:read.files
search:read.users channels:history groups:history im:history mpim:history channels:read
groups:read im:read mpim:read chat:write reactions:read reactions:write files:read
canvases:read canvases:write users:read users:read.email`. Endpoints:
  `slack.com/oauth/v2_user/authorize` and `slack.com/api/oauth.v2.user.access`. Slack calls its
  MCP OAuth "confidential", so check whether a PKCE public client is accepted before building it.
- **Google Workspace**: console.cloud.google.com → new project. Enable the product APIs
  (`gmail`, `drive`, `calendar-json`, `docs`, `sheets`, `slides`, `chat`) and the MCP services
  (`gmailmcp`, `drivemcp`, `calendarmcp`, `docsmcp`, `sheetsmcp`, `slidesmcp`, `chatmcp`, all
  `.googleapis.com`). Google Auth Platform → Clients → **Desktop app**, which allows any loopback
  port, with "Use this client for an AI-powered agent" checked. Data Access scopes:
  `gmail.readonly gmail.compose gmail.modify drive.readonly drive.file calendar.events
calendar.calendarlist.readonly`. Gmail and Drive scopes are restricted, so above 100 test users
  Google requires verification and a security assessment. Servers:
  `https://{gmail,drive,calendar,docs,sheets,slides,chat}mcp.googleapis.com/mcp/v1`.
- **Microsoft 365**: entra.microsoft.com → App registrations → New. Supported accounts: any
  organizational directory plus personal accounts. Platform "Mobile and desktop applications"
  with redirect `http://localhost`; Entra ignores the port on localhost. Delegated Graph
  permissions: `offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite
Files.ReadWrite.All Sites.Read.All Chat.ReadWrite`. There is no general Microsoft-hosted MCP
  server for these, so this needs the local tool handlers of slice 8 (or Work IQ, for tenants
  that have Copilot).
- **Figma**: join Figma's MCP client waitlist (developers.figma.com/docs/figma-mcp-server).
  Nothing can be registered self-serve; dynamic registration answered 403.

### Plugin manifests

A DJL plugin manifest is one JSON object, checked by `PluginManifest` in
`packages/contracts/src/plugins.ts` (`decodePluginManifest` names every wrong field, one per line):

| Field              | Rule                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `id`               | 1–63 of `a-z 0-9 -`, starting with a letter or number                      |
| `name`             | the @mention handle, same rule as `id`                                     |
| `displayName`      | up to 80 characters                                                        |
| `shortDescription` | up to 160                                                                  |
| `longDescription`  | optional, up to 2,000                                                      |
| `websiteUrl`       | optional, https only                                                       |
| `brandColor`       | optional, `#RRGGBB`                                                        |
| `category`         | optional, up to 60                                                         |
| `examplePrompts`   | optional, up to 3, each up to 300                                          |
| `mcpServers`       | up to 10 `{ name, url }`; `url` https, or http only on localhost/127.0.0.1 |
| `skills`           | optional, up to 20 `{ name, description, instructions }`                   |

It needs at least one server or skill, and each server its own name. No sign-in type is
read from the manifest. Each server is asked when the plugin is added (`probeServerAuth`): it
answers, so it is open (`none`); it refuses and offers registration (`oauth`); or it refuses
without registration, so it takes a token (`apiKey`, connected with the token dialog).

```json
{
  "id": "acme",
  "name": "acme",
  "displayName": "Acme",
  "shortDescription": "Work with Acme projects",
  "websiteUrl": "https://acme.example",
  "examplePrompts": ["List my open Acme projects"],
  "mcpServers": [{ "name": "Acme", "url": "https://mcp.acme.example/mcp" }],
  "skills": [{ "name": "acme-report", "description": "Weekly Acme report", "instructions": "..." }]
}
```

- **Create or upload a plugin** (Add menu): choose a `.json` file or paste the JSON. It becomes
  `personal-<id>` in the Personal source and is installed at once. Its skills are written with
  `createSkill`. A skill name that already exists is left alone and never removed. Uninstall
  removes the plugin and only the skills DJL wrote (`createdSkills` in `plugins.json`).
- **Add a marketplace** (Add menu): an https address of `{ "name": ..., "plugins": [manifest, ...] }`.
  The file may be at most 1 MB and 200 plugins, must load within 15 s, and is fetched without
  following redirects. Invalid or duplicate entries are skipped and counted ("Plugins left out
  …: N"). A marketplace gets its own tab with Refresh and Remove. The All tab shows DJL's catalog
  and Personal only.
  Plugin ids are `market-<slug>--<id>`, so a listing cannot replace a catalog or personal
  plugin.
- Adding a marketplace plugin works like a catalog plugin, except that its servers are probed at
  that moment. The record in `plugins.json` freezes the manifest, the server addresses and their
  sign-in types. A later Refresh cannot redirect an added plugin, or its tokens, to a new host;
  to pick up changes, uninstall and add it again. Removing a marketplace uninstalls the plugins
  added from it.
- Manifest plugins reach agents through the same gateway as catalog ones (`pluginAppKey`; the
  app id is the server name slugged, for example `personal-acme_acme`).
- New RPCs: `plugins.saveAppToken`, `importManifest`, `addMarketplace`, `refreshMarketplace`,
  `removeMarketplace`. `WsRpcGroup` had reached the size tsc can write into a declaration
  (TS7056). Even one more RPC broke `packages/contracts` build, which `tsc --noEmit` does not
  catch. The old list is now `WsCoreRpcGroup`, the new calls are in `WsPluginSourcesRpcGroup`,
  and the export is annotated by group. Put new RPCs in a second group like this.
- Not verified: any of it in the real app window; GitHub with a real token; a real marketplace
  or uploaded manifest against live servers (only fake servers in tests). Probing cannot spot
  servers like Google's that list tools openly but need sign-in to call them.
