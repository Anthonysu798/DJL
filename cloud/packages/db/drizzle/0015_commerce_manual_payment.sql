ALTER TABLE "commerce_withdrawals" DROP CONSTRAINT "commerce_withdrawal_status";--> statement-breakpoint
DROP INDEX "commerce_withdrawal_one_processing";--> statement-breakpoint
ALTER TABLE "commerce_withdrawals" ADD COLUMN "payment_operation_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce_withdrawals" ADD COLUMN "payment_started_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce_withdrawals" ADD COLUMN "payment_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce_withdrawals" ADD COLUMN "payment_unknown_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_withdrawal_one_processing" ON "commerce_withdrawals" USING btree ("user_id") WHERE "commerce_withdrawals"."status" in ('requested','approved','payment_pending','payment_unknown');--> statement-breakpoint
ALTER TABLE "commerce_withdrawals" ADD CONSTRAINT "commerce_withdrawals_payment_operation_id_unique" UNIQUE("payment_operation_id");--> statement-breakpoint
ALTER TABLE "commerce_withdrawals" ADD CONSTRAINT "commerce_withdrawal_payment_identity" CHECK (("commerce_withdrawals"."status" in ('payment_pending','payment_unknown') and "commerce_withdrawals"."payment_operation_id" is not null and "commerce_withdrawals"."payment_started_by" is not null and "commerce_withdrawals"."payment_started_at" is not null and "commerce_withdrawals"."approved_by" is not null and "commerce_withdrawals"."payment_started_by"<>"commerce_withdrawals"."approved_by" and "commerce_withdrawals"."payment_started_by"<>"commerce_withdrawals"."user_id" and "commerce_withdrawals"."reference" is null and "commerce_withdrawals"."recorded_by" is null and (("commerce_withdrawals"."status"='payment_pending' and "commerce_withdrawals"."payment_unknown_at" is null) or ("commerce_withdrawals"."status"='payment_unknown' and "commerce_withdrawals"."payment_unknown_at" is not null and "commerce_withdrawals"."payment_unknown_at">="commerce_withdrawals"."payment_started_at"))) or ("commerce_withdrawals"."status" not in ('payment_pending','payment_unknown') and "commerce_withdrawals"."payment_operation_id" is null and "commerce_withdrawals"."payment_started_by" is null and "commerce_withdrawals"."payment_started_at" is null and "commerce_withdrawals"."payment_unknown_at" is null));--> statement-breakpoint
ALTER TABLE "commerce_withdrawals" ADD CONSTRAINT "commerce_withdrawal_status" CHECK ("commerce_withdrawals"."status" in ('requested','approved','payment_pending','payment_unknown','paid_test','rejected'));
--> statement-breakpoint
CREATE FUNCTION commerce_withdrawal_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.payment_operation_id IS NOT NULL OR NEW.status IN ('payment_pending','payment_unknown')
    THEN RAISE EXCEPTION 'Manual payment operation requires an existing approved withdrawal'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.payment_operation_id IS NULL AND NEW.payment_operation_id IS NOT NULL THEN
    IF OLD.status<>'approved' OR NEW.status<>'payment_pending'
      OR OLD.approved_by IS NULL OR OLD.reference IS NOT NULL OR OLD.recorded_by IS NOT NULL
      OR (NEW.id,NEW.user_id,NEW.amount_cents,NEW.approved_by,NEW.created_at,NEW.reference,NEW.recorded_by)
         IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.amount_cents,OLD.approved_by,OLD.created_at,OLD.reference,OLD.recorded_by)
    THEN RAISE EXCEPTION 'First manual payment must preserve its approved withdrawal'; END IF;
  END IF;
  IF OLD.payment_operation_id IS NOT NULL THEN
    IF (NEW.id,NEW.user_id,NEW.amount_cents,NEW.approved_by,NEW.payment_operation_id,NEW.payment_started_by,NEW.payment_started_at,NEW.reference,NEW.recorded_by,NEW.created_at)
       IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.amount_cents,OLD.approved_by,OLD.payment_operation_id,OLD.payment_started_by,OLD.payment_started_at,OLD.reference,OLD.recorded_by,OLD.created_at)
      OR (OLD.status='payment_pending' AND NEW.status NOT IN ('payment_pending','payment_unknown'))
      OR (OLD.status='payment_unknown' AND NEW IS DISTINCT FROM OLD)
    THEN RAISE EXCEPTION 'Manual payment remains unresolved and its identity is immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER commerce_withdrawal_payment_immutable BEFORE INSERT OR UPDATE ON commerce_withdrawals
FOR EACH ROW EXECUTE FUNCTION commerce_withdrawal_payment_guard();
