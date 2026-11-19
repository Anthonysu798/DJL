#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
build_dir="$(mktemp -d /private/tmp/djl-running-app-admission.XXXXXX)"
trap 'rm -rf "$build_dir"' EXIT
python3 - "$source_dir" "$build_dir" <<'PY'
import sys
from pathlib import Path
source,build=map(Path,sys.argv[1:])
text=(source/'Sources/RunningAppAdmission.swift').read_text()
assert text.count('import AppKit\n') == 1
(build/'RunningAppAdmission.swift').write_text(text.replace('import AppKit\n',''))
(build/'main.swift').write_bytes((source/'Tests/RunningAppAdmissionTests.swift').read_bytes())
PY
xcrun swiftc -swift-version 5 -module-cache-path "$build_dir/module-cache" "$source_dir/Sources/ApplicationScopePolicy.swift" "$build_dir/RunningAppAdmission.swift" "$build_dir/main.swift" -o "$build_dir/tests"
# Inert OS names are supplied by the model; no real app discovery or process reads.
python3 - "$build_dir/tests" <<'PY_NM'
import re, subprocess, sys
symbols = subprocess.check_output(['nm', '-u', sys.argv[1]], text=True)
if re.search(r'OBJC_CLASS_.*NSRunningApplication|_proc_pidinfo|_proc_pidpath|_AXUIElement|_CGEvent|_NSWorkspace', symbols):
    raise SystemExit('Admission model unexpectedly linked native discovery or input')
PY_NM
"$build_dir/tests"
