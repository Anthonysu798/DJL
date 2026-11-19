#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
build_dir="$(mktemp -d /private/tmp/djl-application-scope.XXXXXX)"
trap 'rm -rf "$build_dir"' EXIT
xcrun swiftc -swift-version 5 -module-cache-path "$build_dir/module-cache" \
  "$source_dir/Sources/ApplicationScopePolicy.swift" "$source_dir/Tests/ApplicationScopePolicyTests.swift" \
  -o "$build_dir/tests"
"$build_dir/tests"
