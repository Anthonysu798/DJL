-- Runtime accounts inherit the application permissions, never schema ownership.
GRANT USAGE ON SCHEMA public TO djl_app;
REVOKE ALL ON SCHEMA drizzle FROM djl_app;
REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM djl_app;
REVOKE CREATE ON SCHEMA public FROM djl_app;
REVOKE CREATE ON DATABASE djl FROM djl_app;
-- The worker owns queue migrations; the API only produces jobs.
GRANT USAGE ON SCHEMA pgboss TO djl_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO djl_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO djl_api;
ALTER DEFAULT PRIVILEGES FOR ROLE djl_worker IN SCHEMA pgboss
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO djl_api;
ALTER DEFAULT PRIVILEGES FOR ROLE djl_worker IN SCHEMA pgboss
  GRANT USAGE, SELECT ON SEQUENCES TO djl_api;
