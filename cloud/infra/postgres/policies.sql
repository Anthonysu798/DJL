-- Applied after Drizzle migrations by cloud/infra/scripts/apply-policies.sh.
-- The API and worker connect as `djl_app`, never as the Postgres superuser.
-- Append-only tables lose UPDATE and DELETE entirely so a bug cannot rewrite history.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'djl_app') THEN
    CREATE ROLE djl_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO djl_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO djl_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO djl_app;

-- Append-only: ledger, audit trail, usage window history, and run event logs.
-- (ON DELETE CASCADE from a parent row still removes them: referential actions run as the owner.)
REVOKE UPDATE, DELETE ON credit_ledger FROM djl_app;
REVOKE UPDATE, DELETE ON audit_events FROM djl_app;
REVOKE UPDATE, DELETE ON usage_window_events FROM djl_app;
REVOKE UPDATE, DELETE ON run_events FROM djl_app;
REVOKE DELETE ON stripe_events FROM djl_app;
REVOKE DELETE ON usage_requests FROM djl_app;

-- Row level security mirrors the service-layer org scoping. The API sets
-- `SET LOCAL app.org_id = '<uuid>'` per transaction; rows outside it are invisible.
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['credit_ledger','credit_balances','usage_requests','subscriptions','customers','invoices',
                        'conversations','files','shares','runs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_scope ON %I', t);
    EXECUTE format(
      'CREATE POLICY org_scope ON %I TO djl_app USING (
         current_setting(''app.org_id'', true) IS NULL
         OR current_setting(''app.org_id'', true) = ''''
         OR org_id::text = current_setting(''app.org_id'', true)
       )', t);
  END LOOP;
END $$;
-- Note: when app.org_id is unset (worker jobs, admin API) the policy is permissive by design;
-- those code paths run with explicit org filters and are covered by the abuse suite.
