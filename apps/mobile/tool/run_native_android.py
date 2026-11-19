"""Install, verify and run one native journey on the dedicated QA emulator."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.request import urlopen
from android_qa_device import read_owned_profile

parser = argparse.ArgumentParser()
parser.add_argument('apk', type=Path)
parser.add_argument('target')
parser.add_argument('log', type=Path)
parser.add_argument('--project', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--journey', choices=['desktop', 'links', 'settings', 'settings-restore', 'advanced', 'lock', 'composer', 'privacy', 'undo', 'draft'], required=True)
parser.add_argument('--screenshot-prefix', default='desktop-recovery-fixed')
parser.add_argument('--frame-name')
parser.add_argument('--compile-java', action='store_true', help='Compile this QA package with ART before running; leaves Dart in debug mode')
parser.add_argument('--skip-install', action='store_true', help='Verify and reuse this exact already installed APK')
args = parser.parse_args()
os.umask(0o077)
root = Path(__file__).resolve().parents[1]
adb = str(Path.home() / 'Library/Android/sdk/platform-tools/adb')
base = [adb, '-s', 'emulator-5556']
args.log.parent.mkdir(parents=True, exist_ok=True)

with args.log.open('w', buffering=1) as log:
    def run(command):
        subprocess.run(command, check=True, stdout=log, stderr=subprocess.STDOUT)
    def read(command, timeout=10):
        return subprocess.check_output(command, text=True, timeout=timeout, stderr=subprocess.STDOUT).strip()
    read_owned_profile(lambda command: read(base + command))
    print('Installing the native QA bundle…', flush=True)
    run(base + ['shell', 'am', 'force-stop', 'app.djl.mobile'])
    if not args.skip_install:
        run(base + ['install', '--no-streaming', '-r', '-t', str(args.apk.resolve())])
    print('Verifying the installed APK…', flush=True)
    package = read(base + ['shell', 'pm', 'path', 'app.djl.mobile'])
    paths = [line[len('package:'):] for line in package.splitlines() if line.startswith('package:') and line.endswith('/base.apk')]
    if len(paths) != 1 or not re.fullmatch(r'/data/app/[A-Za-z0-9_=/~+.\-]+/base\.apk', paths[0]):
        raise RuntimeError('Could not identify the installed QA APK')
    installed = read(base + ['shell', 'sha256sum', paths[0]], timeout=60).split()[0]
    with args.apk.open('rb') as apk:
        expected = hashlib.file_digest(apk, 'sha256').hexdigest()
    if installed != expected:
        raise RuntimeError('Installed APK does not match the requested test bundle')
    print('Installed APK hash matches.', flush=True)
    if args.compile_java:
        print('Compiling the QA package with ART…', flush=True)
        run(base + ['shell', 'cmd', 'package', 'compile', '-m', 'speed', '-f', 'app.djl.mobile'])
    for port in [8851, 8852, 8853, 8854, 8855, 8334, 22224]:
        run(base + ['reverse', f'tcp:{port}', f'tcp:{port}'])
    run(base + ['forward', 'tcp:58670', 'tcp:58670'])
    harness_log = args.log.with_suffix('.harness.log').open('w')
    if args.journey == 'desktop':
        harness_args = [sys.executable, str(root / 'tool/native_ssh_harness.py'), 'android', str(args.log), '--prefix', 'DJL_DESKTOP', '--screenshot-prefix', args.screenshot_prefix, '--sync-port', '8853']
        sync = 'http://127.0.0.1:8853/'
    elif args.journey == 'links':
        harness_args = [sys.executable, str(root / 'tool/native_links_harness.py'), 'android', str(args.log)]
        sync = 'http://127.0.0.1:8854/phase'
    else:
        prefix = {'settings-restore': 'DJL_SETTINGS_RESTORE', 'advanced': 'DJL_ADVANCED', 'lock': 'DJL_LOCK', 'composer': 'DJL_COMPOSER', 'privacy': 'DJL_PRIVACY', 'undo': 'DJL_UNDO', 'draft': 'DJL_DRAFT'}.get(args.journey, 'DJL_SETTINGS')
        harness_args = [sys.executable, str(root / 'tool/native_frame_harness.py'), 'android', str(args.log), '--prefix', prefix, '--screenshot', args.frame_name or args.journey + '-native', '--timeout', '660' if args.journey == 'privacy' else '300' if args.journey == 'lock' else '360' if args.journey == 'draft' else '180']
        sync = 'http://127.0.0.1:8855/'
    harness = subprocess.Popen(harness_args, cwd=root, stdout=harness_log, stderr=subprocess.STDOUT)
    background = None
    background_log = None
    try:
        for _ in range(50):
            if harness.poll() is not None:
                raise RuntimeError('Native host harness exited during startup')
            try:
                with urlopen(sync, timeout=.5) as response:
                    if response.status == 200:
                        break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError('Native host handshake did not start')
        if args.journey != 'links':
            # Do not pause Dart or wait for a first frame before the host attaches.
            run(base + ['shell', 'am', 'start', '-n', 'app.djl.mobile/.MainActivity', '--ez', 'enable-checked-mode', 'true', '--ez', 'verify-entry-points', 'true', '--ez', 'enable-dart-profiling', 'true', '--ei', 'vm-service-port', '58670'])
        print('Launched; waiting for the current process VM service…', flush=True)
        deadline = time.monotonic() + 90
        uri = None
        while time.monotonic() < deadline:
            try:
                pid = read(base + ['shell', 'pidof', 'app.djl.mobile']).split()[0]
                logs = read(base + ['logcat', '-d', '--pid=' + pid, '-s', 'flutter'])
                urls = re.findall(r'http://127\.0\.0\.1:58670/[^\s]+/', logs)
                if urls:
                    uri = urls[-1]
                    break
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired, IndexError):
                pass
            time.sleep(.2)
        if uri is None:
            raise RuntimeError('No VM service observed for the current QA app process')
        print('Current VM service verified; running native assertions…', flush=True)
        if args.journey == 'privacy':
            background_log = args.log.with_suffix('.background.log').open('w')
            background = subprocess.Popen([sys.executable, str(root / 'tool/native_lock_background.py'), str(args.log), '--platform', 'android'], cwd=root, stdout=background_log, stderr=subprocess.STDOUT)
        env = {**os.environ, 'DJL_QA_PLATFORM': 'android'}
        result = subprocess.run([str(Path.home() / 'flutter/bin/flutter'), 'drive', '--no-pub', '--use-existing-app=' + uri, '--device-id=emulator-5556', '--driver=test_driver/integration_test.dart', '--target=' + args.target, '--no-keep-app-running'], cwd=args.project, env=env, stdout=log, stderr=subprocess.STDOUT)
        if result.returncode != 0:
            raise RuntimeError('Native assertions failed; inspect the saved driver log')
        log.flush()
        content = args.log.read_text(errors='replace')
        if 'Some tests failed' in content or 'TimeoutException' in content or 'Failure Details:' in content:
            raise RuntimeError('Native test reported a failure despite the driver exit status')
        required = {'desktop': 'DJL_DESKTOP_FINISHED', 'links': 'DJL_LINK_FINISHED', 'settings': 'DJL_SETTINGS_FINISHED', 'settings-restore': 'DJL_SETTINGS_RESTORE_FINISHED', 'advanced': 'DJL_ADVANCED_FINISHED', 'lock': 'DJL_LOCK_FINISHED', 'composer': 'DJL_COMPOSER_FINISHED', 'privacy': 'DJL_PRIVACY_FINISHED', 'undo': 'DJL_UNDO_FINISHED', 'draft': 'DJL_DRAFT_FINISHED'}[args.journey]
        if required not in content:
            raise RuntimeError('Native journey did not report its final assertions')
        harness.wait(timeout=15)
        if harness.returncode != 0:
            raise RuntimeError('Native host capture/lifecycle checks failed')
        if background is not None:
            background.wait(timeout=15)
            if background.returncode != 0:
                raise RuntimeError('Native privacy background helper failed or did not prove exit zero')
        print('Native assertions and host checks passed.', flush=True)
    finally:
        if background is not None and background.poll() is None:
            background.terminate()
            background.wait(timeout=10)
        if background_log is not None:
            background_log.close()
        if harness.poll() is None:
            harness.terminate()
            harness.wait(timeout=10)
        harness_log.close()
