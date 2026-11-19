"""Safety behavior of the real fault helper with only the ADB boundary doubled."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tool'))
import shlex
import signal
import subprocess
import tempfile
import unittest

PATH = Path(__file__).resolve().parents[2] / 'tool/native_credential_fault.py'
spec = importlib.util.spec_from_file_location('native_credential_fault', PATH)
qa = importlib.util.module_from_spec(spec)
if PATH.exists():
    spec.loader.exec_module(qa)

PREFIX = 'VGhpcyBpcyB0aGUgcHJlZml4IGZvciBhIHNlY3VyZSBzdG9yYWdlCg_'
SENTINEL = PREFIX + 'qa.native_storage.sentinel.v1'
CONTROL = PREFIX + 'qa.native_storage.control.v1'
ORIGINAL = (f'<?xml version="1.0" encoding="utf-8"?><map>\n'
            f'<string name="{SENTINEL}">U0VOVElORUxfRU5DUllQVEVEX0JZVEVT</string>\n'
            f'<string name="{CONTROL}">Q09OVFJPTF9FTkNSWVBURURfQllURVM=</string>\n'
            '<string name="opaque.credential">DO-NOT-PRINT-PRIVATE</string>\n'
            '<int name="opaque.algorithm" value="9" />\n</map>').encode()


class FakeADB:
    def __init__(self):
        self.sdk = b'36'; self.size = b'Physical size: 1080x2424'
        self.avd = b'DJLFlutterAOSP35QA\nOK\n'
        self.digest = hashlib.sha256(b'qa APK').hexdigest()
        self.running = b'NAME\ninit\n'
        self.uid = b'10123\n'
        self.xml = ORIGINAL
        self.calls = []
        self.writes = 0
        self.pref_reads = 0
        self.temp_exists = False
        self.symlinks = set()
        self.start_after_read = False

    def __call__(self, command, **kw):
        self.calls.append((command, kw.get('input')))
        args = command[3:]
        if args[:2] == ['shell', '-T']:
            args = ['private-shell'] + args[2:]
        code, out = 0, b''
        if args == ['emu', 'avd', 'name']:
            out = self.avd
        elif args == ['shell', 'getprop', 'ro.build.version.sdk']:
            out = self.sdk
        elif args == ['shell', 'wm', 'size']:
            out = self.size
        elif args == ['shell', 'pm', 'path', 'app.djl.mobile']:
            out = b'package:/data/app/owned/base.apk\n'
        elif args == ['shell', 'sha256sum', '/data/app/owned/base.apk']:
            out = (self.digest + '  /data/app/owned/base.apk\n').encode()
        elif args == ['shell', 'run-as', 'app.djl.mobile', 'id', '-u']:
            out = self.uid
        elif args == ['shell', 'ps', '-A', '-o', 'NAME']:
            out = self.running
        elif args[:5] == ['private-shell', 'run-as', 'app.djl.mobile', 'test', '-e']:
            code = 0 if self.temp_exists else 1
        elif args[:5] == ['private-shell', 'run-as', 'app.djl.mobile', 'test', '-L']:
            code = 0 if args[5] in self.symlinks else 1
        elif args == ['private-shell', 'run-as', 'app.djl.mobile', 'cat', 'shared_prefs/FlutterSecureStorage.xml']:
            self.pref_reads += 1
            out = self.xml
            if self.start_after_read:
                self.running = b'NAME\napp.djl.mobile\n'
        elif args[:5] == ['private-shell', 'run-as', 'app.djl.mobile', 'sh', '-c']:
            self.writes += 1
            self.xml = kw['input']
        else:
            raise AssertionError('Unexpected ADB operation')
        return subprocess.CompletedProcess(command, code, out, b'private native stderr')


class HostFilesystemADB(FakeADB):
    """Real fixed shell/IO over public temporary files; only device scope is fake."""
    def __init__(self, root):
        super().__init__()
        self.root = root
        root.mkdir(exist_ok=True)
        (root / 'shared_prefs').mkdir()
        self.target = root / 'shared_prefs/FlutterSecureStorage.xml'
        self.target.write_bytes(ORIGINAL)
        self.received_length = None
        self.corrupt_payload = False
        self.cat_mode = None
        self.change_after_read = False
        self.shell_results = []

    def __call__(self, command, **kw):
        args = command[3:]
        if args[:4] == ['shell', '-T', 'run-as', 'app.djl.mobile']:
            operation = args[4:]
            if operation[:1] == ['test']:
                return subprocess.run(operation, cwd=self.root, capture_output=True)
            if operation == ['cat', 'shared_prefs/FlutterSecureStorage.xml']:
                self.pref_reads += 1
                if not self.target.exists():
                    return subprocess.CompletedProcess(command, 1, b'', b'public missing fixture')
                before = self.target.read_bytes()
                if self.change_after_read:
                    self.target.write_bytes(before.replace(
                        b'DO-NOT-PRINT-PRIVATE', b'NEW-OPAQUE-ENTRY'))
                    self.change_after_read = False
                return subprocess.CompletedProcess(command, 0, before, b'')
            if operation[:2] == ['sh', '-c']:
                self.writes += 1
                script = shlex.split(operation[2])
                if len(script) != 1:
                    raise AssertionError('Expected one fixed shell argument')
                payload = kw['input']
                if self.received_length is not None:
                    payload = payload[:self.received_length]
                if self.corrupt_payload:
                    payload = payload[:-1] + b'X'
                env = os.environ.copy()
                if self.cat_mode is not None:
                    tools = self.root / 'public-tools'
                    tools.mkdir()
                    cat = tools / 'cat'
                    tail = 'exit 7' if self.cat_mode == 'nonzero' else 'exec /bin/sleep 10'
                    cat.write_text('#!/bin/sh\n/bin/cat\n' + tail + '\n')
                    cat.chmod(0o700)
                    env['PATH'] = str(tools) + os.pathsep + env['PATH']
                process = subprocess.Popen(['sh', '-c', script[0]], stdin=subprocess.PIPE,
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           cwd=self.root, env=env, start_new_session=True)
                try:
                    out, err = process.communicate(payload, timeout=.1 if self.cat_mode == 'timeout' else 3)
                except subprocess.TimeoutExpired:
                    # Only this test's fresh public-fixture subprocess group.
                    os.killpg(process.pid, signal.SIGKILL)
                    process.communicate()
                    raise
                result = subprocess.CompletedProcess(command, process.returncode, out, err)
                self.shell_results.append(result.returncode)
                return result
        return super().__call__(command, **kw)


class CredentialFaultTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.apk = self.root / 'fixture.apk'
        self.apk.write_bytes(b'qa APK')
        self.fake = FakeADB()
        self.evidence = self.root / 'private-evidence'

    def device(self, **kw):
        return qa.Device(self.apk, hashlib.sha256(b'qa APK').hexdigest(),
                         run=self.fake, **kw)

    def inject(self):
        qa.execute('inject', self.device(), self.evidence)

    def test_api35_pixel9_guard_and_sentinel_injection_use_real_consumer(self):
        self.fake.avd=b'DJLFlutterPixel9AOSP35QA\nOK';self.fake.sdk=b'35'
        self.assertEqual(self.device().guard()['avd'],'DJLFlutterPixel9AOSP35QA')
        self.inject();self.assertGreater(self.fake.writes,0)
        for field,value in [('sdk',b'36'),('size',b'Physical size: 1080x2400'),('size',b'Physical size: 1080x2424\nOverride size: 1080x2424')]:
            self.fake.calls=[];self.fake.pref_reads=0;self.fake.writes=0;setattr(self.fake,field,value)
            with self.subTest(field=field),self.assertRaises(qa.Refused):self.device().read()
            self.assertEqual(self.fake.pref_reads,0);self.assertEqual(self.fake.writes,0)
            self.assertFalse(any(c[0][3:6]==['shell','pm','path'] for c in self.fake.calls))
            self.fake.sdk=b'35';self.fake.size=b'Physical size: 1080x2424'

    def test_pixel9_guard_requires_real_metadata_before_private_io(self):
        self.fake.avd=b'DJLFlutterPixel9QA\nOK\n'
        self.assertEqual(self.device().guard()['avd'],'DJLFlutterPixel9QA')
        for field,value in [('sdk',b'35'),('size',b'Physical size: 1080x2400'),('size',b'Physical size: 1080x2424\nOverride size: 1080x2424')]:
            self.fake.calls=[];setattr(self.fake,field,value)
            with self.subTest(field=field),self.assertRaises(qa.Refused): self.device().read()
            self.assertEqual(self.fake.pref_reads,0);self.assertEqual(self.fake.writes,0)
            self.assertFalse(any(c[0][3:6]==['shell','pm','path'] for c in self.fake.calls))
            self.fake.sdk=b'36';self.fake.size=b'Physical size: 1080x2424'

    def test_00_tool_exposes_guarded_phase_executor(self):
        self.assertTrue(callable(getattr(qa, 'execute', None)),
                        'Missing guarded credential fault executor')

    def test_prelaunch_guard_never_reads_preferences_or_creates_evidence(self):
        result = qa.execute('guard', self.device(), self.evidence)
        self.assertEqual(result['phase'], 'guarded')
        self.assertEqual(self.fake.pref_reads, 0)
        self.assertEqual(self.fake.writes, 0)
        self.assertFalse(self.evidence.exists())

    def test_fault_preserve_restore_cleanup_changes_only_two_public_keys(self):
        self.inject()
        self.assertEqual(self.fake.xml, ORIGINAL.replace(
            b'U0VOVElORUxfRU5DUllQVEVEX0JZVEVT', b'AA=='))
        self.assertEqual(json.loads((self.evidence / 'state.json').read_text())[
            'lastObservedSha256'], hashlib.sha256(self.fake.xml).hexdigest())
        qa.execute('verify-preserved', self.device(), self.evidence)
        qa.execute('restore', self.device(), self.evidence)
        self.assertEqual(self.fake.xml, ORIGINAL)
        self.assertEqual(json.loads((self.evidence / 'state.json').read_text())[
            'lastObservedSha256'], hashlib.sha256(ORIGINAL).hexdigest())
        self.fake.xml = (b'<map><string name="opaque.credential">DO-NOT-PRINT-PRIVATE</string>'
                         b'<int name="opaque.algorithm" value="9" /></map>')
        qa.execute('verify-cleanup', self.device(), self.evidence)
        self.assertEqual(self.fake.writes, 2)
        self.assertEqual(self.evidence.stat().st_mode & 0o777, 0o700)
        for path in self.evidence.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_wrong_avd_hash_debug_uid_and_running_package_refuse_before_pref_read(self):
        for field, value in [('avd', b'Personal\nOK\n'),
                             ('avd', b'OK\n'),
                             ('avd', b'DJLFlutterQA\nDJLFlutterAOSP35QA\nOK\n'),
                             ('digest', '0' * 64), ('uid', b'0\n'),
                             ('running', b'NAME\napp.djl.mobile\n'),
                             ('running', b'NAME\napp.djl.mobile:worker\n')]:
            with self.subTest(field=field, value=value):
                self.fake = FakeADB()
                setattr(self.fake, field, value)
                with self.assertRaises(qa.Refused):
                    self.inject()
                self.assertEqual(self.fake.pref_reads, 0)
                self.assertEqual(self.fake.writes, 0)

    def test_wrong_package_or_serial_refuses_without_adb(self):
        for kw in [{'package': 'other.app'}, {'serial': 'emulator-5554'}]:
            with self.assertRaises(qa.Refused):
                self.device(**kw)
        self.assertEqual(self.fake.calls, [])

    def test_duplicate_missing_control_bad_sentinel_and_temp_refuse_before_mutation(self):
        for xml in [ORIGINAL.replace(b'</map>', f'<string name="{SENTINEL}">duplicate</string></map>'.encode()),
                    ORIGINAL.replace(CONTROL.encode(), b'other'),
                    ORIGINAL.replace(b'U0VOVElORUxfRU5DUllQVEVEX0JZVEVT', b'AA=='),
                    b'<!DOCTYPE map><map/>']:
            self.fake.xml = xml
            with self.assertRaises(qa.Refused):
                self.inject()
            self.assertEqual(self.fake.writes, 0)
        self.fake.xml = ORIGINAL
        self.fake.temp_exists = True
        with self.assertRaises(qa.Refused):
            self.inject()
        self.assertEqual(self.fake.writes, 0)

    def test_native_error_alone_cannot_restore_without_host_preservation(self):
        self.inject()
        with self.assertRaises(qa.Refused):
            qa.execute('restore', self.device(), self.evidence)
        self.assertEqual(self.fake.writes, 1)

    def test_preservation_detects_deleted_sentinel_and_any_unrelated_delta(self):
        self.inject()
        fault = self.fake.xml
        for xml in [fault.replace(SENTINEL.encode(), b'deleted'),
                    fault.replace(b'DO-NOT-PRINT-PRIVATE', b'changed'),
                    fault.replace(b'value="9"', b'value="10"')]:
            self.fake.xml = xml
            with self.assertRaises(qa.Refused):
                qa.execute('verify-preserved', self.device(), self.evidence)
            self.assertEqual(self.fake.writes, 1)

    def test_restore_revalidates_changed_cipher_other_entries_uid_and_evidence(self):
        self.inject()
        qa.execute('verify-preserved', self.device(), self.evidence)
        fault = self.fake.xml
        for xml in [fault.replace(b'AA==', b'AQ=='),
                    fault.replace(b'DO-NOT-PRINT-PRIVATE', b'changed')]:
            self.fake.xml = xml
            with self.assertRaises(qa.Refused):
                qa.execute('restore', self.device(), self.evidence)
            self.assertEqual(self.fake.writes, 1)
        self.fake.xml = fault
        self.fake.uid = b'10124\n'
        with self.assertRaises(qa.Refused):
            qa.execute('restore', self.device(), self.evidence)
        self.fake.uid = b'10123\n'
        (self.evidence / 'before.xml').write_bytes(ORIGINAL + b' ')
        with self.assertRaises(qa.Refused):
            qa.execute('restore', self.device(), self.evidence)
        self.assertEqual(self.fake.writes, 1)

    def test_running_process_rechecked_before_each_preference_write(self):
        self.inject()
        qa.execute('verify-preserved', self.device(), self.evidence)
        self.fake.running = b'NAME\napp.djl.mobile\n'
        with self.assertRaises(qa.Refused):
            qa.execute('restore', self.device(), self.evidence)
        self.assertEqual(self.fake.writes, 1)

    def test_app_start_after_pref_read_refuses_atomic_write(self):
        self.fake.start_after_read = True
        with self.assertRaises(qa.Refused):
            self.inject()
        self.assertEqual(self.fake.writes, 0)

    def test_dangling_temp_backup_and_pref_symlinks_refuse_before_pref_read(self):
        for path in ['shared_prefs/.djl-native-credential-tmp',
                     'shared_prefs/FlutterSecureStorage.xml.bak',
                     'shared_prefs/FlutterSecureStorage.xml']:
            self.fake = FakeADB()
            self.fake.symlinks.add(path)
            with self.assertRaises(qa.Refused):
                self.inject()
            self.assertEqual(self.fake.pref_reads, 0)
            self.assertEqual(self.fake.writes, 0)

    def test_actual_existing_and_dangling_parent_links_refuse_before_content_access(self):
        for existing in [True, False]:
            with self.subTest(existing=existing), tempfile.TemporaryDirectory() as folder:
                self.fake = HostFilesystemADB(Path(folder))
                parent = Path(folder) / 'shared_prefs'
                outside = Path(folder) / 'outside'
                if existing:
                    parent.rename(outside)
                else:
                    self.fake.target.unlink()
                    parent.rmdir()
                parent.symlink_to(outside, target_is_directory=True)
                with self.assertRaises(qa.Refused):
                    self.inject()
                self.assertEqual(self.fake.pref_reads, 0)
                self.assertEqual(self.fake.writes, 0)
                if existing:
                    self.assertEqual((outside / 'FlutterSecureStorage.xml').read_bytes(), ORIGINAL)

    def test_fresh_prelaunch_guard_does_not_require_parent_directory(self):
        self.fake = HostFilesystemADB(self.root / 'public-app')
        self.fake.target.unlink()
        (self.fake.root / 'shared_prefs').rmdir()
        self.assertEqual(qa.execute('guard', self.device(), self.evidence)['phase'], 'guarded')

    def test_actual_shell_empty_and_truncated_stdin_never_replaces_preferences(self):
        for length in [0, 12]:
            with self.subTest(length=length), tempfile.TemporaryDirectory() as folder:
                self.fake = HostFilesystemADB(Path(folder))
                self.fake.received_length = length
                evidence = Path(folder) / 'evidence'
                with self.assertRaises(qa.Refused):
                    qa.execute('inject', self.device(), evidence)
                self.assertEqual(self.fake.target.read_bytes(), ORIGINAL)
                self.assertEqual((Path(folder) / qa.TEMP).read_bytes(), qa.faulted(ORIGINAL)[:length])
                self.assertNotEqual(self.fake.shell_results[-1], 0)
                self.assertEqual(json.loads((evidence / 'state.json').read_text())['phase'], 'prepared')

    def test_actual_state_machine_read_write_gap_keeps_new_opaque_entry(self):
        self.fake = HostFilesystemADB(self.root / 'public-app')
        self.fake.change_after_read = True
        with self.assertRaises(qa.Refused):
            self.inject()
        self.assertEqual(self.fake.target.read_bytes(), ORIGINAL.replace(
            b'DO-NOT-PRINT-PRIVATE', b'NEW-OPAQUE-ENTRY'))
        self.assertEqual((self.fake.root / qa.TEMP).read_bytes(), qa.faulted(ORIGINAL))
        self.assertEqual((self.evidence / 'before.xml').read_bytes(), ORIGINAL)
        self.assertEqual(json.loads((self.evidence / 'state.json').read_text())['phase'], 'prepared')

    def test_actual_shell_complete_input_injects_and_restores_only_sentinel(self):
        self.fake = HostFilesystemADB(self.root / 'public-app')
        self.inject()
        self.assertEqual(self.fake.target.read_bytes(), qa.faulted(ORIGINAL))
        self.assertFalse((self.fake.root / qa.TEMP).exists())
        self.assertEqual(self.fake.target.stat().st_mode & 0o777, 0o600)
        qa.execute('verify-preserved', self.device(), self.evidence)
        qa.execute('restore', self.device(), self.evidence)
        self.assertEqual(self.fake.target.read_bytes(), ORIGINAL)
        self.assertEqual(self.fake.shell_results, [0, 0])

    def test_actual_shell_same_length_corruption_refuses_before_commit(self):
        self.fake = HostFilesystemADB(self.root / 'public-app')
        self.fake.corrupt_payload = True
        with self.assertRaises(qa.Refused):
            self.inject()
        self.assertEqual(self.fake.target.read_bytes(), ORIGINAL)
        temp = (self.fake.root / qa.TEMP).read_bytes()
        self.assertEqual(len(temp), len(qa.faulted(ORIGINAL)))
        self.assertNotEqual(temp, qa.faulted(ORIGINAL))
        self.assertNotEqual(self.fake.shell_results[-1], 0)

    def test_actual_shell_nonzero_and_timeout_before_commit_keep_target_and_private_temp(self):
        for mode in ['nonzero', 'timeout']:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as folder:
                self.fake = HostFilesystemADB(Path(folder))
                self.fake.cat_mode = mode
                evidence = Path(folder) / 'evidence'
                with self.assertRaises(qa.Refused if mode == 'nonzero' else subprocess.TimeoutExpired):
                    qa.execute('inject', self.device(), evidence)
                self.assertEqual(self.fake.target.read_bytes(), ORIGINAL)
                temp = Path(folder) / qa.TEMP
                if mode == 'nonzero':
                    self.assertEqual(temp.read_bytes(), qa.faulted(ORIGINAL))
                else:
                    self.assertTrue(qa.faulted(ORIGINAL).startswith(temp.read_bytes()))
                self.assertEqual(temp.stat().st_mode & 0o777, 0o600)
                self.assertEqual(json.loads((evidence / 'state.json').read_text())['phase'], 'prepared')

    def test_actual_restore_read_write_gap_keeps_new_opaque_entry_and_preserved_evidence(self):
        self.fake = HostFilesystemADB(self.root / 'public-app')
        self.inject()
        qa.execute('verify-preserved', self.device(), self.evidence)
        fault = qa.faulted(ORIGINAL)
        self.fake.change_after_read = True
        with self.assertRaises(qa.Refused):
            qa.execute('restore', self.device(), self.evidence)
        self.assertEqual(self.fake.target.read_bytes(), fault.replace(
            b'DO-NOT-PRINT-PRIVATE', b'NEW-OPAQUE-ENTRY'))
        self.assertEqual((self.fake.root / qa.TEMP).read_bytes(), ORIGINAL)
        self.assertEqual((self.evidence / 'before.xml').read_bytes(), ORIGINAL)
        self.assertEqual(json.loads((self.evidence / 'state.json').read_text())['phase'], 'preserved')

    def test_cleanup_verification_refuses_retained_public_key_or_genuine_deletion(self):
        self.inject()
        qa.execute('verify-preserved', self.device(), self.evidence)
        qa.execute('restore', self.device(), self.evidence)
        for xml in [ORIGINAL, b'<map/>']:
            self.fake.xml = xml
            with self.assertRaises(qa.Refused):
                qa.execute('verify-cleanup', self.device(), self.evidence)

    def test_private_xml_never_in_stdout_or_command_arguments(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            self.inject()
            qa.execute('verify-preserved', self.device(), self.evidence)
            qa.execute('restore', self.device(), self.evidence)
        self.assertNotIn('DO-NOT-PRINT-PRIVATE', output.getvalue())
        for command, _ in self.fake.calls:
            self.assertNotIn('DO-NOT-PRINT-PRIVATE', ' '.join(command))
            self.assertNotIn('<map>', ' '.join(command))

    def test_pref_io_uses_nonpty_shell_with_remote_exit_status_and_stdin(self):
        self.inject()
        for command, payload in self.fake.calls:
            args = command[3:]
            if 'shared_prefs/FlutterSecureStorage.xml' in args or payload is not None:
                self.assertEqual(args[:2], ['shell', '-T'])
            if payload is not None:
                self.assertEqual(payload, ORIGINAL.replace(
                    b'U0VOVElORUxfRU5DUllQVEVEX0JZVEVT', b'AA=='))


if __name__ == '__main__':
    unittest.main()
