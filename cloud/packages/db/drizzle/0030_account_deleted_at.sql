ALTER TABLE "user" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
-- Deletions used an already-expired ban, which the next sign-in lifted. Keep the
-- pending ones, with their original grace period, as permanent locks.
UPDATE "user" SET "deleted_at" = "ban_expires", "ban_expires" = NULL
WHERE "ban_reason" = 'self_delete' AND "banned" IS TRUE AND "ban_expires" IS NOT NULL;
