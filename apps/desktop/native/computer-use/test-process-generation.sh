#!/bin/bash
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
build_dir="$(mktemp -d /private/tmp/djl-process-generation.XXXXXX)"
trap 'rm -rf "$build_dir"' EXIT
python3 - "$source_dir" "$build_dir" <<'PY'
import sys
from pathlib import Path
source, build = map(Path, sys.argv[1:])
text = (source / 'Sources/main.swift').read_text()
start = text.index('func processReplacedOrExited(')
end = text.index('\nfinal class Session', start)
function = text[start:end]
assert function.count('Darwin.kill') == 1
function = function.replace('Darwin.kill', 'Model.kill')
template = (source / 'Tests/ProcessGenerationTests.swift').read_text()
assert template.count('//__PRODUCTION_FUNCTION__') == 1
(build / 'tests.swift').write_text(template.replace('//__PRODUCTION_FUNCTION__', function))
PY
xcrun swiftc -swift-version 5 -parse-as-library -module-cache-path "$build_dir/module-cache" \
  "$build_dir/tests.swift" -o "$build_dir/tests"
python3 - "$build_dir/tests" <<'PY'
import re, subprocess, sys
symbols = subprocess.check_output(['nm', '-u', sys.argv[1]], text=True)
if re.search(r'\s_kill$|_proc_pidinfo|_proc_pidpath|_AXUIElement|_CGEvent|_NSWorkspace', symbols, re.M):
    raise SystemExit('Generation model unexpectedly linked native process reads/input')
PY
"$build_dir/tests"
