# Multi agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Multi agents" section in DJL where several native CLI agents are members of one group
chat, addressed with `@Name` or `@all`, able to hand work to each other and share one skill library.

**Architecture:** A new provider kind `group`. One group is one ordinary orchestration thread whose
provider is `group`; its driver owns one child native driver per member, routes `@` mentions,
answers the children's permission requests by policy, and emits only each member's final answer
into the thread. Group settings live in their own SQLite tables behind a `GroupService` with WS
RPC; the screen is a new, small view, not a mode of `ChatView`.

**Tech Stack:** TypeScript, Effect (services and layers), SQLite migrations, Vitest, React,
TanStack file routes, i18next catalogs.

**Spec:** `docs/superpowers/specs/2026-11-18-multi-agents-design.md`. Read it first; this plan
argues from it. Slice 1 of the spec (Gemini) has its own plan:
`docs/superpowers/plans/2026-11-18-gemini-native-harness.md`.

## Global Constraints

- Base: `main`. Before Tasks 9 and 13, check whether changes to
  `apps/server/src/harnesses/native/adapter.ts`, `layer.ts` and `types.ts` from the local branch
  `codex/agent-social-publishing` have landed, and rebase onto them if so.
- Product name is DJL; `bun run brand:check` and `bun run public-source:check` must pass.
- Every user-visible string in `apps/web` comes from the seven locale catalogs
  (`en`, `es-419`, `fr`, `ja`, `ko`, `zh-Hans`, `zh-Hant`) with identical keys in canonical order.
  New keys go under a new `multiAgents` section of the `shell` namespace.
- Cross-process schemas go in `packages/contracts`; shared runtime code goes in `packages/shared`
  behind an explicit subpath export (there is no barrel).
- Tests: `bun run --cwd <package> test <file>`, never `bun test`. `apps/server` runs on one
  worker, so always pass a file filter while iterating.
- Never use the real `~/.djl` state; `bun run electron:dev` uses isolated state.
- Spec constants, used verbatim: hop limit default **6**; late-joiner and re-brief window **40**
  messages; `@all` confirmation from **4** members; large-group warning from **8** members; role
  presets **Planner, Builder, Reviewer, Researcher, Writer**.
- Members in version 1: `codex`, `claudeAgent`, `cursor`, `grok`, `kimi`, `iflow`, `qwen`,
  `codebuddy`, `pi`, `gemini`. Not `opencode`, not `djlCloud`.
- `group` must never appear in model pickers, Settings > Accounts, handoff targets, automations,
  or as the default provider.
- Ordinary one-agent chats must behave exactly as before.
- Each task ends green on `bun run ci:desktop:typecheck` and `bun run ci:desktop:lint`.

## Review Focus

1. **Text that looks like a mention but is not.** `mail me at a@claude.com`, `@Claude,` with
   punctuation, `@claude` in lower case, and `@Claude` when `Claude2` also exists. Expected: the
   e-mail wakes nobody; the others wake exactly the named member. (Task 1)
2. **A member that finishes without saying anything** (it only ran tools). Expected: no empty
   bubble; the chat shows a short "finished without a reply" note for that member and the round
   continues. (Tasks 5 and 10)
3. **A member removed, or the group deleted, while a round is running.** Expected: that member's
   CLI is stopped, the other members finish, nothing crashes. (Task 8)
4. **Stop pressed while a second editor is waiting for the write lock**, or the lock holder
   crashes. Expected: the waiting request is released and the lock is freed; no member hangs.
   (Task 6)
5. **A member that has missed hundreds of messages.** Expected: its catch-up is the newest 40 with
   one line saying earlier messages were skipped, never an unbounded prompt. (Task 7)

## File Structure

| Path                                                               | Responsibility                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| `packages/shared/src/groupChat.ts`                                 | Pure helpers: mention parsing, handles, message-id encoding     |
| `packages/contracts/src/groups.ts`                                 | Group, member, reply, event and RPC schemas                     |
| `apps/server/src/persistence/Migrations/062_Groups.ts`             | Tables                                                          |
| `apps/server/src/persistence/{Services,Layers}/GroupRepository.ts` | SQL access                                                      |
| `apps/server/src/groups/{Services,Layers}/GroupService.ts`         | Create, update, delete, members, events, runtime port           |
| `apps/server/src/harnesses/native/group/childSession.ts`           | One member's CLI: ask, final answer, work capture, failure      |
| `apps/server/src/harnesses/native/group/groupPolicy.ts`            | Request classification, propose-only rule, write lock           |
| `apps/server/src/harnesses/native/group/groupPrompt.ts`            | Briefing, catch-up, late-joiner text                            |
| `apps/server/src/harnesses/native/group/groupRound.ts`             | Router: targets, hops, pause, hand-over                         |
| `apps/server/src/harnesses/native/group/groupDriver.ts`            | `NativeDriverFactory` that ties the above to the adapter sink   |
| `apps/web/src/multiAgents/groupStore.ts`                           | Subscribes to group events                                      |
| `apps/web/src/multiAgents/groupChat.logic.ts`                      | Thread messages + replies → chat rows                           |
| `apps/web/src/multiAgents/*.tsx`                                   | Screen, setup dialog, chat view, members panel, composer pieces |
| `apps/web/src/routes/_chat.multi-agents.tsx`                       | Route                                                           |

---

### Task 1: Shared mention and id helpers

**Files:**

- Create: `packages/shared/src/groupChat.ts`
- Modify: `packages/shared/package.json` (add the `./groupChat` subpath export, same shape as
  `./djlStoragePaths`)
- Test: `packages/shared/src/groupChat.test.ts`

**Interfaces:**

- Produces:
  - `GROUP_ALL_HANDLE = "all"`
  - `parseGroupMentions(text: string, handles: readonly string[]): { all: boolean; handles: string[] }`
    Returns canonical handles (as passed in), deduplicated, in order of first appearance.
  - `nextGroupHandle(base: string, taken: readonly string[]): string`
  - `formatGroupItemId(memberId: string, replyId: string): string` → `gm.<memberId>.<replyId>`
  - `parseGroupMessageId(messageId: string): { memberId: string; replyId: string } | null`

- [ ] **Step 1: Write the failing tests.**

```ts
const handles = ["Claude", "Claude2", "Codex", "审稿人"];
it("matches case-insensitively and prefers the longest handle", () => {
  expect(parseGroupMentions("@claude2 and @CODEX please", handles)).toEqual({
    all: false,
    handles: ["Claude2", "Codex"],
  });
});
it("accepts trailing punctuation and non-Latin handles", () => {
  expect(parseGroupMentions("@Claude, what about @审稿人?", handles).handles).toEqual([
    "Claude",
    "审稿人",
  ]);
});
it("ignores e-mail addresses and unknown names", () => {
  expect(parseGroupMentions("mail a@claude.com or @Nobody", handles)).toEqual({
    all: false,
    handles: [],
  });
});
it("recognises @all in any case and deduplicates", () => {
  expect(parseGroupMentions("@All @Codex @codex", handles)).toEqual({
    all: true,
    handles: ["Codex"],
  });
});
it("builds unique handles without spaces", () => {
  expect(nextGroupHandle("Qwen Code", [])).toBe("QwenCode");
  expect(nextGroupHandle("Claude", ["Claude"])).toBe("Claude2");
  expect(nextGroupHandle("Claude", ["claude", "Claude2"])).toBe("Claude3");
  expect(nextGroupHandle("all", [])).toBe("all2");
});
it("round-trips a member id through a thread message id", () => {
  const itemId = formatGroupItemId("m1", "r9");
  expect(itemId).toBe("gm.m1.r9");
  expect(parseGroupMessageId(`assistant:turn-7:${itemId}`)).toEqual({
    memberId: "m1",
    replyId: "r9",
  });
  expect(parseGroupMessageId("assistant:turn-7:assistant-abc")).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail.**
      Run: `bun run --cwd packages/shared test src/groupChat.test.ts`. Expected: FAIL, module missing.

- [ ] **Step 3: Implement.** A mention is `@` at the start of the text or after a character that is
      not a letter, digit, `_`, `-`, `.` or `@`, followed by a handle, followed by the end or a
      character that is not a letter, digit, `_` or `-`. Handles contain only Unicode letters,
      digits, `_` and `-`; `nextGroupHandle` strips everything else from `base`. Member ids and
      reply ids must not contain `.` or `:` (callers use UUIDs without dashes removed is fine;
      dashes are allowed).

- [ ] **Step 4: Run to verify they pass.** Expected: PASS.

- [ ] **Step 5: Commit** (`git commit -m "Add group chat mention and message-id helpers"`).

### Task 2: Contracts, `group` provider kind and `group` project kind

**Files:**

- Create: `packages/contracts/src/groups.ts`; export it from `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/orchestration.ts` (`ProviderKind` literal `"group"`,
  `GroupModelSelection`, add it to the `ModelSelection` union)
- Modify: `packages/contracts/src/project.ts` (`ProjectKind` gains `"group"`)
- Modify: every total `Record<ProviderKind, …>` and exhaustive switch the type checker reports.
  Commit `c9d6ff42c` lists the same sites for Qwen Code; expect `packages/contracts/src/model.ts`,
  `agentMentions.ts`, `packages/shared/src/model.ts`, `providerUsage.ts`, and in `apps/server`
  `provider/providerStatusCache.ts`, `provider/Layers/ProviderHealth.ts`,
  `provider/skillsCatalog.ts`, `providerUsage/registry.ts`, and in `apps/web` `appSettings.ts`,
  `composerDraftStore.ts`, `components/ProviderIcon.tsx`, `components/chat/composerProviderRegistry.tsx`,
  `components/chat/ProviderModelPicker.tsx`, `hooks/useProviderModelCatalog.ts`,
  `lib/threadHandoff.ts`, `routes/-automations.shared.tsx`.
- Modify: `apps/server/src/orchestration/decider.ts` and `commandInvariants.ts` (accept kind
  `group` for project create/update; keep it out of `WORKSPACE_OWNING_PROJECT_KIND_SET`)
- Test: `packages/contracts/src/groups.test.ts`, `packages/contracts/src/orchestration.test.ts`,
  `apps/web/src/providerOrdering.test.ts`, `apps/server/src/orchestration/decider.projectScripts.test.ts`
  (or the decider test file that already covers `project.create`)

**Interfaces:**

- Produces, in `groups.ts`:
  - `GroupId`, `GroupMemberId` (branded trimmed non-empty strings)
  - `GroupMemberProvider` = literals of the ten member kinds in Global Constraints
  - `GROUP_ROLE_PRESETS = ["planner", "builder", "reviewer", "researcher", "writer"] as const`
  - `GroupMember { id, groupId, provider, handle, role: string | null (≤ 200 chars), model: string | null, position: number }`
  - `GroupHandoff { fromMemberId, toMemberId, text }`
  - `Group { id, threadId, projectId, name, folder, folderIsAuto: boolean, hopLimit: number, skipAllWarning: boolean, pendingHandoffs: GroupHandoff[], members: GroupMember[], createdAt, updatedAt }`
  - `GroupReply { groupId, replyId, memberId, status: "ok" | "empty" | "failed", error: string | null, files: string[], commands: string[] }`
  - `GroupMemberState = "idle" | "working" | "waiting" | "failed"`
  - `GroupEvent` union: `{ type: "snapshot", groups: Group[], replies: GroupReply[] }`,
    `{ type: "group.upserted", group }`, `{ type: "group.deleted", groupId, folder }`,
    `{ type: "member.state", groupId, memberId, state }`, `{ type: "reply.recorded", reply }`
  - Inputs: `GroupCreateInput { name, members: { provider, role?: string }[] }`,
    `GroupUpdateInput { groupId, name?, hopLimit?, skipAllWarning?, folder? }`,
    `GroupAddMemberInput { groupId, provider, role? }`,
    `GroupUpdateMemberInput { groupId, memberId, role?: string | null, model?: string | null }`,
    `GroupMemberRef { groupId, memberId }`, `GroupRef { groupId }`,
    `GroupResolvePauseInput { groupId, action: "continue" | "stop", continueText: string }`
  - Constants: `GROUP_DEFAULT_HOP_LIMIT = 6`, `GROUP_CATCH_UP_LIMIT = 40`,
    `GROUP_ALL_WARNING_MIN_MEMBERS = 4`, `GROUP_LARGE_WARNING_MEMBERS = 8`,
    `GROUP_MODEL_SELECTION = { provider: "group", model: "group" } as const`

- [ ] **Step 1: Write the failing tests.**

```ts
// groups.test.ts
it("defaults and bounds", () => {
  expect(GROUP_DEFAULT_HOP_LIMIT).toBe(6);
  expect(GROUP_CATCH_UP_LIMIT).toBe(40);
  expect(() => Schema.decodeUnknownSync(GroupMemberProvider)("opencode")).toThrow();
  expect(Schema.decodeUnknownSync(GroupMemberProvider)("gemini")).toBe("gemini");
});
// orchestration.test.ts
expect(Schema.decodeUnknownSync(ModelSelection)({ provider: "group", model: "group" })).toEqual({
  provider: "group",
  model: "group",
});
// providerOrdering.test.ts
expect(isProviderKind("group")).toBe(false);
expect(PROVIDER_OPTIONS.some((option) => option.value === "group")).toBe(false);
```

In `apps/server/src/orchestration/decider.projectScripts.test.ts`, copy the test that ends with
`rejects.toThrow("Project 'project-mixed-active' already uses workspace root")`, give the second
`project.create` command `kind: "group"`, and assert instead:

```ts
const events = await Effect.runPromise(decideOrchestrationCommand({ command, readModel }));
expect([events].flat().some((event) => event.type === "project.created")).toBe(true);
```

- [ ] **Step 2: Run to verify they fail.** Expected: FAIL (unknown literal / missing module).

- [ ] **Step 3: Implement.** Add the literals and schemas, then run `bun run ci:desktop:typecheck`
      and fix each reported site. For display records give `group` the name `"Group"` and a
      one-entry model list `[{ slug: "group", name: "Group" }]`; for health, usage, skills and
      status records give it an inert entry. Leave `group` out of `DEFAULT_PROVIDER_ORDER`,
      `PROVIDER_OPTIONS`, `HarnessId`, handoff targets, the automations picker and
      `DEFAULT_PROVIDER_KIND`.

- [ ] **Step 4: Run to verify.** The four test files PASS; `bun run ci:desktop:typecheck` PASS.

- [ ] **Step 5: Commit** (`git commit -m "Add group provider kind, project kind and contracts"`).

### Task 3: Persistence

**Files:**

- Create: `apps/server/src/persistence/Migrations/062_Groups.ts`; register
  `[62, "Groups", Migration0062]` in `apps/server/src/persistence/Migrations.ts`
- Create: `apps/server/src/persistence/Services/GroupRepository.ts`,
  `apps/server/src/persistence/Layers/GroupRepository.ts`
- Test: `apps/server/src/persistence/Layers/GroupRepository.test.ts`

**Interfaces:**

- Consumes: schemas from Task 2.
- Produces `GroupRepository` (Effect service, `"djl/persistence/GroupRepository"`), all methods
  returning `Effect`:
  - `listGroups(): Group[]`, `getByThreadId(threadId): Group | null`, `getById(groupId): Group | null`
  - `upsertGroup(row)`, `deleteGroup(groupId)` (cascades members, log and replies)
  - `upsertMember(member)`, `deleteMember(memberId)`
  - `getMemberRuntime(memberId): { nativeSessionId: string | null; readSeq: number }`
  - `saveMemberRuntime(memberId, patch: { nativeSessionId?: string | null; readSeq?: number })`
  - `resetMemberSessions(groupId)` (clears every `nativeSessionId`, keeps `readSeq`)
  - `appendLog(groupId, author: "user" | GroupMemberId, text): number` (returns the new `seq`,
    strictly increasing per group from 1)
  - `logAfter(groupId, seq): { seq, author, text }[]`, `logTail(groupId, count)`
  - `setRoundState(groupId, { lastSpeakers: GroupMemberId[]; lastRoundAll: boolean })`,
    `getRoundState(groupId)`
  - `setPause(groupId, handoffs: GroupHandoff[], resumeRequested: boolean)`
  - `recordReply(reply: GroupReply)`, `listReplies(groupId?): GroupReply[]`
- Tables: `groups`, `group_members` (with `native_session_id`, `read_seq`), `group_log`,
  `group_replies`. `CREATE TABLE IF NOT EXISTS`, as in `059_Servers.ts`.

- [ ] **Step 1: Write the failing tests** against in-memory SQLite, set up like
      `apps/server/src/servers/Layers/ServerService.test.ts` (`SqlitePersistenceMemory`,
      `runMigrations`).

```ts
it("numbers the log from 1 per group and reads after a cursor", async () => {
  expect(await run(repo.appendLog(g1, "user", "hi"))).toBe(1);
  expect(await run(repo.appendLog(g1, m1, "hello"))).toBe(2);
  expect(await run(repo.appendLog(g2, "user", "other"))).toBe(1);
  expect(await run(repo.logAfter(g1, 1))).toEqual([{ seq: 2, author: m1, text: "hello" }]);
  expect((await run(repo.logTail(g1, 1)))[0]?.seq).toBe(2);
});
it("resets sessions but keeps read cursors", async () => {
  await run(repo.saveMemberRuntime(m1, { nativeSessionId: "s1", readSeq: 5 }));
  await run(repo.resetMemberSessions(g1));
  expect(await run(repo.getMemberRuntime(m1))).toEqual({ nativeSessionId: null, readSeq: 5 });
});
it("deletes a group with its members, log and replies", async () => {
  await run(repo.deleteGroup(g1));
  expect(await run(repo.getById(g1))).toBeNull();
  expect(await run(repo.logTail(g1, 10))).toEqual([]);
  expect(await run(repo.listReplies(g1))).toEqual([]);
});
```

- [ ] **Step 2: Run to verify they fail.**
      Run: `bun run --cwd apps/server test src/persistence/Layers/GroupRepository.test.ts`.

- [ ] **Step 3: Implement** the migration and repository on the pattern of
      `apps/server/src/persistence/Layers/ServerRepository.ts`.

- [ ] **Step 4: Run to verify they pass.** Expected: PASS.

- [ ] **Step 5: Commit** (`git commit -m "Persist groups, members, group log and replies"`).

### Task 4: GroupService and RPC

**Files:**

- Create: `apps/server/src/groups/Services/GroupService.ts`,
  `apps/server/src/groups/Layers/GroupService.ts`
- Modify: `packages/contracts/src/ws.ts`, `rpc.ts`, `ipc.ts`; `apps/server/src/wsRpc.ts`;
  `apps/server/src/serverLayers.ts`; `apps/web/src/wsNativeApi.ts`, `wsTransport.ts`
- Test: `apps/server/src/groups/Layers/GroupService.test.ts`, `apps/web/src/wsNativeApi.test.ts`

**Interfaces:**

- Consumes: `GroupRepository` (Task 3); `OrchestrationEngineService.dispatch`
  (`apps/server/src/orchestration/Services/OrchestrationEngine.ts`); `ServerConfig`;
  `harnesses.listAccounts` data for member readiness is read by the renderer, not here.
- Produces `GroupService` (`"djl/groups/GroupService"`):
  - `list(): Group[]`, `create(input: GroupCreateInput): Group`, `update(input): Group`,
    `delete(ref: GroupRef): { folder: string }`
  - `addMember(input): Group`, `updateMember(input): Group`, `removeMember(ref): Group`
  - `stopMember(ref: GroupMemberRef): void`
  - `resolvePause(input: GroupResolvePauseInput): void`
  - `streamEvents: Stream<GroupEvent>` (PubSub, as `ServerCommandService` does)
  - Runtime port for the driver: `runtime: GroupRuntime` (see Task 8 for its shape) and
    `registerLive(threadId, controls: GroupLiveControls): () => void` where
    `GroupLiveControls = { stopMember(memberId): Promise<void>; removeMember(memberId): Promise<void>; resetSessions(): Promise<void> }`
- WS methods: `groups.list`, `groups.create`, `groups.update`, `groups.delete`,
  `groups.addMember`, `groups.updateMember`, `groups.removeMember`, `groups.stopMember`,
  `groups.resolvePause`, and the stream `groups.subscribe` on channel `groups.event` (first item
  is the `snapshot` event). Follow the Servers methods in `ws.ts`, `rpc.ts` and `wsRpc.ts`.

Behaviour the tests pin:

- `create`: makes the folder `<stateDir>/groups/<groupId>`, runs `git init` in it, dispatches
  `project.create` with kind `group` and that folder, then `thread.create` with
  `GROUP_MODEL_SELECTION`, `runtimeMode: "approval-required"`, title = group name. Handles come
  from `nextGroupHandle(PROVIDER_DISPLAY_NAMES[provider], taken)`. `hopLimit` = 6.
- `update` with `folder`: the folder must exist and be a directory; sets `folderIsAuto` false,
  updates the project's `workspaceRoot`, calls `resetMemberSessions` and the live `resetSessions`.
- `delete`: removes rows, archives the thread and project, **never deletes the folder**, returns
  its path, and publishes `group.deleted`.
- `removeMember`: calls the live `removeMember` first, then deletes the row.
- `resolvePause("stop")` clears `pendingHandoffs`. `resolvePause("continue")` sets
  `resumeRequested` and dispatches `thread.turn.start` on the group thread with the message text
  `continueText` (the renderer passes its localized "Continue").

- [ ] **Step 1: Write the failing tests** with a fake `OrchestrationEngineService` that records
      dispatched commands and a temp `stateDir`.

```ts
it("creates a folder, a group project and a group thread", async () => {
  const group = await run(
    service.create({
      name: "Launch",
      members: [
        { provider: "claudeAgent" },
        { provider: "claudeAgent", role: "reviewer" },
        { provider: "codex" },
      ],
    }),
  );
  expect(group.hopLimit).toBe(6);
  expect(group.folderIsAuto).toBe(true);
  expect(fs.existsSync(path.join(group.folder, ".git"))).toBe(true);
  expect(group.members.map((member) => member.handle)).toEqual(["Claude", "Claude2", "Codex"]);
  expect(dispatched.map((command) => command.type)).toEqual(["project.create", "thread.create"]);
  expect(dispatched[0]).toMatchObject({ kind: "group", workspaceRoot: group.folder });
  expect(dispatched[1]).toMatchObject({ modelSelection: { provider: "group", model: "group" } });
});
it("keeps the folder when a group is deleted", async () => {
  const { folder } = await run(service.delete({ groupId: group.id }));
  expect(fs.existsSync(folder)).toBe(true);
  expect(await run(service.list())).toEqual([]);
});
it("changing the folder resets member sessions", async () => {
  await run(service.update({ groupId: group.id, folder: otherDir }));
  expect(liveControls.resetSessions).toHaveBeenCalledTimes(1);
  expect((await run(service.list()))[0]).toMatchObject({ folder: otherDir, folderIsAuto: false });
});
it("rejects a folder that does not exist", async () => {
  await expect(
    run(service.update({ groupId: group.id, folder: "/no/such/dir" })),
  ).rejects.toThrow();
});
it("continue requests a resume and starts a turn with the given text", async () => {
  await run(
    service.resolvePause({ groupId: group.id, action: "continue", continueText: "Continue" }),
  );
  expect(dispatched.at(-1)).toMatchObject({
    type: "thread.turn.start",
    message: { text: "Continue" },
  });
});
```

In `wsNativeApi.test.ts` add, in that file's existing style, that `api.groups.create(input)`
requests `WS_METHODS.groupsCreate`.

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the service, layer wiring and RPC handlers.
- [ ] **Step 4: Run to verify they pass**, then `bun run ci:desktop:typecheck`.
- [ ] **Step 5: Commit** (`git commit -m "Add GroupService with RPC and live events"`).

### Task 5: Child session

**Files:**

- Create: `apps/server/src/harnesses/native/group/childSession.ts`
- Test: `apps/server/src/harnesses/native/group/childSession.test.ts`

**Interfaces:**

- Consumes: `NativeDriverFactory`, `NativeSink` from `../types`.
- Produces:

```ts
export type ChildWork = { files: string[]; commands: string[] };
export type ChildReply =
  | { status: "ok"; text: string; work: ChildWork }
  | { status: "empty"; work: ChildWork }
  | { status: "failed"; error: string; work: ChildWork }
  | { status: "stopped"; work: ChildWork };
export type ChildRequestHandler = (
  type: CanonicalRequestType,
  args: unknown,
  signal?: AbortSignal,
) => Promise<ProviderApprovalDecision | ProviderUserInputAnswers>;
export interface ChildSession {
  readonly nativeSessionId: string;
  ask(prompt: string, onRequest: ChildRequestHandler): Promise<ChildReply>;
  stop(): Promise<void>;
  close(): void;
}
export function openChildSession(input: {
  provider: GroupMemberProvider;
  factory: NativeDriverFactory;
  start: ProviderSessionStartInput; // threadId, cwd, modelSelection, providerOptions, resumeCursor
}): Promise<ChildSession>;
```

Rules the tests pin:

- **Final answer:** concatenate `content.delta` events with `streamKind: "assistant_text"` per
  `itemId`; the reply text is the text of the last `itemId` that received assistant text, trimmed.
  No assistant text at all → `status: "empty"`.
- **Failure isolation:** a child `sink.fail(error)` or a rejected `send` resolves `ask` with
  `status: "failed"` and the error message; it never throws to the caller. After a failure the
  session is closed and must be reopened.
- **Stop:** `stop()` calls the child's `interrupt()`; the pending `ask` resolves `status: "stopped"`.
- **Work capture:** every request the handler answers `accept` or `acceptForSession` is recorded:
  `file_change_approval` and `apply_patch_approval` → `files` (one line from
  `nativeApprovalDetail(args)`, first 200 chars); `command_execution_approval` and
  `exec_command_approval` → `commands`. For provider `codex`, additionally record
  `item.completed` events with `itemType` `file_change` (→ `files`) and `command_execution`
  (→ `commands`) using the event's `title` or `detail`, and skip the request-based record for
  Codex so nothing is counted twice.
- `start.runtimeMode` is always `"approval-required"`; for `codex` pass
  `sandboxMode: "workspace-write"`; pass no `sandboxMode` or `approvalPolicy` to other providers.

- [ ] **Step 1: Write the failing tests** with fake factories that script `sink` calls.

```ts
it("returns only the last assistant message", async () => {
  const child = await openChildSession(
    fake(async (sink) => {
      sink.emit({
        type: "content.delta",
        itemId: "a1",
        payload: { streamKind: "assistant_text", delta: "Let me look." },
      });
      sink.emit({ type: "item.started", itemId: "t1", payload: { itemType: "dynamic_tool_call" } });
      sink.emit({
        type: "content.delta",
        itemId: "r1",
        payload: { streamKind: "reasoning_text", delta: "hmm" },
      });
      sink.emit({
        type: "content.delta",
        itemId: "a2",
        payload: { streamKind: "assistant_text", delta: "The answer " },
      });
      sink.emit({
        type: "content.delta",
        itemId: "a2",
        payload: { streamKind: "assistant_text", delta: "is 4." },
      });
    }),
  );
  expect(await child.ask("2+2?", accept)).toEqual({
    status: "ok",
    text: "The answer is 4.",
    work: { files: [], commands: [] },
  });
});
it("reports an empty reply", async () => {
  const child = await openChildSession(fake(async () => {}));
  expect((await child.ask("go", accept)).status).toBe("empty");
});
it("turns a child failure into a failed reply", async () => {
  const child = await openChildSession(
    fake(async (sink) => sink.fail(new Error("Usage limit reached"))),
  );
  expect(await child.ask("go", accept)).toMatchObject({
    status: "failed",
    error: "Usage limit reached",
  });
});
it("records accepted edits and commands, not declined ones", async () => {
  const child = await openChildSession(
    fake(async (sink) => {
      await sink.request("file_change_approval", { tool: "Edit", input: { file_path: "a.ts" } });
      await sink.request("command_execution_approval", { tool: "Bash", input: { command: "ls" } });
      sink.emit({
        type: "content.delta",
        itemId: "a",
        payload: { streamKind: "assistant_text", delta: "done" },
      });
    }),
  );
  const reply = await child.ask("go", async (type) =>
    type === "file_change_approval" ? "accept" : "decline",
  );
  expect(reply.work.files).toHaveLength(1);
  expect(reply.work.commands).toEqual([]);
});
it("stop resolves the pending ask as stopped", async () => {
  const child = await openChildSession(
    fake(() => new Promise(() => {}), { interrupt: resolveSend }),
  );
  const pending = child.ask("go", accept);
  await child.stop();
  expect((await pending).status).toBe("stopped");
});
```

- [ ] **Step 2: Run to verify they fail.**
      Run: `bun run --cwd apps/server test src/harnesses/native/group/childSession.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** (`git commit -m "Add group child session with final-answer extraction"`).

### Task 6: Request policy and write lock

**Files:**

- Create: `apps/server/src/harnesses/native/group/groupPolicy.ts`
- Test: `apps/server/src/harnesses/native/group/groupPolicy.test.ts`

**Interfaces:**

- Produces:

```ts
export type RequestClass = "lookup" | "change" | "input";
export function classifyRequest(
  provider: GroupMemberProvider,
  type: CanonicalRequestType,
  args: unknown,
): RequestClass;
export interface WriteLock {
  acquire(memberId: string, signal?: AbortSignal): Promise<boolean>; // false = timed out or aborted
  release(memberId: string): void; // releases if held; also removes the member from the queue
  holder(): string | null;
}
export function createWriteLock(options?: { waitMs?: number }): WriteLock; // default 10 minutes
export const GROUP_INPUT_REFUSAL = "Ask your question in the group chat instead.";
export function decideRequest(input: {
  provider: GroupMemberProvider;
  memberId: string;
  proposeOnly: boolean;
  lock: WriteLock;
  type: CanonicalRequestType;
  args: unknown;
  signal?: AbortSignal;
  onWaiting?: (waiting: boolean) => void;
}): Promise<ProviderApprovalDecision | ProviderUserInputAnswers>;
```

Classification, pinned:

- `tool_user_input` → `input`.
- `file_read_approval` → `lookup`.
- `claudeAgent`: `args.tool` in `Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch` → `lookup`.
- ACP agents (`cursor`, `grok`, `kimi`, `iflow`, `qwen`, `codebuddy`, `gemini`):
  `args.toolCall.kind` in `read`, `search`, `fetch`, `think` → `lookup`.
- Everything else → `change`.

Decision, pinned: `input` → an answers object that maps every question id from
`nativeQuestions(args)` (`../requests`) to `GROUP_INPUT_REFUSAL`, or `"decline"` if the request
carries no questions. (A plain `"decline"` makes the Claude driver interrupt its whole turn, so
the member would never answer.) `lookup` → `"accept"`; `change` with `proposeOnly` →
`"decline"`; `change` otherwise → acquire the lock (calling `onWaiting(true)` then
`onWaiting(false)` if it had to wait) and answer `"accept"`, or `"decline"` if acquisition failed.
The lock is reentrant for its holder. Callers release it when the member's `ask` settles.

- [ ] **Step 1: Write the failing tests.**

```ts
it("classifies look-ups per agent", () => {
  expect(classifyRequest("claudeAgent", "command_execution_approval", { tool: "WebSearch" })).toBe(
    "lookup",
  );
  expect(classifyRequest("claudeAgent", "command_execution_approval", { tool: "Bash" })).toBe(
    "change",
  );
  expect(
    classifyRequest("qwen", "command_execution_approval", { toolCall: { kind: "fetch" } }),
  ).toBe("lookup");
  expect(
    classifyRequest("qwen", "command_execution_approval", { toolCall: { kind: "execute" } }),
  ).toBe("change");
  expect(classifyRequest("codex", "file_change_approval", {})).toBe("change");
  expect(classifyRequest("pi", "tool_user_input", {})).toBe("input");
});
it("answers a member's question with the refusal text instead of declining", async () => {
  const answer = await decideRequest({
    provider: "claudeAgent",
    memberId: "m1",
    proposeOnly: false,
    lock: createWriteLock(),
    type: "tool_user_input",
    args: { questions: [{ question: "Which file?", options: [] }] },
  });
  expect(answer).toEqual({ "Which file?": GROUP_INPUT_REFUSAL });
});
it("propose-only allows look-ups and refuses changes", async () => {
  const lock = createWriteLock();
  const base = { provider: "claudeAgent" as const, memberId: "m1", proposeOnly: true, lock };
  expect(
    await decideRequest({
      ...base,
      type: "command_execution_approval",
      args: { tool: "WebFetch" },
    }),
  ).toBe("accept");
  expect(
    await decideRequest({ ...base, type: "file_change_approval", args: { tool: "Edit" } }),
  ).toBe("decline");
  expect(lock.holder()).toBeNull();
});
it("a second writer waits until the first releases", async () => {
  const lock = createWriteLock();
  const change = { type: "file_change_approval" as const, args: {}, proposeOnly: false, lock };
  expect(await decideRequest({ ...change, provider: "codex", memberId: "m1" })).toBe("accept");
  let settled = false;
  const second = decideRequest({ ...change, provider: "claudeAgent", memberId: "m2" }).then(
    (decision) => {
      settled = true;
      return decision;
    },
  );
  await tick();
  expect(settled).toBe(false);
  lock.release("m1");
  expect(await second).toBe("accept");
  expect(lock.holder()).toBe("m2");
});
it("an aborted wait is declined and leaves no one queued", async () => {
  const lock = createWriteLock();
  await lock.acquire("m1");
  const controller = new AbortController();
  const waiting = decideRequest({
    provider: "codex",
    memberId: "m2",
    proposeOnly: false,
    lock,
    type: "file_change_approval",
    args: {},
    signal: controller.signal,
  });
  controller.abort();
  expect(await waiting).toBe("decline");
  lock.release("m1");
  expect(lock.holder()).toBeNull();
});
it("a wait that times out is declined", async () => {
  const lock = createWriteLock({ waitMs: 20 });
  await lock.acquire("m1");
  expect(
    await decideRequest({
      provider: "codex",
      memberId: "m2",
      proposeOnly: false,
      lock,
      type: "file_change_approval",
      args: {},
    }),
  ).toBe("decline");
});
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** (`git commit -m "Add group request policy and write lock"`).

### Task 7: Prompt builder

**Files:**

- Create: `apps/server/src/harnesses/native/group/groupPrompt.ts`
- Test: `apps/server/src/harnesses/native/group/groupPrompt.test.ts`

**Interfaces:**

- Produces:

```ts
export type PromptMember = {
  id: string;
  handle: string;
  providerName: string;
  role: string | null;
};
export type PromptLogEntry = { seq: number; authorLabel: string; text: string }; // "User" or a handle
export function buildMemberPrompt(input: {
  groupName: string;
  self: PromptMember;
  members: PromptMember[];
  skills: { name: string; description: string; path: string }[];
  briefing: boolean; // true on the first wake of a session
  missed: PromptLogEntry[]; // entries after the member's read cursor, oldest first, excluding the current message
  skipped: number; // how many older missed entries were dropped
  message: { fromLabel: string; text: string };
  proposeOnly: boolean;
  attachments: string[]; // absolute paths
  pastedSkills: { name: string; markdown: string }[];
}): string;
export function selectMissed(
  entries: PromptLogEntry[],
  limit: number,
): { missed: PromptLogEntry[]; skipped: number };
```

Content rules: the briefing names the group, lists every member as `@handle (provider, role)`,
marks which one is the reader, explains that writing `@handle` hands the conversation to that
member and that `@all` from an agent does nothing, says to answer in the language of the user's
message, and lists skills as `name: description (path)`. When `proposeOnly` is true the prompt
says files and commands are unavailable this round and to propose instead. Attachments are listed
as absolute paths under "Attached files". The exact wording is the builder's; the tests check
facts, not prose.

- [ ] **Step 1: Write the failing tests.**

```ts
it("keeps only the newest 40 missed messages and says how many were skipped", () => {
  const entries = Array.from({ length: 300 }, (_, i) => ({
    seq: i + 1,
    authorLabel: "User",
    text: `m${i + 1}`,
  }));
  const { missed, skipped } = selectMissed(entries, 40);
  expect(missed).toHaveLength(40);
  expect(missed[0]?.seq).toBe(261);
  expect(skipped).toBe(260);
  const prompt = buildMemberPrompt({ ...base, briefing: false, missed, skipped });
  expect(prompt).toContain("260");
  expect(prompt).not.toContain("m260\n");
  expect(prompt).toContain("m300");
});
it("briefs on first wake only", () => {
  const first = buildMemberPrompt({ ...base, briefing: true });
  expect(first).toContain("Launch");
  expect(first).toContain("@Codex");
  expect(first).toContain("release-notes: Writes release notes (/skills/release-notes/SKILL.md)");
  expect(buildMemberPrompt({ ...base, briefing: false })).not.toContain("release-notes");
});
it("always ends with the new message and its author", () => {
  const prompt = buildMemberPrompt({
    ...base,
    message: { fromLabel: "Claude", text: "@Codex please review" },
  });
  expect(prompt.trimEnd().endsWith("@Codex please review")).toBe(true);
  expect(prompt).toContain("Claude");
});
it("lists attachment paths and pasted skills", () => {
  const prompt = buildMemberPrompt({
    ...base,
    attachments: ["/tmp/a.png"],
    pastedSkills: [{ name: "x", markdown: "# X skill" }],
  });
  expect(prompt).toContain("/tmp/a.png");
  expect(prompt).toContain("# X skill");
});
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** (`git commit -m "Add group member prompt builder"`).

### Task 8: Round router

**Files:**

- Create: `apps/server/src/harnesses/native/group/groupRound.ts`
- Test: `apps/server/src/harnesses/native/group/groupRound.test.ts`

**Interfaces:**

- Consumes: `parseGroupMentions` (Task 1), `ChildSession`, `ChildReply` (Task 5),
  `createWriteLock`, `decideRequest` (Task 6), `buildMemberPrompt`, `selectMissed` (Task 7).
- Produces:

```ts
export interface GroupRuntime {
  loadGroup(threadId: string): Promise<Group | null>;
  appendLog(groupId: string, author: "user" | string, text: string): Promise<number>;
  logAfter(groupId: string, seq: number): Promise<{ seq: number; author: string; text: string }[]>;
  memberRuntime(memberId: string): Promise<{ nativeSessionId: string | null; readSeq: number }>;
  saveMemberRuntime(
    memberId: string,
    patch: { nativeSessionId?: string | null; readSeq?: number },
  ): Promise<void>;
  roundState(groupId: string): Promise<{ lastSpeakers: string[]; lastRoundAll: boolean }>;
  saveRoundState(
    groupId: string,
    state: { lastSpeakers: string[]; lastRoundAll: boolean },
  ): Promise<void>;
  takeResume(groupId: string): Promise<GroupHandoff[]>; // returns pending hand-offs and clears them if a resume was requested, else clears them and returns []
  savePause(groupId: string, handoffs: GroupHandoff[]): Promise<void>;
  recordReply(reply: GroupReply): Promise<void>;
  setMemberState(groupId: string, memberId: string, state: GroupMemberState): void;
  skills(): Promise<{ name: string; description: string; path: string }[]>;
}
export interface RoundHost {
  runtime: GroupRuntime;
  openChild(member: GroupMember, resume: string | null): Promise<ChildSession>; // cached per member by the driver
  dropChild(memberId: string): void;
  emitReply(memberId: string, replyId: string, text: string): void; // into the thread
  newId(): string;
}
export interface Round {
  post(
    text: string,
    extras?: { attachments?: string[]; pastedSkills?: { name: string; markdown: string }[] },
  ): void; // a further user message while running
  stopMember(memberId: string): Promise<void>;
  removeMember(memberId: string): Promise<void>;
  stopAll(): Promise<void>;
  done: Promise<void>;
}
export function startRound(
  host: RoundHost,
  group: Group,
  text: string,
  extras?: Parameters<Round["post"]>[1],
): Round;
```

Algorithm (not determined by the signatures, so stated here):

1. Append the user message to the log. Compute targets and the message's propose-only flag:
   - `takeResume` returned hand-offs → wake each `toMemberId` with its `text`; not propose-only.
   - else mentions contain `all` → every member; propose-only.
   - else mentions name members → those members; not propose-only.
   - else `lastSpeakers` non-empty → those members; propose-only = `lastRoundAll`.
   - else → every member; propose-only.

   Every wake carries the flag of the user message that caused it, and a hand-off inherits the
   flag of the reply that made it. `post` (a further user message during the round) runs this
   same step for the new text, so `@all` followed mid-round by `@Claude do it` lets Claude edit.

2. Each member has its own FIFO queue and runs one `ask` at a time; different members run
   concurrently. A wake for a busy member is queued for that member.
3. On wake: `setMemberState(working)`; open the child with the saved `nativeSessionId` (if opening
   with a resume id fails, open fresh, set `briefing` true and build `missed` from `logAfter(0)`);
   build the prompt from `logAfter(readSeq)` through `selectMissed(…, 40)`; `ask` with a handler
   that calls `decideRequest` (the wake's propose-only flag, one `WriteLock` per round,
   `onWaiting` → `setMemberState(waiting | working)`).
4. On settle: release the lock for that member; `setMemberState(idle | failed)`.
   - `ok`: `appendLog(memberId, text)`, `emitReply`, `recordReply(status ok, work)`, save
     `nativeSessionId` and `readSeq` = the reply's seq. Then parse the reply's mentions against the
     other members' handles (`all` and self are ignored). For each named member: if `hops` < the
     group's `hopLimit`, `hops += 1` and wake it with the reply as the message; otherwise add
     `{ fromMemberId, toMemberId, text }` to the pending hand-offs.
   - `empty`: `recordReply(status empty)`; `emitReply` with an empty-reply marker text `"…"`.
   - `failed`: `recordReply(status failed, error)`, `emitReply` with the error text, `dropChild`.
     Hand over only if no other member is working or queued and nobody else has replied in this
     round and this task has not already been handed over once: wake the next member after the
     failed one in list order (wrapping) with the same message, `hops += 1`.
   - `stopped`: nothing is emitted.
5. The round is done when no member is working or queued. Then `saveRoundState` (`lastSpeakers` =
   members that replied `ok` this round, in order, unchanged if nobody did; `lastRoundAll` = the
   flag of the round's last user message) and, if there are pending hand-offs, `savePause`.
6. `removeMember` stops that member, clears its queue and removes it from targets.

- [ ] **Step 1: Write the failing tests** with an in-memory `GroupRuntime` and scripted fake
      children (`reply("Codex", "text")`, `fail("Claude", "error")`, `hang("Claude")`).

```ts
it("@Name wakes one member; a no-@ follow-up goes to the last speaker", async () => {
  await round("@Claude are you there?").done;
  expect(asked()).toEqual(["Claude"]);
  await round("and now?").done;
  expect(asked()).toEqual(["Claude", "Claude"]);
});
it("the first message with no @ wakes everyone, propose-only", async () => {
  await round("hello").done;
  expect(new Set(asked())).toEqual(new Set(["Claude", "Codex", "Gemini"]));
  expect(proposeOnlyFlags()).toEqual([true, true, true]);
});
it("a follow-up to @all stays propose-only; naming two is not", async () => {
  await round("@all ideas?").done;
  await round("shorter").done;
  expect(proposeOnlyFlags().slice(3)).toEqual([true, true, true]);
  await round("@Claude @Codex fix it").done;
  expect(proposeOnlyFlags().slice(6)).toEqual([false, false]);
});
it("an agent's mention wakes that member and counts a hop", async () => {
  script("Claude", ["@Codex please review"]);
  script("Codex", ["Looks good."]);
  await round("@Claude write it").done;
  expect(asked()).toEqual(["Claude", "Codex"]);
  expect(runtime.pause).toEqual([]);
});
it("pauses after 6 hops and resumes on continue", async () => {
  pingPong("Claude", "Codex"); // each reply mentions the other
  await round("@Claude start").done;
  expect(asked()).toHaveLength(7); // 1 user wake + 6 hops
  expect(runtime.pause).toHaveLength(1);
  runtime.requestResume();
  await round("Continue").done;
  expect(asked()).toHaveLength(14);
});
it("an agent's own @all and self-mention wake nobody", async () => {
  script("Claude", ["@all and @Claude listen"]);
  await round("@Claude go").done;
  expect(asked()).toEqual(["Claude"]);
});
it("a new user message while paused drops the pending hand-offs", async () => {
  pingPong("Claude", "Codex");
  await round("@Claude start").done;
  await round("@Gemini something else").done;
  expect(asked().at(-1)).toBe("Gemini");
  expect(runtime.pause).toEqual([]);
});
it("hands a failed sole task to the next member once", async () => {
  fail("Claude", "Usage limit reached");
  script("Codex", ["Done instead."]);
  await round("@Claude do it").done;
  expect(asked()).toEqual(["Claude", "Codex"]);
  expect(runtime.replies.map((reply) => reply.status)).toEqual(["failed", "ok"]);
});
it("does not hand over inside an @all round", async () => {
  fail("Claude", "boom");
  await round("@all go").done;
  expect(asked().filter((name) => name === "Codex")).toHaveLength(1);
});
it("each member only receives what it has not seen", async () => {
  await round("@Claude one").done;
  await round("@Codex two").done;
  expect(lastPromptFor("Codex")).toContain("one");
  await round("@Codex three").done;
  expect(missedFor("Codex")).toEqual([]); // nothing new besides the message itself
});
it("a named message posted during an @all round is not propose-only", async () => {
  const gate = hangUntilReleased("Codex");
  const running = round("@all ideas?");
  running.post("@Claude do it");
  gate.release("idea");
  await running.done;
  expect(proposeOnlyFlagsFor("Claude")).toEqual([true, false]);
});
it("a hand-off inside an @all round stays propose-only", async () => {
  script("Claude", ["@Codex what do you think?"]);
  await round("@all ideas?").done;
  expect(proposeOnlyFlagsFor("Codex")).toEqual([true, true]);
});
it("removing a member mid-round stops it and lets the others finish", async () => {
  hang("Claude");
  script("Codex", ["ok"]);
  const running = round("@Claude @Codex go");
  await running.removeMember(idOf("Claude"));
  await running.done;
  expect(runtime.replies.map((reply) => reply.status)).toEqual(["ok"]);
});
it("a second message for a busy member waits for that member only", async () => {
  const gate = hangUntilReleased("Claude");
  script("Codex", ["ok"]);
  const running = round("@Claude long task");
  running.post("@Codex quick question");
  await until(() => asked().includes("Codex"));
  expect(stateOf("Claude")).toBe("working");
  gate.release("done");
  await running.done;
});
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** (`git commit -m "Add group round router"`).

### Task 9: Group driver and registration

**Files:**

- Create: `apps/server/src/harnesses/native/group/groupDriver.ts`
- Modify: `apps/server/src/harnesses/native/types.ts` (`NativeProvider` gains `"group"`),
  `profile.ts` (`case "group": return {}`), `layer.ts` (tag `NativeGroupAdapter`,
  `"djl/native/GroupAdapter"`), `adapter.ts`,
  `apps/server/src/provider/Layers/ProviderAdapterRegistry.ts`,
  `apps/server/src/groups/Layers/GroupService.ts` (implement `GroupRuntime`)
- Test: `apps/server/src/harnesses/native/group/groupDriver.test.ts`

**Interfaces:**

- Consumes: `startRound`, `GroupRuntime`, `RoundHost` (Task 8); `openChildSession` (Task 5);
  `GroupService.registerLive` (Task 4); `nativeProfileOptions` from `../profile`;
  `resolveAttachmentPath` from `apps/server/src/attachmentStore.ts`; `discoverSkillsCatalog` from
  `apps/server/src/provider/skillsCatalog.ts`.
- Produces:

```ts
export function createGroupDriverFactory(deps: {
  runtime: GroupRuntime;
  registerLive: (threadId: string, controls: GroupLiveControls) => () => void;
  childFactories: Record<GroupMemberProvider, NativeDriverFactory>;
  childOptions: (provider: GroupMemberProvider) => Promise<ProviderStartOptions>;
  resolveAttachment: (attachment: ChatAttachment) => string | null;
  readSkill: (path: string) => Promise<string>;
}): NativeDriverFactory;
```

Behaviour the tests pin:

- `send(turn)` loads the group for `turn.threadId`, starts a round and resolves when the round is
  done. `interrupt()` is `stopAll`. `close()` closes every child and unregisters live controls.
- On creation the driver calls `registerLive(threadId, controls)`: `stopMember` and `removeMember`
  go to the running round (and close that member's child when no round is running);
  `resetSessions` closes every child so the next wake reopens it in the new folder.
- `emitReply` emits `{ type: "content.delta", itemId, payload: { streamKind: "assistant_text", delta: text } }`
  and then `{ type: "item.completed", itemId, payload: { itemType: "assistant_message", status: "completed" } }`
  with `itemId = formatGroupItemId(memberId, replyId)`, always in that order.
- `models()` returns `{ models: [{ slug: "group", name: "Group" }], source: "group" }` and never
  opens a child; a factory call whose `threadId` has no group still returns a driver (model
  discovery calls the factory with a random thread id).
- Children are opened with the group's `folder` as `cwd`, the member's `model` (if set) as
  `{ provider, model }`, and `childOptions(provider)`.
- `skills()` on the runtime lists the catalog entries not named in `settings.skills.disabled`
  (the same filter `apps/server/src/provider/Layers/ProviderDiscoveryService.ts` applies).
- In `adapter.ts`, for provider `group` only, `sendTurn` accepts `attachments` and `skills`
  (still rejects `mentions` and `workTurnPolicy`); every other provider keeps the existing
  "text prompts only" check.

- [ ] **Step 1: Write the failing tests**, driving the real `makeNativeAdapter("group", factory)`
      with fake child factories, in the style of `apps/server/src/harnesses/native/adapter.test.ts`.

```ts
it("emits a delta before the completion for every member reply", async () => {
  const events = await runTurn("@all reply ok"); // two members
  const perItem = groupBy(
    events.filter((event) => event.itemId?.includes("gm.")),
    (event) => event.itemId,
  );
  expect(Object.keys(perItem)).toHaveLength(2);
  for (const list of Object.values(perItem))
    expect(list.map((event) => event.type)).toEqual(["content.delta", "item.completed"]);
});
it("completes the turn only when every member has finished", async () => {
  const gate = hangUntilReleased("Claude");
  const turn = startTurn("@all go");
  await until(() => repliesSoFar() === 1);
  expect(turnCompleted()).toBe(false);
  gate.release("late");
  await turn;
  expect(turnCompleted()).toBe(true);
});
it("a failing child does not fail the group turn", async () => {
  fail("Claude", "boom");
  const events = await runTurn("@Claude @Codex go");
  expect(events.at(-1)).toMatchObject({ type: "turn.completed", payload: { state: "completed" } });
});
it("lists a static model without opening children", async () => {
  const result = await Effect.runPromise(adapter.listModels({ cwd: "/tmp" }));
  expect(result.models).toEqual([{ slug: "group", name: "Group" }]);
  expect(childFactoryCalls).toBe(0);
});
it("passes attachment paths into the member prompt", async () => {
  await runTurn("@Claude look", { attachments: [imageAttachment] });
  expect(lastPromptFor("Claude")).toContain(resolvedPath);
});
it("other native providers still reject attachments", async () => {
  await expect(sendTurn(codexAdapter, { attachments: [imageAttachment] })).rejects.toThrow(
    "text prompts only",
  );
});
it("closing the driver closes every child", async () => {
  await runTurn("@all hi");
  await Effect.runPromise(adapter.stopSession(threadId));
  expect(closedChildren()).toEqual(new Set(["Claude", "Codex"]));
});
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement**, building the factory in `layer.ts` inside an `Effect.gen` that reads
      `ServerSettingsService`, `ServerConfig` and `GroupService`, the way `NativeDjlCloudAdapter`
      is built. Add `yield* NativeGroupAdapter` to the registry list.
- [ ] **Step 4: Run to verify they pass**; also run
      `bun run --cwd apps/server test src/harnesses/native/adapter.test.ts` (must still PASS).
- [ ] **Step 5: Verify by hand.** `bun run electron:dev`; in the app's dev console call
      `window.nativeApi.groups.create({ name: "T", members: [{ provider: "claudeAgent" }, { provider: "codex" }] })`
      (use whichever two agents are signed in), open the created thread in the normal chat view,
      send `@all reply only "ok"`. Expected: two assistant messages. Report what you saw.
- [ ] **Step 6: Commit** (`git commit -m "Add the group native driver"`).

### Task 10: Renderer data and chat rows

**Files:**

- Create: `apps/web/src/multiAgents/groupStore.ts`, `apps/web/src/multiAgents/groupChat.logic.ts`
- Test: `apps/web/src/multiAgents/groupChat.logic.test.ts`,
  `apps/web/src/multiAgents/groupStore.test.ts`

**Interfaces:**

- Consumes: `api.groups.*` and the `groups.subscribe` stream (Task 4); `parseGroupMessageId`
  (Task 1); thread messages from the existing store (`apps/web/src/store.ts`).
- Produces:
  - `useGroupStore`: `{ groups: Record<GroupId, Group>; replies: Record<string, GroupReply>; memberStates: Record<GroupMemberId, GroupMemberState>; applyEvent(event: GroupEvent): void }`
  - `type GroupChatRow = { kind: "user"; id; text; attachments } | { kind: "member"; id; memberId; handle; provider; role; text; status: "ok" | "empty" | "failed"; error: string | null; files: string[]; commands: string[] } | { kind: "unknown-member"; id; text }`
  - `deriveGroupChatRows(messages: readonly OrchestrationMessage[], group: Group, replies: Record<string, GroupReply>): GroupChatRow[]`
  - `workChipCounts(row): { files: number; commands: number } | null` (null when both are 0)
  - `shouldConfirmAll(group: Group, text: string): boolean` (true when the text mentions `@all`,
    the group has ≥ 4 members and `skipAllWarning` is false)
  - `isLargeGroup(group): boolean` (≥ 8 members)

- [ ] **Step 1: Write the failing tests.**

```ts
it("labels each reply with its member and keeps every reply visible", () => {
  const rows = deriveGroupChatRows(
    [
      user("u1", "@all hi"),
      assistant("assistant:t1:gm.m1.r1", "ok"),
      assistant("assistant:t1:gm.m2.r2", "ok"),
    ],
    group,
    {},
  );
  expect(rows.map((row) => row.kind)).toEqual(["user", "member", "member"]);
  expect(rows[1]).toMatchObject({ handle: "Claude", provider: "claudeAgent" });
  expect(rows[2]).toMatchObject({ handle: "Codex" });
});
it("marks failed and empty replies from the reply record", () => {
  const rows = deriveGroupChatRows(
    [assistant("assistant:t1:gm.m1.r1", "Usage limit reached")],
    group,
    {
      r1: {
        groupId: group.id,
        replyId: "r1",
        memberId: "m1",
        status: "failed",
        error: "Usage limit reached",
        files: [],
        commands: [],
      },
    },
  );
  expect(rows[0]).toMatchObject({ kind: "member", status: "failed", error: "Usage limit reached" });
});
it("keeps a reply from a removed member readable", () => {
  expect(
    deriveGroupChatRows([assistant("assistant:t1:gm.gone.r1", "old")], group, {})[0],
  ).toMatchObject({
    kind: "unknown-member",
    text: "old",
  });
});
it("shows the chip only when work happened", () => {
  expect(
    workChipCounts(memberRow({ files: ["a.ts", "b.ts", "c.ts"], commands: ["bun test", "ls"] })),
  ).toEqual({ files: 3, commands: 2 });
  expect(workChipCounts(memberRow({ files: [], commands: [] }))).toBeNull();
});
it("asks before @all from four members", () => {
  expect(shouldConfirmAll(groupOf(3), "@all go")).toBe(false);
  expect(shouldConfirmAll(groupOf(4), "@all go")).toBe(true);
  expect(shouldConfirmAll(groupOf(4), "@Claude go")).toBe(false);
  expect(shouldConfirmAll({ ...groupOf(4), skipAllWarning: true }, "@all go")).toBe(false);
});
it("applies events", () => {
  store.applyEvent({ type: "snapshot", groups: [group], replies: [] });
  store.applyEvent({ type: "member.state", groupId: group.id, memberId: "m1", state: "working" });
  expect(store.memberStates.m1).toBe("working");
  store.applyEvent({ type: "group.deleted", groupId: group.id, folder: "/x" });
  expect(store.groups[group.id]).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify they fail.**
      Run: `bun run --cwd apps/web test src/multiAgents/groupChat.logic.test.ts`.
- [ ] **Step 3: Implement.** Subscribe once at app start where the Servers subscription is started.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** (`git commit -m "Add group store and chat row derivation"`).

### Task 11: The Multi agents screen

**Files:**

- Create: `apps/web/src/routes/_chat.multi-agents.tsx`,
  `apps/web/src/multiAgents/MultiAgentsScreen.tsx`, `GroupList.tsx`, `GroupSetupDialog.tsx`,
  `GroupChatView.tsx`, `GroupMembersPanel.tsx`, `GroupMessageRow.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx` (rail item in the `DesktopShellChrome` `items`
  array, directly after the Studio entry; an `isOnMultiAgents` flag beside `isOnAutomations`; the
  home item's `active` test; the title; and the non-Electron navigation list that already has an
  Automations entry), `apps/web/src/components/DesktopShellChrome.tsx` (optional `badge?: string`
  on `DesktopRailItem`), `apps/web/src/components/Sidebar.logic.ts` (two new pure functions,
  below; call `excludeGroupThreads` on `sidebarThreads` and `sidebarDisplayThreads` in
  `Sidebar.tsx` before they reach `partitionSidebarThreadsByProjectIds`), the `thread/list`
  handler in `apps/remote-gateway/src/electron-app-server-adapter.js` (skip threads whose model
  selection provider is `group`), all seven `apps/web/src/i18n/locales/*.json`
- Test: `apps/web/src/components/Sidebar.logic.test.ts`,
  `apps/web/src/multiAgents/GroupSetupDialog.logic.test.ts`,
  `apps/remote-gateway/test/electron-app-server-adapter.test.js`,
  `apps/web/src/multiAgents/MultiAgentsScreen.browser.tsx`

**Interfaces:**

- Consumes: Task 10; `harnesses.listAccounts` (`HarnessAccount.status`) for readiness;
  `ChatMarkdown`, `ComposerPromptEditor`, `ProviderIcon`, attachment chips; the existing
  turn-dispatch helper in `apps/web/src/lib/composerSend.ts`.
- Produces: route `/multi-agents` with optional search `{ group?: GroupId }`; i18n keys under
  `shell.multiAgents.*`, including `title` ("Multi agents"), `beta` ("Beta"), `continue`
  ("Continue") and role names for the five presets.
- `Sidebar.logic.ts`:
  `collectGroupProjectIds(projects: readonly Pick<Project, "id" | "kind">[]): Set<ProjectId>` and
  `excludeGroupThreads<T extends Pick<SidebarThreadSummary, "projectId">>(threads: readonly T[], groupProjectIds: ReadonlySet<ProjectId>): T[]`
- `GroupSetupDialog.logic.ts`: `memberChoices(accounts: HarnessAccount[]): { provider; ready: boolean }[]`
  (every member kind is listed; `ready` is `status === "ready"`), and
  `canCreate(selected: GroupMemberProvider[]): boolean` (at least one ready member).

What the screen does:

- Layout: group list on the left with a `+` button; chat in the middle; a members button top right
  that opens `GroupMembersPanel`.
- No groups yet → `GroupSetupDialog` opens: step 1 pick agents (not-ready agents are greyed out
  with a **Set up** button that navigates to `/settings?section=accounts` and returns to
  `/multi-agents`), step 2 name the group (pre-filled from the picked agents' names). Create calls
  `api.groups.create`.
- `GroupChatView` renders `deriveGroupChatRows`; member rows show icon, handle and role; a member
  whose state is `working` or `waiting` shows a typing row; failed rows show a localized
  "could not answer" line with the error and **Set up** / **Try again** buttons; empty rows show a
  localized "finished without a reply" line. The composer sends a normal `thread.turn.start` on
  the group's thread. A paused group (`pendingHandoffs.length > 0`) shows the Continue / Stop
  card, wired to `api.groups.resolvePause`.
- `GroupMembersPanel`: add member (same choices as setup), remove, role (presets or free text),
  model override, hop limit, folder (with the plain warning from Risk 1 of the spec when the
  folder is not auto-created), and a large-group warning when `isLargeGroup`.

- [ ] **Step 1: Write the failing tests.**

```ts
// Sidebar.logic.test.ts
it("keeps group projects and threads out of the normal sidebar", () => {
  const projects = [
    { id: asProjectId("p1"), kind: "project" as const },
    { id: asProjectId("g1"), kind: "group" as const },
  ];
  const ids = collectGroupProjectIds(projects);
  expect([...ids]).toEqual([asProjectId("g1")]);
  const threads = [{ projectId: asProjectId("p1") }, { projectId: asProjectId("g1") }];
  expect(excludeGroupThreads(threads, ids)).toEqual([{ projectId: asProjectId("p1") }]);
});
// GroupSetupDialog.logic.test.ts
it("lists every member kind and marks readiness", () => {
  const choices = memberChoices([
    { id: "codex", installed: true, enabled: true, status: "ready" },
    { id: "qwen", installed: false, enabled: true, status: "missing" },
  ]);
  expect(choices).toHaveLength(10);
  expect(choices.find((choice) => choice.provider === "codex")?.ready).toBe(true);
  expect(choices.find((choice) => choice.provider === "qwen")?.ready).toBe(false);
  expect(choices.find((choice) => choice.provider === "gemini")?.ready).toBe(false);
});
it("needs at least one ready member", () => {
  expect(canCreate([])).toBe(false);
  expect(canCreate(["codex"])).toBe(true);
});
```

In `apps/remote-gateway/test/electron-app-server-adapter.test.js`, add a test beside the existing
`thread/list` test and with its fixtures: given one normal thread and one whose
`modelSelection.provider` is `"group"`, the `thread/list` response contains exactly the normal
thread's id.

Browser test `MultiAgentsScreen.browser.tsx`, in the style of the existing `*.browser.tsx` tests:
with a seeded group and two replies, the screen shows the group name, both member handles and the
Beta badge; with no groups it shows the setup dialog.

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** Confirm the rail icon file exists under
      `apps/web/public/central-icons-reversed` before choosing its name (look for a people or
      group icon). Add every string to all seven catalogs; note the `bun run i18n:check` count
      before and after.
- [ ] **Step 4: Run the checks.** The logic tests, `bun run --cwd apps/remote-gateway test`,
      `bun run ci:desktop:browser`, `bun run ci:desktop:typecheck`, `bun run ci:desktop:lint`.
      Expected: PASS; i18n count not higher than before.
- [ ] **Step 5: Verify by hand** in `bun run electron:dev`: open Multi agents, complete setup with
      two signed-in agents, send `@all reply only "ok"`, then `@<one handle> are you there?`, then
      a message with no `@`. Expected: two labelled replies; one reply; one reply from the same
      member. Report what you saw.
- [ ] **Step 6: Commit** (`git commit -m "Add the Multi agents screen"`).

### Task 12: Composer and reply features

**Files:**

- Create: `apps/web/src/multiAgents/GroupComposer.tsx`, `GroupMentionMenu.tsx`,
  `GroupReplyActions.tsx`, `groupComposer.logic.ts`
- Modify: `apps/web/src/multiAgents/GroupChatView.tsx`, `GroupMessageRow.tsx`, the seven catalogs
- Test: `apps/web/src/multiAgents/groupComposer.logic.test.ts`

**Interfaces:**

- Produces, in `groupComposer.logic.ts`:
  - `mentionMenuItems(group: Group, query: string): { handle: string; label: string; isAll: boolean }[]`
    (All first, then members whose handle starts with `query`, case-insensitive)
  - `askAgainText(row: MemberRow, answeredUserText: string): string` → `@<handle> <answeredUserText>`
  - `replyToText(row: MemberRow): string` → `@<handle>\n> <first 280 characters of row.text>\n\n`
  - `askAnotherText(row: MemberRow, target: GroupMember, lead: string): string` →
    `@<target.handle> <lead>\n> <first 280 characters of row.text>` where `lead` is the localized
    "Please check this answer from {{name}}."
  - `answeredUserText(rows: GroupChatRow[], rowId: string): string` (the nearest user row above)

- [ ] **Step 1: Write the failing tests.**

```ts
it("offers All first and filters by prefix", () => {
  expect(mentionMenuItems(group, "").map((item) => item.handle)).toEqual([
    "all",
    "Claude",
    "Claude2",
    "Codex",
  ]);
  expect(mentionMenuItems(group, "cl").map((item) => item.handle)).toEqual(["Claude", "Claude2"]);
});
it("builds the three reply actions", () => {
  expect(askAgainText(claudeRow, "what is 2+2?")).toBe("@Claude what is 2+2?");
  expect(replyToText({ ...claudeRow, text: "x".repeat(400) })).toBe(
    `@Claude\n> ${"x".repeat(280)}\n\n`,
  );
  expect(askAnotherText(claudeRow, codex, "Please check this answer from Claude.")).toBe(
    "@Codex Please check this answer from Claude.\n> It is 4.",
  );
});
it("finds the user message a reply answered", () => {
  expect(answeredUserText(rows, "reply-2")).toBe("second question");
});
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
  - `@` menu in the composer from `mentionMenuItems`; selecting inserts `@handle `.
  - Before sending, `shouldConfirmAll` → a one-tap confirmation "This will wake N agents" with a
    "do not ask again for this group" tick box that calls `api.groups.update({ skipAllWarning: true })`.
  - Attachments (images and files) with the existing attachment chips and the existing upload
    path the normal composer uses; skill attach with the existing skill picker data
    (`provider.listSkillsCatalog`), sent as `skills` on the turn.
  - Reply actions on member rows: Copy; Ask again (sends `askAgainText`); Reply to this (puts
    `replyToText` in the composer); Ask another agent (member picker, then sends `askAnotherText`).
  - Work chip under a reply from `workChipCounts`; clicking opens a popover listing `files` and
    `commands`.
  - Per-member Stop on the typing row (`api.groups.stopMember`); Stop all uses the thread's
    existing interrupt command.
- [ ] **Step 4: Run to verify they pass**, plus typecheck, lint and the i18n count.
- [ ] **Step 5: Verify by hand** in `electron:dev`, sending these three messages in order:
  1. `@<handle> create a file test.txt`: the file exists in the group folder and the chip reads
     "Changed 1 file".
  2. `@all create a file second.txt`: no file is created and each member proposes.
  3. `@all what is the latest version of Node.js?`: at least one member looks it up.

  Report what you saw, including any agent that edited in an `@all` round. That is Risk 1 of the
  spec and must be fixed before this task is done: for Claude pass the SDK's disallowed-tools
  option in propose-only rounds; for Codex run the turn under the read-only sandbox policy.

- [ ] **Step 6: Commit** (`git commit -m "Add group composer, reply actions and work chip"`).

### Task 13: Live mid-round routing

**Files:**

- Modify: `apps/server/src/harnesses/native/types.ts` (optional `steer?(input: ProviderSendTurnInput): Promise<void>` on `NativeDriver`, if not already present),
  `apps/server/src/harnesses/native/adapter.ts` (`steerTurn` when the driver has `steer`;
  `supportsTurnSteering` true for `group`),
  `apps/server/src/harnesses/native/group/groupDriver.ts` (`steer` → `round.post`),
  `apps/server/src/orchestration/decider.ts` and
  `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` (replace the Codex-only checks
  with one shared predicate), `packages/shared/src/groupChat.ts` or a new shared file for the
  predicate, `apps/web/src/multiAgents/GroupComposer.tsx`
- Test: create `apps/server/src/orchestration/decider.groupSteer.test.ts` (build its read model
  the way `decider.workTask.test.ts` does),
  `apps/server/src/harnesses/native/group/groupDriver.test.ts`

**Interfaces:**

- Produces: `providerSteersLiveTurn(provider: ProviderKind): boolean` (true for `codex` and
  `group`), used at the three Codex-only sites: `shouldQueue` in the decider, and `isCodexSteer`
  and the steer downgrade in the reactor.

- [ ] **Step 1: Write the failing tests.**

```ts
// decider: a steer on a running group thread is not queued and does not interrupt
const events = decide(turnStart({ threadId: runningGroupThread, dispatchMode: "steer" }));
expect(events.map((event) => event.type)).toEqual([
  "thread.message-sent",
  "thread.turn-start-requested",
]);
// decider: a steer on a running Qwen thread still queues and interrupts (unchanged)
expect(
  decide(turnStart({ threadId: runningQwenThread, dispatchMode: "steer" })).map(
    (event) => event.type,
  ),
).toEqual(["thread.message-sent", "thread.turn-queued", "thread.turn-interrupt-requested"]);
// groupDriver: steering a running round wakes an idle member at once
const gate = hangUntilReleased("Claude");
const turn = startTurn("@Claude long task");
await Effect.runPromise(adapter.steerTurn!({ threadId, input: "@Codex quick question" }));
await until(() => repliesSoFar() === 1);
expect(turnCompleted()).toBe(false);
gate.release("done");
await turn;
```

`decide` and `turnStart` stand for that file's own helpers around `decideOrchestrationCommand`.
The point is that the group steer produces no `thread.turn-queued` and no
`thread.turn-interrupt-requested`, and that every other provider is unchanged.

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** In `GroupComposer`, send `dispatchMode: "steer"` when the group
      thread's session is running, `"queue"` otherwise.
- [ ] **Step 4: Run to verify they pass**; run the existing decider and reactor test files in
      full (they must still PASS, proving Codex and the other providers are unchanged).
- [ ] **Step 5: Verify by hand** in `electron:dev`: give one member a long task, then `@` another
      member; the second answers while the first is still working.
- [ ] **Step 6: Commit** (`git commit -m "Route group messages live during a round"`).

### Task 14: End-to-end verification and documentation

**Files:**

- Create: `docs/multi-agents.md`
- Modify: `AGENTS.md` (add the document to "Where the documentation is"; add
  `apps/server/src/groups` and `apps/web/src/multiAgents` nowhere else)

- [ ] **Step 1: Run every check.** `bun run ci:desktop:format`, `ci:desktop:lint`,
      `ci:desktop:typecheck`, `ci:desktop:test`, `ci:desktop:browser`, `bun run brand:check`,
      `bun run public-source:check`, `bun run i18n:check` (count compared with `main`).
      Expected: all PASS.
- [ ] **Step 2: Walk the spec's eight verification steps** in `bun run electron:dev` with two
      signed-in agents (spec section "Verification", items 1 to 8), including: the Continue / Stop
      card is still there after ten minutes and after an app restart; changing the group folder
      keeps the conversation; ordinary one-agent chats send, queue and interrupt as before. Also
      check the two places that assume one reply per turn (spec Risk 5): the "task complete"
      notification after an `@all` round shows a sensible preview, and nothing in the group view
      depends on the turn's single diff summary.
- [ ] **Step 3: Write `docs/multi-agents.md`:** what the feature is, how routing works (`@Name`,
      `@all`, no `@`, hand-offs, the 6-hop pause), what agents may do in an `@all` round, that only
      Codex is confined to the group folder, where group folders live, and a dated "Verified"
      section listing exactly what you ran and saw in Step 2, including anything that failed or
      could not be tried. Do not write that something works unless you observed it.
- [ ] **Step 4: Commit** (`git commit -m "Document Multi agents"`).
