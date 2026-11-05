ALTER TABLE "commerce_alert_email_deliveries" ADD CONSTRAINT "commerce_alert_email_reason" CHECK ("commerce_alert_email_deliveries"."reason_code" is null or "commerce_alert_email_deliveries"."reason_code" in ('delivery_interrupted','send_result_unknown','resolved_before_send','recipient_changed'));
--> statement-breakpoint
ALTER TABLE "commerce_alert_email_deliveries" ADD CONSTRAINT "commerce_alert_email_times" CHECK (("commerce_alert_email_deliveries"."attempted_at" is null or "commerce_alert_email_deliveries"."attempted_at">="commerce_alert_email_deliveries"."created_at") and ("commerce_alert_email_deliveries"."completed_at" is null or "commerce_alert_email_deliveries"."attempted_at" is null or "commerce_alert_email_deliveries"."completed_at">="commerce_alert_email_deliveries"."attempted_at"));
--> statement-breakpoint
CREATE FUNCTION commerce_alert_email_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Commerce email history cannot be deleted'; END IF;
  IF (NEW.id,NEW.incident_id,NEW.mode,NEW.recipient,NEW.template_version,NEW.created_at)
     IS DISTINCT FROM (OLD.id,OLD.incident_id,OLD.mode,OLD.recipient,OLD.template_version,OLD.created_at)
  THEN RAISE EXCEPTION 'Commerce email identity is immutable'; END IF;
  IF OLD.state NOT IN ('pending','submitting') AND NEW IS DISTINCT FROM OLD
  THEN RAISE EXCEPTION 'Commerce email outcome is terminal'; END IF;
  IF (OLD.claim_token IS NOT NULL AND (NEW.claim_token,NEW.attempted_at) IS DISTINCT FROM (OLD.claim_token,OLD.attempted_at))
    OR (OLD.state='pending' AND NEW.state NOT IN ('pending','submitting','needs_review','skipped_resolved'))
    OR (OLD.state='submitting' AND NEW.state NOT IN ('submitting','accepted','simulated','needs_review'))
  THEN RAISE EXCEPTION 'Invalid commerce email transition'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER commerce_alert_email_immutable BEFORE UPDATE OR DELETE ON commerce_alert_email_deliveries
FOR EACH ROW EXECUTE FUNCTION commerce_alert_email_guard();
