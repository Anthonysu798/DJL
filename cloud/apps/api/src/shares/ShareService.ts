/**
 * Read-only share links. A share freezes one branch (root to a leaf) when it
 * is created; later messages never appear. The link carries 32 random bytes;
 * only their SHA-256 is stored, so the URL is shown once. Revoking, or
 * deleting the conversation, makes the link a 404.
 */
import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type {
  CloudCreateShareInput,
  CloudCreateShareResponse,
  CloudMessagePart,
  CloudPublicShareResponse,
  CloudShare,
  CloudShareListResponse,
  CloudSharedMessage,
} from "@synara/contracts/cloud";

import type { Principal } from "../auth/guard.ts";
import type { ChatService } from "../chat/ChatService.ts";
import { branchTo } from "../chat/tree.ts";
import { DOWNLOAD_URL_SECONDS } from "../files/FileService.ts";
import { ApiError } from "../http/errors.ts";
import type { BlobStore } from "../sync/BlobStore.ts";

type ShareRow = typeof schema.shares.$inferSelect;
type SharedMessage = typeof CloudSharedMessage.Encoded;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const notFound = () => new ApiError(404, "not_found", "Not found.");

function toShare(row: ShareRow): typeof CloudShare.Encoded {
  return {
    id: row.id,
    conversationId: row.conversationId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export class ShareService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly chat: Pick<ChatService, "own" | "messages">,
    private readonly blobs: BlobStore,
    private readonly webPublicUrl: string,
  ) {}

  async create(
    p: Principal,
    conversationId: string,
    input: CloudCreateShareInput,
  ): Promise<typeof CloudCreateShareResponse.Encoded> {
    const conversation = await this.chat.own(p, conversationId);
    const leafId = input.messageId ?? conversation.currentLeafId;
    const branch = branchTo(await this.chat.messages(conversationId), leafId);
    if (branch.length === 0) throw notFound();
    const snapshot: SharedMessage[] = branch
      .filter((m) => m.parts.length > 0)
      .map((m) => ({
        role: m.role,
        parts: m.parts as SharedMessage["parts"],
        createdAt: m.createdAt.toISOString(),
      }));
    const token = randomBytes(32).toString("base64url");
    const [row] = await this.db
      .insert(schema.shares)
      .values({
        orgId: p.orgId,
        userId: p.userId,
        conversationId,
        tokenHash: hashToken(token),
        leafMessageId: branch.at(-1)!.id,
        title: conversation.title,
        snapshot,
      })
      .returning();
    return { share: toShare(row!), url: `${this.webPublicUrl}/share/${token}` };
  }

  async list(p: Principal): Promise<typeof CloudShareListResponse.Encoded> {
    const rows = await this.db
      .select()
      .from(schema.shares)
      .where(and(eq(schema.shares.orgId, p.orgId), eq(schema.shares.userId, p.userId)))
      .orderBy(desc(schema.shares.createdAt));
    return { shares: rows.map(toShare) };
  }

  async revoke(p: Principal, id: string): Promise<typeof CloudShare.Encoded> {
    const [row] = await this.db
      .update(schema.shares)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.shares.id, id),
          eq(schema.shares.orgId, p.orgId),
          eq(schema.shares.userId, p.userId),
          isNull(schema.shares.revokedAt),
        ),
      )
      .returning();
    if (row) return toShare(row);
    const revoked = await this.db.query.shares.findFirst({
      where: and(
        eq(schema.shares.id, id),
        eq(schema.shares.orgId, p.orgId),
        eq(schema.shares.userId, p.userId),
      ),
    });
    if (!revoked) throw notFound();
    return toShare(revoked);
  }

  /** The public view. Images get short-lived URLs scoped to the files in this snapshot. */
  async view(token: string): Promise<typeof CloudPublicShareResponse.Encoded> {
    if (!TOKEN.test(token)) throw notFound();
    const [found] = await this.db
      .select({ share: schema.shares })
      .from(schema.shares)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.shares.conversationId))
      .where(
        and(
          eq(schema.shares.tokenHash, hashToken(token)),
          isNull(schema.shares.revokedAt),
          isNull(schema.conversations.deletedAt),
        ),
      );
    if (!found) throw notFound();
    const { share } = found;
    const messages = share.snapshot as SharedMessage[];
    const imageIds = messages.flatMap((m) =>
      (m.parts as CloudMessagePart[]).flatMap((p) => (p.type === "image_ref" ? [p.fileId] : [])),
    );
    const images = imageIds.length
      ? await this.db
          .select({ id: schema.files.id, storageKey: schema.files.storageKey })
          .from(schema.files)
          .where(
            and(
              inArray(schema.files.id, imageIds),
              eq(schema.files.orgId, share.orgId),
              eq(schema.files.status, "ready"),
              isNull(schema.files.deletedAt),
            ),
          )
      : [];
    const imageUrls: Record<string, string> = {};
    for (const image of images)
      imageUrls[image.id] = (
        await this.blobs.presignDownload(image.storageKey, DOWNLOAD_URL_SECONDS)
      ).url;
    return { title: share.title, createdAt: share.createdAt.toISOString(), messages, imageUrls };
  }
}
