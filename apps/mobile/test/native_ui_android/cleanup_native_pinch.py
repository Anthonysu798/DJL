"""Remove only the exact staged native QA JAR after verifying its identity."""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tool'))
from android_native_pinch import native_pinch_command
from android_qa_device import read_owned_profile


def main():
    base = [str(Path.home() / 'Library/Android/sdk/platform-tools/adb'), '-s', 'emulator-5556']
    def read(args):
        return subprocess.check_output(base + args, timeout=15, stderr=subprocess.STDOUT)
    profile = read_owned_profile(read, legacy_names=frozenset())
    if profile['avd'] != 'DJLFlutterPixel9Google35QA':
        raise ValueError('Use only the dedicated Google API35 QA emulator')
    command = native_pinch_command(read)
    remote = command[3]
    read(['shell', 'rm', remote])
    result = subprocess.run(base + ['shell', 'test', '-e', remote], capture_output=True, timeout=15)
    if result.returncode != 1:
        raise ValueError('Native QA runner removal is not verified')
    receipt = {'remote_jar': remote, 'exact_hash_verified_before_removal': True,
               'remote_jar_removed': True, 'helper_app_installed': False,
               'app_data_reset': False}
    (ROOT / 'build/native-input49/cleanup.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
