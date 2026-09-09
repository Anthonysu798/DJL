import {
  ServerCommandId,
  ServerCommandRecord,
  ServerCommandStatus,
  ServerId,
  ServerPermissionTier,
} from "@synara/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  ServerCommandRepository,
  type ServerCommandRepositoryShape,
} from "../Services/ServerCommandRepository.ts";

/** Stored output is an audit trail, not a transcript; the agent already got the full text. */
const MAX_STORED_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_LIST_LIMIT = 20;

const ServerCommandDbRow = Schema.Struct({
  id: ServerCommandId,
  serverId: ServerId,
  serverName: Schema.String,
  threadId: Schema.NullOr(Schema.String),
  command: Schema.String,
  tier: ServerPermissionTier,
  status: ServerCommandStatus,
  exitCode: Schema.NullOr(Schema.Number),
  output: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
  requestedAt: Schema.Number,
  finishedAt: Schema.NullOr(Schema.Number),
});
type ServerCommandDbRow = typeof ServerCommandDbRow.Type;

const decodeRecord = Schema.decodeUnknownEffect(ServerCommandRecord);

function toRecord(row: ServerCommandDbRow) {
  return decodeRecord({
    id: row.id,
    serverId: row.serverId,
    serverName: row.serverName,
    ...(row.threadId !== null ? { threadId: row.threadId } : {}),
    command: row.command,
    tier: row.tier,
    status: row.status,
    ...(row.exitCode !== null ? { exitCode: row.exitCode } : {}),
    ...(row.output !== null ? { output: row.output } : {}),
    ...(row.reason !== null ? { reason: row.reason } : {}),
    requestedAt: row.requestedAt,
    ...(row.finishedAt !== null ? { finishedAt: row.finishedAt } : {}),
  }).pipe(Effect.mapError(toPersistenceDecodeError("ServerCommandRepository.rowToDomain")));
}

export function truncateStoredOutput(output: string): string {
  return Buffer.byteLength(output, "utf8") <= MAX_STORED_OUTPUT_BYTES
    ? output
    : Buffer.from(output, "utf8").subarray(0, MAX_STORED_OUTPUT_BYTES).toString("utf8");
}

function toRow(record: ServerCommandRecord): ServerCommandDbRow {
  return {
    id: record.id,
    serverId: record.serverId,
    serverName: record.serverName,
    threadId: record.threadId ?? null,
    command: record.command,
    tier: record.tier,
    status: record.status,
    exitCode: record.exitCode ?? null,
    output: record.output !== undefined ? truncateStoredOutput(record.output) : null,
    reason: record.reason ?? null,
    requestedAt: record.requestedAt,
    finishedAt: record.finishedAt ?? null,
  };
}

const makeServerCommandRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertRow = SqlSchema.void({
    Request: ServerCommandDbRow,
    execute: (row) =>
      sql`
        INSERT INTO server_commands (
          command_id, server_id, server_name, thread_id, command, tier, status,
          exit_code, output, reason, requested_at, finished_at
        )
        VALUES (
          ${row.id}, ${row.serverId}, ${row.serverName}, ${row.threadId}, ${row.command},
          ${row.tier}, ${row.status}, ${row.exitCode}, ${row.output}, ${row.reason},
          ${row.requestedAt}, ${row.finishedAt}
        )
      `,
  });

  const updateRow = SqlSchema.void({
    Request: ServerCommandDbRow,
    execute: (row) =>
      sql`
        UPDATE server_commands
        SET
          status = ${row.status},
          exit_code = ${row.exitCode},
          output = ${row.output},
          reason = ${row.reason},
          finished_at = ${row.finishedAt}
        WHERE command_id = ${row.id}
      `,
  });

  const selectByServer = SqlSchema.findAll({
    Request: Schema.Struct({ id: ServerId, limit: Schema.Number }),
    Result: ServerCommandDbRow,
    execute: ({ id, limit }) =>
      sql`
        SELECT
          command_id AS "id",
          server_id AS "serverId",
          server_name AS "serverName",
          thread_id AS "threadId",
          command,
          tier,
          status,
          exit_code AS "exitCode",
          output,
          reason,
          requested_at AS "requestedAt",
          finished_at AS "finishedAt"
        FROM server_commands
        WHERE server_id = ${id}
        ORDER BY requested_at DESC, command_id DESC
        LIMIT ${limit}
      `,
  });

  const selectPending = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: ServerCommandDbRow,
    execute: () =>
      sql`
        SELECT
          command_id AS "id",
          server_id AS "serverId",
          server_name AS "serverName",
          thread_id AS "threadId",
          command,
          tier,
          status,
          exit_code AS "exitCode",
          output,
          reason,
          requested_at AS "requestedAt",
          finished_at AS "finishedAt"
        FROM server_commands
        WHERE status = 'pending'
        ORDER BY requested_at ASC, command_id ASC
      `,
  });

  const insert: ServerCommandRepositoryShape["insert"] = (record) =>
    insertRow(toRow(record)).pipe(
      Effect.mapError(toPersistenceSqlError("ServerCommandRepository.insert")),
    );

  const update: ServerCommandRepositoryShape["update"] = (record) =>
    updateRow(toRow(record)).pipe(
      Effect.mapError(toPersistenceSqlError("ServerCommandRepository.update")),
    );

  const listByServer: ServerCommandRepositoryShape["listByServer"] = ({ id, limit }) =>
    selectByServer({ id, limit: limit ?? DEFAULT_LIST_LIMIT }).pipe(
      Effect.mapError(toPersistenceSqlError("ServerCommandRepository.listByServer")),
      Effect.flatMap((rows) => Effect.forEach(rows, toRecord)),
    );

  const listPending: ServerCommandRepositoryShape["listPending"] = () =>
    selectPending({}).pipe(
      Effect.mapError(toPersistenceSqlError("ServerCommandRepository.listPending")),
      Effect.flatMap((rows) => Effect.forEach(rows, toRecord)),
    );

  return { insert, update, listByServer, listPending } satisfies ServerCommandRepositoryShape;
});

export const ServerCommandRepositoryLive = Layer.effect(
  ServerCommandRepository,
  makeServerCommandRepository,
);
