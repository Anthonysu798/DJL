// FILE: GroupRepository.ts
// Purpose: SQLite access for Multi agents groups, members, the group log and reply records.
// Layer: Persistence

import { Group, GroupMemberId, GroupReply, type GroupHandoff } from "@djl/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  GroupRepository,
  type GroupLogEntry,
  type GroupRepositoryShape,
} from "../Services/GroupRepository.ts";

type Row = Record<string, unknown>;

const decodeGroup = Schema.decodeUnknownEffect(Group);
const decodeReply = Schema.decodeUnknownEffect(GroupReply);
const decodeMemberIds = Schema.decodeUnknownEffect(Schema.Array(GroupMemberId));

const json = (value: unknown) => JSON.parse(String(value)) as unknown;

const toEntries = (rows: ReadonlyArray<Row>): GroupLogEntry[] =>
  rows.map((row) => ({
    seq: Number(row.seq),
    author: String(row.author),
    text: String(row.text),
  }));

const makeGroupRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const run = <A>(operation: string, query: Effect.Effect<A, unknown>) =>
    query.pipe(Effect.mapError(toPersistenceSqlError(`GroupRepository.${operation}`)));

  const toGroup = (row: Row, members: ReadonlyArray<Row>) =>
    decodeGroup({
      id: row.group_id,
      threadId: row.thread_id,
      projectId: row.project_id,
      name: row.name,
      folder: row.folder,
      folderIsAuto: row.folder_is_auto === 1,
      hopLimit: row.hop_limit,
      skipAllWarning: row.skip_all_warning === 1,
      pendingHandoffs: json(row.pending_handoffs_json),
      members: members.map((member) => ({
        id: member.member_id,
        groupId: member.group_id,
        provider: member.provider,
        handle: member.handle,
        role: member.role ?? null,
        model: member.model ?? null,
        position: member.position,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }).pipe(Effect.mapError(toPersistenceDecodeError("GroupRepository.toGroup")));

  const withMembers = (rows: ReadonlyArray<Row>) =>
    Effect.gen(function* () {
      if (rows.length === 0) return [];
      const members = yield* run(
        "members",
        sql<Row>`SELECT * FROM group_members ORDER BY position ASC`,
      );
      return yield* Effect.forEach(rows, (row) =>
        toGroup(
          row,
          members.filter((member) => member.group_id === row.group_id),
        ),
      );
    });

  const listGroups: GroupRepositoryShape["listGroups"] = () =>
    run("listGroups", sql<Row>`SELECT * FROM groups ORDER BY created_at ASC`).pipe(
      Effect.flatMap(withMembers),
    );

  const getById: GroupRepositoryShape["getById"] = (groupId) =>
    run("getById", sql<Row>`SELECT * FROM groups WHERE group_id = ${groupId}`).pipe(
      Effect.flatMap(withMembers),
      Effect.map((groups) => groups[0] ?? null),
    );

  const getByThreadId: GroupRepositoryShape["getByThreadId"] = (threadId) =>
    run("getByThreadId", sql<Row>`SELECT * FROM groups WHERE thread_id = ${threadId}`).pipe(
      Effect.flatMap(withMembers),
      Effect.map((groups) => groups[0] ?? null),
    );

  const upsertGroup: GroupRepositoryShape["upsertGroup"] = (row) =>
    run(
      "upsertGroup",
      sql`
        INSERT INTO groups (
          group_id, thread_id, project_id, name, folder, folder_is_auto, hop_limit,
          skip_all_warning, pending_handoffs_json, created_at, updated_at
        )
        VALUES (
          ${row.id}, ${row.threadId}, ${row.projectId}, ${row.name}, ${row.folder},
          ${row.folderIsAuto ? 1 : 0}, ${row.hopLimit}, ${row.skipAllWarning ? 1 : 0},
          ${JSON.stringify(row.pendingHandoffs)}, ${row.createdAt}, ${row.updatedAt}
        )
        ON CONFLICT (group_id) DO UPDATE SET
          name = excluded.name,
          folder = excluded.folder,
          folder_is_auto = excluded.folder_is_auto,
          hop_limit = excluded.hop_limit,
          skip_all_warning = excluded.skip_all_warning,
          pending_handoffs_json = excluded.pending_handoffs_json,
          updated_at = excluded.updated_at
      `,
    ).pipe(Effect.asVoid);

  const deleteGroup: GroupRepositoryShape["deleteGroup"] = (groupId) =>
    run(
      "deleteGroup",
      sql.withTransaction(
        Effect.all([
          sql`DELETE FROM group_members WHERE group_id = ${groupId}`,
          sql`DELETE FROM group_log WHERE group_id = ${groupId}`,
          sql`DELETE FROM group_replies WHERE group_id = ${groupId}`,
          sql`DELETE FROM groups WHERE group_id = ${groupId}`,
        ]),
      ),
    ).pipe(Effect.asVoid);

  const upsertMember: GroupRepositoryShape["upsertMember"] = (member) =>
    run(
      "upsertMember",
      sql`
        INSERT INTO group_members (member_id, group_id, provider, handle, role, model, position)
        VALUES (
          ${member.id}, ${member.groupId}, ${member.provider}, ${member.handle},
          ${member.role}, ${member.model}, ${member.position}
        )
        ON CONFLICT (member_id) DO UPDATE SET
          handle = excluded.handle,
          role = excluded.role,
          model = excluded.model,
          position = excluded.position
      `,
    ).pipe(Effect.asVoid);

  const deleteMember: GroupRepositoryShape["deleteMember"] = (memberId) =>
    run("deleteMember", sql`DELETE FROM group_members WHERE member_id = ${memberId}`).pipe(
      Effect.asVoid,
    );

  const getMemberRuntime: GroupRepositoryShape["getMemberRuntime"] = (memberId) =>
    run(
      "getMemberRuntime",
      sql<Row>`SELECT native_session_id, read_seq FROM group_members WHERE member_id = ${memberId}`,
    ).pipe(
      Effect.map((rows) => ({
        nativeSessionId: (rows[0]?.native_session_id as string | null | undefined) ?? null,
        readSeq: Number(rows[0]?.read_seq ?? 0),
      })),
    );

  const saveMemberRuntime: GroupRepositoryShape["saveMemberRuntime"] = (memberId, patch) =>
    Effect.gen(function* () {
      const current = yield* getMemberRuntime(memberId);
      const nativeSessionId =
        patch.nativeSessionId === undefined ? current.nativeSessionId : patch.nativeSessionId;
      const readSeq = patch.readSeq ?? current.readSeq;
      yield* run(
        "saveMemberRuntime",
        sql`
          UPDATE group_members
          SET native_session_id = ${nativeSessionId}, read_seq = ${readSeq}
          WHERE member_id = ${memberId}
        `,
      );
    });

  const resetMemberSessions: GroupRepositoryShape["resetMemberSessions"] = (groupId) =>
    run(
      "resetMemberSessions",
      sql`UPDATE group_members SET native_session_id = NULL WHERE group_id = ${groupId}`,
    ).pipe(Effect.asVoid);

  const appendLog: GroupRepositoryShape["appendLog"] = (groupId, author, text) =>
    run(
      "appendLog",
      sql.withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<Row>`
            SELECT COALESCE(MAX(seq), 0) AS last FROM group_log WHERE group_id = ${groupId}
          `;
          const seq = Number(rows[0]?.last ?? 0) + 1;
          yield* sql`
            INSERT INTO group_log (group_id, seq, author, text)
            VALUES (${groupId}, ${seq}, ${author}, ${text})
          `;
          return seq;
        }),
      ),
    );

  const logAfter: GroupRepositoryShape["logAfter"] = (groupId, seq) =>
    run(
      "logAfter",
      sql<Row>`
        SELECT seq, author, text FROM group_log
        WHERE group_id = ${groupId} AND seq > ${seq}
        ORDER BY seq ASC
      `,
    ).pipe(Effect.map(toEntries));

  const logTail: GroupRepositoryShape["logTail"] = (groupId, count) =>
    run(
      "logTail",
      sql<Row>`
        SELECT seq, author, text FROM (
          SELECT seq, author, text FROM group_log
          WHERE group_id = ${groupId}
          ORDER BY seq DESC
          LIMIT ${count}
        ) ORDER BY seq ASC
      `,
    ).pipe(Effect.map(toEntries));

  const setRoundState: GroupRepositoryShape["setRoundState"] = (groupId, state) =>
    run(
      "setRoundState",
      sql`
        UPDATE groups
        SET last_speakers_json = ${JSON.stringify(state.lastSpeakers)},
            last_round_all = ${state.lastRoundAll ? 1 : 0}
        WHERE group_id = ${groupId}
      `,
    ).pipe(Effect.asVoid);

  const getRoundState: GroupRepositoryShape["getRoundState"] = (groupId) =>
    Effect.gen(function* () {
      const rows = yield* run(
        "getRoundState",
        sql<Row>`SELECT last_speakers_json, last_round_all FROM groups WHERE group_id = ${groupId}`,
      );
      const lastSpeakers = yield* decodeMemberIds(json(rows[0]?.last_speakers_json ?? "[]")).pipe(
        Effect.mapError(toPersistenceDecodeError("GroupRepository.getRoundState")),
      );
      return { lastSpeakers, lastRoundAll: rows[0]?.last_round_all === 1 };
    });

  const setPause: GroupRepositoryShape["setPause"] = (
    groupId,
    handoffs: ReadonlyArray<GroupHandoff>,
    resumeRequested,
  ) =>
    run(
      "setPause",
      sql`
        UPDATE groups
        SET pending_handoffs_json = ${JSON.stringify(handoffs)},
            resume_requested = ${resumeRequested ? 1 : 0}
        WHERE group_id = ${groupId}
      `,
    ).pipe(Effect.asVoid);

  const isResumeRequested: GroupRepositoryShape["isResumeRequested"] = (groupId) =>
    run(
      "isResumeRequested",
      sql<Row>`SELECT resume_requested FROM groups WHERE group_id = ${groupId}`,
    ).pipe(Effect.map((rows) => rows[0]?.resume_requested === 1));

  const recordReply: GroupRepositoryShape["recordReply"] = (reply) =>
    run(
      "recordReply",
      sql`
        INSERT OR REPLACE INTO group_replies (
          reply_id, group_id, member_id, status, error, files_json, commands_json
        )
        VALUES (
          ${reply.replyId}, ${reply.groupId}, ${reply.memberId}, ${reply.status}, ${reply.error},
          ${JSON.stringify(reply.files)}, ${JSON.stringify(reply.commands)}
        )
      `,
    ).pipe(Effect.asVoid);

  const listReplies: GroupRepositoryShape["listReplies"] = (groupId) =>
    run(
      "listReplies",
      groupId === undefined
        ? sql<Row>`SELECT * FROM group_replies`
        : sql<Row>`SELECT * FROM group_replies WHERE group_id = ${groupId}`,
    ).pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          decodeReply({
            groupId: row.group_id,
            replyId: row.reply_id,
            memberId: row.member_id,
            status: row.status,
            error: row.error ?? null,
            files: json(row.files_json),
            commands: json(row.commands_json),
          }).pipe(Effect.mapError(toPersistenceDecodeError("GroupRepository.listReplies"))),
        ),
      ),
    );

  return {
    listGroups,
    getById,
    getByThreadId,
    upsertGroup,
    deleteGroup,
    upsertMember,
    deleteMember,
    getMemberRuntime,
    saveMemberRuntime,
    resetMemberSessions,
    appendLog,
    logAfter,
    logTail,
    setRoundState,
    getRoundState,
    setPause,
    isResumeRequested,
    recordReply,
    listReplies,
  } satisfies GroupRepositoryShape;
});

export const GroupRepositoryLive = Layer.effect(GroupRepository, makeGroupRepository);
