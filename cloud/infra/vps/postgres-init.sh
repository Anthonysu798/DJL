#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_password="$POSTGRES_MIGRATOR_PASSWORD" \
  -v api_password="$POSTGRES_API_PASSWORD" \
  -v worker_password="$POSTGRES_WORKER_PASSWORD" <<'SQL'
CREATE ROLE djl_migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE djl_app NOLOGIN;
CREATE ROLE djl_api LOGIN PASSWORD :'api_password' IN ROLE djl_app;
CREATE ROLE djl_worker LOGIN PASSWORD :'worker_password' IN ROLE djl_app;
ALTER DATABASE djl OWNER TO djl_migrator;
ALTER SCHEMA public OWNER TO djl_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON DATABASE djl FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA pgboss AUTHORIZATION djl_worker;
SQL
