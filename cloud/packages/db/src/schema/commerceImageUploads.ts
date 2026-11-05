import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth.ts";

export type CommerceImageUploadStatus = "pending" | "verifying" | "ready" | "rejected";

/** Short-lived shop photos never enter the AI files table or its object namespace. */
export const commerceImageUploads = pgTable(
  "commerce_image_uploads",
  {
    id: uuid("id").primaryKey(),
    // A deleted user loses access; retain the short-lived row until its objects can be purged.
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    status: text("status").$type<CommerceImageUploadStatus>().notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    cleanupRetryAt: timestamp("cleanup_retry_at", { withTimezone: true }),
  },
  (t) => [
    index("commerce_image_upload_owner_idx").on(t.userId, t.id),
    index("commerce_image_upload_expiry_idx").on(t.expiresAt),
    check(
      "commerce_image_upload_mime",
      sql`${t.mimeType} in ('image/jpeg','image/png','image/webp')`,
    ),
    check("commerce_image_upload_size", sql`${t.sizeBytes} between 1 and 10485760`),
    check("commerce_image_upload_hash", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "commerce_image_upload_status",
      sql`${t.status} in ('pending','verifying','ready','rejected')`,
    ),
    check(
      "commerce_image_upload_expiry",
      sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '30 minutes'`,
    ),
  ],
);
