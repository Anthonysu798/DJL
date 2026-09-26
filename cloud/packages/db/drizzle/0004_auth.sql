ALTER TABLE "user" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "native_auth_codes" ADD COLUMN "client_id" text NOT NULL;