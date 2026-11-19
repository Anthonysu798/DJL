#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$source_dir/.build/module-cache"
xcrun swiftc -swift-version 5 -module-cache-path "$source_dir/.build/module-cache" \
  "$source_dir/Sources/KeyboardTargetPolicy.swift" "$source_dir/Tests/KeyboardTargetPolicyTests.swift" \
  -o "$source_dir/.build/KeyboardTargetPolicyTests"
"$source_dir/.build/KeyboardTargetPolicyTests"
