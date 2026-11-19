#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$source_dir/.build/module-cache"
xcrun swiftc -swift-version 5 -module-cache-path "$source_dir/.build/module-cache" \
  "$source_dir/Sources/ClipboardPaste.swift" "$source_dir/Tests/ClipboardPasteTests.swift" \
  -framework AppKit -o "$source_dir/.build/ClipboardPasteTests"
"$source_dir/.build/ClipboardPasteTests"
