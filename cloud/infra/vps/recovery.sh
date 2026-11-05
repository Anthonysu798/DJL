#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")"

# JSON/archive validation runs without .env, credentials, a Docker socket, or networking.
helper() {
  local directory=$1 command=$2
  shift 2
  local access=readonly
  [[ "$command" != manifest ]] || access=""
  local mount="type=bind,src=$directory,dst=/backup"
  [[ -z "$access" ]] || mount+=",readonly"
  local extra=()
  if [[ "$command" == compare ]]; then
    extra=(--mount "type=bind,src=$1,dst=/result/baseline.jsonl,readonly")
    set -- /result/baseline.jsonl
  fi
  docker run --rm --pull never --network none --read-only --user "$(id -u):$(id -g)" \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    --mount "type=bind,src=$PWD/recovery.ts,dst=/tools/recovery.ts,readonly" \
    --mount "type=bind,src=$PWD/recovery-verify.sql,dst=/tools/recovery-verify.sql,readonly" \
    --mount "$mount" "${extra[@]}" \
    oven/bun:1.3.13-slim bun /tools/recovery.ts "$command" /backup "$@"
}
die() { echo "$*" >&2; exit 1; }

case "${1:-}" in
  backup)
    [[ $# == 1 ]] || die "Usage: recovery.sh backup"
    compose=(docker compose --env-file .env -f compose.yml)
    running=()
    for service in s3 api worker; do
      container=$("${compose[@]}" ps --all --quiet "$service")
      [[ -n "$container" ]] || continue
      state=$(docker inspect --format '{{.State.Status}} {{.State.Paused}}' "$container")
      case "$state" in
        'running false') running+=("$service") ;;
        'exited false'|'created false') ;;
        *) die "Service $service has an unstable/paused state; no backup was started." ;;
      esac
    done
    mkdir -p backups
    target="$PWD/backups/$(date -u +%Y%m%dT%H%M%SZ)"
    partial="$target.partial"
    [[ ! -e "$target" && ! -e "$partial" ]] || die "Backup target already exists."
    mkdir "$partial"
    cleanup() {
      local status=$?
      trap - EXIT
      if [[ ${#running[@]} -gt 0 ]]; then
        if ! "${compose[@]}" start "${running[@]}"; then
          echo "Failed to restore originally running services; inspect them manually." >&2
          [[ $status != 0 ]] || status=1
        fi
      fi
      exit "$status"
    }
    # Registered before stop: even a partially failed stop must restore the original running set.
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    if [[ ${#running[@]} -gt 0 ]]; then "${compose[@]}" stop "${running[@]}"; fi
    echo "Backup assumes ALL other database/object writers are quiesced; pre/post baselines must match."
    postgres_container=$("${compose[@]}" ps --quiet postgres)
    s3_container=$("${compose[@]}" ps --all --quiet s3)
    [[ -n "$postgres_container" && -n "$s3_container" ]] || die "Existing Postgres and storage containers are required."
    version=$("${compose[@]}" exec -T postgres psql -X -At -U djl_admin -d djl -c 'show server_version_num')
    [[ "$version" =~ ^17[0-9]{4}$ ]] || die "Only PostgreSQL 17 backups are supported."
    postgres_image=$(docker inspect --format '{{.Image}}' "$postgres_container")
    storage_image=$(docker inspect --format '{{.Image}}' "$s3_container")
    storage_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}' "$s3_container")
    [[ "$storage_volume" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]+$ ]] || die "Expected one named storage data volume."
    "${compose[@]}" exec -T postgres psql -X -q -At -v ON_ERROR_STOP=1 -U djl_admin -d djl -f - \
      < recovery-verify.sql > "$partial/baseline-before.jsonl"
    "${compose[@]}" exec -T postgres pg_dump -U djl_admin -Fc djl > "$partial/postgres.dump"
    "${compose[@]}" exec -T postgres pg_restore --list < "$partial/postgres.dump" > /dev/null
    docker run --rm --pull never --network none --mount "type=volume,src=$storage_volume,dst=/data,readonly" --entrypoint tar \
      chrislusf/seaweedfs:4.47 -czf - -C /data . > "$partial/files.tar.gz"
    "${compose[@]}" exec -T postgres psql -X -q -At -v ON_ERROR_STOP=1 -U djl_admin -d djl -f - \
      < recovery-verify.sql > "$partial/recovery-baseline.jsonl"
    helper "$partial" manifest "$postgres_image" "$storage_image" "${running[*]}"
    helper "$partial" verify > /dev/null
    mv -T --no-clobber -- "$partial" "$target"
    [[ ! -e "$partial" ]] || die "Completed backup target collision; partial evidence retained."
    echo "Complete backup: $target. Copy it to encrypted off-host storage; protect auth keys separately."
    ;;
  restore)
    shift
    [[ $# -ge 1 ]] || die "Usage: recovery.sh restore BACKUP --target /absolute/djl-restore-NAME --project djl-restore-NAME [--execute]"
    backup=$(realpath -e -- "$1")
    [[ "$backup" != *.partial ]] || die "Partial backups are not recovery inputs."
    shift
    target="" project="" execute=false
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --target|--project)
          [[ $# -ge 2 ]] || die "Missing option value."
          if [[ "$1" == --target ]]; then target=$2; else project=$2; fi
          shift 2 ;;
        --execute) execute=true; shift ;;
        *) die "Unknown recovery option." ;;
      esac
    done
    [[ "$target" == /* && -n "$project" ]] || die "An explicit new absolute target and project are required."
    [[ "$backup" != *[,:$'\n']* ]] || die "Unsupported backup path."
    [[ ! -e "$target" && ! -L "$target" ]] || die "Target already exists; never reuse a failed or previous target."
    parent=$(realpath -e -- "$(dirname "$target")")
    target="$parent/$(basename "$target")"
    [[ ! -e "$target" && ! -L "$target" ]] || die "Resolved target already exists."
    [[ "$target" != "$backup"/* && "$target" != "$PWD"/* ]] || die "Target must be separate from backup and deployment sources."
    [[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || die "Remote/overridden Docker contexts are not supported."
    endpoint=$(docker context inspect --format '{{(index .Endpoints "docker").Host}}')
    [[ "$endpoint" == unix://* ]] || die "A local Linux Docker Unix socket is required."
    helper "$backup" plan "$target" "$project"
    if [[ "$execute" == false ]]; then
      echo "DRY RUN: no target, database, volume or network created. Live resource-collision checks remain required by --execute."
      exit 0
    fi
    for kind in container volume network; do
      case "$kind" in
        container) existing=$(docker ps --all --quiet --filter "label=com.docker.compose.project=$project") ;;
        volume) existing=$(docker volume ls --quiet --filter "label=com.docker.compose.project=$project") ;;
        network) existing=$(docker network ls --quiet --filter "label=com.docker.compose.project=$project") ;;
      esac
      [[ -z "$existing" ]] || die "Project resources already exist; choose a new project."
    done
    for name in "${project}_postgres-data" "${project}_s3-data"; do
      if docker volume inspect "$name" > /dev/null 2>&1; then die "Target volume already exists."; fi
    done
    if docker network inspect "${project}_isolated" > /dev/null 2>&1; then die "Target network already exists."; fi
    mkdir -m 700 -- "$target"
    mkdir -m 700 -- "$target/source"
    for name in manifest.json postgres.dump files.tar.gz recovery-baseline.jsonl; do
      cp --no-clobber -- "$backup/$name" "$target/source/$name"
    done
    verified=$(helper "$target/source" verify)
    mapfile -t images <<< "$verified"
    [[ ${#images[@]} == 2 ]] || die "Unexpected image verification result."
    run_id=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
    printf '{"version":1,"project":"%s","runId":"%s"}\n' "$project" "$run_id" > "$target/recovery-owner.json"
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$target/postgres-password"
    export RECOVERY_TARGET="$target" RECOVERY_PROJECT="$project" RECOVERY_RUN_ID="$run_id"
    export RECOVERY_POSTGRES_IMAGE="${images[0]}" RECOVERY_STORAGE_IMAGE="${images[1]}"
    for name in "${project}_postgres-data" "${project}_s3-data"; do
      docker volume create --label "djl.recovery.run-id=$run_id" --label "com.docker.compose.project=$project" "$name" > /dev/null
      [[ "$(docker volume inspect --format '{{index .Labels "djl.recovery.run-id"}}' "$name")" == "$run_id" ]] || die "Volume collision; no unowned volume may be mounted."
    done
    docker network create --internal --label "djl.recovery.run-id=$run_id" --label "com.docker.compose.project=$project" "${project}_isolated" > /dev/null
    [[ "$(docker network inspect --format '{{index .Labels "djl.recovery.run-id"}}' "${project}_isolated")" == "$run_id" ]] || die "Network collision."
    [[ "$(docker network inspect --format '{{.Internal}}' "${project}_isolated")" == true ]] || die "Recovery network is not internal."
    compose=(docker compose --env-file /dev/null --project-directory "$target" -p "$project" -f "$PWD/recovery.compose.yml")
    [[ -z "$(docker ps --all --quiet --filter "label=com.docker.compose.project=$project")" ]] || die "Container project collision before startup."
    "${compose[@]}" up -d --wait --wait-timeout 150 postgres
    restored_container=$("${compose[@]}" ps --quiet postgres)
    [[ -n "$restored_container" && "$(docker inspect --format '{{index .Config.Labels "djl.recovery.run-id"}}' "$restored_container")" == "$run_id" ]] || die "Refusing to restore into an unowned container."
    "${compose[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 -U djl_admin -d djl <<'SQL'
CREATE ROLE djl_migrator NOLOGIN;
CREATE ROLE djl_app NOLOGIN;
CREATE ROLE djl_api NOLOGIN IN ROLE djl_app;
CREATE ROLE djl_worker NOLOGIN IN ROLE djl_app;
SQL
    "${compose[@]}" exec -T postgres pg_restore -U djl_admin -d djl --exit-on-error --no-owner < "$target/source/postgres.dump"
    "${compose[@]}" run --rm --no-deps files-restore
    "${compose[@]}" exec -T postgres psql -X -q -At -v ON_ERROR_STOP=1 -U djl_admin -d djl -f - \
      < recovery-verify.sql > "$target/restored-baseline.jsonl"
    helper "$target/source" compare "$target/restored-baseline.jsonl"
    echo "Database baseline matched; file archive extracted to a new isolated volume."
    echo "NOT production recovery acceptance: object API/readback, runtime permissions and real Docker rehearsal remain separately required."
    echo "No API/worker/fees/notifications enabled. Resources retained at $target ($project); no automatic cleanup."
    ;;
  *) die "Usage: recovery.sh {backup|restore BACKUP --target PATH --project NAME [--execute]}" ;;
esac
