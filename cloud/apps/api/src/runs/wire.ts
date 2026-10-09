import type { schema } from "@djl/db";
import type { CloudRun } from "@synara/contracts/cloud";

export type RunRow = typeof schema.runs.$inferSelect;

export function toRun(row: RunRow): typeof CloudRun.Encoded {
  return {
    id: row.id,
    conversationId: row.conversationId,
    messageId: row.messageId,
    mode: row.mode,
    status: row.status,
    model: row.model,
    error: row.error ?? null,
    lastSeq: row.lastSeq,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}
