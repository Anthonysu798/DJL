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
  down) "${compose[@]}" down ;;
  status) "${compose[@]}" ps ;;
  verify)
    "${compose[@]}" run --rm --no-deps -e VERIFY_PUBLIC_STORAGE=true worker bun cloud/apps/api/src/deployment/verify.ts
    "${compose[@]}" run --rm --no-deps -e VERIFY_PUBLIC_STORAGE=true api bun cloud/apps/api/src/deployment/verify.ts
    ;;
  logs) "${compose[@]}" logs --tail 100 "${2:-api}" ;;
  backup)
    mkdir -p backups
    target="backups/$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir "$target"
    "${compose[@]}" stop api worker s3
    trap '"${compose[@]}" start s3 api worker' EXIT
    "${compose[@]}" exec -T postgres pg_dump -U djl_admin -Fc djl > "$target/postgres.dump"
    s3_container=$("${compose[@]}" ps --all --quiet s3)
    docker run --rm --volumes-from "$s3_container:ro" --entrypoint tar \
      chrislusf/seaweedfs:4.47 -czf - -C /data . > "$target/files.tar.gz"
    echo "Backup saved to $target; keep a copy off the VPS."
    ;;
  *) echo "Usage: $0 {init|check|up|down|status|verify|logs [service]|backup}" >&2; exit 2 ;;
esac
