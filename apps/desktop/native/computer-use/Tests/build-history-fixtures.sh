#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")/.." && pwd)"
fixture_dir=/private/tmp/djl-cua-history-fixture
secondary_dir=/private/tmp/djl-cua-history-fixture-secondary
evidence_dir=/private/tmp/djl-cua-history-inert
build_dir="$(mktemp -d /private/tmp/djl-cua-history-fixture-build.XXXXXX)"
trap 'rm -rf "$build_dir"' EXIT
mkdir -p "$fixture_dir/History Fixture.app/Contents/MacOS" "$secondary_dir/History Secondary.app/Contents/MacOS" "$evidence_dir/module-cache"
xcrun swiftc -swift-version 5 -module-cache-path "$evidence_dir/module-cache" "$source_dir/Tests/HistoryFixture.swift" -framework AppKit -framework ApplicationServices -o "$fixture_dir/History Fixture.app/Contents/MacOS/HistoryFixture"
cp "$fixture_dir/History Fixture.app/Contents/MacOS/HistoryFixture" "$secondary_dir/History Secondary.app/Contents/MacOS/HistoryFixture"
python3 - <<'PY'
import plistlib
from pathlib import Path
for directory,name,bundle in [('/private/tmp/djl-cua-history-fixture','History Fixture','com.djl.history-fixture'),('/private/tmp/djl-cua-history-fixture-secondary','History Secondary','com.djl.history-fixture-secondary')]:
    value=dict(CFBundleIdentifier=bundle,CFBundleExecutable='HistoryFixture',CFBundleName=name,CFBundlePackageType='APPL',NSPrincipalClass='NSApplication')
    (Path(directory)/(name+'.app')/'Contents/Info.plist').write_bytes(plistlib.dumps(value))
PY
codesign --force --sign - "$fixture_dir/History Fixture.app"
codesign --force --sign - "$secondary_dir/History Secondary.app"
for probe in HistoryEnvironmentProbe HistoryInputDriver; do
  cp "$source_dir/Tests/$probe.swift" "$build_dir/main.swift"
  case "$probe" in HistoryEnvironmentProbe) output_name=environment-probe ;; HistoryInputDriver) output_name=input-driver ;; esac
  xcrun swiftc -swift-version 5 -module-cache-path "$evidence_dir/module-cache" "$source_dir/Sources/LiveForeground.swift" "$build_dir/main.swift" -framework AppKit -framework CoreGraphics -framework ApplicationServices -o "$evidence_dir/$output_name"
done
