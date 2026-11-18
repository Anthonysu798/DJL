# Multi agents (Beta)

Multi agents puts several of your signed-in CLI agents in one group chat, like a WeChat group.
You open it from **Multi agents** in the left rail. Design: `docs/superpowers/specs/2026-11-18-multi-agents-design.md`.

## What a group is

- One group is one ordinary DJL thread whose provider is `group`, inside a project of kind
  `group`. Group threads never appear in the normal chat list or in the phone app.
- Members are the native subscription agents: Codex, Claude, Cursor, Gemini, Grok, Kimi, iFlow,
  Qwen, CodeBuddy and Pi. The same agent can join twice with different roles.
- Each member keeps its own CLI session. When it is woken it receives only the messages it has
  not seen yet; a member added later gets the group name (its goal), the member list and the last
  40 messages.
- Every skill switched on in Settings > Skills is listed for every member. You can also attach one
  skill to a message from the composer.

## Who answers

| You type | Who is woken | May they change files? |
| --- | --- | --- |
| `@Name …` | that member (several `@Name`s wake each of them) | yes, one at a time |
| `@all …` (or `@所有人`, `@全体成员`, `@全体`) | every member at once | no: they read, search and propose |
| no `@` | whoever answered the previous message (everyone, if nobody has yet) | as in that previous round |

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

## Where the files are

- A new group gets its own folder, `<DJL state dir>/groups/<group id>` (for the desktop app,
  `~/.djl/userdata/groups/<group id>`), with `git init` run in it. The members panel can point the
  group at another folder at any time; the conversation is kept.
- Deleting a group removes its chat and keeps its folder; DJL shows where the files are.

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
