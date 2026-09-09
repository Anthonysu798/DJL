import { assert, it } from "@effect/vitest";
import { ServerId, type ServerCreateInput } from "@synara/contracts";
import { Effect, Layer, Option } from "effect";

import { runMigrations } from "../Migrations.ts";
import { ServerRepository } from "../Services/ServerRepository.ts";
import { ServerRepositoryLive } from "./ServerRepository.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(ServerRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

const createInput = {
  name: "hk-1",
  host: "203.0.113.10",
  port: 22,
  username: "root",
  auth: { type: "keyPath", path: "~/.ssh/id_ed25519", hasPassphrase: false },
  tags: ["prod", "hk"],
  permissionTier: "read-only",
  notes: "",
  source: "manual",
} satisfies ServerCreateInput;

/** The layer shares one in-memory database across tests, so list-order tests start empty. */
const clearServers = Effect.gen(function* () {
  const repository = yield* ServerRepository;
  const existing = yield* repository.list();
  yield* Effect.forEach(existing, (server) => repository.remove(server.id));
});

layer("ServerRepository", (it) => {
  it.effect("creates, lists, updates and removes servers", () =>
    Effect.gen(function* () {
      const repository = yield* ServerRepository;
      yield* runMigrations();
      yield* clearServers;
      const created = yield* repository.create({
        id: ServerId.makeUnsafe("srv-1"),
        input: createInput,
        now: 1000,
      });
      assert.strictEqual(created.port, 22);
      assert.deepStrictEqual(created.tags, ["hk", "prod"]);
      assert.strictEqual(created.createdAt, 1000);

      const listed = yield* repository.list();
      assert.strictEqual(listed.length, 1);

      const saved = yield* repository.save({
        ...created,
        name: "hk-primary",
        lastTest: { at: 2000, outcome: "ok", latencyMs: 120 },
        lastStats: { collectedAt: 2000, uptimeSeconds: 86400 },
        updatedAt: 2000,
      });
      const fetched = yield* repository.getById(created.id);
      assert.isTrue(Option.isSome(fetched));
      if (Option.isSome(fetched)) {
        assert.strictEqual(fetched.value.name, "hk-primary");
        assert.deepStrictEqual(fetched.value.lastTest, saved.lastTest);
        assert.strictEqual(fetched.value.lastStats?.uptimeSeconds, 86400);
      }

      yield* repository.remove(created.id);
      assert.isTrue(Option.isNone(yield* repository.getById(created.id)));
    }),
  );

  it.effect("never stores the secret input", () =>
    Effect.gen(function* () {
      const repository = yield* ServerRepository;
      yield* runMigrations();
      const created = yield* repository.create({
        id: ServerId.makeUnsafe("srv-2"),
        input: { ...createInput, auth: { type: "password" }, secret: { password: "hunter2" } },
        now: 1,
      });
      assert.isFalse("secret" in created);
      assert.isFalse(JSON.stringify(created).includes("hunter2"));
    }),
  );

  it.effect("lists servers ordered by name", () =>
    Effect.gen(function* () {
      const repository = yield* ServerRepository;
      yield* runMigrations();
      yield* clearServers;
      yield* repository.create({
        id: ServerId.makeUnsafe("b"),
        input: { ...createInput, name: "beta" },
        now: 1,
      });
      yield* repository.create({
        id: ServerId.makeUnsafe("a"),
        input: { ...createInput, name: "alpha" },
        now: 2,
      });
      const names = (yield* repository.list()).map((server) => server.name);
      assert.deepStrictEqual(names, ["alpha", "beta"]);
    }),
  );
});
