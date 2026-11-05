import { schema, type DjlDatabase } from "@djl/db";
import { eq, sql } from "drizzle-orm";

/** Credential writes and bans bump in PG; explicit global revocation calls this. */
export async function revokeCommerceAuth(db: Pick<DjlDatabase, "update">, userId: string) {
  await db
    .update(schema.user)
    .set({
      commerceAuthGeneration: sql`${schema.user.commerceAuthGeneration} + 1`,
      updatedAt: schema.user.updatedAt,
    })
    .where(eq(schema.user.id, userId));
}
