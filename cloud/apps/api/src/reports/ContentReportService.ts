/**
 * Reports of offensive, harmful, or wrong AI answers (a store requirement for
 * apps with AI-generated content). A cloud report snapshots the caller's own
 * assistant message so moderators can review it after deletion; a desktop
 * report stores the answer text the phone received from the user's own Mac.
 * Report text, notes, and message content are never logged.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { CONTENT_REPORT_LIMITS, contentReportFieldError } from "@djl/domain";
import type {
  CloudCreateContentReportInput,
  CloudCreateContentReportResponse,
} from "@djl/contracts/cloud";

import { requirePermission, type AdminPrincipal } from "../admin/AdminAuth.ts";
import { writeAudit } from "../audit/AuditLog.ts";
import type { Principal } from "../auth/guard.ts";
import type { ChatService } from "../chat/ChatService.ts";
import type { RateLimiter } from "../gateway/RateLimiter.ts";
import { ApiError } from "../http/errors.ts";

type ReportRow = typeof schema.contentReports.$inferSelect;
type Created = {
  readonly status: 200 | 201;
  readonly body: typeof CloudCreateContentReportResponse.Encoded;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new ApiError(404, "not_found", "Not found.");
const created = (row: ReportRow, status: 200 | 201): Created => ({
  status,
  body: { report: { id: row.id, createdAt: row.createdAt.toISOString() } },
});

export class ContentReportService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly chat: Pick<ChatService, "own">,
    private readonly limiter: RateLimiter,
  ) {}

  /** `p` is null for a signed-out caller, who is limited by `ipHash` instead. */
  async create(
    p: Principal | null,
    ipHash: string | null,
    input: CloudCreateContentReportInput,
  ): Promise<Created> {
    const mismatch = contentReportFieldError(input);
    if (mismatch) throw new ApiError(400, "bad_request", mismatch);
    if (input.source === "cloud" && !p)
      throw new ApiError(401, "unauthorized", "Sign in required.");

    const key = p ? `report:user:${p.userId}` : `report:ip:${ipHash ?? "unknown"}`;
    for (const { limit, windowSeconds } of CONTENT_REPORT_LIMITS) {
      const hit = await this.limiter.hit(`${key}:${windowSeconds}`, limit, windowSeconds);
      if (!hit.allowed) throw new ApiError(429, "rate_limited", "Too many reports. Try later.");
    }

    const note = input.note || null;
    if (input.source === "desktop") {
      const row = await this.insert({
        orgId: p?.orgId ?? null,
        userId: p?.userId ?? null,
        source: "desktop",
        reason: input.reason,
        note,
        snapshot: [{ type: "text", text: input.text! }],
        agent: input.agent || null,
      });
      return created(row!, 201);
    }

    const caller = p!;
    const conversationId = input.conversationId!;
    const messageId = input.messageId!;
    if (!UUID.test(conversationId) || !UUID.test(messageId)) throw notFound();
    await this.chat.own(caller, conversationId);
    const message = await this.db.query.messages.findFirst({
      where: and(
        eq(schema.messages.id, messageId),
        eq(schema.messages.conversationId, conversationId),
      ),
    });
    if (!message) throw notFound();
    if (message.role !== "assistant")
      throw new ApiError(400, "not_assistant_message", "Only AI answers can be reported.");

    const existing = await this.existing(caller.userId, message.id);
    if (existing) return created(existing, 200);
    const row = await this.insert({
      orgId: caller.orgId,
      userId: caller.userId,
      source: "cloud",
      reason: input.reason,
      note,
      conversationId,
      messageId: message.id,
      snapshot: message.parts,
      model: message.model,
    });
    if (row) return created(row, 201);
    // A concurrent identical report won the unique index.
    const raced = await this.existing(caller.userId, message.id);
    if (!raced) throw new Error("content report vanished after a conflict");
    return created(raced, 200);
  }

  private existing(userId: string, messageId: string) {
    return this.db.query.contentReports.findFirst({
      where: and(
        eq(schema.contentReports.userId, userId),
        eq(schema.contentReports.messageId, messageId),
      ),
    });
  }

  /** Undefined only when the (user, message) report already exists. */
  private async insert(
    values: typeof schema.contentReports.$inferInsert,
  ): Promise<ReportRow | undefined> {
    try {
      const [row] = await this.db
        .insert(schema.contentReports)
        .values(values)
        .onConflictDoNothing()
        .returning();
      return row;
    } catch {
      // Driver errors can echo the query parameters, which hold the reported text.
      throw new Error("content report insert failed");
    }
  }

  // ---- admin -----------------------------------------------------------------

  async list(
    p: AdminPrincipal,
    input: { readonly status?: string; readonly limit?: number; readonly cursor?: string },
  ) {
    requirePermission(p, "reports.review");
    const status = input.status === "resolved" ? "resolved" : "open";
    const limit = Math.min(Math.max(Number.isFinite(input.limit) ? input.limit! : 25, 1), 100);
    if (input.cursor !== undefined && !UUID.test(input.cursor))
      throw new ApiError(400, "bad_cursor", "Invalid cursor.");
    const r = schema.contentReports;
    const rows = await this.db
      .select()
      .from(r)
      .where(
        and(
          eq(r.status, status),
          input.cursor
            ? sql`(${r.createdAt}, ${r.id}) < (SELECT created_at, id FROM content_reports WHERE id = ${input.cursor}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(r.createdAt), desc(r.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      reports: page.map((row) => ({
        id: row.id,
        source: row.source,
        reason: row.reason,
        note: row.note,
        status: row.status,
        orgId: row.orgId,
        userId: row.userId,
        conversationId: row.conversationId,
        messageId: row.messageId,
        snapshot: row.snapshot,
        agent: row.agent,
        model: row.model,
        createdAt: row.createdAt,
        resolvedAt: row.resolvedAt,
        resolvedBy: row.resolvedBy,
      })),
      nextCursor: rows.length > limit ? page.at(-1)!.id : null,
    };
  }

  async resolve(p: AdminPrincipal, id: string, reason: string | null) {
    requirePermission(p, "reports.review");
    if (!UUID.test(id)) throw new ApiError(404, "not_found", "Report not found.");
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(schema.contentReports)
        .set({ status: "resolved", resolvedAt: new Date(), resolvedBy: p.adminId })
        .where(and(eq(schema.contentReports.id, id), eq(schema.contentReports.status, "open")))
        .returning({ id: schema.contentReports.id, resolvedAt: schema.contentReports.resolvedAt });
      if (!row) {
        const found = await tx.query.contentReports.findFirst({
          where: eq(schema.contentReports.id, id),
        });
        if (!found) throw new ApiError(404, "not_found", "Report not found.");
        throw new ApiError(409, "already_resolved", "That report is already resolved.");
      }
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "admin.content_report.resolve",
        targetType: "content_report",
        targetId: id,
        before: { status: "open" },
        after: { status: "resolved" },
        reason,
      });
      return { id: row.id, status: "resolved" as const, resolvedAt: row.resolvedAt };
    });
  }
}
