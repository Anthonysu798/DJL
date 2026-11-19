"""Fixed native public-preview test command for the owned QA viewer; no UI entry point."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
CASE = 'app.djl.qa.PublicPreviewPinchTest#testPreparedPublicPreviewPinch'


def native_pinch_command(read):
    receipt = json.loads((ROOT / 'build/native-input49/receipt.json').read_text())
    jar = ROOT / 'build/native-input49/public-preview-pinch.jar'
    source = ROOT / 'test/native_ui_android/PublicPreviewPinchTest.java'
    app = ROOT / 'build/qa-artifacts/source-response-actions-v48-android-main.apk'
    if (hashlib.sha256(jar.read_bytes()).hexdigest() != receipt['jar_sha256'] or
            hashlib.sha256(source.read_bytes()).hexdigest() != receipt['source_sha256'] or
            hashlib.sha256(app.read_bytes()).hexdigest() != receipt['ordinary_app_sha256']):
        raise ValueError('Native QA artifact changed; rebuild before input')
    remote = receipt['remote_jar']
    if re.fullmatch(r'/data/local/tmp/djl-public-pinch49-[0-9a-f]{32}\.jar', remote) is None:
        raise ValueError('Unexpected native QA runner path')
    if read(['shell', 'stat', '-c', '%F', remote]).strip() != b'regular file':
        raise ValueError('Native QA runner must be a regular file')
    if read(['shell', 'sha256sum', remote]).decode().split() != [receipt['jar_sha256'], remote]:
        raise ValueError('Installed native QA runner changed')
    packages = read(['shell', 'pm', 'path', 'app.djl.mobile']).decode().strip().splitlines()
    if len(packages) != 1 or not packages[0].startswith('package:/data/app/'):
        raise ValueError('Expected one ordinary DJL QA package')
    if read(['shell', 'sha256sum', packages[0][8:]]).decode().split()[0] != receipt['ordinary_app_sha256']:
        raise ValueError('Ordinary DJL QA binary changed')
    return ['shell', 'uiautomator', 'runtest', remote, '-c', CASE, '-s']


def record_native_pinch_result(output):
    text = output.decode('utf8', 'replace')
    match = re.search(r'QA_PUBLIC_PINCH_OK asset=(p\.png|s\.svg)', text)
    passed = match is not None and re.search(r'OK\s*\(1 test\)', text) is not None
    result = {
        'native_case': CASE,
        'outcome': 'injected' if passed else 'rejected_before_touch'
        if 'QA_PUBLIC_PINCH_REJECTED input_attempted=0' in text else 'failed_or_unknown',
        'public_asset': match.group(1) if passed else None,
        'rendered_zoom_proven': False,
    }
    with (ROOT / 'build/native-input49/invocations.jsonl').open('a') as stream:
        stream.write(json.dumps(result) + '\n')
    if not passed:
        raise RuntimeError('Prepared native pinch did not pass; do not replay')
