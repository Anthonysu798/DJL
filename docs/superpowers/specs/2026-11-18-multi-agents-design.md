# Multi agents: group chat for CLI agents

**Date:** 2026-11-18
**Status:** Design approved; implementation plan not yet written

## Why

DJL streams each subscription CLI agent (Claude, Codex, Cursor, Grok, Kimi, iFlow, Qwen,
CodeBuddy, Pi) in its own chat. Products such as ClawChat and Pachat put several agents in one
WeChat-style group where the user `@`s one agent or `@all`, and the agents check and hand work to
each other. DJL has the hard part, driving the CLIs, but no group, and none of those products
shares skills across agents.

This adds a **Multi agents** section to the left rail. It has to be simple enough that a
non-technical user is talking to several agents within a minute, and it gives every member the
same skill library.

## Goals

- A group chat where several native agents are members, addressed with `@Name` or `@all`.
- One mode: the same chat answers questions and does work in a folder. No mode switch.
- Agents can hand work to each other, bounded by a hop limit.
- Every skill switched on in Settings > Skills is available to every member.
- No permission pop-ups during a group chat.

## Non-goals (version 1)

- Shared connected tools (MCP), private chat with a member, group templates, pinned group notes.
- Phone app support, OpenCode members, DJL Cloud / API-key / local-model members.
- An "Add skill" button. Skills are added the way they are today.
- Human collaborators. Version 2 direction, recorded so version 1 does not block it: join by
  one-time invite code over the existing direct encrypted relay; guests may bring their own agents
  and may `@` the host's; the host's agents answer only (no edits or commands) for a guest.

## Anti-goals

- A settings-heavy screen. If a new user must configure roles, models, folders or permissions
  before the first message, the feature has failed.
- Agents that loop on each other and burn subscription quota unattended.
- Two agents silently overwriting each other's files.
- Any change in how ordinary one-agent chats behave.

## Decided behaviour

**Room**

- `@Name` wakes that member; naming two wakes both. `@all` wakes every member at once.
- A message with no `@` goes to whoever answered the previous round: after `@all` that is
  everyone; after a hand-off it is every member that answered; if nobody has spoken yet, everyone.
- Agents can `@` each other, including to hand over file edits. After **6 hops** in a row the
  group pauses with a **Continue / Stop** card; Continue grants 6 more. The limit is a per-group
  setting.
- A message for a busy agent waits for that agent. An idle agent starts immediately even while
  others are working. Stop per member and Stop all.
- `@all` in a group of 4 or more asks "This will wake N agents", with "do not ask again for this
  group".
- If a member fails (signed out, limit reached, crashed), its task is handed to another member.

**Members**

- Members are the native agents plus a new native Gemini agent.
- Optional role per member: presets (Planner, Builder, Reviewer, Researcher, Writer) or one line
  of the user's own text. The same agent can join twice with different roles.
- A new member uses that agent's DJL default model, changeable per member for this group only.
- Agents that are not installed or not signed in are listed greyed out with a **Set up** button
  that leads to the existing Accounts flow and back.
- No fixed member limit; a warning when the group gets large.

**Context and work**

- Catch-up only: each member keeps its own session and receives just the messages it has not seen.
- A member added later gets the group name, the member list and the last 40 messages. There is no
  separate goal field; agents learn the purpose from the name and the conversation.
- An agent the user `@`s, or that another agent hands work to, may edit files and run commands in
  the group's folder. Codex is also sandboxed to that folder.
- One writer at a time; a second editor waits. Two agents named in one message, or two continuing
  their own conversation, may both edit, taking turns.
- Only `@all` is propose-only: nobody changes files or runs commands, then the user `@`s one to do
  it. Agents can still read files, search the web and open web pages in an `@all` round.
- The group folder is auto-created, so nobody has to choose one. Group settings can point the
  group at an existing DJL project instead, at any time; the agents restart in the new folder and
  are given the last 40 messages.
- The chat shows a typing indicator and then the **final answer only**, with a chip under it
  ("Changed 3 files · ran 2 commands") that opens the details.
- Attachments: images and files.
- Deleting a group keeps its folder and files, and tells the user where they are.

**Skills**

- Members are told which skills exist and pick one up when the task fits. The user can also
  attach a specific skill to a message.

**Screen**

- New left-rail item **Multi agents**, marked **Beta**, visible to everyone.
- WeChat layout: group list on the left, chat in the middle, members behind a button top right.
- First open: a two-step guided setup (pick agents, name the group).
- Reply actions: Copy, Ask again, Reply to this, Ask another agent.
- Groups are created only here and stay out of the normal chat lists.

## Approaches

1. **Room over hidden chats.** A room record plus one hidden normal thread per member and a
   backend router. Keeps the one-provider-per-thread rule intact; needs a second message store and
   a second transcript view.
2. **Group super-harness (chosen).** One new provider, `group`, that runs the other native drivers
   inside a single normal thread.
3. **Renderer only.** The screen forwards messages between normal threads. Rejected: relay stops
   when the window closes, and it cannot serve the phone or collaborators later.

Option 2 was the owner's choice, matching the original request for "an extra harness that controls
multiple agents". It is workable because every native agent is built by a factory
`(input, sink) => driver` (`apps/server/src/harnesses/native/types.ts`), so a group driver can
create and own child drivers, and ingestion already supports several assistant messages in one
turn. It reuses thread storage, queueing, notifications, rename, archive, delete and search
unchanged. Its costs are under Risks.

## Design

### Shape

- New provider kind `group`. One group is one ordinary thread whose provider is `group`, with the
  placeholder model selection `{provider: "group", model: "group"}`.
- The group driver is a `NativeDriverFactory` registered in
  `apps/server/src/harnesses/native/layer.ts`. It is constructed there with access to settings, the
  way `createDjlCloudDriverFactory` is given config, so it can resolve each child's own profile
  with `nativeProfileOptions(childProvider, settings)`. A plain factory only sees `{group: {}}`.
- It creates child drivers lazily with the existing factories (`createClaudeDriver`,
  `createCodexDriver`, the `createNativeAcpDriver` agents, `createPiDriver`), one per member, each
  with its own child sink and CLI process, resumed by the member's saved native session id.
- One user message is one turn is one **round**. The round ends when every woken member, relays
  included, has finished, or at the hop limit, or on Stop.
- `listModels` for `group` returns a static list without a group record and without spawning
  children (the adapter calls the factory with a random thread id for discovery).

### Router (inside the group driver)

- Parses `@Name` and `@all` from the user's text and from each member's final answer.
- An agent may name several members in its answer; each is one hop. An agent's own `@all` does not
  wake anyone.
- Builds each member's prompt as plain text: on first wake a briefing (group name, members and
  roles, how to `@`, the skill list, reply in the user's language); then catch-up (messages after
  that member's read cursor); then the new message. A read cursor is saved only after a reply
  completes.
- Counts hops per round. At the limit the round **ends** and the undelivered hand-offs are saved on
  the group. The screen shows the Continue / Stop card from that saved state; Continue starts a new
  round that delivers them. The pause is not held open inside the turn, because the adapter
  cancels any open request after five minutes and a user who walks away would lose it.
- A child's `sink.fail` is caught by the child sink and never reaches the group's sink, where the
  adapter would fail the turn and stop the whole session. The router posts a note naming the agent
  and the reason, then hands the task over.

### What reaches the transcript

- Child tool and reasoning events are swallowed. Per member the driver emits a working activity,
  then one assistant message: always `content.delta` first, then `item.completed`. Without a prior
  delta, `resolveAssistantCompletionMessageId` in
  `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` can attach one member's
  completion to another member's open message.
- The item id encodes the member (`gm.<memberId>.<seq>`). The adapter prefixes it with the turn id
  and ingestion turns it into the message id, so the speaker is recoverable from the message id.

### Requests and the write lock

Every child runs `approval-required`, ignoring any permission mode saved in the user's profile.
The group driver answers each child `sink.request` by policy. There is no user-facing mode; the
policy follows who was woken.

- **An `@all` round** (the user's `@all`, a no-`@` message that resolves to everyone after one, or
  the first message in a group where nobody has spoken) is propose-only for the whole round,
  hand-offs included: accept reads and look-ups, decline file changes and commands.
- **Any other round:** accept. A file-change or command request must hold the group's single
  write lock; another member's request waits, time-boxed, then is declined with a reason.
- Look-ups need a finer split than the three request types the drivers report today. Claude
  reports every tool except Read, Edit and Write as a command
  (`apps/server/src/harnesses/native/claude.ts`), and the ACP driver does the same for every tool
  kind except read and edit (`acp.ts`). The policy therefore also looks at the request's own
  detail: the tool name for Claude (Read, Grep, Glob, WebFetch, WebSearch are look-ups) and the
  tool kind for ACP agents (read, search, fetch, think are look-ups).
- Codex is started with the workspace-write sandbox on the group folder. Sandbox and approval
  options are sent to Codex only; the Claude, ACP and Pi factories reject them.
- `tool_user_input` from a child gets a fixed "ask in the group chat instead" answer.

### Skills and attachments

- The briefing lists every enabled skill from the existing catalog
  (`apps/server/src/provider/skillsCatalog.ts`) as name, description and `SKILL.md` path.
- Attaching a skill pastes its `SKILL.md` with `apps/server/src/provider/skillPromptInjection.ts`.
- Native agents accept text only (the check in `sendTurn` in
  `apps/server/src/harnesses/native/adapter.ts`). For `group`, attachments are saved to disk and
  their absolute paths go into the prompt, so every CLI opens them with its own tools.

### Storage and API

- New SQLite tables in one migration: groups (thread id, hop limit, folder, `@all` warning flag,
  hand-offs pending at a pause), members (agent, role, model, native session id, read cursor), reply work log (files and commands
  per reply, for the chip's details).
- WS RPC and a live push channel following the Servers registry
  (`packages/contracts/src/servers.ts`, `ws.ts`, `rpc.ts`, `apps/server/src/wsRpc.ts`,
  `apps/server/src/servers/`): create, update, delete group; add, remove, update member; stop
  member.
- New `ProjectKind` `group`: one project per group, so the thread's folder is the project's
  `workspaceRoot` (auto-created `<DJL_HOME>/groups/<id>`, or a chosen existing folder). Most web
  code allow-lists `kind === "project"`, so group projects stay out of the normal lists by default.
  The decider allows one owning project per workspace root for the `project` and `studio` kinds;
  `group` must not own its root, or pointing a group at an existing project would be rejected.
- Changing a group's folder closes every child, updates the project's root, and re-briefs each
  member with the last 40 messages on its next wake (the same path as an agent that cannot resume).

### Screen

- Rail item in `apps/web/src/components/Sidebar.tsx` (the `DesktopRailItem` list) plus a new
  file-based route, with a Beta badge.
- A new, small `GroupChatView` built from `ChatMarkdown`, `ComposerPromptEditor`, the attachment
  chips and `ProviderIcon`. It is not a mode of `ChatView.tsx` (over 12,000 lines) and does not use
  `MessagesTimeline` as is: `collapseSettledTurns` in `MessagesTimeline.logic.ts` would fold four
  of five replies into one "Worked for" disclosure.
- The `@` menu lists the group's members and All. The members panel shows each member's state.
- Strings in all seven locale catalogs under `apps/web/src/i18n/locales`.

### Gemini

- A native ACP driver modelled on `apps/server/src/harnesses/native/qwen.ts`. `gemini` already has
  its provider kind, model catalog, settings and a health probe. Missing: the driver, the layer and
  registry entries, the Accounts, sign-in and tools rows, and the picker order.
- Before writing it, confirm in Gemini CLI's own documentation the current ACP flag and whether it
  supports loading a saved session.

## Calls made by the designer

These were not asked of the owner; each can be overturned.

- Speaker identity is read from the message id through one shared helper in `packages/contracts`,
  so the core message schema needs no migration.
- Hand-over on failure goes to the next idle member in list order, counts as a hop, and happens
  only when the failed member was the only one woken. In an `@all` round the others are already
  answering, so the failure is only noted.
- An agent's own `@all` wakes nobody, and a hand-off inside an `@all` round stays propose-only.
- The hop-limit pause ends the round and is stored on the group, not held open inside the turn.
- Auto-created group folders get `git init`, so the existing checkpoint diff works there.
- The large-group warning appears from 8 members.
- Group threads are filtered out of the phone app's thread list until phone support exists.
- Gemini ships as its own first pull request: independent, useful alone, testable alone.

## Base and in-flight work

- This design was verified against `main` at `9f0888e21`.
- The local branch `codex/agent-social-publishing` carries uncommitted changes to
  `apps/server/src/harnesses/native/adapter.ts`, `layer.ts` and `types.ts`, including an optional
  `steer` on `NativeDriver` and a `steerTurn` for Codex that `main` does not have. Slices 2 and 7
  touch the same files. Check whether that work has landed before starting each, and rebase.
- On `main` the native adapter has no steering at all (`supportsTurnSteering: false`), while
  `apps/server/src/orchestration/decider.ts` still special-cases Codex when deciding to queue.

## Risks

1. **Only Codex is truly confined to the group folder.** The other agents are told to stay in it
   but can reach the rest of the disk, and with one mode they can always edit when `@`'d. The
   auto-created folder is the safety net; pointing a group at a real project removes it, and that
   setting must say so plainly. The read-only `@all` rule works by the agent asking and DJL
   refusing. If a user's own Claude settings pre-allow edits, Claude may not ask, so write tools
   should also be blocked for Claude in those rounds if the SDK allows it. Codex must be checked
   the same way: confirm it asks before applying a patch under the workspace-write sandbox, and if
   it does not, run its `@all` turns under the read-only sandbox policy.
2. **Live mid-round routing is a new path.** A `steer` dispatch today also emits a turn interrupt
   in the decider, which would stop the round. Early slices queue until the round ends; live
   routing lands in its own slice with a decider test that no interrupt is emitted for `group`.
3. **Adding a provider kind is wide.** Many files hold a total `Record<ProviderKind, …>`; commit
   `c9d6ff42c` is the guide. `group` must stay out of model pickers, Accounts, handoff targets,
   automations and the default provider.
4. **Idle shutdown and restarts.** The idle runtime stop closes the group driver, which must close
   every child. An ACP agent without session loading cannot resume: start fresh and re-brief with
   the last 40 messages. A hard crash can leave orphan CLI processes.
5. **Single-message assumptions.** The turn diff and the completion notification attach to one
   latest assistant message per turn; a round has several.
6. **Cost.** N members is N CLI processes and N subscriptions' quota. Children spawn lazily and
   close when idle.

## Build order

Each slice is a mergeable pull request that passes the desktop CI checks.

1. **Native Gemini agent.** Check: a driver fixture test beside the Qwen one; one real turn in
   `bun run electron:dev`.
2. **Inert `group` provider.** Typechecks everywhere, one hard-coded child, final answer only.
   Check: `apps/server/src/harnesses/native/group.test.ts` (delta before completed, child failure
   isolated, `send` resolves at round end).
3. **Group registry.** Migration, contracts, RPC, `apps/server/src/groups/`, `ProjectKind`
   `group`. Check: `apps/server/src/groups/GroupService.test.ts` plus decider tests.
4. **Router and rounds.** `@Name`, `@all`, last-speaker rule, briefing, catch-up cursors, resume,
   relay with hop limit, failure hand-over. Check: a router test with fake child drivers.
5. **Screen.** Rail item, route, two-step setup, `GroupChatView`, members panel, Set up state,
   seven locales. Check: a view-logic test; a two-member `@all` in `electron:dev`.
6. **Doing work.** Request policy, write lock, read-only `@all`, folder setting, per-member Stop,
   work chip and details. Check: a policy test with fake child drivers.
7. **Polish.** Live mid-round routing, attachments, skill attach, reply actions, `@all` warning.

## Verification

- Every slice: `bun run ci:desktop:format`, `ci:desktop:lint`, `ci:desktop:typecheck`,
  `ci:desktop:test` (server tests with a file filter while iterating). Renderer slices also
  `ci:desktop:browser`. Compare the `bun run i18n:check` count before and after. `brand:check`.
- Router and policy logic are tested with fake child drivers, never real CLIs.
- End to end in `bun run electron:dev` (isolated state, never the real `~/.djl`) with two
  signed-in agents:
  1. `@all reply only "ok"`: both answer, each under its own name.
  2. `@Claude are you there?`: only Claude answers.
  3. A follow-up with no `@`: only Claude answers.
  4. `@all create a file test.txt`: no file is created; each agent proposes and says it could not
     edit. `@all what is the latest version of Node.js?`: at least one agent looks it up online.
  5. `@Claude create a file test.txt`: the file exists in the group folder and the chip reads
     "Changed 1 file".
  6. An agent reply containing `@Codex`: Codex is woken; the group pauses at 6 hops, and the
     Continue / Stop card is still there after ten minutes and after an app restart.
  7. `@Claude @Codex each add one line to notes.txt`: both lines are present, neither lost.
  8. Change the group folder in settings, then send a message: the agent works in the new folder
     and still knows what was discussed.

## Left to the builder

- Table and column names, RPC method names, file layout under `apps/server/src/groups/`.
- Exact wording of the briefing, role presets, notes and cards (in all seven locales).
- How the write-lock wait is time-boxed, and the idle timeout for child processes.
- Visual design of the screen within DJL's existing components and tokens.
- Whether `Ask again` re-runs with the member's existing session or a rolled-back one.
