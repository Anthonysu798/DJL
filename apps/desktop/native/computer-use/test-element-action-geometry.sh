#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$source_dir/.build/module-cache"
xcrun swiftc -swift-version 5 -module-cache-path "$source_dir/.build/module-cache" \
  "$source_dir/Sources/ElementActionGeometry.swift" "$source_dir/Tests/ElementActionGeometryTests.swift" \
  -o "$source_dir/.build/ElementActionGeometryTests"
"$source_dir/.build/ElementActionGeometryTests"
