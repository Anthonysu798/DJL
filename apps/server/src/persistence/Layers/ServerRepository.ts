import {
  ServerAuthMethod,
  ServerConnectionTest,
  ServerId,
  ServerRecord,
  ServerStats,
  ServerTag,
} from "@synara/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import { ServerRepository, type ServerRepositoryShape } from "../Services/ServerRepository.ts";

const ServerDbRow = Schema.Struct({
  id: ServerId,
  name: Schema.String,
  host: Schema.String,
  port: Schema.Number,
  username: Schema.String,
  auth: Schema.fromJsonString(ServerAuthMethod),
  tags: Schema.fromJsonString(Schema.Array(ServerTag)),
  permissionTier: ServerRecord.fields.permissionTier,
  notes: Schema.String,
  source: ServerRecord.fields.source,
  sshConfigAlias: Schema.NullOr(Schema.String),
  lastTest: Schema.NullOr(Schema.fromJsonString(ServerConnectionTest)),
  lastStats: Schema.NullOr(Schema.fromJsonString(ServerStats)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
type ServerDbRow = typeof ServerDbRow.Type;

const decodeRecord = Schema.decodeUnknownEffect(ServerRecord);

function toRecord(row: ServerDbRow) {
  return decodeRecord({
    ...row,
    sshConfigAlias: row.sshConfigAlias ?? undefined,
    lastTest: row.lastTest ?? undefined,
    lastStats: row.lastStats ?? undefined,
  }).pipe(Effect.mapError(toPersistenceDecodeError("ServerRepository.rowToDomain")));
}

function toRow(record: ServerRecord): ServerDbRow {
  return {
    id: record.id,
    name: record.name,
    host: record.host,
    port: record.port,
    username: record.username,
    auth: record.auth,
    tags: record.tags,
    permissionTier: record.permissionTier,
    notes: record.notes,
    source: record.source,
    sshConfigAlias: record.sshConfigAlias ?? null,
    lastTest: record.lastTest ?? null,
    lastStats: record.lastStats ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

const makeServerRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertRow = SqlSchema.void({
    Request: ServerDbRow,
    execute: (row) =>
      sql`
        INSERT INTO servers (
          server_id,
          name,
          host,
          port,
          username,
          auth_json,
          tags_json,
          permission_tier,
          notes,
          source,
          ssh_config_alias,
          last_test_json,
          last_stats_json,
          created_at,
          updated_at
        )
        VALUES (
          ${row.id},
          ${row.name},
          ${row.host},
          ${row.port},
          ${row.username},
          ${row.auth},
          ${row.tags},
          ${row.permissionTier},
          ${row.notes},
          ${row.source},
          ${row.sshConfigAlias},
          ${row.lastTest},
          ${row.lastStats},
          ${row.createdAt},
          ${row.updatedAt}
        )
      `,
  });

  const updateRow = SqlSchema.void({
    Request: ServerDbRow,
    execute: (row) =>
      sql`
        UPDATE servers
        SET
          name = ${row.name},
          host = ${row.host},
          port = ${row.port},
          username = ${row.username},
          auth_json = ${row.auth},
          tags_json = ${row.tags},
          permission_tier = ${row.permissionTier},
          notes = ${row.notes},
          source = ${row.source},
          ssh_config_alias = ${row.sshConfigAlias},
          last_test_json = ${row.lastTest},
          last_stats_json = ${row.lastStats},
          updated_at = ${row.updatedAt}
        WHERE server_id = ${row.id}
      `,
  });

  const selectAll = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: ServerDbRow,
    execute: () =>
      sql`
        SELECT
          server_id AS "id",
          name,
          host,
          port,
          username,
          auth_json AS "auth",
          tags_json AS "tags",
          permission_tier AS "permissionTier",
          notes,
          source,
          ssh_config_alias AS "sshConfigAlias",
          last_test_json AS "lastTest",
          last_stats_json AS "lastStats",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM servers
        ORDER BY name COLLATE NOCASE ASC, server_id ASC
      `,
  });

  const selectById = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: ServerId }),
    Result: ServerDbRow,
    execute: ({ id }) =>
      sql`
        SELECT
          server_id AS "id",
          name,
          host,
          port,
          username,
          auth_json AS "auth",
          tags_json AS "tags",
          permission_tier AS "permissionTier",
          notes,
          source,
          ssh_config_alias AS "sshConfigAlias",
          last_test_json AS "lastTest",
          last_stats_json AS "lastStats",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM servers
        WHERE server_id = ${id}
      `,
  });

  const deleteRow = SqlSchema.void({
    Request: Schema.Struct({ id: ServerId }),
    execute: ({ id }) => sql`DELETE FROM servers WHERE server_id = ${id}`,
  });

  const list: ServerRepositoryShape["list"] = () =>
    selectAll({}).pipe(
      Effect.mapError(toPersistenceSqlError("ServerRepository.list:query")),
      Effect.flatMap((rows) => Effect.forEach(rows, toRecord)),
    );

  const getById: ServerRepositoryShape["getById"] = (id) =>
    selectById({ id }).pipe(
      Effect.mapError(toPersistenceSqlError("ServerRepository.getById:query")),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) => toRecord(row).pipe(Effect.map(Option.some)),
        }),
      ),
    );

  const create: ServerRepositoryShape["create"] = ({ id, input, now }) => {
    const record: ServerRecord = {
      id,
      name: input.name,
      host: input.host,
      port: input.port ?? 22,
      username: input.username,
      auth: input.auth,
      tags: [...new Set(input.tags ?? [])].toSorted(),
      permissionTier: input.permissionTier ?? "read-only",
      notes: input.notes ?? "",
      source: input.source ?? "manual",
      ...(input.sshConfigAlias ? { sshConfigAlias: input.sshConfigAlias } : {}),
      createdAt: now,
      updatedAt: now,
    };
    return insertRow(toRow(record)).pipe(
      Effect.mapError(toPersistenceSqlError("ServerRepository.create:insert")),
      Effect.as(record),
    );
  };

  const save: ServerRepositoryShape["save"] = (record) =>
    updateRow(toRow(record)).pipe(
      Effect.mapError(toPersistenceSqlError("ServerRepository.save:update")),
      Effect.as(record),
    );

  const remove: ServerRepositoryShape["remove"] = (id) =>
    deleteRow({ id }).pipe(
      Effect.mapError(toPersistenceSqlError("ServerRepository.remove:delete")),
    );

  return { list, getById, create, save, remove } satisfies ServerRepositoryShape;
});

export const ServerRepositoryLive = Layer.effect(ServerRepository, makeServerRepository);
