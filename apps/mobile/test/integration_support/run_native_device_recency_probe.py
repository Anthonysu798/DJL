"""Exercise APK formatting on the owned Pixel9 without launching it or reading app data."""
import argparse
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]
SDK = Path.home() / 'Library/Android/sdk'
sys.path.insert(0, str(ROOT / 'tool'))
from android_qa_device import read_owned_profile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apk', type=Path, default=ROOT / 'build/app/outputs/flutter-apk/app-debug.apk')
    args = parser.parse_args()
    apk = args.apk.resolve()
    if not apk.is_relative_to(ROOT / 'build') or not apk.is_file():
        raise ValueError('Only an owned mobile build APK is accepted')
    base = [str(SDK / 'platform-tools/adb'), '-s', 'emulator-5556']
    def adb(*items, timeout=15):
        try:
            return subprocess.check_output(base + list(items), timeout=timeout, stderr=subprocess.STDOUT)
        except subprocess.CalledProcessError as error:
            print(error.output.decode(errors='replace'))
            raise
    profile = read_owned_profile(lambda items: adb(*items))
    tools = sorted((SDK / 'build-tools').glob('*/d8'), key=lambda p: tuple(int(n) for n in p.parent.name.split('.')))[-1].parent
    android = SDK / 'platforms/android-35/android.jar'
    locale = adb('shell', 'getprop', 'persist.sys.locale')
    timezone = adb('shell', 'getprop', 'persist.sys.timezone')
    remote = '/data/local/tmp/djl-native-date-' + uuid.uuid4().hex
    with tempfile.TemporaryDirectory(prefix='djl-native-date-') as folder:
        work = Path(folder)
        classes = work / 'classes'
        classes.mkdir()
        subprocess.run(['javac', '--release', '8', '-classpath', str(android), '-d', str(classes),
                        str(Path(__file__).with_name('NativeDeviceRecencyProbe.java'))], check=True, timeout=30)
        probe = work / 'probe.jar'
        subprocess.run([str(tools / 'd8'), '--min-api', '24', '--lib', str(android), '--output', str(probe),
                        *map(str, classes.rglob('*.class'))], check=True, timeout=30)
        adb('shell', 'mkdir', remote)
        try:
            adb('push', str(probe), remote + '/probe.jar')
            adb('push', str(apk), remote + '/app.apk', timeout=60)
            adb('shell', 'chmod', '444', remote + '/probe.jar', remote + '/app.apk')
            command = ('CLASSPATH=' + shlex.quote(remote + '/probe.jar') +
                       ' app_process / app.djl.qa.NativeDeviceRecencyProbe ' + shlex.quote(remote + '/app.apk'))
            output = adb('shell', command, timeout=30).decode()
            assert 'PASS native date cases=11' in output, output
        finally:
            adb('shell', 'rm', '-f', remote + '/probe.jar', remote + '/app.apk')
            adb('shell', 'rmdir', remote)
            assert adb('shell', 'getprop', 'persist.sys.locale') == locale
            assert adb('shell', 'getprop', 'persist.sys.timezone') == timezone
    report = {'native_cases': 11, 'actual_packaged_code': 'app.djl.mobile.DeviceRecencyFormatter',
              'apk_sha256': hashlib.sha256(apk.read_bytes()).hexdigest(), 'qa_device': profile,
              'app_launched': False, 'private_app_data_read': False, 'system_locale_timezone_unchanged': True,
              'owned_probe_files_removed': True}
    (ROOT / 'build/device-evidence/reports/native-recency46-android-probe.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
