ALTER TABLE "commerce_withdrawals" ADD COLUMN "payment_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce_withdrawals" ADD COLUMN "payment_evidence_reference" text;--> statement-breakpoint
ALTER TABLE "commerce_withdrawals" DROP CONSTRAINT "commerce_withdrawal_payment_identity";--> statement-breakpoint
ALTER TABLE "commerce_withdrawals" ADD CONSTRAINT "commerce_withdrawal_payment_identity" CHECK (
  (payment_operation_id is null and payment_started_by is null and payment_started_at is null and payment_unknown_at is null and payment_confirmed_at is null and payment_evidence_reference is null and status not in ('payment_pending','payment_unknown'))
  or (payment_operation_id is not null and payment_started_by is not null and payment_started_at is not null and approved_by is not null and payment_started_by<>approved_by and payment_started_by<>user_id and (
    (status in ('payment_pending','payment_unknown') and reference is null and recorded_by is null and payment_confirmed_at is null and payment_evidence_reference is null and ((status='payment_pending' and payment_unknown_at is null) or (status='payment_unknown' and payment_unknown_at is not null and payment_unknown_at>=payment_started_at)))
    or (status='paid_test' and reference is not null and reference=btrim(reference) and char_length(reference) between 1 and 150 and recorded_by is not null and recorded_by<>approved_by and recorded_by<>user_id and payment_confirmed_at is not null and payment_confirmed_at>=payment_started_at and payment_evidence_reference is not null and payment_evidence_reference=btrim(payment_evidence_reference) and char_length(payment_evidence_reference) between 1 and 500 and reason is not null and reason=btrim(reason) and char_length(reason) between 1 and 500 and (payment_unknown_at is null or (payment_unknown_at>=payment_started_at and payment_confirmed_at>=payment_unknown_at)))
  ))
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce_withdrawal_payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF OLD.payment_confirmed_at IS NOT NULL THEN
      IF NEW IS DISTINCT FROM OLD
      THEN RAISE EXCEPTION 'Confirmed manual payment result is immutable'; END IF;
    ELSIF NEW.status='paid_test' THEN
      IF OLD.status NOT IN ('payment_pending','payment_unknown')
        OR (NEW.id,NEW.user_id,NEW.amount_cents,NEW.approved_by,NEW.payment_operation_id,NEW.payment_started_by,NEW.payment_started_at,NEW.payment_unknown_at,NEW.created_at)
           IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.amount_cents,OLD.approved_by,OLD.payment_operation_id,OLD.payment_started_by,OLD.payment_started_at,OLD.payment_unknown_at,OLD.created_at)
        OR NEW.payment_confirmed_at IS NULL OR NEW.payment_evidence_reference IS NULL
      THEN RAISE EXCEPTION 'Manual payment remains unresolved and its identity is immutable'; END IF;
    ELSIF (NEW.id,NEW.user_id,NEW.amount_cents,NEW.approved_by,NEW.payment_operation_id,NEW.payment_started_by,NEW.payment_started_at,NEW.reference,NEW.recorded_by,NEW.created_at)
          IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.amount_cents,OLD.approved_by,OLD.payment_operation_id,OLD.payment_started_by,OLD.payment_started_at,OLD.reference,OLD.recorded_by,OLD.created_at)
      OR (OLD.status='payment_pending' AND NEW.status NOT IN ('payment_pending','payment_unknown'))
      OR (OLD.status='payment_unknown' AND NEW IS DISTINCT FROM OLD)
    THEN RAISE EXCEPTION 'Manual payment remains unresolved and its identity is immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
