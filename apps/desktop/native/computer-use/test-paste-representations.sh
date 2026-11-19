#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
paste_sdk="$(xcrun --show-sdk-path)"
mkdir -p "$source_dir/.build/module-cache"
xcrun swiftc -swift-version 5 -module-cache-path "$source_dir/.build/module-cache" \
  -I "$paste_sdk/usr/include/libxml2" -lxml2 \
  "$source_dir/Sources/PasteRepresentations.swift" "$source_dir/Tests/PasteRepresentationsTests.swift" \
  -framework AppKit -o "$source_dir/.build/PasteRepresentationsTests"
"$source_dir/.build/PasteRepresentationsTests"
