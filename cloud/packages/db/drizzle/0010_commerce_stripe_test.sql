CREATE TABLE "commerce_payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"request_key" text NOT NULL,
	"referrer_id" uuid,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'cad' NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"session_id" text,
	"payment_intent_id" text,
	"checkout_url" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_payment_attempts_session_id_unique" UNIQUE("session_id"),
	CONSTRAINT "commerce_payment_attempts_payment_intent_id_unique" UNIQUE("payment_intent_id"),
	CONSTRAINT "commerce_payment_test_amount" CHECK ("commerce_payment_attempts"."currency"='cad' and "commerce_payment_attempts"."amount_cents" between 50 and 99999999),
	CONSTRAINT "commerce_payment_state" CHECK ("commerce_payment_attempts"."status" in ('creating','open','unknown','cancel_requested','paid','expired_unpaid','failed','requires_review'))
);
--> statement-breakpoint
CREATE TABLE "commerce_payment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"object_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"outcome" text,
	"error_code" text,
	"facts" jsonb
);
--> statement-breakpoint
CREATE TABLE "commerce_provider_refunds" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"request_key" text NOT NULL,
	"reason" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"refund_total_cents" bigint NOT NULL,
	"status" text DEFAULT 'submitting' NOT NULL,
	"provider_refund_id" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_provider_refunds_provider_refund_id_unique" UNIQUE("provider_refund_id"),
	CONSTRAINT "commerce_provider_refund_amount" CHECK ("commerce_provider_refunds"."amount_cents">0 and "commerce_provider_refunds"."refund_total_cents">="commerce_provider_refunds"."amount_cents" and "commerce_provider_refunds"."refund_total_cents"<=99999999),
	CONSTRAINT "commerce_provider_refund_state" CHECK ("commerce_provider_refunds"."status" in ('submitting','unknown','pending','succeeded','failed','requires_review'))
);
--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD COLUMN "payment_provider" text DEFAULT 'simulation' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_payment_attempts" ADD CONSTRAINT "commerce_payment_attempts_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_payment_attempts" ADD CONSTRAINT "commerce_payment_attempts_referrer_id_commerce_customers_user_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."commerce_customers"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_provider_refunds" ADD CONSTRAINT "commerce_provider_refunds_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_provider_refunds" ADD CONSTRAINT "commerce_provider_refunds_item_id_commerce_order_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."commerce_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_provider_refunds" ADD CONSTRAINT "commerce_provider_refunds_attempt_id_commerce_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."commerce_payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_payment_request_unique" ON "commerce_payment_attempts" USING btree ("order_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_payment_one_active" ON "commerce_payment_attempts" USING btree ("order_id") WHERE "commerce_payment_attempts"."status" in ('creating','open','unknown','cancel_requested','requires_review');--> statement-breakpoint
CREATE INDEX "commerce_payment_order_idx" ON "commerce_payment_attempts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "commerce_payment_event_object_idx" ON "commerce_payment_events" USING btree ("object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_refund_request_unique" ON "commerce_provider_refunds" USING btree ("actor_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_refund_one_active" ON "commerce_provider_refunds" USING btree ("item_id") WHERE "commerce_provider_refunds"."status" in ('submitting','unknown','pending','requires_review');--> statement-breakpoint
CREATE INDEX "commerce_provider_refund_order_idx" ON "commerce_provider_refunds" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_order_payment_provider" CHECK ("commerce_orders"."payment_provider" in ('simulation','stripe_test'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce_order_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.total_cents IS DISTINCT FROM OLD.total_cents OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.address IS DISTINCT FROM OLD.address OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.mode IS DISTINCT FROM OLD.mode OR NEW.payment_provider IS DISTINCT FROM OLD.payment_provider OR (OLD.paid_at IS NOT NULL AND (NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.referrer_id IS DISTINCT FROM OLD.referrer_id)) THEN RAISE EXCEPTION 'Order snapshot cannot be changed'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION commerce_payment_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.order_id,NEW.request_key,NEW.referrer_id,NEW.amount_cents,NEW.currency,NEW.created_at) IS DISTINCT FROM ROW(OLD.order_id,OLD.request_key,OLD.referrer_id,OLD.amount_cents,OLD.currency,OLD.created_at) OR (OLD.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id) OR (OLD.payment_intent_id IS NOT NULL AND NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id) THEN RAISE EXCEPTION 'Payment request snapshot cannot be changed'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER commerce_payment_snapshot BEFORE UPDATE ON commerce_payment_attempts FOR EACH ROW EXECUTE FUNCTION commerce_payment_snapshot_guard();
--> statement-breakpoint
CREATE FUNCTION commerce_refund_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.order_id,NEW.item_id,NEW.attempt_id,NEW.actor_id,NEW.request_key,NEW.reason,NEW.amount_cents,NEW.refund_total_cents,NEW.created_at) IS DISTINCT FROM ROW(OLD.order_id,OLD.item_id,OLD.attempt_id,OLD.actor_id,OLD.request_key,OLD.reason,OLD.amount_cents,OLD.refund_total_cents,OLD.created_at) OR (OLD.provider_refund_id IS NOT NULL AND NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id) OR (OLD.applied_at IS NOT NULL AND NEW.applied_at IS DISTINCT FROM OLD.applied_at) THEN RAISE EXCEPTION 'Refund request snapshot cannot be changed'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER commerce_refund_snapshot BEFORE UPDATE ON commerce_provider_refunds FOR EACH ROW EXECUTE FUNCTION commerce_refund_snapshot_guard();
--> statement-breakpoint
CREATE FUNCTION commerce_event_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.id,NEW.type,NEW.object_id,NEW.payload_hash,NEW.received_at) IS DISTINCT FROM ROW(OLD.id,OLD.type,OLD.object_id,OLD.payload_hash,OLD.received_at) THEN RAISE EXCEPTION 'Event identity cannot be changed'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER commerce_event_snapshot BEFORE UPDATE ON commerce_payment_events FOR EACH ROW EXECUTE FUNCTION commerce_event_snapshot_guard();
--> statement-breakpoint
CREATE TRIGGER commerce_payment_no_delete BEFORE DELETE ON commerce_payment_attempts FOR EACH ROW EXECUTE FUNCTION commerce_append_only();
--> statement-breakpoint
CREATE TRIGGER commerce_payment_no_truncate BEFORE TRUNCATE ON commerce_payment_attempts FOR EACH STATEMENT EXECUTE FUNCTION commerce_append_only();
--> statement-breakpoint
CREATE TRIGGER commerce_refund_no_delete BEFORE DELETE ON commerce_provider_refunds FOR EACH ROW EXECUTE FUNCTION commerce_append_only();
--> statement-breakpoint
CREATE TRIGGER commerce_refund_no_truncate BEFORE TRUNCATE ON commerce_provider_refunds FOR EACH STATEMENT EXECUTE FUNCTION commerce_append_only();
--> statement-breakpoint
CREATE TRIGGER commerce_event_no_delete BEFORE DELETE ON commerce_payment_events FOR EACH ROW EXECUTE FUNCTION commerce_append_only();
--> statement-breakpoint
CREATE TRIGGER commerce_event_no_truncate BEFORE TRUNCATE ON commerce_payment_events FOR EACH STATEMENT EXECUTE FUNCTION commerce_append_only();
