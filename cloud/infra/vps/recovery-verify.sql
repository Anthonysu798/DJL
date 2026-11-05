-- Read-only, deterministic JSON Lines for a quiesced source or isolated recovery.
-- Run with: psql -X -q -At -v ON_ERROR_STOP=1 -f recovery-verify.sql
-- No clock, row values, credentials, owner OIDs, or repairs are emitted.
-- The catalog-generated statements quote identifiers; no operator SQL is accepted.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';
SET LOCAL extra_float_digits = 3;
SET LOCAL search_path = pg_catalog, public;

SELECT jsonb_build_object('format','djl-vps-recovery-baseline','version',1)::text;

-- Hash a sorted multiset of row hashes in 1,000-row chunks, not one huge row string.
-- Includes queue history, encrypted columns and sequence state, but prints none of them.
-- Sequence log_cnt is internal WAL bookkeeping, not state preserved by pg_dump/setval.
SELECT format($query$
  WITH rows AS (
    SELECT encode(sha256(convert_to(%s,'UTF8')),'hex') h FROM %I.%I t
  ), numbered AS (
    SELECT h,(row_number() OVER (ORDER BY h)-1)/1000 chunk FROM rows
  ), chunks AS (
    SELECT chunk,count(*) n,encode(sha256(convert_to(string_agg(h,'' ORDER BY h),'UTF8')),'hex') h
    FROM numbered GROUP BY chunk
  ) SELECT jsonb_build_object('kind','table','schema',%L,'name',%L,
    'rows',coalesce(sum(n),0)::text,
    'sha256',encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY chunk),''),'UTF8')),'hex'))::text
    FROM chunks;
$query$,CASE WHEN c.relkind='S' THEN 'jsonb_build_object(''last_value'',t.last_value,''is_called'',t.is_called)::text' ELSE 'to_jsonb(t)::text' END,
  n.nspname,c.relname,n.nspname,c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind IN ('r','p','m','S') AND n.nspname NOT LIKE 'pg\_%'
  AND n.nspname <> 'information_schema'
ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"
\gexec

-- Only generate a family's checks when its required tables exist.
SELECT statement FROM (VALUES
  ('commerce_commission_snapshots',to_regclass('public.commerce_commissions') IS NOT NULL
    AND to_regclass('public.commerce_order_items') IS NOT NULL
    AND to_regclass('public.commerce_orders') IS NOT NULL,$query$
    SELECT jsonb_build_object('kind','invariant','name','commerce_commission_snapshots','violations',count(*)::text)::text
    FROM public.commerce_commissions c LEFT JOIN public.commerce_order_items i ON i.id=c.order_item_id
    LEFT JOIN public.commerce_orders o ON o.id=i.order_id
    WHERE i.id IS NULL OR o.id IS NULL OR c.user_id IS DISTINCT FROM o.referrer_id
      OR c.amount_cents<>trunc((i.line_cents-i.refunded_cents)::numeric*i.commission_bps/10000);
  $query$),
  ('commerce_alert_email_delivery_consistency',to_regclass('public.commerce_alert_email_deliveries') IS NOT NULL
    AND to_regclass('public.commerce_alert_incidents') IS NOT NULL,$query$
    SELECT jsonb_build_object('kind','invariant','name','commerce_alert_email_delivery_consistency','violations',count(*)::text)::text
    FROM public.commerce_alert_email_deliveries d LEFT JOIN public.commerce_alert_incidents i ON i.id=d.incident_id
    WHERE i.id IS NULL OR d.mode NOT IN ('mock','resend')
      OR d.state NOT IN ('pending','submitting','accepted','simulated','needs_review','skipped_resolved')
      OR coalesce(length(trim(d.recipient)),0)=0 OR coalesce(length(trim(d.template_version)),0)=0
      OR (d.state='pending' AND (d.claim_token IS NOT NULL OR d.attempted_at IS NOT NULL OR d.completed_at IS NOT NULL))
      OR (d.state='submitting' AND (d.claim_token IS NULL OR d.attempted_at IS NULL OR d.completed_at IS NOT NULL))
      OR (d.state IN ('accepted','simulated') AND (d.claim_token IS NULL OR d.attempted_at IS NULL
        OR d.completed_at IS NULL OR coalesce(length(trim(d.provider_id)),0)=0))
      OR (d.state IN ('needs_review','skipped_resolved') AND (d.completed_at IS NULL OR coalesce(length(d.reason_code),0)=0))
      OR (d.state='accepted' AND d.mode<>'resend') OR (d.state='simulated' AND d.mode<>'mock')
      OR d.completed_at<d.created_at OR d.attempted_at<d.created_at OR d.completed_at<d.attempted_at;
  $query$),
  ('commerce_schema_families',true,$query$
    WITH family AS (
      SELECT 'core' name,count(to_regclass('public.'||name)) n,count(*) expected
      FROM (VALUES
        ('commerce_customers'),('commerce_suppliers'),('commerce_supplier_members'),
        ('commerce_products'),('commerce_orders'),('commerce_order_items'),
        ('commerce_commissions'),('commerce_ledger'),('commerce_operations'),('commerce_withdrawals')
      ) core(name)
      UNION ALL
      SELECT 'payment',count(to_regclass('public.'||name)),count(*) FROM (VALUES
        ('commerce_payment_attempts'),('commerce_provider_refunds'),('commerce_payment_events')
      ) payment(name)
      UNION ALL
      SELECT 'external',count(to_regclass('public.'||name)),count(*) FROM (VALUES
        ('commerce_external_refunds'),('commerce_external_refund_allocations')
      ) external(name)
      UNION ALL
      SELECT 'alerts',count(to_regclass('public.commerce_alert_incidents')),1
      UNION ALL
      SELECT 'alert_email',count(to_regclass('public.commerce_alert_email_deliveries')),1
    )
    SELECT jsonb_build_object('kind','invariant','name','commerce_schema_families','violations',count(*)::text)::text
    FROM family f WHERE n NOT IN (0,expected)
      OR (name IN ('payment','external','alerts') AND n>0 AND EXISTS(SELECT 1 FROM family WHERE name='core' AND n<>expected))
      OR (name='external' AND n>0 AND EXISTS(SELECT 1 FROM family WHERE name='payment' AND n<>expected))
      OR (name='alert_email' AND n>0 AND EXISTS(SELECT 1 FROM family WHERE name='alerts' AND n<>expected));
  $query$),
  ('commerce_external_allocations',to_regclass('public.commerce_external_refunds') IS NOT NULL
    AND to_regclass('public.commerce_external_refund_allocations') IS NOT NULL
    AND to_regclass('public.commerce_order_items') IS NOT NULL,$query$
    SELECT jsonb_build_object('kind','invariant','name','commerce_external_allocations','violations',(
      (SELECT count(*) FROM public.commerce_external_refunds x WHERE
        (x.allocation_state='allocated' AND x.amount_cents<>(SELECT coalesce(sum(a.amount_cents),0) FROM public.commerce_external_refund_allocations a WHERE a.external_refund_id=x.id))
        OR (x.allocation_state<>'allocated' AND EXISTS(SELECT 1 FROM public.commerce_external_refund_allocations a WHERE a.external_refund_id=x.id)))
      +(SELECT count(*) FROM public.commerce_external_refund_allocations a
        LEFT JOIN public.commerce_external_refunds x ON x.id=a.external_refund_id
        LEFT JOIN public.commerce_order_items i ON i.id=a.item_id
        WHERE x.id IS NULL OR i.id IS NULL OR i.order_id<>x.order_id
          OR a.refunded_after_cents<>a.refunded_before_cents+a.amount_cents
          OR a.refunded_after_cents>i.refunded_cents)
    )::text)::text;
  $query$),
  ('commerce_journals_balanced',to_regclass('public.commerce_ledger') IS NOT NULL,$query$
    SELECT jsonb_build_object('kind','invariant','name','commerce_journals_balanced','violations',count(*)::text)::text
    FROM (SELECT event_key FROM public.commerce_ledger GROUP BY event_key
      HAVING sum(amount_cents)<>0 OR bool_or(currency<>'CAD' OR mode<>'test')) broken;
  $query$),
  ('commerce_order_totals',to_regclass('public.commerce_orders') IS NOT NULL
    AND to_regclass('public.commerce_order_items') IS NOT NULL,$query$
    SELECT jsonb_build_object('kind','invariant','name','commerce_order_totals','violations',count(*)::text)::text
    FROM public.commerce_orders o LEFT JOIN (
      SELECT order_id,sum(line_cents) total,sum(refunded_cents) refunded
      FROM public.commerce_order_items GROUP BY order_id
    ) i ON i.order_id=o.id WHERE o.total_cents IS DISTINCT FROM i.total
      OR o.refunded_cents IS DISTINCT FROM i.refunded;
  $query$),
  ('commerce_wallet_signs',to_regclass('public.commerce_ledger') IS NOT NULL,$query$
    SELECT jsonb_build_object('kind','invariant','name','commerce_wallet_signs','violations',count(*)::text)::text
    FROM (SELECT owner_id,account FROM public.commerce_ledger
      WHERE account IN ('pending','available','frozen','paid','recovery') GROUP BY owner_id,account
      HAVING (account='recovery' AND sum(amount_cents)>0)
        OR (account<>'recovery' AND sum(amount_cents)<0)) broken;
  $query$),
  ('commerce_withdrawal_frozen',to_regclass('public.commerce_withdrawals') IS NOT NULL
    AND to_regclass('public.commerce_ledger') IS NOT NULL,$query$
    SELECT jsonb_build_object('kind','invariant','name','commerce_withdrawal_frozen','violations',count(*)::text)::text
    FROM (SELECT owner_id,sum(amount_cents) amount FROM public.commerce_ledger
      WHERE account='frozen' GROUP BY owner_id) l FULL JOIN (
      SELECT user_id::text owner_id,sum(amount_cents) amount FROM public.commerce_withdrawals
      WHERE status IN ('requested','approved','payment_pending','payment_unknown') GROUP BY user_id
    ) w USING(owner_id) WHERE coalesce(l.amount,0)<>coalesce(w.amount,0);
  $query$),
  ('credit_balance_fold',to_regclass('public.credit_ledger') IS NOT NULL
    AND to_regclass('public.credit_balances') IS NOT NULL,$query$
    SELECT jsonb_build_object('kind','invariant','name','credit_balance_fold','violations',count(*)::text)::text
    FROM (SELECT org_id,sum(amount) FILTER(WHERE bucket='free') free,
      sum(amount) FILTER(WHERE bucket='trial') trial,sum(amount) FILTER(WHERE bucket='plan') plan,
      sum(amount) FILTER(WHERE bucket='topup') topup FROM public.credit_ledger GROUP BY org_id
    ) l FULL JOIN public.credit_balances b USING(org_id)
    WHERE coalesce(l.free,0)<>coalesce(b.free,0) OR coalesce(l.trial,0)<>coalesce(b.trial,0)
      OR coalesce(l.plan,0)<>coalesce(b.plan,0) OR coalesce(l.topup,0)<>coalesce(b.topup,0);
  $query$)
) checks(name,available,statement) WHERE available ORDER BY name COLLATE "C"
\gexec

COMMIT;
