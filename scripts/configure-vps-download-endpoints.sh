#!/usr/bin/env bash
set -euo pipefail

host="${DJL_RELEASE_HOST:?Set DJL_RELEASE_HOST to the SSH destination for the legacy VPS}"
key="${DJL_RELEASE_SSH_KEY:?Set DJL_RELEASE_SSH_KEY to the release SSH private-key path}"
remote_root="${DJL_RELEASE_ROOT:-/srv/djl-releases}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
caddyfile="$repo_root/scripts/vps/downloads.Caddyfile"
sync_script="$repo_root/scripts/vps/sync-download-aliases.sh"

[[ "$remote_root" == "/srv/djl-releases" ]] || {
  echo "DJL_RELEASE_ROOT must be /srv/djl-releases for production." >&2
  exit 2
}
[[ -r "$key" ]] || {
  echo "Release SSH key is not readable: $key" >&2
  exit 2
}

remote_stage="$(ssh -i "$key" -o BatchMode=yes "$host" mktemp -d /tmp/djl-download-endpoints.XXXXXX)"
trap 'ssh -i "$key" -o BatchMode=yes "$host" rm -rf "$remote_stage" >/dev/null 2>&1 || true' EXIT

scp -i "$key" -o BatchMode=yes "$caddyfile" "$host:$remote_stage/Caddyfile"
scp -i "$key" -o BatchMode=yes "$sync_script" "$host:$remote_stage/sync-download-aliases.sh"

ssh -i "$key" -o BatchMode=yes "$host" bash -s -- "$remote_root" "$remote_stage" <<'REMOTE_SCRIPT'
set -euo pipefail

root="$1"
stage="$2"
config=/etc/caddy/Caddyfile
backup="/etc/caddy/Caddyfile.backup.$(date -u +%Y%m%dT%H%M%SZ)"

[[ "$root" == "/srv/djl-releases" ]] || {
  echo "Refusing an unexpected release root." >&2
  exit 2
}

DJL_RELEASE_ROOT="$root" bash "$stage/sync-download-aliases.sh" "$root/stable"
caddy validate --config "$stage/Caddyfile" --adapter caddyfile
cp -a "$config" "$backup"
install -m 0644 "$stage/Caddyfile" "$config"
caddy validate --config "$config" --adapter caddyfile
systemctl reload caddy
systemctl is-active --quiet caddy

echo "Installed stable download routes. Previous Caddyfile: $backup"
REMOTE_SCRIPT
