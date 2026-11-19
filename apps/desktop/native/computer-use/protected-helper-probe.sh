#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
output_dir=/private/tmp/djl-cua-keyboard-protection
bash "$source_dir/key-focus-protection-probe.sh"
cat "$source_dir/Sources/LiveForeground.swift" "$source_dir/Tests/ProtectedHelperProbe.swift" > "$output_dir/ProtectedHelperProbeCombined.swift"
xcrun swiftc -swift-version 5 -target arm64-apple-macos14.4 -module-cache-path "$output_dir/module-cache" \
  "$output_dir/ProtectedHelperProbeCombined.swift" -framework AppKit -framework ApplicationServices -framework CoreGraphics \
  -o "$output_dir/ProtectedHelperProbe"
printf '%s\n' "$output_dir/ProtectedHelperProbe"
