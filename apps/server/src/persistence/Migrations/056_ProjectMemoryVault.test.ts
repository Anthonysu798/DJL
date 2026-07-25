import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration from "./056_ProjectMemoryVault.ts";

it.effect("creates a project-scoped FTS index with update and delete triggers", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* Migration;

    yield* sql`
      INSERT INTO project_memory_documents (
        project_id, thread_id, relative_path, kind, title, content, file_hash,
        frontmatter_json, links_json, modified_at, indexed_at
      ) VALUES (
        'project-a', 'thread-a', 'Tasks/thread-a.md', 'task', 'Quarterly plan',
        'The launch date is September 9.', 'hash-a', '{}', '[]',
        '2026-07-13T10:00:00.000Z', '2026-07-13T10:00:00.000Z'
      )
    `;
    yield* sql`
      INSERT INTO project_memory_documents (
        project_id, thread_id, relative_path, kind, title, content, file_hash,
        frontmatter_json, links_json, modified_at, indexed_at
      ) VALUES (
        'project-b', 'thread-b', 'Tasks/thread-b.md', 'task', 'Other plan',
        'The launch date is October 1.', 'hash-b', '{}', '[]',
        '2026-07-13T10:00:00.000Z', '2026-07-13T10:00:00.000Z'
      )
    `;

    const projectA = yield* sql<{ readonly projectId: string; readonly content: string }>`
      SELECT memory.project_id AS "projectId", memory.content
      FROM project_memory_fts AS search
      JOIN project_memory_documents AS memory ON memory.document_id = search.rowid
      WHERE project_memory_fts MATCH 'September' AND memory.project_id = 'project-a'
    `;
    assert.deepStrictEqual(projectA, [
      { projectId: "project-a", content: "The launch date is September 9." },
    ]);

    yield* sql`
      UPDATE project_memory_documents
      SET content = 'The launch date moved to November 2.'
      WHERE project_id = 'project-a'
    `;
    const oldMatch = yield* sql`
      SELECT rowid FROM project_memory_fts WHERE project_memory_fts MATCH 'September'
    `;
    const newMatch = yield* sql`
      SELECT rowid FROM project_memory_fts WHERE project_memory_fts MATCH 'November'
    `;
    assert.lengthOf(oldMatch, 0);
    assert.lengthOf(newMatch, 1);

    yield* sql`DELETE FROM project_memory_documents WHERE project_id = 'project-a'`;
    const deletedMatch = yield* sql`
      SELECT rowid FROM project_memory_fts WHERE project_memory_fts MATCH 'November'
    `;
    assert.lengthOf(deletedMatch, 0);
  }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
);
