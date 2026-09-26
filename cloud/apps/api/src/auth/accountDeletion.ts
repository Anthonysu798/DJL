/**
 * Self-service account deletion (required for App Store review). Uses the
 * same soft delete as the admin console: the account is locked with
 * `ban_reason = 'self_delete'`, the worker purges it after the 30-day grace,
 * and every session ends now (their access tokens go on the denylist through
 * the session delete hook).
 */
import { eq } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";

import { writeAudit } from "../audit/AuditLog.ts";
import type { DjlAuth } from "./auth.ts";

export async function deleteOwnAccount(input: {
  readonly db: DjlDatabase;
  readonly auth: DjlAuth;
  readonly userId: string;
  readonly ipHash: string | null;
  readonly traceId: string;
}): Promise<void> {
  const { db, auth, userId } = input;
  const deletedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.user)
      .set({ banned: true, banReason: "self_delete", banExpires: deletedAt })
      .where(eq(schema.user.id, userId));
    await writeAudit(tx, {
      actorType: "user",
      actorId: userId,
      action: "user.delete",
      targetType: "user",
      targetId: userId,
      after: { deletedAt: deletedAt.toISOString() },
      ipHash: input.ipHash,
      traceId: input.traceId,
    });
  });
  const ctx = await auth.$context;
  await ctx.internalAdapter.deleteUserSessions(userId);
}
