CREATE TABLE "commerce_customers" (
 "user_id" uuid PRIMARY KEY, "referral_code" text NOT NULL UNIQUE,
 "referrer_id" uuid REFERENCES "commerce_customers"("user_id"), "first_paid_at" timestamptz,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "commerce_customer_no_self" CHECK (referrer_id IS NULL OR referrer_id <> user_id)
);--> statement-breakpoint
CREATE TABLE "commerce_suppliers" (
 "id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), "name" text NOT NULL,
 "active" boolean NOT NULL DEFAULT true, "return_address" text NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE "commerce_supplier_members" (
 "supplier_id" uuid NOT NULL REFERENCES "commerce_suppliers"("id"), "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 PRIMARY KEY ("supplier_id","user_id")
);--> statement-breakpoint
CREATE TABLE "commerce_products" (
 "id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), "supplier_id" uuid NOT NULL REFERENCES "commerce_suppliers"("id"),
 "sku" text NOT NULL UNIQUE, "name" text NOT NULL, "description" text NOT NULL, "category" text NOT NULL, "image_url" text NOT NULL,
 "price_cents" bigint NOT NULL, "cost_cents" bigint NOT NULL, "commission_bps" integer NOT NULL, "return_days" integer NOT NULL,
 "stock" integer NOT NULL, "reserved" integer NOT NULL DEFAULT 0, "status" text NOT NULL DEFAULT 'draft',
 "updated_at" timestamptz NOT NULL DEFAULT now(), "created_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "commerce_product_money" CHECK (price_cents BETWEEN 1 AND 100000000 AND cost_cents BETWEEN 0 AND price_cents),
 CONSTRAINT "commerce_product_rate" CHECK (commission_bps BETWEEN 0 AND 10000 AND return_days BETWEEN 0 AND 365),
 CONSTRAINT "commerce_product_stock" CHECK (stock BETWEEN 0 AND 1000000 AND reserved BETWEEN 0 AND stock),
 CONSTRAINT "commerce_product_status" CHECK (status IN ('draft','published','archived'))
);--> statement-breakpoint
CREATE INDEX "commerce_product_catalog_idx" ON "commerce_products" ("status");--> statement-breakpoint
CREATE TABLE "commerce_orders" (
 "id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), "user_id" uuid NOT NULL REFERENCES "commerce_customers"("user_id"),
 "referrer_id" uuid REFERENCES "commerce_customers"("user_id"), "status" text NOT NULL DEFAULT 'awaiting_payment',
 "mode" text NOT NULL DEFAULT 'test', "currency" text NOT NULL DEFAULT 'CAD', "total_cents" bigint NOT NULL,
 "refunded_cents" bigint NOT NULL DEFAULT 0, "address" jsonb NOT NULL, "expires_at" timestamptz NOT NULL,
 "paid_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "commerce_order_money" CHECK (total_cents BETWEEN 1 AND 5000000000000 AND refunded_cents BETWEEN 0 AND total_cents),
 CONSTRAINT "commerce_order_mode" CHECK (mode='test' AND currency='CAD'),
 CONSTRAINT "commerce_order_status" CHECK (status IN ('awaiting_payment','paid','cancelled','refunded'))
);--> statement-breakpoint
CREATE INDEX "commerce_order_owner_idx" ON "commerce_orders" ("user_id");--> statement-breakpoint
CREATE TABLE "commerce_order_items" (
 "id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), "order_id" uuid NOT NULL REFERENCES "commerce_orders"("id"),
 "product_id" uuid NOT NULL REFERENCES "commerce_products"("id"), "supplier_id" uuid NOT NULL REFERENCES "commerce_suppliers"("id"),
 "name" text NOT NULL, "quantity" integer NOT NULL, "price_cents" bigint NOT NULL, "cost_cents" bigint NOT NULL,
 "line_cents" bigint NOT NULL, "refunded_cents" bigint NOT NULL DEFAULT 0, "commission_bps" integer NOT NULL, "return_days" integer NOT NULL,
 "status" text NOT NULL DEFAULT 'pending', "carrier" text, "tracking_number" text, "delivered_at" timestamptz, "open_case" boolean NOT NULL DEFAULT false,
 CONSTRAINT "commerce_item_money" CHECK (quantity BETWEEN 1 AND 1000 AND line_cents=quantity*price_cents AND refunded_cents BETWEEN 0 AND line_cents),
 CONSTRAINT "commerce_item_status" CHECK (status IN ('pending','accepted','shipped','delivered','cancelled'))
);--> statement-breakpoint
CREATE INDEX "commerce_item_order_idx" ON "commerce_order_items" ("order_id");--> statement-breakpoint
CREATE INDEX "commerce_item_supplier_idx" ON "commerce_order_items" ("supplier_id");--> statement-breakpoint
CREATE TABLE "commerce_commissions" (
 "id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), "order_item_id" uuid NOT NULL UNIQUE REFERENCES "commerce_order_items"("id"),
 "user_id" uuid NOT NULL REFERENCES "commerce_customers"("user_id"), "amount_cents" bigint NOT NULL, "released" boolean NOT NULL DEFAULT false,
 "created_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "commerce_commission_amount" CHECK (amount_cents BETWEEN 0 AND 5000000000000)
);--> statement-breakpoint
CREATE TABLE "commerce_ledger" (
 "id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), "event_key" text NOT NULL, "line" integer NOT NULL,
 "owner_id" text NOT NULL, "account" text NOT NULL, "amount_cents" bigint NOT NULL, "currency" text NOT NULL DEFAULT 'CAD',
 "mode" text NOT NULL DEFAULT 'test', "resource_id" text NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "commerce_ledger_money" CHECK (amount_cents BETWEEN -9007199254740991 AND 9007199254740991 AND amount_cents<>0 AND currency='CAD' AND mode='test')
);--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_ledger_event_line" ON "commerce_ledger" ("event_key","line");--> statement-breakpoint
CREATE INDEX "commerce_ledger_owner_idx" ON "commerce_ledger" ("owner_id","account");--> statement-breakpoint
CREATE TABLE "commerce_operations" (
 "id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), "actor_id" text NOT NULL, "kind" text NOT NULL,
 "key" text NOT NULL, "fingerprint" text NOT NULL, "resource_id" uuid NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_operation_idempotency" ON "commerce_operations" ("actor_id","kind","key");--> statement-breakpoint
CREATE TABLE "commerce_withdrawals" (
 "id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), "user_id" uuid NOT NULL REFERENCES "commerce_customers"("user_id"),
 "amount_cents" bigint NOT NULL, "status" text NOT NULL DEFAULT 'requested', "reference" text UNIQUE,
 "reason" text, "approved_by" uuid, "recorded_by" uuid, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT "commerce_withdrawal_amount" CHECK (amount_cents BETWEEN 2000 AND 9007199254740991),
 CONSTRAINT "commerce_withdrawal_status" CHECK (status IN ('requested','approved','paid_test','rejected'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_withdrawal_one_processing" ON "commerce_withdrawals" ("user_id") WHERE status IN ('requested','approved');--> statement-breakpoint
CREATE FUNCTION commerce_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Commerce financial history is append-only';
END $$;--> statement-breakpoint
CREATE TRIGGER commerce_ledger_immutable BEFORE UPDATE OR DELETE ON commerce_ledger FOR EACH ROW EXECUTE FUNCTION commerce_append_only();--> statement-breakpoint
CREATE TRIGGER commerce_operations_immutable BEFORE UPDATE OR DELETE ON commerce_operations FOR EACH ROW EXECUTE FUNCTION commerce_append_only();--> statement-breakpoint
CREATE TRIGGER commerce_ledger_no_truncate BEFORE TRUNCATE ON commerce_ledger FOR EACH STATEMENT EXECUTE FUNCTION commerce_append_only();--> statement-breakpoint
CREATE TRIGGER commerce_operations_no_truncate BEFORE TRUNCATE ON commerce_operations FOR EACH STATEMENT EXECUTE FUNCTION commerce_append_only();--> statement-breakpoint
CREATE FUNCTION commerce_balanced_journal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (SELECT sum(amount_cents) FROM commerce_ledger WHERE event_key=NEW.event_key AND currency=NEW.currency) <> 0 THEN
  RAISE EXCEPTION 'Commerce journal is unbalanced';
 END IF;
 RETURN NULL;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER commerce_journal_balance AFTER INSERT ON commerce_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce_balanced_journal();--> statement-breakpoint
CREATE FUNCTION commerce_customer_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(17473,1);
 IF OLD.first_paid_at IS NOT NULL AND NEW.first_paid_at IS DISTINCT FROM OLD.first_paid_at THEN RAISE EXCEPTION 'First payment history cannot be reset'; END IF;
 IF OLD.referrer_id IS NOT NULL AND NEW.referrer_id IS DISTINCT FROM OLD.referrer_id THEN RAISE EXCEPTION 'A referral cannot be changed'; END IF;
 IF OLD.first_paid_at IS NOT NULL AND NEW.referrer_id IS DISTINCT FROM OLD.referrer_id THEN RAISE EXCEPTION 'Referral cannot be bound after payment'; END IF;
 IF NEW.referrer_id IS DISTINCT FROM OLD.referrer_id AND NEW.referrer_id IS NOT NULL THEN
  IF EXISTS (WITH RECURSIVE parents(id,referrer_id) AS (
   SELECT user_id,referrer_id FROM commerce_customers WHERE user_id=NEW.referrer_id
   UNION SELECT c.user_id,c.referrer_id FROM commerce_customers c JOIN parents p ON c.user_id=p.referrer_id
  ) SELECT 1 FROM parents WHERE id=NEW.user_id) THEN RAISE EXCEPTION 'Referral cycle'; END IF;
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER commerce_customer_binding BEFORE UPDATE ON commerce_customers FOR EACH ROW EXECUTE FUNCTION commerce_customer_binding_guard();--> statement-breakpoint
CREATE FUNCTION commerce_order_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.total_cents IS DISTINCT FROM OLD.total_cents OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.address IS DISTINCT FROM OLD.address OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.mode IS DISTINCT FROM OLD.mode OR (OLD.paid_at IS NOT NULL AND (NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.referrer_id IS DISTINCT FROM OLD.referrer_id)) THEN
  RAISE EXCEPTION 'Order snapshot cannot be changed';
 END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER commerce_order_snapshot BEFORE UPDATE ON commerce_orders FOR EACH ROW EXECUTE FUNCTION commerce_order_snapshot_guard();--> statement-breakpoint
CREATE FUNCTION commerce_item_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.order_id,NEW.product_id,NEW.supplier_id,NEW.name,NEW.quantity,NEW.price_cents,NEW.cost_cents,NEW.line_cents,NEW.commission_bps,NEW.return_days) IS DISTINCT FROM ROW(OLD.order_id,OLD.product_id,OLD.supplier_id,OLD.name,OLD.quantity,OLD.price_cents,OLD.cost_cents,OLD.line_cents,OLD.commission_bps,OLD.return_days) THEN RAISE EXCEPTION 'Order item snapshot cannot be changed'; END IF;
 RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER commerce_item_snapshot BEFORE UPDATE ON commerce_order_items FOR EACH ROW EXECUTE FUNCTION commerce_item_snapshot_guard();
