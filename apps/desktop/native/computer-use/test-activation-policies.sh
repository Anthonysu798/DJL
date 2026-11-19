#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
build_dir="$(mktemp -d /private/tmp/djl-activation-policies.XXXXXX)"
trap 'rm -rf "$build_dir"' EXIT
for pair in 'WindowRepairTests WindowRepairPolicy' 'LoopCompletionTests ActivationLoopCompletion' 'ControlFocusTests FocusRoutingState' 'ActivationUpdateLeaseTests ActivationUpdateLease'; do
  read -r test_name source_name <<< "$pair"
  xcrun swiftc -swift-version 5 -module-cache-path "$build_dir/module-cache" \
    "$source_dir/Sources/$source_name.swift" "$source_dir/Tests/$test_name.swift" -o "$build_dir/$test_name"
  "$build_dir/$test_name"
done
