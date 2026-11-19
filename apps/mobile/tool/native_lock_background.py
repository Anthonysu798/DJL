"""Hold the dedicated QA app backgrounded past the historical app-lock threshold."""
import argparse
from pathlib import Path
import subprocess
import time
import re
from android_qa_device import read_owned_profile

parser = argparse.ArgumentParser()
parser.add_argument('log', type=Path)
parser.add_argument('--platform', choices=['ios', 'android'], default='ios')
parser.add_argument('--simulator')
args = parser.parse_args()
# Both platforms are restricted to explicitly owned disposable QA devices.
adb = [str(Path.home() / 'Library/Android/sdk/platform-tools/adb'), '-s', 'emulator-5556']
if args.platform == 'android':
    if args.simulator is not None:
        raise RuntimeError('--simulator is only valid for iOS')
    profile = read_owned_profile(lambda command: subprocess.check_output(adb + command, text=True, timeout=10))
    print(f"Owned Android QA AVD verified: {profile['avd']}.", flush=True)
elif args.simulator not in {'3526719A-27DA-4F9A-9CC0-C83AA94FD935', 'CD2EB9C1-619A-4C48-8EE8-F970FC4E9C9C'}:
    raise RuntimeError('Use a dedicated mobile QA simulator')
def content():
    return args.log.read_text(errors='replace') if args.log.exists() else ''
def failed(text):
    return 'Some tests failed' in text or 'Failure Details:' in text or 'DriverError: Failed to fulfill RequestData' in text
def wait_for(marker, start=0):
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        text = content()
        found = text.find(marker, start)
        if found >= 0:
            return found + len(marker)
        if failed(text):
            raise RuntimeError('Native privacy test failed before background stage')
        time.sleep(.2)
    raise RuntimeError('Native privacy background stage was not reached')
def app_pid():
    if args.platform == 'android':
        value = subprocess.check_output(adb + ['shell', 'pidof', 'app.djl.mobile'], text=True, timeout=10).strip()
        if re.fullmatch(r'[1-9]\d*', value) is None:
            raise RuntimeError('The native QA app process disappeared or is ambiguous')
        return int(value)
    listing = subprocess.check_output(['xcrun', 'simctl', 'spawn', args.simulator, 'launchctl', 'list'], text=True)
    match = re.search(r'^([0-9]+)\s+\S+\s+UIKitApplication:app\.djl\.mobile\[', listing, re.MULTILINE)
    if match is None:
        raise RuntimeError('The native QA app process disappeared')
    return int(match.group(1))
def background():
    if args.platform == 'android':
        subprocess.run(adb + ['shell', 'input', 'keyevent', '3'], check=True)
    else:
        subprocess.run(['xcrun', 'simctl', 'launch', args.simulator, 'com.apple.Preferences'], check=True)
def resume(expected_pid):
    if app_pid() != expected_pid:
        raise RuntimeError('The native QA app process changed before resume')
    # Plain launch resumes the existing isolate, never a terminate/restart flow.
    if args.platform == 'android':
        subprocess.run(adb + ['shell', 'am', 'start', '-n', 'app.djl.mobile/.MainActivity'], check=True)
    else:
        subprocess.run(['xcrun', 'simctl', 'launch', args.simulator, 'app.djl.mobile'], check=True)
    if app_pid() != expected_pid:
        raise RuntimeError('Resume replaced the native QA app process')
    print(f'Existing native QA app PID {expected_pid} verified after resume.', flush=True)

start = wait_for('DJL_PRIVACY_SHORT_BACKGROUND_READY')
expected_pid = app_pid()
print(f'Existing native QA app PID {expected_pid} verified before background.', flush=True)
background()
wait_for('DJL_PRIVACY_LIFECYCLE_paused', start)
time.sleep(2)
resume(expected_pid)
print('Short background/resume preserved the existing QA app process.', flush=True)
start = wait_for('DJL_PRIVACY_LONG_BACKGROUND_READY', start)
background()
wait_for('DJL_PRIVACY_LIFECYCLE_paused', start)
began = time.monotonic()
print('Actual paused state observed; holding background for305 real seconds.', flush=True)
while time.monotonic() - began < 305:
    if failed(content()):
        raise RuntimeError('Native privacy test failed while backgrounded')
    time.sleep(1)
resume(expected_pid)
print(f'Resumed the existing QA app after {time.monotonic() - began:.1f} real seconds.', flush=True)
