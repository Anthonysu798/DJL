#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
output_dir=/private/tmp/djl-cua-keyboard-protection
fixture_dir=/private/tmp/djl-cua-background-probe
mkdir -p "$output_dir/module-cache" "$fixture_dir/DJLBackgroundFixture.app/Contents/MacOS"
chmod 700 "$output_dir"
cp "$source_dir/fixtures/Info.plist" "$fixture_dir/DJLBackgroundFixture.app/Contents/Info.plist"
xcrun swiftc -module-cache-path "$output_dir/module-cache" "$source_dir/fixtures/FixtureApp.swift" -framework AppKit -framework CoreGraphics -o "$fixture_dir/DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture"
xcrun swiftc -module-cache-path "$output_dir/module-cache" "$source_dir/Tests/FakeFixtureKeyController.swift" -framework AppKit -framework ApplicationServices -framework CoreGraphics -o "$output_dir/FakeFixtureKeyController"
cat "$source_dir/Sources/FocusRoutingState.swift" "$source_dir/Tests/KeyFocusProtectionProbe.swift" > "$output_dir/KeyFocusProtectionProbeCombined.swift"
xcrun swiftc -swift-version 5 -target arm64-apple-macos14.4 -module-cache-path "$output_dir/module-cache" "$output_dir/KeyFocusProtectionProbeCombined.swift" -framework AppKit -framework ApplicationServices -framework CoreGraphics -o "$output_dir/KeyFocusProtectionProbe"
printf '%s\n' "$output_dir/KeyFocusProtectionProbe"
