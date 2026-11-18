import * as NodeServices from "@effect/platform-node/NodeServices";
import type { GroupMemberId, OrchestrationCommand } from "@synara/contracts";
import { Effect, Layer } from "effect";
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

afterEach(() => {
  dispatched.length = 0;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const fakeEngine = {
  dispatch: (command: OrchestrationCommand) =>
    Effect.sync(() => {
      dispatched.push(command);
      return { sequence: dispatched.length };
    }),
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
    expect(outcome.memberRuntime).toEqual({ nativeSessionId: "s1", readSeq: 1 });
    expect(outcome.replies.map((reply) => reply.replyId)).toEqual(["r1"]);
    expect(outcome.roots.length).toBeGreaterThan(0);
    // Attachments from other chats must not become readable: only a turn's own files are.
    expect(outcome.roots.some((root) => root.endsWith("attachments"))).toBe(false);
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
