"""Host-side lifecycle/keyboard checks for integration_test/ssh_test.dart.
Run this before flutter drive. Uses only the dedicated disposable QA devices.
"""
import argparse
from pathlib import Path
import subprocess
import time
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument('platform', choices=['ios', 'android'])
parser.add_argument('log', type=Path)
parser.add_argument('--prefix', default='DJL_SSH')
parser.add_argument('--screenshot-prefix', default='ssh')
parser.add_argument('--sync-port', type=int, default=0)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = root / 'build' / 'device-evidence' / args.platform
output.mkdir(parents=True, exist_ok=True)
keyboard_captured = False

class CaptureStatus(BaseHTTPRequestHandler):
    def do_GET(self):
        connected = args.log.exists() and 'VMServiceFlutterDriver: Connected to Flutter application.' in args.log.read_text(errors='replace')
        body = json.dumps({'keyboardCaptured': keyboard_captured, 'driverConnected': connected}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

if args.sync_port:
    sync_server = ThreadingHTTPServer(('127.0.0.1', args.sync_port), CaptureStatus)
    threading.Thread(target=sync_server.serve_forever, daemon=True).start()

def wait_for(marker):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        if args.log.exists():
            content = args.log.read_text(errors='replace')
            if marker in content:
                return
            if 'Some tests failed' in content or 'Failure Details:' in content:
                raise RuntimeError('The native journey failed before the next lifecycle stage')
        time.sleep(.2)
    raise RuntimeError(f'Native test never reached {marker}')

def run(command):
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)

wait_for(f'{args.prefix}_KEYBOARD_READY')
if args.platform == 'android':
    adb = str(Path.home() / 'Library/Android/sdk/platform-tools/adb')
    base = [adb, '-s', 'emulator-5556']
    with (output / f'{args.screenshot_prefix}-native-keyboard.png').open('wb') as image:
        subprocess.run(base + ['exec-out', 'screencap', '-p'], stdout=image, check=True)
    state = subprocess.check_output(base + ['shell', 'dumpsys', 'input_method'], text=True)
    (output / f'{args.screenshot_prefix}-keyboard-state.txt').write_text('\n'.join(line for line in state.splitlines() if 'mInputShown=' in line or 'isInputViewShown' in line))
    if args.sync_port and 'mInputShown=true' not in state and 'isInputViewShown=true' not in state:
        raise RuntimeError('The native Android keyboard was not shown at capture')
    keyboard_captured = True
    wait_for(f'{args.prefix}_BACKGROUND_READY')
    run(base + ['shell', 'input', 'keyevent', '3'])
    wait_for(f'{args.prefix}_LIFECYCLE_paused')
    time.sleep(1)
    run(base + ['shell', 'am', 'start', '-n', 'app.djl.mobile/.MainActivity'])
else:
    device = '3526719A-27DA-4F9A-9CC0-C83AA94FD935'
    run(['xcrun', 'simctl', 'io', device, 'screenshot', str(output / f'{args.screenshot_prefix}-native-keyboard.png')])
    keyboard_captured = True
    wait_for(f'{args.prefix}_BACKGROUND_READY')
    run(['xcrun', 'simctl', 'launch', device, 'com.apple.Preferences'])
    wait_for(f'{args.prefix}_LIFECYCLE_paused')
    time.sleep(1)
    run(['xcrun', 'simctl', 'launch', device, 'app.djl.mobile'])
print('Native keyboard captured; app backgrounded and restored.')
