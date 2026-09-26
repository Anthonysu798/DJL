/** Database rows to the JSON shapes in @synara/contracts/cloud. */
import type { schema } from "@djl/db";
import type { CloudConversation, CloudMessage } from "@synara/contracts/cloud";

export type ConversationRow = typeof schema.conversations.$inferSelect;
export type MessageRow = typeof schema.messages.$inferSelect;

export function toConversation(row: ConversationRow): typeof CloudConversation.Encoded {
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    archived: row.archived,
    lastMessageAt: row.lastMessageAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toMessage(row: MessageRow): typeof CloudMessage.Encoded {
  return {
    id: row.id,
    conversationId: row.conversationId,
    parentId: row.parentId,
    role: row.role,
    parts: row.parts as (typeof CloudMessage.Encoded)["parts"],
    model: row.role === "assistant" ? row.model : null,
    runId: row.runId,
    createdAt: row.createdAt.toISOString(),
  };
}
