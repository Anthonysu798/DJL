import { assert, it } from "@effect/vitest";
import { ServerCommandId, ServerId, type ServerCommandRecord } from "@synara/contracts";
import { Effect, Layer } from "effect";

import { runMigrations } from "../Migrations.ts";
import { ServerCommandRepository } from "../Services/ServerCommandRepository.ts";
import { ServerCommandRepositoryLive } from "./ServerCommandRepository.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ServerCommandRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const serverId = ServerId.makeUnsafe("srv-1");

const record = (id: string, overrides: Partial<ServerCommandRecord> = {}): ServerCommandRecord => ({
  id: ServerCommandId.makeUnsafe(id),
  serverId,
  serverName: "hk-1",
  command: "uptime",
  tier: "approve-each",
  status: "pending",
  requestedAt: 1000,
  ...overrides,
});

layer("ServerCommandRepository", (it) => {
  it.effect("inserts, updates and lists newest first per server", () =>
    Effect.gen(function* () {
      const repository = yield* ServerCommandRepository;
      yield* runMigrations();
      yield* repository.insert(record("cmd-1", { requestedAt: 1000, threadId: "thread-a" }));
      yield* repository.insert(record("cmd-2", { requestedAt: 2000, status: "running" }));
      yield* repository.insert(
        record("cmd-other", { serverId: ServerId.makeUnsafe("srv-2"), requestedAt: 3000 }),
      );

      const listed = yield* repository.listByServer({ id: serverId });
      assert.deepStrictEqual(
        listed.map((row) => row.id),
        ["cmd-2", "cmd-1"],
      );
      assert.strictEqual(listed[1]?.threadId, "thread-a");
      assert.isUndefined(listed[0]?.threadId);

      yield* repository.update(
        record("cmd-2", {
          requestedAt: 2000,
          status: "succeeded",
          exitCode: 0,
          output: "ok\n",
          finishedAt: 2500,
        }),
      );
      const [updated] = yield* repository.listByServer({ id: serverId, limit: 1 });
      assert.strictEqual(updated?.status, "succeeded");
      assert.strictEqual(updated?.exitCode, 0);
      assert.strictEqual(updated?.output, "ok\n");
      assert.strictEqual(updated?.finishedAt, 2500);
    }),
  );

  it.effect("lists pending commands across servers oldest first", () =>
    Effect.gen(function* () {
      const repository = yield* ServerCommandRepository;
      yield* runMigrations();
      yield* repository.insert(record("pending-late", { requestedAt: 9000 }));
      yield* repository.insert(
        record("pending-early", { serverId: ServerId.makeUnsafe("srv-3"), requestedAt: 8000 }),
      );
      yield* repository.insert(record("refused", { requestedAt: 9500, status: "refused" }));
      const pending = yield* repository.listPending();
      const ids = pending.map((row) => String(row.id));
      assert.isTrue(ids.indexOf("pending-early") < ids.indexOf("pending-late"));
      assert.isFalse(ids.includes("refused"));
      assert.isTrue(pending.every((row) => row.status === "pending"));
    }),
  );

  it.effect("truncates stored output to 64 KiB", () =>
    Effect.gen(function* () {
      const repository = yield* ServerCommandRepository;
      yield* runMigrations();
      const huge = "x".repeat(70 * 1024);
      yield* repository.insert(
        record("cmd-big", { status: "succeeded", output: huge, requestedAt: 5 }),
      );
      const stored = (yield* repository.listByServer({ id: serverId, limit: 200 })).find(
        (candidate) => candidate.id === "cmd-big",
      );
      assert.strictEqual(stored?.output?.length, 64 * 1024);
    }),
  );
});
