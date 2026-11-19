"""Guarded, sentinel-only Android credential failure QA; never resets storage.

Root runs this only after independent review. Every phase requires the current
phase's exact QA APK/hash, even if cold native phases use separately built APKs.
No app launch/stop, install, ADB service control or automatic recovery is done.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import xml.etree.ElementTree as ET
from android_qa_device import read_owned_profile

PACKAGE = 'app.djl.mobile'
SERIAL = 'emulator-5556'
AVDS = {'DJLFlutterAOSP35QA', 'DJLFlutterQA'}
PREF = 'shared_prefs/FlutterSecureStorage.xml'
TEMP = 'shared_prefs/.djl-native-credential-tmp'
PREFIX = 'VGhpcyBpcyB0aGUgcHJlZml4IGZvciBhIHNlY3VyZSBzdG9yYWdlCg_'
SENTINEL = PREFIX + 'qa.native_storage.sentinel.v1'
CONTROL = PREFIX + 'qa.native_storage.control.v1'
FAULT = b'AA=='


class Refused(RuntimeError):
    """Messages are fixed and contain no preference/native error content."""


def require(condition):
    if not condition:
        raise Refused('Credential QA refused an unexpected or changed state.')


def sha(data):
    return hashlib.sha256(data).hexdigest()


class Device:
    def __init__(self, apk, digest, *, run=None, package=PACKAGE, serial=SERIAL):
        require(package == PACKAGE and serial == SERIAL)
        require(re.fullmatch('[0-9a-f]{64}', digest) is not None)
        self.apk, self.digest = Path(apk), digest
        require(sha(self.apk.read_bytes()) == digest)
        self.run = run or subprocess.run
        self.base = [str(Path.home() / 'Library/Android/sdk/platform-tools/adb'),
                     '-s', SERIAL]

    def call(self, args, *, data=None, absent=False):
        result = self.run(self.base + args, input=data, capture_output=True,
                          timeout=10)
        if absent:
            require(result.returncode in (0, 1))
            return result.returncode == 1
        require(result.returncode == 0)
        return result.stdout

    def guard(self):
        require(sha(self.apk.read_bytes()) == self.digest)
        try:
            profile = read_owned_profile(self.call, AVDS)
        except RuntimeError:
            raise Refused('Credential QA refused an unexpected or changed state.') from None
        paths = self.call(['shell', 'pm', 'path', PACKAGE]).decode().splitlines()
        require(len(paths) == 1 and re.fullmatch(
            r'package:/data/app/[A-Za-z0-9_=/~+.\-]+/base\.apk', paths[0]) is not None)
        path = paths[0][8:]
        installed = self.call(['shell', 'sha256sum', path]).decode().split()
        require(len(installed) == 2 and installed == [self.digest, path])
        uid = self.call(['shell', 'run-as', PACKAGE, 'id', '-u']).decode().strip()
        require(uid.isascii() and uid.isdigit() and int(uid) >= 10000)
        processes = self.call(['shell', 'ps', '-A', '-o', 'NAME']).decode().splitlines()
        require(processes and processes[0].strip() == 'NAME')
        require(not any(s.strip() == PACKAGE or s.strip().startswith(PACKAGE + ':')
                        for s in processes[1:]))
        # A fresh app may not have the directory yet. A link, including a
        # dangling one, must be refused before testing/reading any child path.
        require(self.call(['shell', '-T', 'run-as', PACKAGE, 'test', '-L', 'shared_prefs'],
                          absent=True))
        for path in [PREF + '.bak', TEMP]:
            require(self.call(['shell', '-T', 'run-as', PACKAGE, 'test', '-e', path],
                              absent=True))
        for path in [PREF, PREF + '.bak', TEMP]:
            require(self.call(['shell', '-T', 'run-as', PACKAGE, 'test', '-L', path],
                              absent=True))
        return {'avd': profile['avd'], 'uid': uid, 'package': PACKAGE, 'serial': SERIAL}

    def read(self):
        scope = self.guard()
        return scope, self.call(['shell', '-T', 'run-as', PACKAGE, 'cat', PREF])

    def write(self, data, scope, expected_current):
        require(isinstance(data, bytes) and data and
                isinstance(expected_current, bytes) and expected_current)
        require(self.guard() == scope)
        # Only fixed allowlisted relative paths enter this shell. XML travels on
        # stdin, never in arguments. Hashes/length derive only from validated
        # bytes. Verify received bytes and the still-current destination before
        # committing; any refusal retains the private temp for explicit review.
        script = (
            'umask 077; set -C; '
            'test ! -L shared_prefs && test -d shared_prefs && '
            f'test ! -L {PREF} && test ! -L {TEMP} && '
            f'test ! -e {PREF}.bak && test ! -L {PREF}.bak && '
            f'cat > {TEMP} && chmod 600 {TEMP} && '
            f'test "$(wc -c < {TEMP} | tr -d \'[:space:]\')" = {len(data)} && '
            f'test "$(sha256sum {TEMP})" = "{sha(data)}  {TEMP}" && '
            'test ! -L shared_prefs && test -d shared_prefs && '
            f'test ! -L {TEMP} && test ! -L {PREF} && '
            f'test ! -e {PREF}.bak && test ! -L {PREF}.bak && '
            f'test "$(sha256sum {PREF})" = "{sha(expected_current)}  {PREF}" && '
            f'mv {TEMP} {PREF}'
        )
        self.call(['shell', '-T', 'run-as', PACKAGE, 'sh', '-c', shlex.quote(script)],
                  data=data)


def entries(data):
    require(b'<!DOCTYPE' not in data and b'<!ENTITY' not in data)
    root = ET.fromstring(data)
    require(root.tag == 'map' and not root.attrib)
    result = {}

    def opaque(element):
        return (element.tag, sorted(element.attrib.items()), element.text,
                [opaque(child) for child in element])

    for child in root:
        name = child.get('name')
        require(name is not None and name not in result)
        result[name] = opaque(child)
    return root, result


def sentinel_span(data):
    root, values = entries(data)
    for name in [SENTINEL, CONTROL]:
        node = next((e for e in root if e.get('name') == name), None)
        require(node is not None and node.tag == 'string' and
                node.attrib == {'name': name} and len(node) == 0 and node.text)
    pattern = (rb'<string\s+name=([\'"])' + re.escape(SENTINEL.encode()) +
               rb'\1\s*>([^<]*)</string>')
    matches = list(re.finditer(pattern, data))
    require(len(matches) == 1)
    return matches[0].span(2), values


def faulted(before):
    (start, end), _ = sentinel_span(before)
    return before[:start] + FAULT + before[end:]


def private_file(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(data)


def read_private(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and
            stat.S_IMODE(info.st_mode) == 0o600)
    return path.read_bytes()


def save_state(folder, state):
    temp = folder / 'state.tmp'
    private_file(temp, json.dumps(state, sort_keys=True).encode())
    os.replace(temp, folder / 'state.json')


def execute(phase, device, evidence):
    if phase == 'guard':
        device.guard()
        return {'phase': 'guarded', 'apkSha256': device.digest}
    require(phase in {'inject', 'verify-preserved', 'restore', 'verify-cleanup'})
    folder = Path(evidence)
    scope, current = device.read()
    if phase == 'inject':
        require(not folder.exists() and not folder.is_symlink())
        _, original_entries = entries(current)
        sentinel_span(current)
        for key in [SENTINEL, CONTROL]:
            text = original_entries[key][2]
            encrypted = base64.b64decode(''.join(text.split()), validate=True)
            require(len(encrypted) >= 16)
        changed = faulted(current)
        folder.mkdir(mode=0o700)
        state = {'schema': 1, 'scope': scope, 'beforeSha256': sha(current),
                 'injectedSha256': sha(changed), 'preparedApkSha256': device.digest,
                 'phase': 'prepared'}
        private_file(folder / 'before.xml', current)
        save_state(folder, state)
        device.write(changed, scope, current)
        after_scope, after = device.read()
        require(after_scope == scope and after == changed)
        current = after
        state['phase'] = 'injected'
    else:
        info = folder.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and
                stat.S_IMODE(info.st_mode) == 0o700)
        require({p.name for p in folder.iterdir()} == {'before.xml', 'state.json'})
        state = json.loads(read_private(folder / 'state.json'))
        before = read_private(folder / 'before.xml')
        require(state['schema'] == 1 and state['scope'] == scope and
                sha(before) == state['beforeSha256'] and
                sha(faulted(before)) == state['injectedSha256'])
        if phase == 'verify-preserved':
            require(state['phase'] in {'prepared', 'injected', 'preserved'})
            # Stronger than opaque equality: retained bad value and all other
            # bytes must be exactly those written. A native exception is no proof.
            require(current == faulted(before))
            state['phase'] = 'preserved'
        elif phase == 'restore':
            require(state['phase'] == 'preserved' and current == faulted(before))
            (start, end), _ = sentinel_span(current)
            (old_start, old_end), _ = sentinel_span(before)
            restored = current[:start] + before[old_start:old_end] + current[end:]
            require(restored == before)
            device.write(restored, scope, current)
            after_scope, after = device.read()
            require(after_scope == scope and after == before)
            current = after
            state['phase'] = 'restored'
        else:
            require(state['phase'] == 'restored')
            _, original = entries(before)
            _, remaining = entries(current)
            require(SENTINEL not in remaining and CONTROL not in remaining)
            require(remaining == {k: v for k, v in original.items()
                                  if k not in {SENTINEL, CONTROL}})
            state['phase'] = 'cleaned'
    state['lastVerifiedApkSha256'] = device.digest
    state['lastObservedSha256'] = sha(current)
    save_state(folder, state)
    return {'phase': state['phase'], 'beforeSha256': state['beforeSha256'],
            'injectedSha256': state['injectedSha256']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['guard', 'inject', 'verify-preserved', 'restore', 'verify-cleanup'])
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--apk-sha256', required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = execute(args.phase, Device(args.apk, args.apk_sha256), args.evidence)
    except Exception:
        # Never print subprocess stderr, XML, exception descriptions or key names.
        print('Credential QA refused; retain private evidence for explicit review.')
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
