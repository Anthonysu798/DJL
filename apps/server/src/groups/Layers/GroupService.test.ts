import * as NodeServices from "@effect/platform-node/NodeServices";
import type { GroupMemberId, OrchestrationCommand } from "@djl/contracts";
import { Effect, Fiber, Layer, Stream } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServerConfig } from "../../config";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine";
import { GroupRepositoryLive } from "../../persistence/Layers/GroupRepository.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { runMigrations } from "../../persistence/Migrations.ts";
import { GroupService } from "../Services/GroupService";
import { GroupDriverBridge, GroupDriverBridgeLive } from "../Services/GroupDriverBridge";
import { ServerSettingsService } from "../../serverSettings";
import { GroupServiceLive } from "./GroupService";

const isWindows = process.platform === "win32";
const dispatched: OrchestrationCommand[] = [];
const tempDirs: string[] = [];
// What the checkpoint reactor reports after a dispatched command, replayed to Undo.
let replayed: unknown[] = [];

afterEach(() => {
  dispatched.length = 0;
  replayed = [];
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const fakeEngine = {
  dispatch: (command: OrchestrationCommand) =>
    Effect.sync(() => {
      dispatched.push(command);
      return { sequence: dispatched.length };
    }),
  streamDomainEventsFrom: () => Stream.fromIterable(replayed),
} as unknown as typeof OrchestrationEngineService.Service;

const makeLayer = () =>
  GroupServiceLive.pipe(
    Layer.provideMerge(GroupRepositoryLive),
    Layer.provideMerge(Layer.succeed(OrchestrationEngineService, fakeEngine)),
    Layer.provideMerge(GroupDriverBridgeLive),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "djl-group-service-test-" })),
    Layer.provide(NodeServices.layer),
  );

const run = <A>(effect: Effect.Effect<A, unknown, GroupService | GroupDriverBridge>) =>
  Effect.gen(function* () {
    yield* runMigrations();
    return yield* effect;
  }).pipe(Effect.provide(makeLayer()), Effect.scoped, Effect.runPromise);

const threeMembers = {
  name: "Launch",
  members: [
    { provider: "claudeAgent" as const },
    { provider: "claudeAgent" as const, role: "reviewer" },
    { provider: "codex" as const },
  ],
};

describe.skipIf(isWindows)("GroupService", () => {
  it("creates a folder, a group project and a group thread", async () => {
    // The test state folder is removed when a run ends, so disk checks happen inside it.
    const { group, hasGit } = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const created = yield* service.create(threeMembers);
        return { group: created, hasGit: fs.existsSync(path.join(created.folder, ".git")) };
      }),
    );
    expect(group.hopLimit).toBe(6);
    expect(group.folderIsAuto).toBe(true);
    expect(hasGit).toBe(true);
    expect(group.members.map((member) => member.handle)).toEqual(["Claude", "Claude2", "Codex"]);
    expect(group.members[1]?.role).toBe("reviewer");
    expect(dispatched.map((command) => command.type)).toEqual(["project.create", "thread.create"]);
    expect(dispatched[0]).toMatchObject({ kind: "group", workspaceRoot: group.folder });
    expect(dispatched[1]).toMatchObject({
      threadId: group.threadId,
      title: "Launch",
      modelSelection: { provider: "group", model: "group" },
      runtimeMode: "approval-required",
    });
  });

  it("keeps the folder when a group is deleted", async () => {
    const { folderKept, remaining } = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const group = yield* service.create(threeMembers);
        const result = yield* service.delete({ groupId: group.id });
        return { folderKept: fs.existsSync(result.folder), remaining: yield* service.list() };
      }),
    );
    expect(folderKept).toBe(true);
    expect(remaining).toEqual([]);
    expect(dispatched.map((command) => command.type)).toEqual([
      "project.create",
      "thread.create",
      "thread.delete",
      "project.delete",
    ]);
  });

  it("changing the folder resets member sessions and moves the project", async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "djl-group-folder-"));
    tempDirs.push(other);
    const resetSessions = vi.fn(async () => {});
    const updated = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const group = yield* service.create(threeMembers);
        service.registerLive(group.threadId, {
          stopMember: async () => {},
          removeMember: async () => {},
          resetSessions,
          resetMember: async () => {},
          post: async () => false,
        });
        return yield* service.update({ groupId: group.id, folder: other });
      }),
    );
    expect(resetSessions).toHaveBeenCalledTimes(1);
    expect(updated).toMatchObject({ folder: other, folderIsAuto: false });
    expect(dispatched.at(-1)).toMatchObject({ type: "project.meta.update", workspaceRoot: other });
  });

  it("attaches a runtime the group driver can use to read and write the group", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const bridge = yield* GroupDriverBridge;
        const group = yield* service.create(threeMembers);
        const attached = bridge.current();
        if (!attached) throw new Error("bridge not attached");
        const { runtime } = attached;
        const loaded = yield* Effect.promise(() => runtime.loadGroup(group.threadId));
        const seq = yield* Effect.promise(() => runtime.appendLog(group.id, "user", "hello"));
        const after = yield* Effect.promise(() => runtime.logAfter(group.id, 0));
        const claude = group.members[0]!;
        yield* Effect.promise(() =>
          runtime.saveMemberRuntime(claude.id, { nativeSessionId: "s1", readSeq: seq }),
        );
        const memberRuntime = yield* Effect.promise(() => runtime.memberRuntime(claude.id));
        yield* Effect.promise(() =>
          runtime.recordReply({
            groupId: group.id,
            replyId: "r1",
            memberId: claude.id,
            status: "ok",
            error: null,
            files: [],
            commands: [],
          }),
        );
        const replies = yield* service.listReplies();
        return { loaded, seq, after, memberRuntime, replies, roots: attached.readRoots };
      }),
    );
    expect(outcome.loaded?.name).toBe("Launch");
    expect(outcome.seq).toBe(1);
    expect(outcome.after).toEqual([{ seq: 1, author: "user", text: "hello" }]);
    expect(outcome.memberRuntime).toEqual({ nativeSessionId: "s1", readSeq: 1, setupRevSeen: 0 });
    expect(outcome.replies.map((reply) => reply.replyId)).toEqual(["r1"]);
    expect(outcome.roots.length).toBeGreaterThan(0);
    // Attachments from other chats must not become readable: only a turn's own files are.
    expect(outcome.roots.some((root) => root.endsWith("attachments"))).toBe(false);
  });

  it("publishes drafts and keeps what each busy member has written until it settles", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const bridge = yield* GroupDriverBridge;
        const group = yield* service.create(threeMembers);
        const { runtime } = bridge.current()!;
        const [claude, , codex] = group.members;
        const events = yield* Stream.runCollect(Stream.take(service.streamEvents, 4)).pipe(
          Effect.forkChild,
        );
        yield* Effect.sleep("10 millis");
        runtime.setMemberState(group.id, claude!.id, "working");
        runtime.publishDraft(group.id, claude!.id, "Hel", true);
        runtime.publishDraft(group.id, claude!.id, "lo", false);
        runtime.setMemberState(group.id, codex!.id, "waiting");
        const writing = service.live();
        runtime.publishDraft(group.id, claude!.id, "Again", true);
        const restarted = service.live();
        runtime.publishDraft(group.id, claude!.id, "x".repeat(30_000), false);
        const capped = service.live().drafts[claude!.id]?.length;
        runtime.setMemberState(group.id, claude!.id, "idle");
        runtime.publishDraft(group.id, codex!.id, "Oops", true);
        runtime.setMemberState(group.id, codex!.id, "failed");
        const settled = service.live();
        yield* service.delete({ groupId: group.id });
        return {
          claude: claude!.id,
          codex: codex!.id,
          events: [...(yield* Fiber.join(events))],
          writing,
          restarted,
          capped,
          settled,
          deleted: service.live(),
        };
      }),
    );
    const { claude, codex } = outcome;
    expect(outcome.events.slice(1, 3)).toEqual([
      {
        type: "reply.draft",
        groupId: expect.any(String),
        memberId: claude,
        delta: "Hel",
        restart: true,
      },
      {
        type: "reply.draft",
        groupId: expect.any(String),
        memberId: claude,
        delta: "lo",
        restart: false,
      },
    ]);
    expect(outcome.writing).toEqual({
      memberStates: { [claude]: "working", [codex]: "waiting" },
      drafts: { [claude]: "Hello" },
      rounds: {},
      activities: {},
    });
    expect(outcome.restarted.drafts).toEqual({ [claude]: "Again" });
    expect(outcome.capped).toBe(24_000);
    expect(outcome.settled).toEqual({
      memberStates: { [codex]: "failed" },
      drafts: {},
      rounds: {},
      activities: {},
    });
    expect(outcome.deleted).toEqual({
      memberStates: {},
      drafts: {},
      rounds: {},
      activities: {},
    });
  });

  it("creates a group from a template: brief, lead and reviewer", async () => {
    const group = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        return yield* service.create({
          name: "Ship",
          brief: "Small commits.",
          members: [
            { provider: "claudeAgent", role: "planner", lead: true },
            { provider: "codex", role: "builder" },
            { provider: "claudeAgent", role: "reviewer", reviewer: true },
          ],
        });
      }),
    );
    expect(group.brief).toBe("Small commits.");
    expect(group.defaultRecipient).toBe(group.members[0]?.id);
    expect(group.reviewerMemberId).toBe(group.members[2]?.id);
    expect(group.members.every((member) => !member.muted && member.contextUsage === null)).toBe(
      true,
    );
  });

  it("bumps the brief revision only when the brief changes, and validates members", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const group = yield* service.create(threeMembers);
        const first = yield* service.update({ groupId: group.id, brief: "Be brief." });
        const same = yield* service.update({ groupId: group.id, brief: "  Be brief.  " });
        const lead = group.members[0]!.id;
        const routed = yield* service.update({
          groupId: group.id,
          defaultRecipient: lead,
          reviewerMemberId: group.members[1]!.id,
        });
        const unknown = yield* service
          .update({ groupId: group.id, reviewerMemberId: "nobody" as GroupMemberId })
          .pipe(Effect.flip);
        const everyone = yield* service.update({ groupId: group.id, defaultRecipient: "all" });
        return { first, same, routed, unknown, everyone, lead };
      }),
    );
    expect(outcome.first.setupRev).toBe(1);
    expect(outcome.same.setupRev).toBe(1);
    // Choosing a lead and a reviewer changes what members are told, in one revision.
    expect(outcome.routed.setupRev).toBe(2);
    expect(outcome.routed.defaultRecipient).toBe(outcome.lead);
    expect(outcome.routed.reviewerMemberId).toBe(outcome.routed.members[1]?.id);
    expect(outcome.unknown.message).toBe("Member not found");
    expect(outcome.everyone.defaultRecipient).toBe("all");
  });

  it("removing the lead or the reviewer turns that setting off", async () => {
    const group = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const created = yield* service.create(threeMembers);
        const [lead, reviewer] = created.members;
        yield* service.update({
          groupId: created.id,
          defaultRecipient: lead!.id,
          reviewerMemberId: reviewer!.id,
        });
        yield* service.removeMember({ groupId: created.id, memberId: lead!.id });
        return yield* service.removeMember({ groupId: created.id, memberId: reviewer!.id });
      }),
    );
    expect(group.defaultRecipient).toBe("last");
    expect(group.reviewerMemberId).toBeNull();
  });

  it("mutes a member, starts it fresh, and resets it when its model changes", async () => {
    const resetMember = vi.fn(async (_memberId: GroupMemberId) => {});
    const outcome = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const bridge = yield* GroupDriverBridge;
        const group = yield* service.create(threeMembers);
        service.registerLive(group.threadId, {
          stopMember: async () => {},
          removeMember: async () => {},
          resetSessions: async () => {},
          resetMember,
          post: async () => false,
        });
        const codex = group.members[2]!;
        const runtime = bridge.current()!.runtime;
        yield* Effect.promise(() =>
          runtime.saveMemberRuntime(codex.id, {
            nativeSessionId: "s1",
            contextUsage: { usedTokens: 900, maxTokens: 1000 },
          }),
        );
        const muted = yield* service.updateMember({
          groupId: group.id,
          memberId: codex.id,
          muted: true,
        });
        const withUsage = muted.members[2]!.contextUsage;
        const fresh = yield* service.resetMember({ groupId: group.id, memberId: codex.id });
        const after = yield* Effect.promise(() => runtime.memberRuntime(codex.id));
        yield* service.updateMember({ groupId: group.id, memberId: codex.id, model: "gpt-5" });
        return { muted, withUsage, fresh, after, codex };
      }),
    );
    expect(outcome.muted.members[2]?.muted).toBe(true);
    expect(outcome.muted.setupRev).toBe(1);
    expect(outcome.withUsage).toEqual({ usedTokens: 900, maxTokens: 1000 });
    expect(outcome.fresh.members[2]?.contextUsage).toBeNull();
    expect(outcome.after.nativeSessionId).toBeNull();
    expect(resetMember.mock.calls).toEqual([[outcome.codex.id], [outcome.codex.id]]);
  });

  it("undoes a round's files and tells the members once the files changed back", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const bridge = yield* GroupDriverBridge;
        const group = yield* service.create(threeMembers);
        replayed = [
          { type: "thread.turn-diff-completed", payload: { threadId: "other", files: [] } },
          {
            type: "thread.turn-diff-completed",
            payload: { threadId: group.threadId, checkpointTurnCount: 2, files: [] },
          },
        ];
        yield* service.undoRound({ groupId: group.id, turnCount: 2 });
        const log = yield* Effect.promise(() => bridge.current()!.runtime.logAfter(group.id, 0));
        return { group, log };
      }),
    );
    expect(dispatched.at(-1)).toMatchObject({
      type: "thread.checkpoint.revert",
      threadId: outcome.group.threadId,
      turnCount: 2,
      scope: "files",
    });
    expect(outcome.log).toHaveLength(1);
    expect(outcome.log[0]?.author).toBe("user");
    expect(outcome.log[0]?.text).toMatch(/undid the file changes/);
  });

  it("reports a failed undo and tells the members nothing", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const bridge = yield* GroupDriverBridge;
        const group = yield* service.create(threeMembers);
        replayed = [
          {
            type: "thread.activity-appended",
            payload: {
              threadId: group.threadId,
              activity: {
                kind: "checkpoint.revert.failed",
                payload: { detail: "Undo newer file changes before undoing this turn." },
              },
            },
          },
        ];
        const error = yield* service
          .undoRound({ groupId: group.id, turnCount: 1 })
          .pipe(Effect.flip);
        const log = yield* Effect.promise(() => bridge.current()!.runtime.logAfter(group.id, 0));
        return { error, log };
      }),
    );
    expect(outcome.error.message).toBe("Undo newer file changes before undoing this turn.");
    expect(outcome.log).toEqual([]);
  });

  it("a like toggles and is noted for the agent; other reactions post a message", async () => {
    const post = vi.fn(async (_text: string, _messageId: string) => true);
    const outcome = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const bridge = yield* GroupDriverBridge;
        const runtime = bridge.current()!.runtime;
        const group = yield* service.create(threeMembers);
        const claude = group.members[0]!;
        service.registerLive(group.threadId, {
          stopMember: async () => {},
          removeMember: async () => {},
          resetSessions: async () => {},
          resetMember: async () => {},
          post,
        });
        yield* Effect.promise(() =>
          runtime.recordReply({
            groupId: group.id,
            replyId: "r1",
            memberId: claude.id,
            status: "ok",
            error: null,
            files: [],
            commands: [],
          }),
        );
        yield* service.react({ groupId: group.id, replyId: "r1", kind: "like" });
        const liked = yield* service.listReactions();
        yield* service.react({ groupId: group.id, replyId: "r1", kind: "like" });
        const unliked = yield* service.listReactions();
        yield* service.react({
          groupId: group.id,
          replyId: "r1",
          kind: "dislike",
          message: "@Claude 👎 try again",
        });
        const messageId = post.mock.calls[0]![1];
        const cue = yield* Effect.promise(() => runtime.takeCue(messageId));
        const log = yield* Effect.promise(() => runtime.logAfter(group.id, 0));
        return { liked, unliked, messageId, cue, log, reactions: yield* service.listReactions() };
      }),
    );
    expect(outcome.liked.map((reaction) => reaction.kind)).toEqual(["like"]);
    expect(outcome.unliked).toEqual([]);
    expect(outcome.log.map((entry) => entry.text)).toEqual([
      "👍 (the user liked @Claude's answer)",
    ]);
    expect(post).toHaveBeenCalledWith("@Claude 👎 try again", expect.stringMatching(/^group-cue-/));
    expect(outcome.cue).toEqual({ kind: "reaction", targetId: "r1" });
    expect(outcome.reactions.map((reaction) => reaction.kind)).toEqual(["dislike"]);
  });

  it("with no round running, a posted message starts a turn the chat hides", async () => {
    await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const bridge = yield* GroupDriverBridge;
        const group = yield* service.create(threeMembers);
        yield* Effect.promise(() =>
          bridge.current()!.runtime.recordReply({
            groupId: group.id,
            replyId: "r1",
            memberId: group.members[0]!.id,
            status: "ok",
            error: null,
            files: [],
            commands: [],
          }),
        );
        yield* service.react({
          groupId: group.id,
          replyId: "r1",
          kind: "simpler",
          message: "@Claude 🤔 explain simpler",
        });
      }),
    );
    expect(dispatched.at(-1)).toMatchObject({
      type: "thread.turn.start",
      dispatchMode: "queue",
      message: { text: "@Claude 🤔 explain simpler" },
    });
    const command = dispatched.at(-1) as Extract<
      OrchestrationCommand,
      { type: "thread.turn.start" }
    >;
    expect(command.message.messageId).toMatch(/^group-cue-/);
  });

  it("plans a mission with the lead, starts it, skips a step and removes steps", async () => {
    const post = vi.fn(async (_text: string, _messageId: string) => true);
    const outcome = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const bridge = yield* GroupDriverBridge;
        const runtime = bridge.current()!.runtime;
        const group = yield* service.create(threeMembers);
        const [claude, claude2, codex] = group.members;
        yield* service.update({ groupId: group.id, defaultRecipient: codex!.id });
        service.registerLive(group.threadId, {
          stopMember: async () => {},
          removeMember: async () => {},
          resetSessions: async () => {},
          resetMember: async () => {},
          post,
        });
        const planned = yield* service.missionPlan({
          groupId: group.id,
          goal: "Ship it",
          message: "plan this mission: Ship it",
        });
        const planCue = yield* Effect.promise(() => runtime.takeCue(post.mock.calls[0]![1]));
        const ready = {
          ...planned,
          status: "ready" as const,
          steps: [
            { text: "a", memberId: claude!.id, status: "pending" as const },
            { text: "b", memberId: claude2!.id, status: "pending" as const },
            { text: "c", memberId: codex!.id, status: "pending" as const },
          ],
        };
        yield* Effect.promise(() => runtime.saveMission(ready));
        const trimmed = yield* service.missionRemoveStep({
          groupId: group.id,
          missionId: planned.id,
          index: 1,
        });
        const started = yield* service.missionStart({
          groupId: group.id,
          missionId: planned.id,
          message: "Start the mission",
        });
        const startCue = yield* Effect.promise(() => runtime.takeCue(post.mock.calls[1]![1]));
        yield* Effect.promise(() =>
          runtime.saveMission({
            ...started,
            status: "paused",
            steps: started.steps.map((step, index) =>
              index === 0 ? { ...step, status: "failed" as const } : step,
            ),
          }),
        );
        const skipped = yield* service.missionStart({
          groupId: group.id,
          missionId: planned.id,
          skipCurrent: true,
          message: "Skip",
        });
        const stopped = yield* service.missionStop({ groupId: group.id, missionId: planned.id });
        return { planned, planCue, trimmed, started, startCue, skipped, stopped, codex: codex! };
      }),
    );
    expect(outcome.planned.status).toBe("planning");
    expect(outcome.planned.plannerMemberId).toBe(outcome.codex.id);
    expect(post.mock.calls[0]![0]).toBe("@Codex plan this mission: Ship it");
    expect(outcome.planCue).toEqual({ kind: "missionPlan", missionId: outcome.planned.id });
    expect(outcome.trimmed.steps.map((step) => step.text)).toEqual(["a", "c"]);
    expect(outcome.started.status).toBe("running");
    expect(outcome.started.startedAt).not.toBeNull();
    expect(outcome.startCue).toEqual({ kind: "missionStart", missionId: outcome.planned.id });
    expect(outcome.skipped.steps.map((step) => step.status)).toEqual(["skipped", "pending"]);
    expect(outcome.skipped.currentStep).toBe(1);
    expect(outcome.stopped.status).toBe("stopped");
  });

  it("rejects a folder that does not exist", async () => {
    await expect(
      run(
        Effect.gen(function* () {
          const service = yield* GroupService;
          const group = yield* service.create(threeMembers);
          return yield* service.update({ groupId: group.id, folder: "/no/such/dir/djl" });
        }),
      ),
    ).rejects.toThrow();
  });

  it("invites guests, changes a role and removes one; a group update keeps them", async () => {
    const result = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const bridge = yield* GroupDriverBridge;
        const group = yield* service.create(threeMembers);
        const invited = yield* service.inviteGuest({
          groupId: group.id,
          name: "Alex",
          role: "chat",
        });
        const alex = invited.guests![0]!;
        const duplicate = yield* service
          .inviteGuest({ groupId: group.id, name: "alex", role: "viewer" })
          .pipe(Effect.flip);
        yield* service.inviteGuest({ groupId: group.id, name: "Sam", role: "viewer" });
        // Renaming the group rewrites its row; the guest list must survive that.
        const renamed = yield* service.update({ groupId: group.id, name: "Launch 2" });
        const sam = renamed.guests![1]!;
        const asChat = yield* Effect.promise(() =>
          bridge.current()!.runtime.guestOf(group.id, `group-guest-${alex.id}-m1`),
        );
        const asViewer = yield* Effect.promise(() =>
          bridge.current()!.runtime.guestOf(group.id, `group-guest-${sam.id}-m2`),
        );
        const asOwner = yield* Effect.promise(() =>
          bridge.current()!.runtime.guestOf(group.id, "plain-id"),
        );
        const promoted = yield* service.updateGuest({
          groupId: group.id,
          guestId: sam.id,
          role: "chat",
        });
        const removed = yield* service.removeGuest({ groupId: group.id, guestId: alex.id });
        const afterRemoval = yield* Effect.promise(() =>
          bridge.current()!.runtime.guestOf(group.id, `group-guest-${alex.id}-m3`),
        );
        return {
          alex,
          duplicate,
          renamed,
          asChat,
          asViewer,
          asOwner,
          promoted,
          removed,
          afterRemoval,
        };
      }),
    );
    expect(result.alex).toMatchObject({ name: "Alex", role: "chat" });
    expect(result.alex.id).toMatch(/^[a-z0-9]{16}$/);
    expect(String(result.duplicate)).toContain("already exists");
    expect(result.renamed.name).toBe("Launch 2");
    expect(result.renamed.guests?.map((guest) => guest.name)).toEqual(["Alex", "Sam"]);
    expect(result.asChat).toEqual({ name: "Alex" });
    expect(result.asViewer).toBeNull();
    expect(result.asOwner).toBeUndefined();
    expect(result.promoted.guests?.[1]).toMatchObject({ name: "Sam", role: "chat" });
    expect(result.removed.guests?.map((guest) => guest.name)).toEqual(["Sam"]);
    expect(result.afterRemoval).toBeNull();
  });

  it("a guest's agent joins as a visiting member, and leaves with the guest", async () => {
    const result = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const bridge = yield* GroupDriverBridge;
        const group = yield* service.create(threeMembers);
        const chat = (yield* service.inviteGuest({ groupId: group.id, name: "Sam", role: "chat" }))
          .guests![0]!;
        const bo = (yield* service.inviteGuest({
          groupId: group.id,
          name: "Bo Lee",
          role: "agent",
        })).guests![1]!;
        const join = { groupId: group.id, provider: "codex" as const, model: "gpt-x" };
        // Only a guest invited as an agent may bring one.
        const refused = yield* service
          .guestAgentJoin({ ...join, guestId: chat.id, sessionId: "s1" })
          .pipe(Effect.flip);
        const joined = yield* service.guestAgentJoin({ ...join, guestId: bo.id, sessionId: "s1" });
        // Saying "still here" changes nothing; a new model is shown.
        const again = yield* service.guestAgentJoin({ ...join, guestId: bo.id, sessionId: "s1" });
        const changed = yield* service.guestAgentJoin({
          ...join,
          model: "gpt-y",
          guestId: bo.id,
          sessionId: "s2",
        });
        const hub = bridge.current()!.guestAgents;
        const sent: unknown[] = [];
        hub.listen(bo.id, (event) => sent.push(event));
        const online = hub.session(bo.id);
        const live = service.live().guestAgents;
        const turn = hub.ask(bo.id, "hello");
        const removed = yield* service.removeGuest({ groupId: group.id, guestId: bo.id });
        const answer = yield* Effect.promise(() => turn.reply);
        const liveAfter = service.live().guestAgents;
        return {
          refused,
          joined,
          again,
          changed,
          online,
          live,
          liveAfter,
          sent,
          removed,
          answer,
          bo,
        };
      }),
    );
    expect(String(result.refused)).toContain("cannot bring an agent");
    const visiting = result.joined.members.at(-1)!;
    expect(visiting).toMatchObject({
      handle: "BoLee",
      provider: "codex",
      model: "gpt-x",
      guestId: result.bo.id,
    });
    expect(result.joined.members).toHaveLength(4);
    expect(result.joined.setupRev).toBeGreaterThan(0);
    expect(result.again.setupRev).toBe(result.joined.setupRev);
    expect(result.changed.members.at(-1)).toMatchObject({ id: visiting.id, model: "gpt-y" });
    expect(result.online).toBe("s2");
    expect(result.live).toEqual([result.bo.id]);
    expect(result.liveAfter).toBeUndefined();
    // The guest's computer was asked once, then told it was removed.
    expect(result.sent).toMatchObject([{ type: "turn" }, { type: "removed" }]);
    expect(result.removed.members.map((member) => member.handle)).not.toContain("BoLee");
    expect(result.removed.guests?.map((guest) => guest.name)).toEqual(["Sam"]);
    expect(result.answer.status).toBe("failed");
  });

  it("adds, updates and removes members with unique handles", async () => {
    const removeMember = vi.fn(async (_memberId: GroupMemberId) => {});
    const result = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const group = yield* service.create(threeMembers);
        service.registerLive(group.threadId, {
          stopMember: async () => {},
          removeMember,
          resetSessions: async () => {},
          resetMember: async () => {},
          post: async () => false,
        });
        const added = yield* service.addMember({ groupId: group.id, provider: "codex" });
        const codex2 = added.members.at(-1)!;
        const renamed = yield* service.updateMember({
          groupId: group.id,
          memberId: codex2.id,
          role: "builder",
          model: "gpt-5.5",
        });
        const removed = yield* service.removeMember({ groupId: group.id, memberId: codex2.id });
        return { codex2, renamed, removed };
      }),
    );
    expect(result.codex2.handle).toBe("Codex2");
    expect(result.renamed.members.at(-1)).toMatchObject({ role: "builder", model: "gpt-5.5" });
    expect(removeMember).toHaveBeenCalledWith(result.codex2.id);
    expect(result.removed.members).toHaveLength(3);
  });

  it("continue requests a resume and starts a turn with the given text; stop clears", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const service = yield* GroupService;
        const group = yield* service.create(threeMembers);
        const [claude, , codex] = group.members;
        yield* service.savePause(group.id, [
          { fromMemberId: claude!.id, toMemberId: codex!.id, text: "@Codex go" },
        ]);
        yield* service.resolvePause({
          groupId: group.id,
          action: "continue",
          continueText: "Continue",
        });
        const resumed = yield* service.takeResume(group.id);
        yield* service.savePause(group.id, [
          { fromMemberId: claude!.id, toMemberId: codex!.id, text: "@Codex go" },
        ]);
        yield* service.resolvePause({
          groupId: group.id,
          action: "stop",
          continueText: "Continue",
        });
        const afterStop = yield* service.takeResume(group.id);
        const groups = yield* service.list();
        return { resumed, afterStop, pending: groups[0]?.pendingHandoffs ?? [] };
      }),
    );
    expect(outcome.resumed).toHaveLength(1);
    expect(outcome.afterStop).toEqual([]);
    expect(outcome.pending).toEqual([]);
    const turnStarts = dispatched.filter((command) => command.type === "thread.turn.start");
    expect(turnStarts).toHaveLength(1);
    expect(turnStarts[0]).toMatchObject({ message: { text: "Continue" } });
  });
});
