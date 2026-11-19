"""Deliver actual OS cold/warm links to the dedicated QA devices and capture native pixels."""
import argparse
import json
from pathlib import Path
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument('platform', choices=['ios', 'android'])
parser.add_argument('log', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
config = json.loads(Path('/private/tmp/djl-mobile-qa/link-native-config.json').read_text())
output = root / 'build/device-evidence' / args.platform
output.mkdir(parents=True, exist_ok=True)
phase = 0

class Status(BaseHTTPRequestHandler):
    def do_GET(self):
        connected = args.log.exists() and 'VMServiceFlutterDriver: Connected to Flutter application.' in args.log.read_text(errors='replace')
        body = json.dumps({'phase': phase, 'driverConnected': connected}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 8854), Status)
threading.Thread(target=server.serve_forever, daemon=True).start()
adb = str(Path.home() / 'Library/Android/sdk/platform-tools/adb')
device = '3526719A-27DA-4F9A-9CC0-C83AA94FD935'

def run(command, *, check=True):
    return subprocess.run(command, check=check, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def open_url(url, cold=False):
    if args.platform == 'ios':
        if cold:
            run(['xcrun', 'simctl', 'terminate', device, 'app.djl.mobile'], check=False)
        run(['xcrun', 'simctl', 'openurl', device, url])
    else:
        base = [adb, '-s', 'emulator-5556']
        if cold:
            run(base + ['shell', 'am', 'force-stop', 'app.djl.mobile'])
        command = base + ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url]
        if cold:
            command += ['--ez', 'enable-dart-profiling', 'true', '--ei', 'vm-service-port', '58670']
        run(command + ['app.djl.mobile'])

def wait_for(marker):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        if args.log.exists():
            content = args.log.read_text(errors='replace')
            if marker in content:
                return
            if 'Some tests failed' in content or 'Failure Details:' in content:
                raise RuntimeError('Native URL test failed')
        time.sleep(.2)
    raise RuntimeError(f'Native test never reached {marker}')

def screenshot(name):
    path = output / f'links-native-{name}.png'
    if args.platform == 'ios':
        run(['xcrun', 'simctl', 'io', device, 'screenshot', str(path)])
    else:
        with path.open('wb') as image:
            subprocess.run([adb, '-s', 'emulator-5556', 'exec-out', 'screencap', '-p'], stdout=image, check=True)

try:
    if args.platform == 'android':
        run([adb, '-s', 'emulator-5556', 'reverse', 'tcp:8854', 'tcp:8854'])
    open_url(f"djl://cloud/c/{config['DJL_QA_LINK_COLD']}", cold=True)
    wait_for('DJL_LINK_COLD_VERIFIED')
    screenshot('cold')
    open_url(f"djl://cloud/c/{config['DJL_QA_LINK_WARM']}")
    phase = 1
    wait_for('DJL_LINK_WARM_VERIFIED')
    screenshot('warm')
    phase = 2
    wait_for('DJL_LINK_FINISHED')
    print('Actual OS cold/warm links delivered and native screens captured.')
finally:
    server.shutdown()
