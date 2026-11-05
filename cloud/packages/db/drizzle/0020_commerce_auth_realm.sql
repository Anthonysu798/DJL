CREATE TABLE "commerce_auth_session" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "commerce_auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "commerce_auth_verification" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commerce_auth_session" ADD CONSTRAINT "commerce_auth_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_auth_session_user_id_idx" ON "commerce_auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "commerce_auth_verification_identifier_idx" ON "commerce_auth_verification" USING btree ("identifier");