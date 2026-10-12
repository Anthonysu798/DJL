import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { CloudNotificationsResponse } from "@synara/contracts/cloud";
import type { Principal } from "../auth/guard.ts";
import { ApiError } from "../http/errors.ts";

const PAGE_SIZE = 30;
type Cursor = { at: string; id: string };

function decodeCursor(raw: string): Cursor {
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString()) as Cursor;
    if (
      typeof value.at === "string" &&
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$/.test(value.at) &&
      Number.isFinite(Date.parse(value.at)) &&
      new Date(value.at).getUTCFullYear() >= 1 &&
      new Date(value.at).toISOString().slice(0, 19) === value.at.slice(0, 19) &&
      typeof value.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)
    )
      return value;
  } catch {
    /* Invalid cursors are client errors, never database parameters. */
  }
  throw new ApiError(400, "bad_cursor", "Invalid cursor.");
}

export class NotificationService {
  constructor(private readonly db: DjlDatabase) {}

  private eligible(p: Principal) {
    return and(
      eq(schema.runs.orgId, p.orgId),
      eq(schema.runs.userId, p.userId),
      eq(schema.runs.mode, "task"),
      inArray(schema.runs.status, ["succeeded", "failed"]),
      isNotNull(schema.runs.finishedAt),
      isNull(schema.conversations.deletedAt),
      eq(schema.conversations.orgId, p.orgId),
      eq(schema.conversations.userId, p.userId),
    );
  }

  private receipt(p: Principal) {
    return and(
      eq(schema.notificationReads.runId, schema.runs.id),
      eq(schema.notificationReads.userId, p.userId),
      eq(schema.notificationReads.orgId, p.orgId),
    );
  }

  async unreadCount(p: Principal): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.runs)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.runs.conversationId))
      .leftJoin(schema.notificationReads, this.receipt(p))
      .where(and(this.eligible(p), isNull(schema.notificationReads.readAt)));
    return row?.count ?? 0;
  }

  async list(p: Principal, cursor?: string): Promise<typeof CloudNotificationsResponse.Encoded> {
    const after = cursor ? decodeCursor(cursor) : null;
    const rows = await this.db
      .select({
        run: schema.runs,
        title: schema.conversations.title,
        readAt: schema.notificationReads.readAt,
        cursorAt: sql<string>`to_char(${schema.runs.finishedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(schema.runs)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.runs.conversationId))
      .leftJoin(schema.notificationReads, this.receipt(p))
      .where(
        and(
          this.eligible(p),
          after
            ? or(
                sql`${schema.runs.finishedAt} < ${after.at}::timestamptz`,
                and(
                  sql`${schema.runs.finishedAt} = ${after.at}::timestamptz`,
                  lt(schema.runs.id, after.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(schema.runs.finishedAt), desc(schema.runs.id))
      .limit(PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      notifications: page.map(({ run, title, readAt }) => ({
        id: run.id,
        conversationId: run.conversationId,
        conversationTitle: title,
        status: run.status as "succeeded" | "failed",
        finishedAt: run.finishedAt!.toISOString(),
        readAt: readAt?.toISOString() ?? null,
      })),
      nextCursor:
        rows.length > PAGE_SIZE && last
          ? Buffer.from(JSON.stringify({ at: last.cursorAt, id: last.run.id })).toString(
              "base64url",
            )
          : null,
      unreadCount: await this.unreadCount(p),
    };
  }

  async markRead(p: Principal, input: readonly string[]): Promise<{ unreadCount: number }> {
    const ids = [...new Set(input)];
    if (!ids.length || ids.length > PAGE_SIZE)
      throw new ApiError(400, "bad_request", "Choose 1–30 notifications.");
    await this.db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: schema.runs.id })
        .from(schema.runs)
        .innerJoin(schema.conversations, eq(schema.conversations.id, schema.runs.conversationId))
        .where(and(this.eligible(p), inArray(schema.runs.id, ids)));
      if (owned.length !== ids.length) throw new ApiError(404, "not_found", "Not found.");
      await tx
        .insert(schema.notificationReads)
        .values(ids.map((runId) => ({ userId: p.userId, orgId: p.orgId, runId })))
        .onConflictDoNothing({
          target: [schema.notificationReads.userId, schema.notificationReads.runId],
        });
    });
    return { unreadCount: await this.unreadCount(p) };
  }
}
