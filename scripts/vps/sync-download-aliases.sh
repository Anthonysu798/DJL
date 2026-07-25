#!/usr/bin/env bash
set -euo pipefail

channel_dir="${1:?Usage: sync-download-aliases.sh CHANNEL_DIR}"
release_root="${DJL_RELEASE_ROOT:-/srv/djl-releases}"
resolved_channel="$(readlink -f "$channel_dir")"

case "$resolved_channel" in
  "$release_root"/channels/*) ;;
  *)
    echo "Refusing channel outside $release_root/channels: $resolved_channel" >&2
    exit 2
    ;;
esac

sync_alias() {
  local manifest="$1"
  local extension="$2"
  local alias_name="$3"
  local required_suffix="${4:-.$extension}"
  local manifest_path="$resolved_channel/$manifest"
  local alias_path="$resolved_channel/$alias_name"

  if [[ ! -f "$manifest_path" ]]; then
    rm -f "$alias_path"
    echo "$alias_name unavailable ($manifest missing)"
    return
  fi

  local artifact
  artifact="$({
    awk -v suffix="$required_suffix" '
      $1 == "-" && $2 == "url:" &&
        length($3) >= length(suffix) &&
        substr($3, length($3) - length(suffix) + 1) == suffix {
          print $3
          exit
        }
    ' "$manifest_path"
  })"

  case "$artifact" in
    ""|*/*|.*)
      echo "Invalid $extension artifact in $manifest_path: ${artifact:-<missing>}" >&2
      exit 1
      ;;
  esac

  if [[ ! -f "$resolved_channel/$artifact" ]]; then
    echo "$manifest references a missing artifact: $artifact" >&2
    exit 1
  fi

  ln -sfn "$artifact" "$alias_path"
  echo "$alias_name -> $artifact"
}

sync_alias latest-mac.yml dmg current-mac-arm64.dmg -arm64.dmg
sync_alias latest-mac.yml dmg current-mac-x64.dmg -x64.dmg
ln -sfn "$(readlink "$resolved_channel/current-mac-arm64.dmg")" "$resolved_channel/current-mac.dmg"
echo "current-mac.dmg -> $(readlink "$resolved_channel/current-mac.dmg")"
sync_alias latest.yml exe current-windows.exe
