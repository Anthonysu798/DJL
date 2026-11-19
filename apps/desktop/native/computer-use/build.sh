#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
output_dir="${DJL_COMPUTER_USE_BUILD_DIR:-$source_dir/.build}"
arch="${1:-arm64}"
case "$arch" in arm64|x86_64) ;; *) echo 'Usage: build.sh [arm64|x86_64]' >&2; exit 2 ;; esac
app_dir="$output_dir/DJL Computer Use.app"
paste_sdk="$(xcrun --show-sdk-path)"
mkdir -p "$output_dir/module-cache" "$app_dir/Contents/MacOS"
cp "$source_dir/Info.plist" "$app_dir/Contents/Info.plist"
xcrun swiftc -swift-version 5 -O -target "$arch-apple-macos14.4" \
  -module-cache-path "$output_dir/module-cache" \
  -I "$paste_sdk/usr/include/libxml2" -lxml2 \
  "$source_dir"/Sources/*.swift \
  -framework AppKit -framework ApplicationServices -framework CoreGraphics -framework ScreenCaptureKit \
  -o "$app_dir/Contents/MacOS/DJLComputerUse"
# Development identity only. Production must sign this nested bundle with its own stable identity.
codesign --force --sign - "$app_dir" >&2
printf '%s\n' "$app_dir"
