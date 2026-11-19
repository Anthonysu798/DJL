ALTER TYPE "public"."admin_role" ADD VALUE 'commerce';
--> statement-breakpoint
CREATE TYPE "public"."commerce_staff_role" AS ENUM ('operations', 'support', 'finance', 'read_only', 'none');
--> statement-breakpoint
ALTER TABLE "admins" ADD COLUMN "commerce_role" "public"."commerce_staff_role";
--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_commerce_scope_check" CHECK (("role"::text = 'commerce' AND "commerce_role" IS NOT NULL) OR ("role"::text IN ('admin','employee') AND "commerce_role" IS NULL));
