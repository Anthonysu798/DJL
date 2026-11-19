CREATE TABLE "commerce_external_refund_allocations" (
	"external_refund_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"refunded_before_cents" bigint NOT NULL,
	"refunded_after_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_external_refund_allocations_external_refund_id_item_id_pk" PRIMARY KEY("external_refund_id","item_id"),
	CONSTRAINT "commerce_external_allocation_amount" CHECK ("commerce_external_refund_allocations"."amount_cents">0 and "commerce_external_refund_allocations"."refunded_before_cents">=0 and "commerce_external_refund_allocations"."refunded_after_cents"="commerce_external_refund_allocations"."refunded_before_cents"+"commerce_external_refund_allocations"."amount_cents" and "commerce_external_refund_allocations"."refunded_after_cents"<=99999999)
);
--> statement-breakpoint
CREATE TABLE "commerce_external_refunds" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"provider_refund_id" text NOT NULL,
	"source_event_id" text NOT NULL,
	"payment_intent_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'cad' NOT NULL,
	"provider_status" text DEFAULT 'unknown' NOT NULL,
	"allocation_state" text DEFAULT 'unallocated' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"hold_version" integer,
	"allocated_at" timestamp with time zone,
	"allocated_by" text,
	"allocation_fingerprint" text,
	"allocation_reason" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_external_refunds_provider_refund_id_unique" UNIQUE("provider_refund_id"),
	CONSTRAINT "commerce_external_refund_amount" CHECK ("commerce_external_refunds"."currency"='cad' and "commerce_external_refunds"."amount_cents" between 1 and 99999999),
	CONSTRAINT "commerce_external_refund_status" CHECK ("commerce_external_refunds"."provider_status" in ('unknown','pending','requires_action','succeeded','failed','canceled')),
	CONSTRAINT "commerce_external_refund_state" CHECK ("commerce_external_refunds"."allocation_state" in ('unallocated','allocated','excluded_owned','requires_review')),
	CONSTRAINT "commerce_external_refund_version" CHECK ("commerce_external_refunds"."version">=1 and ("commerce_external_refunds"."hold_version" is null or "commerce_external_refunds"."hold_version">0))
);
--> statement-breakpoint
ALTER TABLE "commerce_order_items" ADD COLUMN "sku" text;--> statement-breakpoint
ALTER TABLE "commerce_payment_attempts" ADD COLUMN "review_key" text;--> statement-breakpoint
ALTER TABLE "commerce_payment_attempts" ADD COLUMN "review_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_external_refund_allocations" ADD CONSTRAINT "commerce_external_refund_allocations_external_refund_id_commerce_external_refunds_id_fk" FOREIGN KEY ("external_refund_id") REFERENCES "public"."commerce_external_refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_external_refund_allocations" ADD CONSTRAINT "commerce_external_refund_allocations_item_id_commerce_order_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."commerce_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_external_refunds" ADD CONSTRAINT "commerce_external_refunds_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_external_refunds" ADD CONSTRAINT "commerce_external_refunds_attempt_id_commerce_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."commerce_payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_external_refunds" ADD CONSTRAINT "commerce_external_refunds_source_event_id_commerce_payment_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."commerce_payment_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_external_refund_order_idx" ON "commerce_external_refunds" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "commerce_payment_attempts" ADD CONSTRAINT "commerce_payment_review_version" CHECK ("commerce_payment_attempts"."review_version">=0);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce_item_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.order_id,NEW.product_id,NEW.supplier_id,NEW.name,NEW.sku,NEW.quantity,NEW.price_cents,NEW.cost_cents,NEW.line_cents,NEW.commission_bps,NEW.return_days) IS DISTINCT FROM ROW(OLD.order_id,OLD.product_id,OLD.supplier_id,OLD.name,OLD.sku,OLD.quantity,OLD.price_cents,OLD.cost_cents,OLD.line_cents,OLD.commission_bps,OLD.return_days) THEN RAISE EXCEPTION 'Order item snapshot cannot be changed'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce_payment_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.order_id,NEW.request_key,NEW.referrer_id,NEW.amount_cents,NEW.currency,NEW.created_at) IS DISTINCT FROM ROW(OLD.order_id,OLD.request_key,OLD.referrer_id,OLD.amount_cents,OLD.currency,OLD.created_at) OR (OLD.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id) OR (OLD.payment_intent_id IS NOT NULL AND NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id) OR NEW.review_version<OLD.review_version OR (NEW.review_key IS DISTINCT FROM OLD.review_key AND NEW.review_version<=OLD.review_version) THEN RAISE EXCEPTION 'Payment request snapshot or review generation cannot be changed'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION commerce_external_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.id,NEW.order_id,NEW.attempt_id,NEW.provider_refund_id,NEW.source_event_id,NEW.payment_intent_id,NEW.amount_cents,NEW.currency,NEW.hold_version,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.attempt_id,OLD.provider_refund_id,OLD.source_event_id,OLD.payment_intent_id,OLD.amount_cents,OLD.currency,OLD.hold_version,OLD.created_at) OR NEW.version<OLD.version OR ((NEW.provider_status IS DISTINCT FROM OLD.provider_status OR NEW.allocation_state IS DISTINCT FROM OLD.allocation_state) AND NEW.version<=OLD.version) OR (OLD.allocated_at IS NOT NULL AND ROW(NEW.allocated_at,NEW.allocated_by,NEW.allocation_fingerprint,NEW.allocation_reason,NEW.allocation_state) IS DISTINCT FROM ROW(OLD.allocated_at,OLD.allocated_by,OLD.allocation_fingerprint,OLD.allocation_reason,OLD.allocation_state)) THEN RAISE EXCEPTION 'External refund source or allocation receipt cannot be changed'; END IF;
 IF (NEW.allocation_state='allocated') IS DISTINCT FROM (NEW.allocated_at IS NOT NULL) OR (NEW.allocated_at IS NOT NULL AND (NEW.allocated_by IS NULL OR NEW.allocation_fingerprint IS NULL OR NEW.allocation_reason IS NULL)) THEN RAISE EXCEPTION 'External refund allocation receipt is incomplete'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER commerce_external_refund_snapshot BEFORE UPDATE ON commerce_external_refunds FOR EACH ROW EXECUTE FUNCTION commerce_external_refund_guard();
--> statement-breakpoint
CREATE TRIGGER commerce_external_refund_no_delete BEFORE DELETE ON commerce_external_refunds FOR EACH ROW EXECUTE FUNCTION commerce_append_only();
--> statement-breakpoint
CREATE TRIGGER commerce_external_refund_no_truncate BEFORE TRUNCATE ON commerce_external_refunds FOR EACH STATEMENT EXECUTE FUNCTION commerce_append_only();
--> statement-breakpoint
CREATE TRIGGER commerce_external_allocation_immutable BEFORE UPDATE OR DELETE ON commerce_external_refund_allocations FOR EACH ROW EXECUTE FUNCTION commerce_append_only();
--> statement-breakpoint
CREATE TRIGGER commerce_external_allocation_no_truncate BEFORE TRUNCATE ON commerce_external_refund_allocations FOR EACH STATEMENT EXECUTE FUNCTION commerce_append_only();
--> statement-breakpoint
CREATE FUNCTION commerce_external_allocation_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE target uuid; expected bigint; actual numeric; state text; lines integer;
 BEGIN
 IF TG_TABLE_NAME='commerce_external_refunds' THEN target:=NEW.id; ELSE target:=NEW.external_refund_id; END IF;
 SELECT amount_cents,allocation_state INTO expected,state FROM commerce_external_refunds WHERE id=target;
 SELECT coalesce(sum(amount_cents),0),count(*) INTO actual,lines FROM commerce_external_refund_allocations WHERE external_refund_id=target;
 IF state='allocated' THEN
  IF actual<>expected OR lines<1 THEN RAISE EXCEPTION 'External refund allocation must equal the confirmed full amount'; END IF;
 ELSE IF lines<>0 THEN RAISE EXCEPTION 'Uncommitted external refund allocation rows are not allowed'; END IF; END IF;
 IF EXISTS(SELECT 1 FROM commerce_external_refund_allocations a JOIN commerce_external_refunds e ON e.id=a.external_refund_id JOIN commerce_order_items i ON i.id=a.item_id WHERE a.external_refund_id=target AND (i.order_id<>e.order_id OR a.refunded_after_cents>i.line_cents OR a.refunded_after_cents>i.refunded_cents)) THEN RAISE EXCEPTION 'External allocation must match its order item and posted cumulative refund'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER commerce_external_allocation_sum AFTER INSERT ON commerce_external_refund_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce_external_allocation_balanced();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER commerce_external_refund_sum AFTER INSERT OR UPDATE ON commerce_external_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce_external_allocation_balanced();
