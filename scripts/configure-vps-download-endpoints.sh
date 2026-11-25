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

scp -i "$key" -o BatchMode=yes "$caddyfile" "$host:$remote_stage/djl-downloads.caddy"
scp -i "$key" -o BatchMode=yes "$sync_script" "$host:$remote_stage/sync-download-aliases.sh"

ssh -i "$key" -o BatchMode=yes "$host" bash -s -- "$remote_root" "$remote_stage" <<'REMOTE_SCRIPT'
set -euo pipefail

root="$1"
stage="$2"
# The host Caddyfile also serves the relay, the website and other sites. Only the
# downloads fragment is ours to replace; the main file only gains an import line.
config=/etc/caddy/Caddyfile
fragment=/etc/caddy/djl-downloads.caddy
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="/etc/caddy/Caddyfile.backup.$stamp"
import_line="import $fragment"

[[ "$root" == "/srv/djl-releases" ]] || {
  echo "Refusing an unexpected release root." >&2
  exit 2
}

DJL_RELEASE_ROOT="$root" bash "$stage/sync-download-aliases.sh" "$root/stable"
caddy validate --config "$stage/djl-downloads.caddy" --adapter caddyfile
cp -a "$config" "$backup"
[[ -f "$fragment" ]] && cp -a "$fragment" "$fragment.backup.$stamp"

restore() {
  cp -a "$backup" "$config"
  if [[ -f "$fragment.backup.$stamp" ]]; then cp -a "$fragment.backup.$stamp" "$fragment"; else rm -f "$fragment"; fi
  echo "Caddy rejected the new routes; restored the previous configuration." >&2
}

install -m 0644 "$stage/djl-downloads.caddy" "$fragment"
if ! grep -qxF "$import_line" "$config"; then
  # A downloads.slcor.com block left in the main file from the old installer would collide.
  if grep -q '^downloads\.slcor\.com' "$config"; then
    echo "Remove the downloads.slcor.com block from $config first (it now lives in $fragment)." >&2
    rm -f "$fragment"
    [[ -f "$fragment.backup.$stamp" ]] && cp -a "$fragment.backup.$stamp" "$fragment"
    exit 2
  fi
  printf '\n%s\n' "$import_line" >> "$config"
fi
if ! caddy validate --config "$config" --adapter caddyfile; then
  restore
  exit 1
fi
systemctl reload caddy
systemctl is-active --quiet caddy

echo "Installed stable download routes in $fragment. Previous Caddyfile: $backup"
REMOTE_SCRIPT
