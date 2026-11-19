#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
output_dir="$source_dir/.build"
mkdir -p "$output_dir/module-cache"
xcrun swiftc -swift-version 5 -module-cache-path "$output_dir/module-cache" \
  "$source_dir/Sources/InteractionHistoryCore.swift" "$source_dir/Tests/InteractionHistoryCoreTests.swift" \
  -o "$output_dir/InteractionHistoryCoreTests"
"$output_dir/InteractionHistoryCoreTests"
xcrun swiftc -swift-version 5 -module-cache-path "$output_dir/module-cache" \
  "$source_dir/Sources/InteractionHistoryCore.swift" "$source_dir/Sources/InteractionHistoryTransport.swift" \
  "$source_dir/Tests/InteractionHistoryTransportTests.swift" -o "$output_dir/InteractionHistoryTransportTests"
"$output_dir/InteractionHistoryTransportTests"
xcrun swiftc -swift-version 5 -module-cache-path "$output_dir/module-cache" \
  "$source_dir/Sources/InteractionHistoryMetadata.swift" "$source_dir/Tests/InteractionHistoryMetadataTests.swift" \
  -framework ApplicationServices -o "$output_dir/InteractionHistoryMetadataTests"
"$output_dir/InteractionHistoryMetadataTests"
xcrun swiftc -swift-version 5 -module-cache-path "$output_dir/module-cache" \
  "$source_dir/Sources/InteractionHistoryCore.swift" "$source_dir/Sources/InteractionHistoryFocus.swift" \
  "$source_dir/Tests/InteractionHistoryFocusTests.swift" -o "$output_dir/InteractionHistoryFocusTests"
"$output_dir/InteractionHistoryFocusTests"

python3 "$source_dir/Tests/run-history-reader-inert.py" "$output_dir/history-reader-inert"
"$output_dir/history-reader-inert/HistoryReaderInertTests" "$output_dir/history-metadata-proofs.json" --metadata-only
"$output_dir/history-reader-inert/HistoryReaderInertTests" "$output_dir/history-poll-model.json" --poll-model

xcrun swiftc -swift-version 5 -module-cache-path "$output_dir/module-cache" \
  "$source_dir/Sources/InteractionHistoryCore.swift" "$source_dir/Sources/InteractionHistoryFocus.swift" \
  "$source_dir/Tests/InteractionHistoryRootPairTests.swift" -o "$output_dir/InteractionHistoryRootPairTests"
"$output_dir/InteractionHistoryRootPairTests"
