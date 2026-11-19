"""Build/stage the fixed SDK QA JAR; does not run UI tests or launch any app."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]
SDK = Path.home() / 'Library/Android/sdk'
sys.path.insert(0, str(ROOT / 'tool'))
from android_qa_device import read_owned_profile


def main():
    base = [str(SDK / 'platform-tools/adb'), '-s', 'emulator-5556']
    def read(args):
        return subprocess.check_output(base + args, timeout=15, stderr=subprocess.STDOUT)
    profile = read_owned_profile(read, legacy_names=frozenset())
    if profile['avd'] != 'DJLFlutterPixel9Google35QA':
        raise ValueError('Use the dedicated Google API35 QA emulator')
    output = ROOT / 'build/native-input49'
    output.mkdir(parents=True, exist_ok=True)
    jar, receipt = output / 'public-preview-pinch.jar', output / 'receipt.json'
    if jar.exists() or receipt.exists():
        raise ValueError('Retain existing native QA artifacts; do not overwrite')
    platform = SDK / 'platforms/android-35'
    libraries = [platform / 'android.jar', platform / 'uiautomator.jar',
                 platform / 'optional/android.test.base.jar']
    source = Path(__file__).with_name('PublicPreviewPinchTest.java')
    app = ROOT / 'build/qa-artifacts/source-response-actions-v48-android-main.apk'
    with tempfile.TemporaryDirectory(prefix='djl-native-pinch49-') as folder:
        classes = Path(folder) / 'classes'
        classes.mkdir()
        subprocess.run(['javac', '--release', '8', '-classpath', ':'.join(map(str, libraries)),
                        '-d', str(classes), str(source)], check=True, timeout=30)
        subprocess.run([str(SDK / 'build-tools/36.0.0/d8'), '--min-api', '24',
                        '--lib', str(libraries[0]), '--classpath', str(libraries[1]),
                        '--classpath', str(libraries[2]), '--output', str(jar),
                        *map(str, classes.rglob('*.class'))], check=True, timeout=30)
    remote = '/data/local/tmp/djl-public-pinch49-' + uuid.uuid4().hex + '.jar'
    exists = subprocess.run(base + ['shell', 'test', '-e', remote], capture_output=True, timeout=15)
    if exists.returncode != 1:
        raise ValueError('Native QA runner path must be absent before staging')
    read(['push', str(jar), remote])
    read(['shell', 'chmod', '444', remote])
    report = {'remote_jar': remote, 'jar_sha256': hashlib.sha256(jar.read_bytes()).hexdigest(),
              'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'ordinary_app_sha256': hashlib.sha256(app.read_bytes()).hexdigest(),
              'qa_device': profile, 'ui_input_run': False, 'helper_app_installed': False}
    receipt.write_text(json.dumps(report, indent=2) + '\n')
    from android_native_pinch import native_pinch_command
    native_pinch_command(read)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
