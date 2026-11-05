CREATE TABLE "commerce_alert_email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"recipient" text NOT NULL,
	"template_version" text DEFAULT 'commerce-alert-v1' NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"claim_token" uuid,
	"attempted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"provider_id" text,
	"reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_alert_email_mode" CHECK ("commerce_alert_email_deliveries"."mode" in ('mock','resend')),
	CONSTRAINT "commerce_alert_email_state" CHECK ("commerce_alert_email_deliveries"."state" in ('pending','submitting','accepted','simulated','needs_review','skipped_resolved')),
	CONSTRAINT "commerce_alert_email_lifecycle" CHECK (
    (("commerce_alert_email_deliveries"."state"='pending' and "commerce_alert_email_deliveries"."claim_token" is null and "commerce_alert_email_deliveries"."attempted_at" is null and "commerce_alert_email_deliveries"."completed_at" is null)
    or ("commerce_alert_email_deliveries"."state"='submitting' and "commerce_alert_email_deliveries"."claim_token" is not null and "commerce_alert_email_deliveries"."attempted_at" is not null and "commerce_alert_email_deliveries"."completed_at" is null)
    or ("commerce_alert_email_deliveries"."state" in ('accepted','simulated') and "commerce_alert_email_deliveries"."claim_token" is not null and "commerce_alert_email_deliveries"."attempted_at" is not null and "commerce_alert_email_deliveries"."completed_at" is not null and coalesce(length("commerce_alert_email_deliveries"."provider_id"),0)>0)
    or ("commerce_alert_email_deliveries"."state" in ('needs_review','skipped_resolved') and "commerce_alert_email_deliveries"."completed_at" is not null and "commerce_alert_email_deliveries"."reason_code" is not null))
    and ("commerce_alert_email_deliveries"."state"<>'accepted' or "commerce_alert_email_deliveries"."mode"='resend') and ("commerce_alert_email_deliveries"."state"<>'simulated' or "commerce_alert_email_deliveries"."mode"='mock')
    and ("commerce_alert_email_deliveries"."completed_at" is null or "commerce_alert_email_deliveries"."completed_at">="commerce_alert_email_deliveries"."created_at")
  )
);
--> statement-breakpoint
ALTER TABLE "commerce_alert_email_deliveries" ADD CONSTRAINT "commerce_alert_email_deliveries_incident_id_commerce_alert_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."commerce_alert_incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_alert_email_incident_mode_unique" ON "commerce_alert_email_deliveries" USING btree ("incident_id","mode");--> statement-breakpoint
CREATE INDEX "commerce_alert_email_pending_idx" ON "commerce_alert_email_deliveries" USING btree ("state","created_at","id");