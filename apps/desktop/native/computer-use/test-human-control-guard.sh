#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
output_dir="$source_dir/.build"
mkdir -p "$output_dir/module-cache"
xcrun swiftc -swift-version 5 -module-cache-path "$output_dir/module-cache" \
  "$source_dir/Sources/LiveForeground.swift" "$source_dir/Sources/ForegroundRestorationAuthority.swift" \
  "$source_dir/Sources/HumanControlGuard.swift" "$source_dir/Tests/HumanControlGuardTests.swift" \
  -framework AppKit -framework ApplicationServices -framework CoreGraphics -o "$output_dir/HumanControlGuardTests"
"$output_dir/HumanControlGuardTests"
