#!/usr/bin/env bash
# Applies infra/postgres/policies.sql to $DATABASE_URL. Idempotent.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/../postgres/policies.sql"
