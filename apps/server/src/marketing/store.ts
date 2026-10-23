import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
export class MarketingError extends Error {
  readonly _tag = "MarketingError";
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function listDocuments(kind: string) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{
      body: string;
      version: number;
    }>`SELECT body, version FROM marketing_documents WHERE kind = ${kind} ORDER BY updated_at DESC`;
    return rows.map((row) => ({ value: JSON.parse(row.body) as unknown, version: row.version }));
  });
}
export function readDocument(kind: string, id: string) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{
      body: string;
      version: number;
    }>`SELECT body, version FROM marketing_documents WHERE kind = ${kind} AND id = ${id}`;
    return rows[0]
      ? { value: JSON.parse(rows[0].body) as unknown, version: rows[0].version }
      : null;
  });
}
export function saveDocument(
  kind: string,
  id: string,
  value: unknown,
  expectedVersion: number | null,
) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const body = JSON.stringify(value);
    const now = new Date().toISOString();
    const rows =
      expectedVersion === null
        ? yield* sql`INSERT INTO marketing_documents (kind, id, body, version, updated_at) VALUES (${kind}, ${id}, ${body}, 1, ${now}) ON CONFLICT DO NOTHING RETURNING version`
        : yield* sql`UPDATE marketing_documents SET body = ${body}, version = version + 1, updated_at = ${now} WHERE kind = ${kind} AND id = ${id} AND version = ${expectedVersion} RETURNING version`;
    if (!rows.length)
      return yield* Effect.fail(
        new MarketingError("This item changed in another window. Reload before saving.", 409),
      );
    return { value, version: Number(rows[0]!.version) };
  });
}
