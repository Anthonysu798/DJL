import * as NodeServices from "@effect/platform-node/NodeServices";
import type { ServerCreateInput, ServerRecord } from "@synara/contracts";
import { Effect, Layer } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ServerSecretStoreLive } from "../../auth/Layers/ServerSecretStore";
import { ServerSecretStore } from "../../auth/Services/ServerSecretStore";
import { ServerConfig } from "../../config";
import { runMigrations } from "../../persistence/Migrations.ts";
import { ServerRepositoryLive } from "../../persistence/Layers/ServerRepository.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { readServerSecret } from "../secrets";
import { SshRunner, type SshRunInput, type SshRunResult, type SshRunnerShape } from "../SshRunner";
import { ServerService } from "../Services/ServerService";
import { ServerServiceLive, makeServerServiceLayer } from "./ServerService";

const KEY_LINE =
  "203.0.113.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBl9dS4A9c2tVw9hVHCnXH0d8Q+2wq3o0y2TjCJXk5vQ";
const isWindows = process.platform === "win32";

let fixtureDir: string;
let djlKnownHosts: string;
const runCalls: SshRunInput[] = [];
let scripted: SshRunResult = {
  outcome: "ok",
  stdout: "djl-ok\n",
  message: undefined,
  latencyMs: 12,
};

beforeAll(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "djl-server-service-"));
  djlKnownHosts = path.join(fixtureDir, "known_hosts");
  fs.writeFileSync(djlKnownHosts, "");
  const keygen = path.join(fixtureDir, "fake-keygen");
  const keyscan = path.join(fixtureDir, "fake-keyscan");
  fs.writeFileSync(
    keygen,
    `#!/bin/sh
mode=$1; pattern=$2; file=$4
case "$mode" in
  -F) grep "^$pattern " "$file" ;;
  -R) grep -v "^$pattern " "$file" > "$file.tmp"; mv "$file.tmp" "$file" ;;
esac
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(keyscan, `#!/bin/sh\necho "# comment"\necho "${KEY_LINE}"\n`, { mode: 0o755 });
  process.env.DJL_SSH_KEYGEN_COMMAND = keygen;
  process.env.DJL_SSH_KEYSCAN_COMMAND = keyscan;
});

afterAll(() => {
  delete process.env.DJL_SSH_KEYGEN_COMMAND;
  delete process.env.DJL_SSH_KEYSCAN_COMMAND;
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

afterEach(() => {
  runCalls.length = 0;
  scripted = { outcome: "ok", stdout: "djl-ok\n", message: undefined, latencyMs: 12 };
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

const makeLayer = () =>
  ServerServiceLive.pipe(
    Layer.provideMerge(ServerRepositoryLive),
    Layer.provideMerge(Layer.succeed(SshRunner, stubRunner())),
    Layer.provideMerge(ServerSecretStoreLive),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "djl-server-service-test-" })),
    Layer.provide(NodeServices.layer),
  );

const run = <A>(effect: Effect.Effect<A, unknown, ServerService | ServerSecretStore>) =>
  Effect.gen(function* () {
    yield* runMigrations();
    return yield* effect;
  }).pipe(Effect.provide(makeLayer()), Effect.scoped, Effect.runPromise);

const createInput = {
  name: "hk-1",
  host: "203.0.113.10",
  port: 22,
  username: "root",
  auth: { type: "password" },
  tags: ["prod"],
  permissionTier: "read-only",
  notes: "",
  source: "manual",
  secret: { password: "hunter2" },
} satisfies ServerCreateInput;

describe.skipIf(isWindows)("ServerService", () => {
  it("creates a server, stores its secret separately, and never returns it", async () => {
    await run(
      Effect.gen(function* () {
        const service = yield* ServerService;
        const store = yield* ServerSecretStore;
        const record = yield* service.create(createInput);
        expect(JSON.stringify(record)).not.toContain("hunter2");
        expect(yield* readServerSecret(store, record.id, "password")).toBe("hunter2");
        const { servers } = yield* service.list();
        expect(servers.map((s) => s.id)).toEqual([record.id]);
      }),
    );
  });

  it("gates the first test on host key trust, then trusts and probes with the stored secret", async () => {
    await run(
      Effect.gen(function* () {
        const service = yield* ServerService;
        const record = yield* service.create(createInput);
        const first = yield* service.testConnection({ id: record.id });
        expect(first.outcome).toBe("host-key-unknown");
        expect(first.hostKey?.fingerprint).toMatch(/^SHA256:/);
        expect(runCalls).toHaveLength(0);

        const trusted = yield* service.trustHostKey({
          id: record.id,
          fingerprint: first.hostKey!.fingerprint,
        });
        expect(trusted.outcome).toBe("ok");
        expect(fs.readFileSync(djlKnownHosts, "utf8")).toContain(KEY_LINE);
        expect(runCalls).toHaveLength(1);
        expect(runCalls[0]?.secret).toBe("hunter2");
        expect(runCalls[0]?.command).toBe("echo djl-ok");

        const { servers } = yield* service.list();
        expect(servers[0]?.lastTest?.outcome).toBe("ok");
      }),
    );
  });

  it("rejects trusting a fingerprint that does not match the scan", async () => {
    await run(
      Effect.gen(function* () {
        const service = yield* ServerService;
        const record = yield* service.create(createInput);
        yield* service.testConnection({ id: record.id });
        const failure = yield* service
          .trustHostKey({ id: record.id, fingerprint: "SHA256:nope" })
          .pipe(Effect.flip);
        expect(failure._tag).toBe("SshRunnerError");
      }),
    );
  });

  it("refreshes stats and persists them", async () => {
    await run(
      Effect.gen(function* () {
        const service = yield* ServerService;
        const record = yield* service.create({
          ...createInput,
          auth: { type: "agent" },
          secret: undefined,
        });
        const first = yield* service.testConnection({ id: record.id });
        yield* service.trustHostKey({ id: record.id, fingerprint: first.hostKey!.fingerprint });
        scripted = {
          outcome: "ok",
          stdout: "@@hostname\nweb-1\n@@uptime\n5000.1 1\n@@df\n/dev/x 100 40 60 40% /\n",
          message: undefined,
          latencyMs: 30,
        };
        const result = yield* service.refreshStats({ id: record.id });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.stats.hostname).toBe("web-1");
        const { servers } = yield* service.list();
        expect(servers[0]?.lastStats?.uptimeSeconds).toBe(5000);

        scripted = {
          outcome: "auth-failed",
          stdout: "",
          message: "Permission denied",
          latencyMs: 5,
        };
        const failed = yield* service.refreshStats({ id: record.id });
        expect(failed.ok).toBe(false);
        if (!failed.ok) expect(failed.test.outcome).toBe("auth-failed");
      }),
    );
  });

  it("clears secrets that the new auth method cannot use and forgets the host key on host change", async () => {
    await run(
      Effect.gen(function* () {
        const service = yield* ServerService;
        const store = yield* ServerSecretStore;
        const record = yield* service.create(createInput);
        const first = yield* service.testConnection({ id: record.id });
        yield* service.trustHostKey({ id: record.id, fingerprint: first.hostKey!.fingerprint });
        expect(fs.readFileSync(djlKnownHosts, "utf8")).toContain(KEY_LINE);

        const updated = yield* service.update({
          id: record.id,
          patch: { auth: { type: "agent" }, host: "203.0.113.11" },
        });
        expect(updated.host).toBe("203.0.113.11");
        expect(updated.lastTest).toBeUndefined();
        expect(yield* readServerSecret(store, record.id, "password")).toBeNull();
        expect(fs.readFileSync(djlKnownHosts, "utf8")).not.toContain(KEY_LINE);
      }),
    );
  });

  it("removes the row, secrets and known host", async () => {
    await run(
      Effect.gen(function* () {
        const service = yield* ServerService;
        const store = yield* ServerSecretStore;
        const record = yield* service.create(createInput);
        yield* service.remove({ id: record.id });
        expect((yield* service.list()).servers).toEqual([]);
        expect(yield* readServerSecret(store, record.id, "password")).toBeNull();
        const missing = yield* service.testConnection({ id: record.id }).pipe(Effect.flip);
        expect(missing._tag).toBe("ServerNotFoundError");
      }),
    );
  });

  it("imports concrete hosts from the SSH config once", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "djl-import-home-"));
    fs.mkdirSync(path.join(home, ".ssh"));
    fs.writeFileSync(
      path.join(home, ".ssh", "config"),
      "Host hk\n  HostName 203.0.113.10\n  User deploy\n  IdentityFile ~/.ssh/id_hk\nHost *\n  User x\n",
    );
    const layer = makeServerServiceLayer({ homeDir: home }).pipe(
      Layer.provideMerge(ServerRepositoryLive),
      Layer.provideMerge(Layer.succeed(SshRunner, stubRunner())),
      Layer.provideMerge(ServerSecretStoreLive),
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "djl-server-import-test-" })),
      Layer.provide(NodeServices.layer),
    );
    try {
      await Effect.gen(function* () {
        yield* runMigrations();
        const service = yield* ServerService;
        const preview = yield* service.importPreview();
        expect(preview.candidates.map((c) => c.alias)).toEqual(["hk"]);
        const applied = yield* service.importApply({ aliases: ["hk"] });
        expect(applied.servers).toHaveLength(1);
        const record: ServerRecord = applied.servers[0]!;
        expect(record.source).toBe("ssh-config");
        expect(record.sshConfigAlias).toBe("hk");
        expect(record.username).toBe("deploy");
        expect(record.auth).toEqual({
          type: "keyPath",
          path: path.join(home, ".ssh", "id_hk"),
          hasPassphrase: false,
        });
        const again = yield* service.importPreview();
        expect(again.candidates[0]?.alreadyImported).toBe(true);
        expect((yield* service.importApply({ aliases: ["hk"] })).servers).toEqual([]);
      }).pipe(Effect.provide(layer), Effect.scoped, Effect.runPromise);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
