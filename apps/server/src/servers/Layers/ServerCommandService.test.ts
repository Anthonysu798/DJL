import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerId, type ServerCreateInput, type ServerRecord } from "@synara/contracts";
import { Effect, Fiber, Layer, Stream } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ServerSecretStoreLive } from "../../auth/Layers/ServerSecretStore";
import { ServerSecretStore } from "../../auth/Services/ServerSecretStore";
import { ServerConfig } from "../../config";
import { runMigrations } from "../../persistence/Migrations.ts";
import { ServerCommandRepositoryLive } from "../../persistence/Layers/ServerCommandRepository.ts";
import { ServerRepositoryLive } from "../../persistence/Layers/ServerRepository.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ServerRepository } from "../../persistence/Services/ServerRepository.ts";
import { storeServerSecrets } from "../secrets";
import { SshRunner, type SshRunInput, type SshRunResult, type SshRunnerShape } from "../SshRunner";
import { ServerCommandService } from "../Services/ServerCommandService";
import { makeServerCommandServiceLayer } from "./ServerCommandService";

const KEY_LINE =
  "203.0.113.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBl9dS4A9c2tVw9hVHCnXH0d8Q+2wq3o0y2TjCJXk5vQ";
const isWindows = process.platform === "win32";

let fixtureDir: string;
let djlKnownHosts: string;
const runCalls: SshRunInput[] = [];
const okResult: SshRunResult = {
  outcome: "ok",
  stdout: "up 3 days\n",
  stderr: "",
  exitCode: 0,
  message: undefined,
  latencyMs: 12,
};
let scripted: SshRunResult = okResult;

beforeAll(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "djl-server-command-"));
  djlKnownHosts = path.join(fixtureDir, "known_hosts");
  fs.writeFileSync(djlKnownHosts, "");
  const keygen = path.join(fixtureDir, "fake-keygen");
  fs.writeFileSync(
    keygen,
    `#!/bin/sh\nmode=$1; pattern=$2; file=$4\ncase "$mode" in -F) grep "^$pattern " "$file" ;; esac\n`,
    { mode: 0o755 },
  );
  process.env.DJL_SSH_KEYGEN_COMMAND = keygen;
});

afterAll(() => {
  delete process.env.DJL_SSH_KEYGEN_COMMAND;
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

afterEach(() => {
  runCalls.length = 0;
  scripted = okResult;
  fs.writeFileSync(djlKnownHosts, "");
});

const stubRunner = (): SshRunnerShape => ({
  run: (input) => {
    runCalls.push(input);
    return Effect.succeed(scripted);
  },
  capabilities: () => Effect.succeed({ sshPath: "ssh", sshVersion: "9.9", askpassSupported: true }),
  knownHostsFiles: [djlKnownHosts],
  djlKnownHostsPath: djlKnownHosts,
  sshCommand: "ssh",
});

const makeLayer = (approvalTimeoutMs?: number) =>
  makeServerCommandServiceLayer(approvalTimeoutMs ? { approvalTimeoutMs } : {}).pipe(
    Layer.provideMerge(ServerCommandRepositoryLive),
    Layer.provideMerge(ServerRepositoryLive),
    Layer.provideMerge(Layer.succeed(SshRunner, stubRunner())),
    Layer.provideMerge(ServerSecretStoreLive),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "djl-server-command-test-" })),
    Layer.provide(NodeServices.layer),
  );

type Services = ServerCommandService | ServerRepository | ServerSecretStore;

const run = <A>(effect: Effect.Effect<A, unknown, Services>, approvalTimeoutMs?: number) =>
  Effect.gen(function* () {
    yield* runMigrations();
    return yield* effect;
  }).pipe(Effect.provide(makeLayer(approvalTimeoutMs)), Effect.scoped, Effect.runPromise);

const baseInput = {
  name: "hk-1",
  host: "203.0.113.10",
  port: 22,
  username: "root",
  auth: { type: "password" },
  tags: [],
  permissionTier: "read-only",
  notes: "",
  source: "manual",
} satisfies ServerCreateInput;

let counter = 0;

/** Polls until the forked request has queued its record; a fixed sleep flakes under load. */
const awaitPending = Effect.gen(function* () {
  const service = yield* ServerCommandService;
  for (let attempt = 0; attempt < 200; attempt++) {
    const pending = yield* service.listPending();
    if (pending.length > 0) return pending;
    yield* Effect.sleep(10);
  }
  throw new Error("No pending command appeared.");
});

const addServer = (
  overrides: Partial<ServerCreateInput>,
  options: { trusted?: boolean; password?: string } = {},
) =>
  Effect.gen(function* () {
    const repository = yield* ServerRepository;
    const store = yield* ServerSecretStore;
    const record: ServerRecord = yield* repository.create({
      id: ServerId.makeUnsafe(`srv-${++counter}`),
      input: { ...baseInput, ...overrides },
      now: Date.now(),
    });
    if (options.password) {
      yield* storeServerSecrets(store, record.id, { password: options.password });
    }
    if (options.trusted !== false) fs.writeFileSync(djlKnownHosts, `${KEY_LINE}\n`);
    return record;
  });

describe.skipIf(isWindows)("ServerCommandService", () => {
  it("refuses an unknown server with exit 125 and does not run ssh", async () => {
    await run(
      Effect.gen(function* () {
        const service = yield* ServerCommandService;
        const result = yield* service.requestCommand({ serverName: "nope", command: "uptime" });
        expect(result.status).toBe("refused");
        expect(result.exitCode).toBe(125);
        expect(result.reason).toContain("No registered server named");
        expect(result.reason).toContain("nope");
        expect(runCalls).toHaveLength(0);
      }),
    );
  });

  it("refuses a server whose host key is not trusted yet", async () => {
    await run(
      Effect.gen(function* () {
        const service = yield* ServerCommandService;
        const server = yield* addServer({ permissionTier: "full" }, { trusted: false });
        const result = yield* service.requestCommand({
          serverName: server.name,
          command: "uptime",
        });
        expect(result.status).toBe("refused");
        expect(result.exitCode).toBe(125);
        expect(result.reason).toContain("Test the connection in Settings");
        expect(runCalls).toHaveLength(0);
        const { commands } = yield* service.listByServer({ id: server.id });
        expect(commands.map((command) => command.status)).toEqual(["refused"]);
      }),
    );
  });

  it("matches the server name case-insensitively and runs read-only commands", async () => {
    await run(
      Effect.gen(function* () {
        const service = yield* ServerCommandService;
        const server = yield* addServer({ name: "Prod-Web" }, { password: "hunter2" });
        const result = yield* service.requestCommand({
          serverName: "prod-web",
          threadId: "thread-1",
          command: "uptime",
        });
        expect(result.status).toBe("succeeded");
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("up 3 days\n");
        expect(result.threadId).toBe("thread-1");
        expect(result.serverId).toBe(server.id);
        expect(runCalls).toHaveLength(1);
        expect(runCalls[0]?.secret).toBe("hunter2");
        expect(runCalls[0]?.timeoutMs).toBe(300_000);
      }),
    );
  });

  it("refuses write-shaped commands on a read-only server with exit 126", async () => {
    await run(
      Effect.gen(function* () {
        const service = yield* ServerCommandService;
        const server = yield* addServer({});
        const result = yield* service.requestCommand({
          serverName: server.name,
          command: "rm -rf /tmp/x",
        });
        expect(result.status).toBe("refused");
        expect(result.exitCode).toBe(126);
        expect(result.reason).toMatch(/read-only/i);
        expect(runCalls).toHaveLength(0);
      }),
    );
  });

  it("queues approve-each commands, streams pending then updated, and runs on approval", async () => {
    await run(
      Effect.gen(function* () {
        const service = yield* ServerCommandService;
        const server = yield* addServer({ permissionTier: "approve-each" });
        const eventsFiber = yield* Stream.runCollect(Stream.take(service.streamEvents, 2)).pipe(
          Effect.forkChild,
        );
        yield* Effect.sleep(10);
        const requestFiber = yield* service
          .requestCommand({ serverName: server.name, command: "systemctl restart nginx" })
          .pipe(Effect.forkChild);

        const pending = yield* awaitPending;
        expect(pending).toHaveLength(1);
        expect(pending[0]?.status).toBe("pending");
        expect(runCalls).toHaveLength(0);

        const resolved = yield* service.resolve({ id: pending[0]!.id, decision: "approve" });
        expect(resolved.status).toBe("running");

        const result = yield* Fiber.join(requestFiber);
        expect(result.status).toBe("succeeded");
        expect(result.exitCode).toBe(0);
        expect(runCalls[0]?.command).toBe("systemctl restart nginx");

        const events = [...(yield* Fiber.join(eventsFiber))];
        expect(events.map((event) => event.type)).toEqual(["command-updated", "command-updated"]);
        expect(
          events.map((event) => (event.type === "command-updated" ? event.command.status : "")),
        ).toEqual(["pending", "running"]);
        expect(yield* service.listPending()).toEqual([]);
      }),
    );
  });

  it("returns exit 125 when a queued command is denied", async () => {
    await run(
      Effect.gen(function* () {
        const service = yield* ServerCommandService;
        const server = yield* addServer({ permissionTier: "approve-each" });
        const requestFiber = yield* service
          .requestCommand({ serverName: server.name, command: "uptime" })
          .pipe(Effect.forkChild);
        const [pending] = yield* awaitPending;
        const denied = yield* service.resolve({ id: pending!.id, decision: "deny" });
        expect(denied.status).toBe("denied");
        const result = yield* Fiber.join(requestFiber);
        expect(result.status).toBe("denied");
        expect(result.exitCode).toBe(125);
        expect(runCalls).toHaveLength(0);
        const missing = yield* service
          .resolve({ id: pending!.id, decision: "approve" })
          .pipe(Effect.flip);
        expect(missing._tag).toBe("ServerCommandNotPendingError");
      }),
    );
  });

  it("times out a queued command that nobody resolves", async () => {
    await run(
      Effect.gen(function* () {
        const service = yield* ServerCommandService;
        const server = yield* addServer({ permissionTier: "approve-each" });
        const result = yield* service.requestCommand({ serverName: server.name, command: "id" });
        expect(result.status).toBe("timed-out");
        expect(result.exitCode).toBe(124);
        expect(runCalls).toHaveLength(0);
      }),
      50,
    );
  });

  it("runs immediately on a full-access server and records failures with ssh stderr", async () => {
    await run(
      Effect.gen(function* () {
        const service = yield* ServerCommandService;
        const server = yield* addServer({ permissionTier: "full" });
        scripted = {
          outcome: "error",
          stdout: "partial\n",
          stderr: "bash: nope: command not found\n",
          exitCode: 127,
          message: "bash: nope: command not found",
          latencyMs: 3,
        };
        const result = yield* service.requestCommand({
          serverName: server.name,
          command: "nope --now",
        });
        expect(result.status).toBe("failed");
        expect(result.exitCode).toBe(127);
        expect(result.stdout).toBe("partial\nbash: nope: command not found\n");
        expect(runCalls).toHaveLength(1);
        const { commands } = yield* service.listByServer({ id: server.id });
        expect(commands[0]?.output).toBe("partial\nbash: nope: command not found\n");
        expect(commands[0]?.finishedAt).toBeTypeOf("number");
      }),
    );
  });
});
