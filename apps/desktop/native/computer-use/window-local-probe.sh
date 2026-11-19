#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
output_dir=/private/tmp/djl-cua-spi-input-probe
fixture_dir=/private/tmp/djl-cua-background-probe
mkdir -p "$output_dir" "$output_dir/module-cache" "$fixture_dir/DJLBackgroundFixture.app/Contents/MacOS"
chmod 700 "$output_dir"
cp "$source_dir/fixtures/Info.plist" "$fixture_dir/DJLBackgroundFixture.app/Contents/Info.plist"
xcrun swiftc -module-cache-path "$output_dir/module-cache" "$source_dir/fixtures/FixtureApp.swift" \
  -framework AppKit -framework CoreGraphics -o "$fixture_dir/DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture"
xcrun swiftc -swift-version 5 -target arm64-apple-macos14.4 -module-cache-path "$output_dir/module-cache" \
  "$source_dir/Tests/WindowLocalInputProbe.swift" -framework AppKit -framework ApplicationServices -framework CoreGraphics \
  -o "$output_dir/WindowLocalInputProbe"
case "${1:---build}" in
  --build) printf '%s\n' "$output_dir/WindowLocalInputProbe" ;;
  --run) "$output_dir/WindowLocalInputProbe" | tee "$output_dir/active-fixture-results.jsonl" ;;
  --inactive) "$output_dir/WindowLocalInputProbe" --require-inactive | tee "$output_dir/inactive-fixture-results.jsonl" ;;
  *) echo 'Usage: window-local-probe.sh [--build|--run|--inactive]' >&2; exit 2 ;;
esac
