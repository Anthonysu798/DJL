#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${VPS_HOST:?VPS_HOST is required}"
: "${VPS_ROOT:?VPS_ROOT is required}"
: "${VPS_SSH_KEY:?VPS_SSH_KEY is required}"
: "${VPS_KNOWN_HOSTS:?VPS_KNOWN_HOSTS is required}"
: "${DJL_VERSION:?DJL_VERSION is required}"
[[ "$VPS_HOST" =~ ^[a-zA-Z0-9_-]+@[a-zA-Z0-9.-]+$ ]] || { echo "Invalid SSH destination" >&2; exit 2; }
[[ "$VPS_ROOT" =~ ^/srv/djl-cloud-(staging|production)$ ]] || { echo "Invalid deployment directory" >&2; exit 2; }
[[ "$DJL_VERSION" =~ ^[a-zA-Z0-9._-]+$ ]] || { echo "Invalid deployment version" >&2; exit 2; }
repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
printf '%s\n' "$VPS_SSH_KEY" > "$work/key"
printf '%s\n' "$VPS_KNOWN_HOSTS" > "$work/known_hosts"
ssh_opts=(-i "$work/key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$work/known_hosts")
git ls-files -- package.json bun.lock bunfig.toml .dockerignore patches cloud \
  ':(glob)apps/*/package.json' ':(glob)packages/*/package.json' scripts/package.json \
  packages/contracts/src packages/contracts/fixtures/cloud > "$work/files"
tar -czf "$work/source.tgz" -T "$work/files"
ssh "${ssh_opts[@]}" "$VPS_HOST" "test -f '$VPS_ROOT/cloud/infra/vps/.env'"
scp "${ssh_opts[@]}" "$work/source.tgz" "$VPS_HOST:$VPS_ROOT/source.tgz"
ssh "${ssh_opts[@]}" "$VPS_HOST" "bash -s -- '$VPS_ROOT' '$DJL_VERSION'" <<'REMOTE'
set -euo pipefail
cd "$1"
tar xzf source.tgz
export DJL_VERSION="$2"
cd cloud/infra/vps
./djl.sh check
./djl.sh backup
./djl.sh up
./djl.sh verify
curl --fail --silent --show-error http://127.0.0.1:8787/ready
curl --fail --silent --show-error http://127.0.0.1:8787/health | grep -Fq "\"version\":\"$DJL_VERSION\""
REMOTE
