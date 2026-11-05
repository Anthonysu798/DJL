#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")"
compose=(docker compose --env-file .env -f compose.yml)
setup() {
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/setup" -w /setup \
    oven/bun:1.3.13-slim bun setup.ts "$1"
}
case "${1:-}" in
  init) setup init ;;
  check) setup check; "${compose[@]}" config --quiet ;;
  up)
    setup check
    "${compose[@]}" build
    # Reapply grants to newly migrated tables on every deployment.
    "${compose[@]}" rm -f migrate policies s3-init
    "${compose[@]}" up -d --wait --wait-timeout 180
    ;;
  remote-up)
    setup check
    "${compose[@]}" up -d --build --wait --wait-timeout 180 remote-relay
    ;;
  remote-down)
    "${compose[@]}" stop remote-relay
    ;;
  down) "${compose[@]}" down ;;
  status) "${compose[@]}" ps ;;
  verify)
    "${compose[@]}" run --rm --no-deps -e VERIFY_PUBLIC_STORAGE=true worker bun cloud/apps/api/src/deployment/verify.ts
    "${compose[@]}" run --rm --no-deps -e VERIFY_PUBLIC_STORAGE=true api bun cloud/apps/api/src/deployment/verify.ts
    ;;
  logs) "${compose[@]}" logs --tail 100 "${2:-api}" ;;
  backup)
    bash recovery.sh backup
    ;;
  restore)
    shift
    bash recovery.sh restore "$@"
    ;;
  *) echo "Usage: $0 {init|check|up|remote-up|remote-down|down|status|verify|logs [service]|backup|restore BACKUP --target PATH --project NAME [--execute]}" >&2; exit 2 ;;
esac
