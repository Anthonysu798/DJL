#!/bin/bash
set -euo pipefail

source_dir="$(cd "$(dirname "$0")" && pwd)"
probe_dir=/private/tmp/djl-cua-background-probe
app_dir="$probe_dir/DJLBackgroundFixture.app"
mkdir -p "$probe_dir/module-cache" "$app_dir/Contents/MacOS"
chmod 700 "$probe_dir"
cp "$source_dir/Info.plist" "$app_dir/Contents/Info.plist"

xcrun swiftc -module-cache-path "$probe_dir/module-cache" \
  "$source_dir/FixtureApp.swift" -o "$app_dir/Contents/MacOS/DJLBackgroundFixture" \
  -framework AppKit -framework CoreGraphics
xcrun swiftc -module-cache-path "$probe_dir/module-cache" \
  "$source_dir/BackgroundProbe.swift" -o "$probe_dir/BackgroundProbe" \
  -framework AppKit -framework ApplicationServices -framework CoreGraphics

case "${1:---status}" in
  --status) "$probe_dir/BackgroundProbe" | tee "$probe_dir/permissions.jsonl" ;;
  --run) "$probe_dir/BackgroundProbe" --launch | tee "$probe_dir/runtime.jsonl" ;;
  *) echo 'Usage: bash build-and-probe.sh [--status|--run]' >&2; exit 2 ;;
esac
