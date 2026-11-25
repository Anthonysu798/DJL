ALTER TYPE "public"."kill_switch" ADD VALUE 'sites';--> statement-breakpoint
CREATE TABLE "site_deploys" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"zip_bytes" integer NOT NULL,
	"zip_sha256" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"manifest" jsonb,
	"reason" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "site_reports" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"ip_hash" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"disabled_reason" text,
	"live_deploy_id" uuid,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"last_deploy_at" timestamp with time zone,
	"last_visit_at" timestamp with time zone,
	"expiry_warned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_deploys" ADD CONSTRAINT "site_deploys_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_deploys" ADD CONSTRAINT "site_deploys_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_deploys" ADD CONSTRAINT "site_deploys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_deploys" ADD CONSTRAINT "site_deploys_reviewed_by_admins_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_reports" ADD CONSTRAINT "site_reports_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_reports" ADD CONSTRAINT "site_reports_resolved_by_admins_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_deploys_site_created_idx" ON "site_deploys" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "site_deploys_status_idx" ON "site_deploys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "site_reports_status_created_idx" ON "site_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_name_idx" ON "sites" USING btree ("name");--> statement-breakpoint
CREATE INDEX "sites_org_user_idx" ON "sites" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "sites_status_idx" ON "sites" USING btree ("status");