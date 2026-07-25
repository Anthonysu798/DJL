import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Markdown files in the managed vault are authoritative. These tables are
  // disposable indexes and conflict metadata that can be rebuilt at any time.
  yield* sql`
    CREATE TABLE IF NOT EXISTS project_memory_documents (
      document_id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      thread_id TEXT,
      relative_path TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('project', 'task', 'decision', 'person', 'source', 'note')),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      frontmatter_json TEXT NOT NULL DEFAULT '{}',
      links_json TEXT NOT NULL DEFAULT '[]',
      importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
      confidence REAL NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
      modified_at TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      UNIQUE(project_id, relative_path)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_memory_documents_project
      ON project_memory_documents(project_id, modified_at DESC, document_id DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_memory_documents_thread
      ON project_memory_documents(project_id, thread_id, modified_at DESC)
  `;

  yield* sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS project_memory_fts USING fts5(
      title,
      content,
      project_id UNINDEXED,
      relative_path UNINDEXED,
      content = 'project_memory_documents',
      content_rowid = 'document_id',
      tokenize = 'unicode61 remove_diacritics 2'
    )
  `;
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS project_memory_documents_ai
    AFTER INSERT ON project_memory_documents BEGIN
      INSERT INTO project_memory_fts(rowid, title, content, project_id, relative_path)
      VALUES (new.document_id, new.title, new.content, new.project_id, new.relative_path);
    END
  `;
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS project_memory_documents_ad
    AFTER DELETE ON project_memory_documents BEGIN
      INSERT INTO project_memory_fts(
        project_memory_fts, rowid, title, content, project_id, relative_path
      ) VALUES (
        'delete', old.document_id, old.title, old.content, old.project_id, old.relative_path
      );
    END
  `;
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS project_memory_documents_au
    AFTER UPDATE ON project_memory_documents BEGIN
      INSERT INTO project_memory_fts(
        project_memory_fts, rowid, title, content, project_id, relative_path
      ) VALUES (
        'delete', old.document_id, old.title, old.content, old.project_id, old.relative_path
      );
      INSERT INTO project_memory_fts(rowid, title, content, project_id, relative_path)
      VALUES (new.document_id, new.title, new.content, new.project_id, new.relative_path);
    END
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS project_memory_links (
      document_id INTEGER NOT NULL,
      target TEXT NOT NULL,
      PRIMARY KEY(document_id, target),
      FOREIGN KEY(document_id) REFERENCES project_memory_documents(document_id) ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_project_memory_links_target
      ON project_memory_links(target, document_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS project_memory_embeddings (
      document_id INTEGER PRIMARY KEY,
      engine_version TEXT NOT NULL,
      dimensions INTEGER NOT NULL CHECK (dimensions > 0),
      vector_blob BLOB NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES project_memory_documents(document_id) ON DELETE CASCADE
    )
  `;
});
