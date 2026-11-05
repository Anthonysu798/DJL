CREATE TABLE "commerce_alert_incidents" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"order_id" uuid,
	"source_status" text NOT NULL,
	"state" text NOT NULL,
	"first_detected_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"last_transition_at" timestamp with time zone NOT NULL,
	CONSTRAINT "commerce_alert_kind" CHECK ("commerce_alert_incidents"."kind" in ('payment_unresolved','payment_review','refund_unresolved','refund_review','refund_pending','event_unprocessed','event_review_unmapped','external_refund_unresolved','withdrawal_requested','withdrawal_approved')),
	CONSTRAINT "commerce_alert_resource_type" CHECK ("commerce_alert_incidents"."resource_type" in ('payment_attempt','provider_refund','payment_event','external_refund','withdrawal')),
	CONSTRAINT "commerce_alert_state" CHECK ("commerce_alert_incidents"."state" in ('pending','open','resolved')),
	CONSTRAINT "commerce_alert_lifecycle" CHECK ("commerce_alert_incidents"."first_detected_at"<="commerce_alert_incidents"."last_seen_at" and "commerce_alert_incidents"."first_detected_at"<="commerce_alert_incidents"."last_transition_at" and
      (("commerce_alert_incidents"."state"='pending' and "commerce_alert_incidents"."opened_at" is null and "commerce_alert_incidents"."resolved_at" is null) or
       ("commerce_alert_incidents"."state"='open' and "commerce_alert_incidents"."opened_at" is not null and "commerce_alert_incidents"."resolved_at" is null) or
       ("commerce_alert_incidents"."state"='resolved' and "commerce_alert_incidents"."resolved_at" is not null)))
);
--> statement-breakpoint
ALTER TABLE "commerce_alert_incidents" ADD CONSTRAINT "commerce_alert_incidents_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_alert_active_unique" ON "commerce_alert_incidents" USING btree ("kind","resource_id") WHERE "commerce_alert_incidents"."state" in ('pending','open');--> statement-breakpoint
CREATE INDEX "commerce_alert_transition_idx" ON "commerce_alert_incidents" USING btree ("last_transition_at","id");