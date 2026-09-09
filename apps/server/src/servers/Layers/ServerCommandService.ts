// FILE: ServerCommandService.ts
// Purpose: Enforces a server's permission tier for agent commands, holds approve-each requests
//          until the user decides, runs approved commands over SshRunner and records everything.
// Layer: Servers domain service implementation
import {
  ServerCommandId,
  ServerId,
  type ServerCommandRecord,
  type ServerCommandStreamEvent,
  type ServerRecord,
} from "@synara/contracts";
import * as Crypto from "node:crypto";
import { Deferred, Effect, Layer, Option, PubSub, Stream } from "effect";

import { ServerSecretStore } from "../../auth/Services/ServerSecretStore";
import { ServerCommandRepository } from "../../persistence/Services/ServerCommandRepository.ts";
import { ServerRepository } from "../../persistence/Services/ServerRepository.ts";
import { evaluateReadOnlyCommand } from "../commandPolicy";
import { makeKnownHosts } from "../knownHosts";
import { readServerSecret } from "../secrets";
import { SshRunner } from "../SshRunner";
import { buildSshArgs } from "../sshArgs";
import {
  ServerCommandNotPendingError,
  ServerCommandService,
  type ServerCommandOutcome,
  type ServerCommandServiceShape,
} from "../Services/ServerCommandService";

const DEFAULT_APPROVAL_TIMEOUT_MS = 15 * 60_000;
const COMMAND_TIMEOUT_MS = 300_000;

/** Shell conventions: 124 timed out, 125 could not run, 126 not permitted. */
const EXIT_TIMED_OUT = 124;
const EXIT_UNAVAILABLE = 125;
const EXIT_NOT_PERMITTED = 126;

type Decision = "approve" | "deny";

interface PendingEntry {
  readonly record: ServerCommandRecord;
  readonly decision: Deferred.Deferred<Decision>;
}

const outcome = (record: ServerCommandRecord, exitCode: number): ServerCommandOutcome => ({
  ...record,
  stdout: record.output ?? "",
  exitCode,
});

export interface ServerCommandServiceOptions {
  /** How long an approve-each command waits for a decision. Default 15 minutes. */
  readonly approvalTimeoutMs?: number;
}

export const makeServerCommandService = (options: ServerCommandServiceOptions = {}) =>
  Effect.gen(function* () {
    const servers = yield* ServerRepository;
    const commands = yield* ServerCommandRepository;
    const secretStore = yield* ServerSecretStore;
    const runner = yield* SshRunner;
    const knownHosts = yield* makeKnownHosts({
      sshCommand: runner.sshCommand,
      knownHostsFiles: runner.knownHostsFiles,
      djlKnownHostsPath: runner.djlKnownHostsPath,
    });
    const approvalTimeoutMs = options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
    const events = yield* PubSub.unbounded<ServerCommandStreamEvent>();
    const pending = new Map<ServerCommandId, PendingEntry>();

    const publish = (command: ServerCommandRecord) =>
      PubSub.publish(events, { type: "command-updated", command }).pipe(Effect.asVoid);

    // Requests from a previous process can never be answered: their shim call is gone.
    const stale = yield* commands.listPending();
    for (const record of stale) {
      yield* commands.update({
        ...record,
        status: "timed-out",
        exitCode: EXIT_TIMED_OUT,
        reason: "DJL restarted before this command was approved.",
        finishedAt: Date.now(),
      });
    }

    const findServer = (name: string) =>
      servers.list().pipe(
        Effect.map((all) => {
          const exact = all.find((server) => server.name === name);
          if (exact) return Option.some(exact);
          const lower = name.toLowerCase();
          return Option.fromUndefinedOr(all.find((server) => server.name.toLowerCase() === lower));
        }),
      );

    const secretForRun = (server: ServerRecord, command: string) => {
      const plan = buildSshArgs({
        server,
        command,
        knownHostsFiles: runner.knownHostsFiles,
        importedKeyPath: null,
      });
      if (plan.askpassSecretKind === null) return Effect.succeed<string | null>(null);
      return readServerSecret(secretStore, server.id, plan.askpassSecretKind);
    };

    const finish = (
      record: ServerCommandRecord,
      patch: Pick<ServerCommandRecord, "status" | "exitCode"> &
        Partial<Pick<ServerCommandRecord, "output" | "reason">>,
    ) =>
      Effect.gen(function* () {
        const next: ServerCommandRecord = { ...record, ...patch, finishedAt: Date.now() };
        yield* commands.update(next);
        yield* publish(next);
        return next;
      });

    const refuse = (record: ServerCommandRecord, exitCode: number, reason: string) =>
      Effect.gen(function* () {
        const refused: ServerCommandRecord = {
          ...record,
          status: "refused",
          exitCode,
          reason,
          finishedAt: Date.now(),
        };
        yield* commands.insert(refused);
        yield* publish(refused);
        return outcome(refused, exitCode);
      });

    const execute = (record: ServerCommandRecord, server: ServerRecord) =>
      Effect.gen(function* () {
        const secret = yield* secretForRun(server, record.command);
        const result = yield* runner.run({
          server,
          command: record.command,
          secret,
          timeoutMs: COMMAND_TIMEOUT_MS,
        });
        const ok = result.outcome === "ok";
        const exitCode = ok
          ? 0
          : result.outcome === "timeout"
            ? EXIT_TIMED_OUT
            : (result.exitCode ?? 255);
        const stderr = result.stderr || (ok ? "" : (result.message ?? ""));
        const finished = yield* finish(record, {
          status: ok ? "succeeded" : "failed",
          exitCode,
          output: result.stdout + stderr,
        });
        return outcome(finished, exitCode);
      });

    const awaitApproval = (record: ServerCommandRecord, server: ServerRecord) =>
      Effect.gen(function* () {
        const decision = yield* Deferred.make<Decision>();
        pending.set(record.id, { record, decision });
        yield* commands.insert(record);
        yield* publish(record);
        const decided = yield* Deferred.await(decision).pipe(
          Effect.timeoutOption(approvalTimeoutMs),
          Effect.ensuring(Effect.sync(() => pending.delete(record.id))),
          Effect.onInterrupt(() =>
            finish(record, {
              status: "timed-out",
              exitCode: EXIT_TIMED_OUT,
              reason: "The djl-ssh call went away before a decision was made.",
            }).pipe(Effect.ignore),
          ),
        );
        if (Option.isNone(decided)) {
          const timedOut = yield* finish(record, {
            status: "timed-out",
            exitCode: EXIT_TIMED_OUT,
            reason: "Nobody approved this command within 15 minutes.",
          });
          return outcome(timedOut, EXIT_TIMED_OUT);
        }
        if (decided.value === "deny") {
          // `resolve` already stored and published the denial.
          return outcome(
            { ...record, status: "denied", exitCode: EXIT_UNAVAILABLE, finishedAt: Date.now() },
            EXIT_UNAVAILABLE,
          );
        }
        return yield* execute({ ...record, status: "running" }, server);
      });

    const requestCommand: ServerCommandServiceShape["requestCommand"] = (input) =>
      Effect.gen(function* () {
        const now = Date.now();
        const command = input.command.trim();
        const found = yield* findServer(input.serverName.trim());
        if (Option.isNone(found)) {
          const reason = `No registered server named "${input.serverName.trim()}". Check Settings → Servers.`;
          const record: ServerCommandRecord = {
            id: ServerCommandId.makeUnsafe(Crypto.randomUUID()),
            serverId: ServerId.makeUnsafe("unknown"),
            serverName: input.serverName.trim(),
            ...(input.threadId ? { threadId: input.threadId } : {}),
            command,
            tier: "read-only",
            status: "refused",
            exitCode: EXIT_UNAVAILABLE,
            reason,
            requestedAt: now,
            finishedAt: now,
          };
          return outcome(record, EXIT_UNAVAILABLE);
        }
        const server = found.value;
        const record: ServerCommandRecord = {
          id: ServerCommandId.makeUnsafe(Crypto.randomUUID()),
          serverId: server.id,
          serverName: server.name,
          ...(input.threadId ? { threadId: input.threadId } : {}),
          command,
          tier: server.permissionTier,
          status: "pending",
          requestedAt: now,
        };
        const trusted = yield* knownHosts.isKnown(server.host, server.port);
        if (!trusted) {
          return yield* refuse(
            record,
            EXIT_UNAVAILABLE,
            `The host key for "${server.name}" is not trusted yet. Test the connection in Settings → Servers first.`,
          );
        }
        switch (server.permissionTier) {
          case "read-only": {
            const verdict = evaluateReadOnlyCommand(command);
            if (!verdict.allowed) return yield* refuse(record, EXIT_NOT_PERMITTED, verdict.reason);
            const running: ServerCommandRecord = { ...record, status: "running" };
            yield* commands.insert(running);
            yield* publish(running);
            return yield* execute(running, server);
          }
          case "approve-each":
            return yield* awaitApproval(record, server);
          case "full": {
            const running: ServerCommandRecord = { ...record, status: "running" };
            yield* commands.insert(running);
            yield* publish(running);
            return yield* execute(running, server);
          }
        }
      });

    const resolve: ServerCommandServiceShape["resolve"] = ({ id, decision }) =>
      Effect.gen(function* () {
        const entry = pending.get(id);
        if (!entry) return yield* Effect.fail(new ServerCommandNotPendingError({ id }));
        pending.delete(id);
        const next: ServerCommandRecord =
          decision === "approve"
            ? { ...entry.record, status: "running" }
            : {
                ...entry.record,
                status: "denied",
                exitCode: EXIT_UNAVAILABLE,
                reason: "Denied in DJL.",
                finishedAt: Date.now(),
              };
        yield* commands.update(next);
        yield* publish(next);
        yield* Deferred.succeed(entry.decision, decision);
        return next;
      });

    const listByServer: ServerCommandServiceShape["listByServer"] = (input) =>
      commands
        .listByServer({
          id: input.id,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
        .pipe(Effect.map((list) => ({ commands: list })));

    const listPending: ServerCommandServiceShape["listPending"] = () => commands.listPending();

    return {
      requestCommand,
      resolve,
      listByServer,
      listPending,
      streamEvents: Stream.fromPubSub(events),
    } satisfies ServerCommandServiceShape;
  });

export const makeServerCommandServiceLayer = (options: ServerCommandServiceOptions = {}) =>
  Layer.effect(ServerCommandService, makeServerCommandService(options));

export const ServerCommandServiceLive = makeServerCommandServiceLayer();
