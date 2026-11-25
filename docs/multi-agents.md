# Multi agents (Beta)

Multi agents puts several of your signed-in CLI agents in one group chat, like a WeChat group.
You open it from **Multi agents** in the left rail. Design: `docs/superpowers/specs/2026-11-18-multi-agents-design.md`.

## What a group is

- One group is one ordinary DJL thread whose provider is `group`, inside a project of kind
  `group`. Group threads never appear in the normal chat list. The phone app lists them
  separately, under **Groups** (see "On the phone" below).
- Members are the native subscription agents: Codex, Claude, Cursor, Gemini, Grok, Kimi, iFlow,
  Qwen, CodeBuddy and Pi. The same agent can join twice with different roles.
- Each member keeps its own CLI session. When it is woken it receives only the messages it has
  not seen yet; a member added later gets the group name (its goal), the member list and the last
  40 messages.
- Every skill switched on in Settings > Skills is listed for every member. You can also attach one
  skill to a message from the composer.

## Who answers

| You type                                      | Who is woken                                                        | May they change files?            |
| --------------------------------------------- | ------------------------------------------------------------------- | --------------------------------- |
| `@Name …`                                     | that member (several `@Name`s wake each of them)                    | yes, one at a time                |
| `@all …` (or `@所有人`, `@全体成员`, `@全体`) | every member at once                                                | no: they read, search and propose |
| no `@`                                        | whoever answered the previous message (everyone, if nobody has yet) | as in that previous round         |

- A member's final answer can `@` another member; that member is woken with the answer as its
  task. After 6 hand-offs in a row the group pauses with a **Continue / Stop** card. The pause is
  stored, so it survives closing the app. Hand-offs from an `@all` round stay read-only after
  Continue. The limit is a per-group setting.
- A message sent while agents are still working joins the running round: an idle member starts
  at once, and a busy member gets it after its current task. Each typing row has its own Stop;
  **Stop all** stops the round.
- If a member fails (signed out, limit reached, crashed), its error shows in the chat and, when it
  was the only member woken, the task is handed to the next idle member.
- `@all` in a group of 4 or more members asks first ("This will wake N agents"), with
  "Don't ask again for this group".

## What members may do

- There are no permission pop-ups. Every member runs with approvals on, and DJL answers each
  request by the rule above: in an `@all` round only reads, searches and web look-ups inside the
  group folder, the skill folders and the message's attachments are allowed; any change,
  command, or read outside those folders (including `~` and `$VAR` paths) is refused. For Claude,
  DJL also routes Read, Glob, Grep, Edit, Write, MultiEdit, NotebookEdit and Bash through this rule
  even when your own Claude settings pre-allow them.
- A member you `@` may run commands and change files, but a file change aimed outside the group
  folder is declined.
- Only one member changes files at a time. A second member that wants to edit waits for the
  first, then is declined with a reason if the wait runs out.
- **Only Codex is held inside the group folder by a sandbox.** The other agents are told to stay
  in it, and their file-change requests outside it are declined, but a command they run when
  `@`'d can still reach the rest of the disk. Pointing a group at a real
  project folder removes the safety of a fresh folder; the group settings say so.
- Under each reply a chip reads "Changed N files · ran N commands" when the member did either;
  clicking it lists them.

## Version 2 additions (2026-11-23)

Design and the research behind it: `docs/superpowers/specs/2026-11-23-group-harness-v2-design.md`.

- **Pass.** In a round that went to everyone, a member with nothing to add replies `[PASS]`. It is
  not added to the conversation, does not count as having answered, and shows as one quiet line
  ("Codex had nothing to add").
- **Group brief.** Shared instructions in the group settings. Every member reads them in its
  first briefing; when they change, each member is told on its next wake.
- **Messages without @ go to:** whoever answered last (the default, as before), everyone
  (propose-only, like `@all`), or one member as the **lead**, who answers or hands parts out with
  `@`. The composer shows the lead or "everyone" beside Send.
- **Mute.** A muted member answers only when you name it; `@all`, agents' hand-offs, failure
  hand-over and automatic review skip it.
- **Check changes automatically.** Pick a reviewer. When another member changes files, the
  reviewer is woken read-only with the list of changed files; it says the change is right, or
  `@`s the author with what to fix. The fix is a normal hand-off, so the hop limit bounds the loop.
- **After an `@all` round:** **Go with this** under each proposal (sends `@Name Go ahead with your
proposal.`), and under the round's last reply **Combine** (pick who merges the proposals) and
  **Discuss** (everyone reads the others' answers and adds only what is new, or passes).
- **Context meter** per member in the group settings (amber from 70 %, red from 85 % when the CLI
  reports its window size), and **Start fresh**: stops that member, forgets its CLI session, and
  re-briefs it with the last 40 messages on its next wake. Changing a member's model does the same.
- **Quiet members.** A member working for 3 minutes with no activity from its CLI (and not waiting
  for the write lock) is marked "No activity for 3 min" with Stop and Start fresh.
- **Hand-offs N of M** in the header while a round uses hand-offs.
- **Undo changes** under the last reply of the newest round that changed files. It reverses that
  round's file changes with DJL's checkpoints (one round at a time, newest first) and tells the
  members on their next wake.
- **Templates** in the new-group dialog: Build & review, Plan · build · review (Planner as lead),
  Research & write, Second opinions (everyone by default). They fill roles from agents that are
  signed in, preferring different agents.

The phone app ignores these fields and events for now; nothing it does changed.

## Mission mode (2026-11-24)

Design: `docs/superpowers/specs/2026-11-24-group-mission-mode-design.md`.

- **Agents react to what they pick up.** A member woken by your message puts 👀 on it, then ✅
  (answered), 💤 (nothing to add) or ⚠️ (failed); a stopped member takes its 👀 back. The same
  happens on a reply that handed work to another member, or that you reacted to.
- **Tap reactions** under every answer: 👍 Good (feedback only: no agent is woken; the agent reads
  it on its next wake; tap again to take it back), 👎 Not quite (the agent tries again), ✅ Do it
  (the agent carries it out with edit rights; Go with this is the same), 🤔 Explain simpler.
  The message DJL posts for a reaction is written in your language and joins a running round;
  with no round running it starts one, and the chat never shows it as a bubble.
- **Live status, kept small.** The header shows each member as an icon; a green ring pulses on
  whoever is working. What it is doing shows once, in the chat, on that member's working line:
  "Codex · Reading `file`", "Editing `file`", "Running `command`", Writing, Reviewing, Planning,
  or waiting its turn, plus "from Claude" when another agent handed it the work. While a mission
  runs, the header also shows "Mission 1/4".
- **Starter quests** in each group: Say hi to everyone, Ask one agent, React to an answer, Run a
  mission. They tick off from what happened in the chat; hiding them is remembered per group on
  this computer.
- **Missions.** The flag in the composer turns the next message into a goal. The planner (the
  lead, else a Planner, else the first unmuted member) answers with a checklist, which becomes the
  mission card's steps. Remove steps you do not want, then Start: each step runs with edit rights,
  hand-offs and automatic review inside it count toward that step, and the next step starts when
  nothing of the current one is left running. A failed step, Stop all, or a hand-off pause holds
  the mission with Retry step / Skip step / Stop. A finished mission shows its time, files
  changed, commands and reviews, with Copy summary.
- On the phone, the new events are ignored. A message DJL posted for a reaction or a mission while
  no round was running shows there as a message from you.

## Where the files are

- A new group gets its own folder, `<DJL state dir>/groups/<group id>` (for the desktop app,
  `~/.djl/userdata/groups/<group id>`), with `git init` run in it. The members panel can point the
  group at another folder at any time; the conversation is kept.
- Deleting a group removes its chat and keeps its folder; DJL shows where the files are.

## On the phone

The Flutter app (`apps/mobile`) shows groups under **Groups** on the paired Mac's home screen. From
the phone you can read a group, send a message (with `@Name` or `@all`), stop the round or one
member, continue or end a paused round, and create a group from the agents that are signed in on
the Mac. Renaming, roles, models, the folder and the hand-off limit stay on the desktop.

- A reply is shown while it is written. Each member's text so far is published on the
  `groups.event` stream as `reply.draft` events (`restart` means the member began a new message,
  so the draft is replaced). Drafts are never stored: the transcript still receives only the
  finished answer. The snapshot carries `live` (busy members and their text so far) so a client
  that joins or reconnects mid-round is caught up. The desktop group view shows the same live text.
- The phone bridge (`apps/remote-gateway/src/electron-groups.js`) serves `djl/groups/list`,
  `agents`, `create`, `send`, `stop`, `stopMember`, `resolvePause` and `setSkipAllWarning`, forwards
  group events as `djl/groups/event` and drafts as `djl/groups/draft`, and merges a burst of draft
  deltas into one relay frame. It advertises the `djlGroups` capability; against an older desktop
  the phone asks the person to update DJL on the Mac.
- Messages from the phone can carry up to 20 files of up to 50 MB each: photos, PDFs, Word, Excel
  and PowerPoint (`.docx`, `.xlsx`, `.pptx`), video, and text or code files. The relay caps a
  message at 1 MiB, so the phone sends each file in 384 KiB pieces with `djl/groups/upload`; the
  bridge assembles it, posts it to the desktop's `/api/attachments/upload` on the group's thread,
  and returns the reference that `djl/groups/send` then carries in `attachments`. User messages
  carry their attachment details (`attachments` beside `content`), and `djl/groups/attachment`
  pages a stored file back for preview. The bridge advertises this as `djlGroupAttachments`.
- On the phone, images and text or code files preview in the app; PDFs and Office files open in
  Quick Look on iOS and in the app that views them on Android.
- The desktop stores text and source files (`.py`, `.ts`, `.go`, `.sql` and similar) as plain text
  under their own extension. Archives, macro-enabled Office files, legacy `.doc`/`.ppt`/`.xls`, HEIC
  and markup a browser would render (`.html`, `.svg`) are refused with a readable error.

## Code map

- Contracts: `packages/contracts/src/groups.ts`; mention parsing and ids:
  `packages/shared/src/groupChat.ts`.
- Server: `apps/server/src/groups/` (storage, RPC service) and
  `apps/server/src/harnesses/native/group/` (driver, round router, request policy, prompts).
- Renderer: `apps/web/src/multiAgents/` and the route `apps/web/src/routes/_chat.multi-agents.tsx`.

## Verified

2026-11-18, on branch `worktree-multi-agents`.

**Checks.** `ci:desktop:format`, `ci:desktop:lint`, `ci:desktop:typecheck`, `brand:check` and
`public-source:check` passed. `ci:desktop:browser`: 354 of 354 passed. `ci:desktop:test`: every
package passed except one web test (`MessagesTimeline` "keeps small transcripts on the simple
non-virtualized path"), which timed out at 10 s under heavy machine load and passed 45 of 45 when
re-run alone. Server suite: 2744 passed; the one failure was the new persistence test, which ran
before its fix was saved and passes now. Remote gateway: 733 passed. Shop: 60 passed.
`i18n:check` reports 191 findings, the same count as before this work.

**Real agents, driven through the group driver** (Claude Code 2.1.327, Codex CLI 0.166.0, with an
in-memory group store rather than the app):

- `@all reply only "ok"`: both answered, each under its own name.
- `@Claude …`: only Claude answered; a follow-up with no `@`: only Claude answered.
- `@all create a file`: no file was created; both proposed instead.
- `@Claude create a file`: the file existed afterwards and the reply recorded 1 file.
- A Claude answer containing `@Codex` woke Codex.
- Live routing: Claude was given a 25-second shell task; `@Codex reply with only the word: quick`
  was sent 8 s later and Codex answered at 16 s while Claude was still working. Claude answered
  at 33 s, all in one turn.
- `@Codex create chip.txt`: the file was created, but the first run recorded no work at all,
  because Codex reports its work inside the item data. Fixed; after the fix the reply recorded
  Codex's shell command (it wrote the file with a command, so no file change is listed).
- `@all what is the latest released version of Node.js? Look it up`: Claude ran a web search,
  which an `@all` round allows; Codex answered without a recorded look-up.

- After the final review: with `Write` pre-allowed in the group folder's
  `.claude/settings.local.json`, an `@all` request to call Write anyway was refused and no file was
  created. The same run without DJL's group hook (control) created the file.

**In the app** (browser dev mode, `bun run dev`, with a separate home folder):

- Seen working: the Multi agents rail item with its Beta badge, the group list, the two-step setup
  (agent list while accounts are checked, naming step), and the `@` menu (All, Codex, Claude).
- `@Codex create a file …` reached the server, but the turn ran as plain Codex and failed with
  "The 'group' model is not supported". Cause: the stored-event normalizer did not know the
  `group` provider and rewrote it to `codex`. Fixed and covered by a unit test. The send was
  **not** repeated in the app after the fix (see below).
- Blocked: in browser mode the connection restarted every second or two (the `server.config`
  stream kept ending, at a machine load average of about 230 to 250 from other apps). Creating a
  group and other slower requests were cut off every time. This code is unchanged by this
  work, and the desktop app was not tried.

**Not tried:** the desktop app (`electron:dev`); a full group turn in the app after the fix; the
work chip, reply actions, attachments and skill picker in the app; the Continue / Stop card after
ten minutes and after a restart; changing the group folder; the completion notification after an
`@all` round; ordinary one-agent chats by hand (only their automated tests ran); Gemini (the
Gemini CLI is not installed on the test machine).

## Simpler screens (2026-11-24)

Same features, fewer controls on screen:

- **One header row.** The separate stage strip is gone; see "Live status" above.
- **A mission plan shows once.** The planner's checklist is hidden in its reply; the mission card
  under it lists the steps, each with its agent's icon.
- **Under an answer**, hovering shows one small pill: the four tap reactions (each pops when
  tapped), Copy (it turns into "✓ Copied" for a moment), and a "…" menu with Ask again, Reply to
  this and Ask another agent.
- **Group settings** is a small glass panel that floats over the chat: a plain list where every
  row is a label and one picker.
  - Each member has a **model picker** that lists that agent's models, with a search box when the
    list is long ("Agent default" keeps the agent's own choice), and a "…" menu with Role, Mute,
    Context used, Start fresh and Remove.
  - "Messages without @ go to" and "Check changes automatically" are one picker each.
  - Group brief, hand-off limit, folder and Delete group are under **More settings**.
- **One dropdown style.** Every menu in Multi agents (model, member options, add member, who
  answers, the "…" under an answer) is the same liquid-glass menu with roomy rows; a picker's chip
  shows a check for a moment after its value changes.
- **Reply to this** no longer pastes the quoted answer into the input. A small chip above the
  input says "Replying to Cursor" with a one-line preview and an ✕ to cancel; you type only your
  own words. The sent message shows the quoted answer as one quiet line above your bubble. Quotes
  are plain text (no link paths or markup) and never wake the agents they name.
- **Copy** uses the app's own copy helper, because the desktop app refuses the browser clipboard
  call; a failed copy says so.

## Inviting people into a group (2026-11-24)

The owner can invite collaborators into one group. A guest joins from the DJL phone app with a
code and chats with the owner's agents. Everything still runs on the owner's computer, with the
owner's subscriptions.

**For the owner**

- **Group settings → People → Invite a person.** Give a name and choose what they can do:
  - **Can chat**: they can ask the agents. The agents answer a guest with proposals only and
    change no files; the owner approves with ✅ Do it or Go with this.
  - **Can watch**: they read the chat and cannot write.
- The row then shows an invite code. The guest opens the DJL phone app, taps **Pair with code**
  and enters it. A code lasts five minutes; until the guest has paired, DJL replaces it with a
  fresh one when it runs out, and **New invite code** does so at once.
- The row shows whether the guest is connected. The role can be changed at any time, and
  **Remove from group** closes their connection and deletes their identity, so they cannot
  reconnect.
- A group can have up to 8 guests. Guests connect only while Remote is on and the computer is
  awake; a paired guest keeps the computer awake under the same rule as the owner's phone.
- In the chat, a guest's messages sit on the left under their name with a "guest" tag.

**What a guest can and cannot do**

- A guest sees one group: its members, its messages and its live status. They do not see the
  owner's other chats or groups, the group's folder path, the group brief, other guests, or the
  agents' tool activity (commands run, files opened).
- A guest can send text. They cannot attach files, stop a round, answer approval prompts, start
  or plan a mission, react, change settings, or use anything else the owner's phone can.
- The agents are told a message is from a guest: a visitor, not the owner. They are told not to
  reveal secrets and not to take a guest's instructions to change their rules.

**How it is kept apart**

- Each guest gets a gateway process of their own, with its own device identity and relay session
  (`apps/desktop/src/groupGuestGateways.ts`). A guest's connection is never the owner's session.
- That gateway serves a fixed list of requests and refuses the rest
  (`apps/remote-gateway/src/guest-scope.js`). It skips every handler that touches the owner's
  files, git, terminals or settings, and lets out only the guest's group and its chat thread.
- The server reads who wrote a message from its id (`group-guest-<guest id>-…`), which only that
  gateway can write. A removed guest, or one who may only watch, wakes nobody.
- A guest gateway refuses to start without its own state folder: otherwise it would adopt the
  owner's identity from the shared macOS Keychain entry.

**Not done yet**

- On the phone, a guest's messages and the owner's look the same (both show as "you"); only the
  desktop labels a guest.
- The owner's computer cannot tell when a guest's phone goes away: the relay does not report a
  phone that disconnects, so a person's row stays "Connected" until Remote reconnects. Visiting
  agents are not affected (see below); fixing it for phones needs a small relay change.
- Tried with the iOS simulator through the live relay on 2026-11-24 (pair with a code, send,
  read the answer, one group visible). Not tried on a physical phone or on Android.

## Visiting agents (2026-11-24)

Someone else's agent can join your group, and yours can join theirs. The agent keeps running on
its owner's computer, with its owner's subscription; only text travels between the two
computers, end-to-end encrypted, through the same relay as the phone.

**Inviting someone's agent (the group's owner)**

- **Group settings → People → Invite a person**, choose **Brings an agent**, and give the code to
  the other person. It lasts five minutes and is renewed like a person's code.
- When they join, their agent appears among the members with a "guest" tag and the name you gave
  the invite. It is called with `@name` like any member, takes part in `@all`, missions and
  hand-offs, and shows the model its owner chose (you cannot change it).
- What it gets: the group's messages, the member list and the group brief, inside each message
  it is asked to answer. What it never gets: the group's folder, file paths, attachments, skills,
  or any other chat. It cannot read, change or run anything on your computer.
- What it hands to your agents with `@handle` is always a proposal: your agents change nothing
  on a visiting agent's word until you approve (✅ Do it or Go with this).
- If its computer is offline it fails at once with "This visiting agent is not connected right
  now", and the task goes to another member as with any failed member. People shows
  **Connected** or **Their computer is offline**.
- Removing the member or its row in People takes the invite back; their app then shows **No
  longer invited**.

**Lending your agent (the other person)**

- **Multi agents → Join a group**: enter the invite code and pick the agent and model that
  answer there. The agent then shows under **Lent to other groups** with its state (Connected,
  Answering…, Their computer is offline, No longer invited). **Leave this group** takes it back.
- A lent agent needs the DJL desktop app to be running; it does not need your own Remote to be
  on. Up to 8 agents can be lent at a time.
- Only Claude can be lent for now. A lent Claude runs with no tools at all (no files, shell,
  web or MCP servers) and none of the lender's settings, hooks or `CLAUDE.md`
  (`createLentClaudeDriver`: `tools: []`, `settingSources: []`, `strictMcpConfig: true`), so
  whatever the other group writes, it can only answer with text. Checked 2026-11-24: such a
  session reports an empty tool list at start.
- As a second barrier it works in an empty folder of its own (`<data folder>/lent-agents/<link
  id>`), any request that still reaches DJL is refused, and every message from the other group
  arrives behind a notice that it is someone else's chat.
- Codex cannot be lent: it runs read-only shell commands (`cat`, `ls`) without asking, so its
  permission prompts cannot keep it out of the lender's files. Other agents are not lendable
  until each is checked the same way (`GROUP_LENDABLE_PROVIDERS` in `packages/contracts`).

**How it works**

- The owner's side reuses the guest gateway: role `agent` in `guest-scope.js` answers only
  `djl/groups/agent/join|reply|draft` and lets out only `djl/groups/agent/turn|cancel|removed`.
  It is not shown the chat at all.
- The visiting member has `guestId` set (`group_members.guest_id`, migration 066). The round
  opens it through `guestAgentChild.ts`, which asks `guestAgentHub.ts` instead of starting a CLI.
- The other computer runs `guest-agent-link.js` in its own process (`agentLinkChild.ts`): the
  phone side of the handshake in Node (`guest-link-client.js`), a "still here" every 30 seconds,
  and each turn answered through its own backend (`groups.lentAgentAsk`, `lentAgent.ts`).
- The agent's session id travels with every "still here". When its CLI was closed (15 idle
  minutes, a restart), the id changes and the group briefs the agent again on its next turn.
- No relay change. The relay sees one more session per invite, as for a guest's phone.
