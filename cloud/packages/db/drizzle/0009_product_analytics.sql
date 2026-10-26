CREATE TABLE "analytics_daily_activity" (
	"day" text NOT NULL,
	"installation_id" uuid NOT NULL,
	"actor_key" text NOT NULL,
	"user_id" uuid,
	"feature" text NOT NULL,
	"platform" text NOT NULL,
	"app_version" text NOT NULL,
	"channel" text NOT NULL,
	"events" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "analytics_daily_activity_day_installation_id_actor_key_feature_app_version_pk" PRIMARY KEY("day","installation_id","actor_key","feature","app_version")
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"installation_id" uuid NOT NULL,
	"user_id" uuid,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"feature" text,
	"platform" text NOT NULL,
	"app_version" text NOT NULL,
	"channel" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_installations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"credential_hash" text NOT NULL,
	"platform" text NOT NULL,
	"app_version" text NOT NULL,
	"os_version" text NOT NULL,
	"channel" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_opened_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "analytics_installations_credential_hash_unique" UNIQUE("credential_hash")
);
--> statement-breakpoint
CREATE TABLE "analytics_source_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"dimension_key" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"value" bigint NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_daily_activity" ADD CONSTRAINT "analytics_daily_activity_installation_id_analytics_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."analytics_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_daily_activity" ADD CONSTRAINT "analytics_daily_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_installation_id_analytics_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."analytics_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_daily_user_day_idx" ON "analytics_daily_activity" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "analytics_daily_day_idx" ON "analytics_daily_activity" USING btree ("day");--> statement-breakpoint
CREATE INDEX "analytics_events_installation_idx" ON "analytics_events" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "analytics_events_user_idx" ON "analytics_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "analytics_events_retention_idx" ON "analytics_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "analytics_installations_seen_idx" ON "analytics_installations" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "analytics_source_history_idx" ON "analytics_source_snapshots" USING btree ("source","dimension_key","observed_at");