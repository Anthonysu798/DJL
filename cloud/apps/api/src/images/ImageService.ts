import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type {
  CloudCreateImageInput,
  CloudImagesResponse,
  CloudSendMessageInput,
} from "@synara/contracts/cloud";
import type { Principal } from "../auth/guard.ts";
import type { ChatService } from "../chat/ChatService.ts";
import type { GatewayService, RequestFacts } from "../gateway/GatewayService.ts";
import { ApiError } from "../http/errors.ts";

export class ImageService {
  constructor(
    private readonly deps: {
      db: DjlDatabase;
      chat: ChatService;
      gateway: Pick<GatewayService, "listModels">;
    },
  ) {}
  async create(facts: RequestFacts, conversationId: string, input: CloudCreateImageInput) {
    const conversation = await this.deps.chat.own(facts.principal, conversationId);
    const model = (await this.deps.gateway.listModels()).find(
      (model) => model.capabilities.includes("image.generate") && model.status === "active",
    );
    if (!model)
      throw new ApiError(503, "image_unavailable", "Image generation isn't configured yet.");
    return this.deps.chat.send(
      facts,
      conversationId,
      {
        clientMessageId: input.clientMessageId,
        parentId: conversation.currentLeafId,
        parts: [{ type: "text", text: input.prompt }],
        mode: "task",
        model: model.id,
      } as CloudSendMessageInput,
      input.aspectRatio,
    );
  }
  async list(p: Principal, cursor?: string): Promise<typeof CloudImagesResponse.Encoded> {
    let after: [string, string] | null = null;
    if (cursor) {
      try {
        const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
        if (
          Array.isArray(parsed) &&
          typeof parsed[0] === "string" &&
          !Number.isNaN(Date.parse(parsed[0])) &&
          typeof parsed[1] === "string" &&
          /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(parsed[1])
        )
          after = [parsed[0], parsed[1]];
      } catch {}
      if (!after) throw new ApiError(400, "bad_cursor", "Invalid image cursor.");
    }
    const f = schema.files,
      m = schema.messages,
      c = schema.conversations;
    const parent = alias(m, "image_prompt");
    const rows = await this.deps.db
      .select({
        file: f,
        message: m,
        conversationId: c.id,
        at: sql<string>`${f.createdAt}::text`,
        promptParts: parent.parts,
      })
      .from(f)
      .innerJoin(m, eq(m.id, f.messageId))
      .innerJoin(c, eq(c.id, m.conversationId))
      .leftJoin(parent, and(eq(parent.id, m.parentId), eq(parent.conversationId, c.id)))
      .where(
        and(
          eq(f.userId, p.userId),
          eq(f.orgId, p.orgId),
          eq(c.userId, p.userId),
          eq(c.orgId, p.orgId),
          eq(f.source, "generated"),
          eq(f.status, "ready"),
          isNull(f.deletedAt),
          isNull(c.deletedAt),
          after
            ? sql`(${f.createdAt},${f.id}) < (${after[0]}::timestamptz,${after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(f.createdAt), desc(f.id))
      .limit(31);
    const page = rows.slice(0, 30),
      last = page.at(-1);
    const images = page.map((row) => ({
      fileId: row.file.id,
      conversationId: row.conversationId,
      messageId: row.message.id,
      prompt:
        (row.promptParts as { type: string; text?: string }[] | null)
          ?.filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join("\n") ?? "",
      mimeType: row.file.mimeType,
      size: row.file.sizeBytes,
      width: row.file.width,
      height: row.file.height,
      createdAt: row.file.createdAt.toISOString(),
    }));
    return {
      images: images as typeof CloudImagesResponse.Encoded.images,
      nextCursor:
        rows.length > 30 && last
          ? Buffer.from(JSON.stringify([last.at, last.file.id])).toString("base64url")
          : null,
    };
  }
}
