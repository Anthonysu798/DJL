import { assert, it } from "@effect/vitest";
import {
  GroupId,
  GroupMemberId,
  ProjectId,
  ThreadId,
  type Group,
  type GroupMember,
} from "@djl/contracts";
import { Effect, Layer } from "effect";

import { runMigrations } from "../Migrations.ts";
import { GroupRepository } from "../Services/GroupRepository.ts";
import { GroupRepositoryLive } from "./GroupRepository.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(GroupRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

const g1 = GroupId.makeUnsafe("g1");
const g2 = GroupId.makeUnsafe("g2");
const m1 = GroupMemberId.makeUnsafe("m1");
const m2 = GroupMemberId.makeUnsafe("m2");

const group = (id: GroupId, overrides: Partial<Group> = {}): Omit<Group, "members"> => ({
  id,
  threadId: ThreadId.makeUnsafe(`thread-${id}`),
  projectId: ProjectId.makeUnsafe(`project-${id}`),
  name: "Launch",
  folder: `/tmp/groups/${id}`,
  folderIsAuto: true,
  hopLimit: 6,
  skipAllWarning: false,
  pendingHandoffs: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const member = (id: GroupMemberId, position: number, groupId = g1): GroupMember => ({
  id,
  groupId,
  provider: position === 0 ? "claudeAgent" : "codex",
  handle: position === 0 ? "Claude" : "Codex",
  role: null,
  model: null,
  position,
});

layer("GroupRepository", (it) => {
  it.effect("stores a group with its members in position order", () =>
    Effect.gen(function* () {
      const repo = yield* GroupRepository;
      yield* runMigrations();
      yield* repo.upsertGroup(group(g1));
      yield* repo.upsertMember(member(m2, 1));
      yield* repo.upsertMember(member(m1, 0));
      const stored = yield* repo.getById(g1);
      assert.deepStrictEqual(
        stored?.members.map((entry) => entry.handle),
        ["Claude", "Codex"],
      );
      assert.strictEqual((yield* repo.getByThreadId(ThreadId.makeUnsafe("thread-g1")))?.id, g1);
      assert.strictEqual((yield* repo.listGroups()).length, 1);
    }),
  );

  it.effect("numbers the log from 1 per group and reads after a cursor", () =>
    Effect.gen(function* () {
      const repo = yield* GroupRepository;
      yield* repo.upsertGroup(group(g2));
      assert.strictEqual(yield* repo.appendLog(g1, "user", "hi"), 1);
      assert.strictEqual(yield* repo.appendLog(g1, m1, "hello"), 2);
      assert.strictEqual(yield* repo.appendLog(g2, "user", "other"), 1);
      assert.deepStrictEqual(yield* repo.logAfter(g1, 1), [{ seq: 2, author: m1, text: "hello" }]);
      assert.strictEqual((yield* repo.logTail(g1, 1))[0]?.seq, 2);
    }),
  );

  it.effect("resets sessions but keeps read cursors", () =>
    Effect.gen(function* () {
      const repo = yield* GroupRepository;
      yield* repo.saveMemberRuntime(m1, { nativeSessionId: "s1", readSeq: 5 });
      assert.deepStrictEqual(yield* repo.getMemberRuntime(m1), {
        nativeSessionId: "s1",
        readSeq: 5,
      });
      yield* repo.resetMemberSessions(g1);
      assert.deepStrictEqual(yield* repo.getMemberRuntime(m1), {
        nativeSessionId: null,
        readSeq: 5,
      });
    }),
  );

  it.effect("keeps round state, pauses and replies", () =>
    Effect.gen(function* () {
      const repo = yield* GroupRepository;
      yield* repo.setRoundState(g1, { lastSpeakers: [m1], lastRoundAll: true });
      assert.deepStrictEqual(yield* repo.getRoundState(g1), {
        lastSpeakers: [m1],
        lastRoundAll: true,
      });
      yield* repo.setPause(g1, [{ fromMemberId: m1, toMemberId: m2, text: "@Codex go" }], true);
      const paused = yield* repo.getById(g1);
      assert.strictEqual(paused?.pendingHandoffs.length, 1);
      assert.strictEqual(yield* repo.isResumeRequested(g1), true);
      yield* repo.recordReply({
        groupId: g1,
        replyId: "r1",
        memberId: m1,
        status: "ok",
        error: null,
        files: ["a.ts"],
        commands: [],
      });
      assert.deepStrictEqual(
        (yield* repo.listReplies(g1)).map((reply) => reply.files),
        [["a.ts"]],
      );
    }),
  );

  it.effect("deletes a member, then a group with its members, log and replies", () =>
    Effect.gen(function* () {
      const repo = yield* GroupRepository;
      yield* repo.deleteMember(m2);
      assert.strictEqual((yield* repo.getById(g1))?.members.length, 1);
      yield* repo.deleteGroup(g1);
      assert.strictEqual(yield* repo.getById(g1), null);
      assert.deepStrictEqual(yield* repo.logTail(g1, 10), []);
      assert.deepStrictEqual(yield* repo.listReplies(g1), []);
      assert.strictEqual((yield* repo.listGroups()).length, 1);
    }),
  );
});
