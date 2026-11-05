CREATE TABLE "commerce_image_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "commerce_image_upload_mime" CHECK ("commerce_image_uploads"."mime_type" in ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "commerce_image_upload_size" CHECK ("commerce_image_uploads"."size_bytes" between 1 and 10485760),
	CONSTRAINT "commerce_image_upload_hash" CHECK ("commerce_image_uploads"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "commerce_image_upload_status" CHECK ("commerce_image_uploads"."status" in ('pending','verifying','ready','rejected')),
	CONSTRAINT "commerce_image_upload_expiry" CHECK ("commerce_image_uploads"."expires_at" > "commerce_image_uploads"."created_at" and "commerce_image_uploads"."expires_at" <= "commerce_image_uploads"."created_at" + interval '30 minutes')
);
--> statement-breakpoint
ALTER TABLE "commerce_auth_session" ADD COLUMN "auth_generation" integer DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_auth_verification" ADD COLUMN "auth_generation" integer DEFAULT -1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "commerce_auth_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_image_uploads" ADD CONSTRAINT "commerce_image_uploads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_image_upload_owner_idx" ON "commerce_image_uploads" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "commerce_image_upload_expiry_idx" ON "commerce_image_uploads" USING btree ("expires_at");
--> statement-breakpoint
-- Password reset/change uses both account UPDATE and INSERT (the first credential).
CREATE FUNCTION commerce_auth_credential_generation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.provider_id = 'credential' AND NEW.account_id = NEW.user_id::text
    AND (CASE WHEN TG_OP = 'INSERT' THEN NEW.password IS NOT NULL
      ELSE NEW.password IS DISTINCT FROM OLD.password END) THEN
    UPDATE public."user"
    SET commerce_auth_generation = commerce_auth_generation + 1
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER commerce_auth_credential_generation
AFTER INSERT OR UPDATE OF password ON "account"
FOR EACH ROW EXECUTE FUNCTION commerce_auth_credential_generation();--> statement-breakpoint
-- Re-enabling an account must not resurrect a session from before suspension.
CREATE FUNCTION commerce_auth_ban_generation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.commerce_auth_generation := OLD.commerce_auth_generation + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER commerce_auth_ban_generation
BEFORE UPDATE OF banned ON "user"
FOR EACH ROW
WHEN (NEW.banned IS TRUE AND OLD.banned IS DISTINCT FROM TRUE)
EXECUTE FUNCTION commerce_auth_ban_generation();
