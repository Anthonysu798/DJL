// FILE: ServerService.ts
// Purpose: Composes repository, secret store, SshRunner, known_hosts, stats and import.
// Layer: Servers domain service implementation
import {
  ServerId,
  type ServerConnectionTest,
  type ServerRecord,
  type ServerSecretKind,
  type SshConfigCandidate,
} from "@synara/contracts";
import * as Crypto from "node:crypto";
import * as os from "node:os";
import { Effect, FileSystem, Layer, Option, Path } from "effect";

import { ServerSecretStore } from "../../auth/Services/ServerSecretStore";
import { ServerConfig } from "../../config";
import { ServerRepository } from "../../persistence/Services/ServerRepository.ts";
import { fingerprintOfKeyLine, makeKnownHosts } from "../knownHosts";
import { listLocalPrivateKeys } from "../localKeys";
import {
  ALL_SERVER_SECRET_KINDS,
  clearServerSecrets,
  readServerSecret,
  storeServerSecrets,
} from "../secrets";
import { SshRunner, SshRunnerError } from "../SshRunner";
import { buildSshArgs } from "../sshArgs";
import { expandHomePath, readSshConfigHosts } from "../sshConfigImport";
import { parseStatsOutput, STATS_COMMAND } from "../stats";
import {
  ServerNotFoundError,
  ServerService,
  type ServerServiceShape,
} from "../Services/ServerService";

const PROBE_COMMAND = "echo djl-ok";

/** Secret kinds that an auth method can still use; the rest are cleared on switch. */
function secretKindsFor(auth: ServerRecord["auth"]): ReadonlySet<ServerSecretKind> {
  switch (auth.type) {
    case "agent":
      return new Set();
    case "keyPath":
      return new Set<ServerSecretKind>(["passphrase"]);
    case "importedKey":
      return new Set<ServerSecretKind>(["privateKey", "passphrase"]);
    case "password":
      return new Set<ServerSecretKind>(["password"]);
  }
}

export interface ServerServiceOptions {
  /** Overrides the home directory used for ~/.ssh lookups (tests). */
  readonly homeDir?: string;
}

export const makeServerService = (options: ServerServiceOptions = {}) =>
  Effect.gen(function* () {
    const repository = yield* ServerRepository;
    const secretStore = yield* ServerSecretStore;
    const runner = yield* SshRunner;
    const config = yield* ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const pathApi = yield* Path.Path;
    const platformServices = Layer.mergeAll(
      Layer.succeed(FileSystem.FileSystem, fileSystem),
      Layer.succeed(Path.Path, pathApi),
    );
    const knownHosts = yield* makeKnownHosts({
      sshCommand: runner.sshCommand,
      knownHostsFiles: runner.knownHostsFiles,
      djlKnownHostsPath: runner.djlKnownHostsPath,
    });

    /** Host-key lines returned by ssh-keyscan, awaiting the user's explicit trust. */
    const pendingScans = new Map<ServerId, ReadonlyArray<string>>();

    const homeDir =
      options.homeDir ?? (config.homeDir.trim().length > 0 ? config.homeDir : os.homedir());

    const requireServer = (id: ServerId) =>
      repository.getById(id).pipe(
        Effect.flatMap((option) =>
          Option.match(option, {
            onNone: () => Effect.fail(new ServerNotFoundError({ id })),
            onSome: Effect.succeed,
          }),
        ),
      );

    const persistTest = (record: ServerRecord, test: ServerConnectionTest) =>
      repository.save({ ...record, lastTest: test, updatedAt: Date.now() }).pipe(Effect.as(test));

    const secretForRun = (record: ServerRecord) => {
      const plan = buildSshArgs({
        server: record,
        command: PROBE_COMMAND,
        knownHostsFiles: runner.knownHostsFiles,
        importedKeyPath: null,
      });
      if (plan.askpassSecretKind === null) return Effect.succeed<string | null>(null);
      return readServerSecret(secretStore, record.id, plan.askpassSecretKind);
    };

    /** Returns a host-key-unknown/unreachable test when the host is not yet trusted, else null. */
    const hostKeyGate = (record: ServerRecord) =>
      Effect.gen(function* () {
        const known = yield* knownHosts.isKnown(record.host, record.port);
        if (known) return null;
        const lines = yield* knownHosts.scan(record.host, record.port);
        if (lines.length === 0) {
          pendingScans.delete(record.id);
          return {
            at: Date.now(),
            outcome: "unreachable",
            message: "No host key returned by ssh-keyscan. Check the host and port.",
          } satisfies ServerConnectionTest;
        }
        pendingScans.set(record.id, lines);
        const hostKey = fingerprintOfKeyLine(lines[0]!) ?? undefined;
        return {
          at: Date.now(),
          outcome: "host-key-unknown",
          ...(hostKey ? { hostKey } : {}),
        } satisfies ServerConnectionTest;
      });

    const runProbe = (record: ServerRecord) =>
      Effect.gen(function* () {
        const gate = yield* hostKeyGate(record);
        if (gate) return yield* persistTest(record, gate);
        const secret = yield* secretForRun(record);
        const result = yield* runner.run({ server: record, command: PROBE_COMMAND, secret });
        const test: ServerConnectionTest = {
          at: Date.now(),
          outcome: result.outcome,
          latencyMs: result.latencyMs,
          ...(result.message ? { message: result.message } : {}),
        };
        return yield* persistTest(record, test);
      });

    const list: ServerServiceShape["list"] = () =>
      repository.list().pipe(Effect.map((servers) => ({ servers })));

    const create: ServerServiceShape["create"] = (input) =>
      Effect.gen(function* () {
        const id = ServerId.makeUnsafe(Crypto.randomUUID());
        const record = yield* repository.create({ id, input, now: Date.now() });
        yield* storeServerSecrets(secretStore, id, input.secret);
        return record;
      });

    const update: ServerServiceShape["update"] = (input) =>
      Effect.gen(function* () {
        const existing = yield* requireServer(input.id);
        const patch = input.patch;
        const next: ServerRecord = {
          ...existing,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.host !== undefined ? { host: patch.host } : {}),
          ...(patch.port !== undefined ? { port: patch.port } : {}),
          ...(patch.username !== undefined ? { username: patch.username } : {}),
          ...(patch.auth !== undefined ? { auth: patch.auth } : {}),
          ...(patch.tags !== undefined ? { tags: [...new Set(patch.tags)].toSorted() } : {}),
          ...(patch.permissionTier !== undefined ? { permissionTier: patch.permissionTier } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          updatedAt: Date.now(),
        };
        const hostChanged = next.host !== existing.host || next.port !== existing.port;
        const saved = yield* repository.save(
          hostChanged ? { ...next, lastTest: undefined, lastStats: undefined } : next,
        );
        yield* storeServerSecrets(secretStore, saved.id, input.secret);
        const allowed = secretKindsFor(saved.auth);
        const toClear = new Set<ServerSecretKind>(input.clearSecrets ?? []);
        for (const kind of ALL_SERVER_SECRET_KINDS) if (!allowed.has(kind)) toClear.add(kind);
        yield* clearServerSecrets(secretStore, saved.id, [...toClear]);
        if (hostChanged) {
          pendingScans.delete(saved.id);
          yield* knownHosts.forget(existing.host, existing.port);
        }
        return saved;
      });

    const remove: ServerServiceShape["remove"] = ({ id }) =>
      Effect.gen(function* () {
        const existing = yield* requireServer(id);
        yield* repository.remove(id);
        yield* clearServerSecrets(secretStore, id, ALL_SERVER_SECRET_KINDS);
        pendingScans.delete(id);
        yield* knownHosts.forget(existing.host, existing.port);
      });

    const testConnection: ServerServiceShape["testConnection"] = ({ id }) =>
      requireServer(id).pipe(Effect.flatMap(runProbe));

    const trustHostKey: ServerServiceShape["trustHostKey"] = ({ id, fingerprint }) =>
      Effect.gen(function* () {
        const record = yield* requireServer(id);
        const lines = pendingScans.get(id);
        const scanned = lines?.[0] ? fingerprintOfKeyLine(lines[0]) : null;
        if (!lines || !scanned || scanned.fingerprint !== fingerprint) {
          return yield* Effect.fail(
            new SshRunnerError({
              message: "The host key changed since it was scanned. Test the connection again.",
            }),
          );
        }
        yield* knownHosts.trust(lines);
        pendingScans.delete(id);
        return yield* runProbe(record);
      });

    const refreshStats: ServerServiceShape["refreshStats"] = ({ id }) =>
      Effect.gen(function* () {
        const record = yield* requireServer(id);
        const gate = yield* hostKeyGate(record);
        if (gate) {
          const test = yield* persistTest(record, gate);
          return { ok: false as const, test };
        }
        const secret = yield* secretForRun(record);
        const result = yield* runner.run({ server: record, command: STATS_COMMAND, secret });
        const now = Date.now();
        const test: ServerConnectionTest = {
          at: now,
          outcome: result.outcome,
          latencyMs: result.latencyMs,
          ...(result.message ? { message: result.message } : {}),
        };
        if (result.outcome !== "ok") {
          yield* persistTest(record, test);
          return { ok: false as const, test };
        }
        const stats = parseStatsOutput(result.stdout, now);
        yield* repository.save({ ...record, lastTest: test, lastStats: stats, updatedAt: now });
        return { ok: true as const, stats };
      });

    const importPreview: ServerServiceShape["importPreview"] = () =>
      Effect.gen(function* () {
        const existing = yield* repository.list();
        const imported = new Set(existing.map((server) => server.sshConfigAlias).filter(Boolean));
        const { configPath, hosts } = yield* readSshConfigHosts(homeDir).pipe(
          Effect.provide(platformServices),
        );
        return {
          configPath,
          candidates: hosts.map((host) => {
            const candidate: { -readonly [K in keyof SshConfigCandidate]: SshConfigCandidate[K] } =
              {
                alias: host.alias,
                host: host.hostName,
                port: host.port,
                alreadyImported: imported.has(host.alias),
              };
            if (host.user) candidate.username = host.user;
            if (host.identityFile) candidate.identityFile = host.identityFile;
            return candidate;
          }),
        };
      });

    const importApply: ServerServiceShape["importApply"] = ({ aliases }) =>
      Effect.gen(function* () {
        const preview = yield* importPreview();
        const wanted = new Set(aliases);
        const fallbackUser = os.userInfo().username;
        const created: ServerRecord[] = [];
        for (const candidate of preview.candidates) {
          if (!wanted.has(candidate.alias) || candidate.alreadyImported) continue;
          const record = yield* create({
            name: candidate.alias,
            host: candidate.host,
            port: candidate.port,
            username: candidate.username ?? fallbackUser,
            auth: candidate.identityFile
              ? {
                  type: "keyPath",
                  path: expandHomePath(candidate.identityFile, homeDir),
                  hasPassphrase: false,
                }
              : { type: "agent" },
            tags: [],
            permissionTier: "read-only",
            notes: "",
            source: "ssh-config",
            sshConfigAlias: candidate.alias,
          });
          created.push(record);
        }
        return { servers: created };
      });

    const checkCapabilities: ServerServiceShape["checkCapabilities"] = () => runner.capabilities();

    const listLocalKeys: ServerServiceShape["listLocalKeys"] = () =>
      listLocalPrivateKeys(homeDir).pipe(
        Effect.provide(platformServices),
        Effect.map((keys) => ({ keys })),
      );

    return {
      list,
      create,
      update,
      remove,
      testConnection,
      trustHostKey,
      refreshStats,
      importPreview,
      importApply,
      checkCapabilities,
      listLocalKeys,
    } satisfies ServerServiceShape;
  });

export const makeServerServiceLayer = (options: ServerServiceOptions = {}) =>
  Layer.effect(ServerService, makeServerService(options));

export const ServerServiceLive = makeServerServiceLayer();
