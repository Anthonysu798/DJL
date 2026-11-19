#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
build_dir="$(mktemp -d /private/tmp/djl-selection-tests.XXXXXX)"
trap 'rm -rf "$build_dir"' EXIT
for name in SelectionTextTests SelectionOperationTests; do
  xcrun swiftc -swift-version 5 -module-cache-path "$build_dir/module-cache" \
    "$source_dir/Sources/SelectionText.swift" "$source_dir/Sources/SelectionOperation.swift" \
    "$source_dir/Tests/$name.swift" -o "$build_dir/$name"
  "$build_dir/$name"
done
