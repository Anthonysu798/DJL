"""Run the real QA scripts with subprocess, clock, HTTP and lifecycle doubles only."""
from contextlib import redirect_stdout, redirect_stderr
import hashlib
import io
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tool'))
import runpy
import subprocess
import tempfile
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
ADB = str(Path.home() / 'Library/Android/sdk/platform-tools/adb')
BASE = [ADB, '-s', 'emulator-5556']
IOS = '3526719A-27DA-4F9A-9CC0-C83AA94FD935'
SHORT = 'DJL_PRIVACY_SHORT_BACKGROUND_READY\n'
LONG = 'DJL_PRIVACY_LONG_BACKGROUND_READY\n'
PAUSED = 'DJL_PRIVACY_LIFECYCLE_paused\n'


class BackgroundHarness:
    def __init__(self, case, platform='android'):
        folder = tempfile.TemporaryDirectory()
        case.addCleanup(folder.cleanup)
        self.log = Path(folder.name) / 'privacy.log'
        self.log.write_text(SHORT)
        self.platform = platform
        self.sdk = '36'; self.size = 'Physical size: 1080x2424'
        self.avd = 'DJLFlutterAOSP35QA\nOK\n'
        self.pid = '4321'
        self.now = 0.0
        self.commands, self.queries = [], []
        self.ignore_pause = False
        self.fail_long = False
        self.change_pid_long = False
        self.replace_on_resume = False
        self.output = io.StringIO()

    def sleep(self, seconds):
        self.now += seconds
        if self.fail_long and self.now >= 10:
            self.log.write_text(self.log.read_text() + 'Some tests failed\n')
        if self.change_pid_long and self.now >= 307:
            self.pid = '5678'

    def read(self, command, **kwargs):
        self.queries.append(command)
        if command == BASE + ['emu', 'avd', 'name']:
            return self.avd
        if command == BASE + ['shell', 'getprop', 'ro.build.version.sdk']:
            return self.sdk
        if command == BASE + ['shell', 'wm', 'size']:
            return self.size
        if command == BASE + ['shell', 'pidof', 'app.djl.mobile']:
            return self.pid + '\n'
        if command == ['xcrun', 'simctl', 'spawn', IOS, 'launchctl', 'list']:
            return f'{self.pid}\t0\tUIKitApplication:app.djl.mobile[fixture]\n'
        raise AssertionError(f'Unexpected subprocess read: {command}')

    def run_command(self, command, **kwargs):
        if kwargs.get('check') is not True:
            raise AssertionError('Native lifecycle command must check exit status')
        self.commands.append((self.now, command))
        home = BASE + ['shell', 'input', 'keyevent', '3']
        resume = BASE + ['shell', 'am', 'start', '-n', 'app.djl.mobile/.MainActivity']
        ios_home = ['xcrun', 'simctl', 'launch', IOS, 'com.apple.Preferences']
        ios_resume = ['xcrun', 'simctl', 'launch', IOS, 'app.djl.mobile']
        if command in [home, ios_home]:
            if not self.ignore_pause:
                self.log.write_text(self.log.read_text() + PAUSED)
        elif command in [resume, ios_resume]:
            self.log.write_text(self.log.read_text() + LONG)
            if self.replace_on_resume:
                self.pid = '5678'
        else:
            raise AssertionError(f'Forbidden lifecycle command: {command}')
        return types.SimpleNamespace(returncode=0)

    def execute(self, extra=()):
        argv = [str(ROOT / 'tool/native_lock_background.py'), str(self.log)]
        if self.platform == 'ios':
            argv += ['--simulator', IOS]  # Existing CLI: no platform argument.
        else:
            argv += ['--platform', 'android']
        argv += list(extra)
        with mock.patch.object(sys, 'argv', argv), \
             mock.patch('subprocess.check_output', side_effect=self.read), \
             mock.patch('subprocess.run', side_effect=self.run_command), \
             mock.patch('time.monotonic', side_effect=lambda: self.now), \
             mock.patch('time.sleep', side_effect=self.sleep), \
             redirect_stdout(self.output), redirect_stderr(self.output):
            runpy.run_path(str(ROOT / 'tool/native_lock_background.py'), run_name='__main__')


class Process:
    def __init__(self, code=0):
        self.returncode = None
        self.code = code
        self.waits = []
        self.terminated = False
    def poll(self):
        return self.returncode
    def wait(self, timeout):
        self.waits.append(timeout)
        if not self.terminated:
            self.returncode = self.code
        return self.returncode
    def terminate(self):
        self.terminated = True
        self.returncode = -15


class RunnerHarness:
    def __init__(self, case, journey='privacy'):
        folder = tempfile.TemporaryDirectory()
        case.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.apk = self.root / 'fixture.apk'
        self.apk.write_bytes(b'owned QA artifact fixture')
        self.log = self.root / 'journey.log'
        self.journey = journey
        self.driver_code = 0
        self.background_code = 0
        self.failure_text = False
        self.finish_marker = None
        self.wrong_hash = False
        self.hash_requires_seconds = 0
        self.hash_timeout = None
        self.sdk = '36'; self.size = 'Physical size: 1080x2424'
        self.avd = 'DJLFlutterAOSP35QA\nOK\n'
        self.avd_error = None
        self.events = []
        self.processes, self.commands = [], []
        self.output = io.StringIO()

    def read(self, command, **kwargs):
        self.events.append(('query', command))
        if command == BASE + ['emu', 'avd', 'name']:
            if self.avd_error is not None:
                raise self.avd_error
            return self.avd
        if command == BASE + ['shell', 'pm', 'path', 'app.djl.mobile']:
            return 'package:/data/app/qa/package/base.apk\n'
        if command == BASE + ['shell', 'sha256sum', '/data/app/qa/package/base.apk']:
            self.hash_timeout = kwargs.get('timeout')
            if self.hash_timeout < self.hash_requires_seconds:
                raise subprocess.TimeoutExpired(command, self.hash_timeout)
            digest = '0' * 64 if self.wrong_hash else hashlib.sha256(b'owned QA artifact fixture').hexdigest()
            return digest + ' /data/app/qa/package/base.apk\n'
        if command == BASE + ['shell', 'getprop', 'ro.build.version.sdk']:
            return self.sdk
        if command == BASE + ['shell', 'wm', 'size']:
            return self.size
        if command == BASE + ['shell', 'pidof', 'app.djl.mobile']:
            return '4321\n'
        if command == BASE + ['logcat', '-d', '--pid=4321', '-s', 'flutter']:
            return 'VM service http://127.0.0.1:58670/fixture/\n'
        raise AssertionError(f'Unexpected runner subprocess read: {command}')

    def run_command(self, command, **kwargs):
        self.commands.append(command)
        self.events.append(('mutation', command))
        if command[:3] == BASE:
            if kwargs.get('check') is not True:
                raise AssertionError('ADB runner operation must check status')
            return types.SimpleNamespace(returncode=0)
        if command[0] == str(Path.home() / 'flutter/bin/flutter') and command[1] == 'drive':
            if kwargs['env']['DJL_QA_PLATFORM'] != 'android':
                raise AssertionError('Missing Android driver platform')
            marker = {'desktop':'DJL_DESKTOP_FINISHED','links':'DJL_LINK_FINISHED','settings':'DJL_SETTINGS_FINISHED','settings-restore':'DJL_SETTINGS_RESTORE_FINISHED','advanced':'DJL_ADVANCED_FINISHED','lock':'DJL_LOCK_FINISHED','composer':'DJL_COMPOSER_FINISHED','privacy':'DJL_PRIVACY_FINISHED','undo':'DJL_UNDO_FINISHED','draft':'DJL_DRAFT_FINISHED'}[self.journey]
            kwargs['stdout'].write('All tests passed\n' + (self.finish_marker or marker) + '\n')
            if self.failure_text:
                kwargs['stdout'].write('Failure Details: synthetic rejected result\n')
            return types.SimpleNamespace(returncode=self.driver_code)
        raise AssertionError(f'Unexpected runner subprocess: {command}')

    def popen(self, command, **kwargs):
        script = Path(command[1]).name
        if script not in {'native_lock_background.py','native_frame_harness.py','native_links_harness.py','native_ssh_harness.py'}:
            raise AssertionError(f'Unexpected helper process: {command}')
        process = Process(self.background_code if script == 'native_lock_background.py' else 0)
        self.processes.append((script, command, kwargs['stdout'].name, process))
        kwargs['stdout'].write('synthetic helper output\n')
        return process

    def execute(self):
        argv = [str(ROOT / 'tool/run_native_android.py'), str(self.apk), 'integration_test/lock_lifecycle_test.dart', str(self.log), '--journey', self.journey]
        response = mock.MagicMock()
        response.__enter__.return_value.status = 200
        with mock.patch.object(sys, 'argv', argv), \
             mock.patch('subprocess.run', side_effect=self.run_command), \
             mock.patch('subprocess.check_output', side_effect=self.read), \
             mock.patch('subprocess.Popen', side_effect=self.popen), \
             mock.patch('urllib.request.urlopen', return_value=response), \
             mock.patch('os.umask'), \
             mock.patch('time.sleep'), \
             redirect_stdout(self.output), redirect_stderr(self.output):
            runpy.run_path(str(ROOT / 'tool/run_native_android.py'), run_name='__main__')


class AndroidPrivacyToolingTests(unittest.TestCase):
    def test_api35_pixel9_runner_and_background_require_matching_metadata(self):
        for harness_type in [RunnerHarness,BackgroundHarness]:
            harness=harness_type(self);harness.avd='DJLFlutterPixel9AOSP35QA\nOK';harness.sdk='35'
            harness.execute();self.assertTrue(harness.commands)
            for field,value in [('sdk','36'),('size','Physical size: 1080x2400'),('size','Physical size: 1080x2424\nOverride size: 1080x2424')]:
                harness=harness_type(self);harness.avd='DJLFlutterPixel9AOSP35QA\nOK';harness.sdk='35';setattr(harness,field,value)
                with self.subTest(tool=harness_type.__name__,field=field),self.assertRaises(RuntimeError):harness.execute()
                self.assertEqual(harness.commands,[])
                if isinstance(harness,RunnerHarness):self.assertEqual(harness.processes,[])

    def test_pixel9_runner_and_background_prove_metadata_before_commands(self):
        for harness_type in [RunnerHarness,BackgroundHarness]:
            harness=harness_type(self);harness.avd='DJLFlutterPixel9QA\nOK'
            harness.execute();self.assertTrue(harness.commands)
            for field,value in [('sdk','35'),('size','Physical size: 1080x2400'),('size','Physical size: 1080x2424\nOverride size: 1080x2424')]:
                harness=harness_type(self);harness.avd='DJLFlutterPixel9QA\nOK';setattr(harness,field,value)
                with self.subTest(tool=harness_type.__name__,field=field),self.assertRaises(RuntimeError): harness.execute()
                self.assertEqual(harness.commands,[])
                if isinstance(harness,RunnerHarness): self.assertEqual(harness.processes,[])

    def test_android_home_and_resume_preserve_pid_after_305_monotonic_seconds(self):
        harness = BackgroundHarness(self)
        harness.execute()
        self.assertEqual([command for _, command in harness.commands], [
            BASE + ['shell', 'input', 'keyevent', '3'],
            BASE + ['shell', 'am', 'start', '-n', 'app.djl.mobile/.MainActivity'],
            BASE + ['shell', 'input', 'keyevent', '3'],
            BASE + ['shell', 'am', 'start', '-n', 'app.djl.mobile/.MainActivity'],
        ])
        self.assertEqual(harness.commands[1][0] - harness.commands[0][0], 2)
        self.assertEqual(harness.commands[3][0] - harness.commands[2][0], 305)
        self.assertIn(BASE + ['emu', 'avd', 'name'], harness.queries)
        self.assertGreaterEqual(harness.queries.count(BASE + ['shell', 'pidof', 'app.djl.mobile']), 3)

    def test_both_owned_avds_are_allowed_but_other_names_fail_before_home(self):
        for avd in ['DJLFlutterAOSP35QA\nOK\n', 'DJLFlutterQA\nOK\n']:
            harness = BackgroundHarness(self)
            harness.avd = avd
            harness.execute()
        for avd in ['UnrelatedUserAVD\nOK\n', 'DJLFlutterQA-other\nOK\n', '', 'DJLFlutterQA\nDJLFlutterAOSP35QA\nOK\n']:
            harness = BackgroundHarness(self)
            harness.avd = avd
            with self.subTest(avd=avd), self.assertRaises(RuntimeError):
                harness.execute()
            self.assertEqual(harness.commands, [])

        harness = BackgroundHarness(self)
        with self.assertRaisesRegex(RuntimeError, 'only valid for iOS'):
            harness.execute(extra=['--simulator', IOS])
        self.assertEqual(harness.commands, [])

    def test_missing_or_ambiguous_pid_fails_before_background(self):
        for pid in ['', '4321 5678', '0', '-1']:
            harness = BackgroundHarness(self)
            harness.pid = pid
            with self.subTest(pid=pid), self.assertRaises(RuntimeError):
                harness.execute()
            self.assertEqual(harness.commands, [])

    def test_old_paused_marker_cannot_replace_observed_current_background(self):
        harness = BackgroundHarness(self)
        harness.log.write_text(PAUSED + SHORT)
        harness.ignore_pause = True
        with self.assertRaisesRegex(RuntimeError, 'stage was not reached'):
            harness.execute()
        self.assertEqual(len(harness.commands), 1)

    def test_failure_while_long_backgrounded_stops_without_second_resume(self):
        harness = BackgroundHarness(self)
        harness.fail_long = True
        with self.assertRaisesRegex(RuntimeError, 'failed while backgrounded'):
            harness.execute()
        self.assertEqual(len(harness.commands), 3)
        self.assertLess(harness.now, 307)

    def test_replaced_process_in_background_is_rejected_before_resume_can_restart(self):
        harness = BackgroundHarness(self)
        harness.change_pid_long = True
        with self.assertRaisesRegex(RuntimeError, 'process'):
            harness.execute()
        self.assertEqual(len(harness.commands), 3)

    def test_replacement_during_resume_is_rejected(self):
        harness = BackgroundHarness(self)
        harness.replace_on_resume = True
        with self.assertRaisesRegex(RuntimeError, 'process'):
            harness.execute()
        self.assertEqual(len(harness.commands), 2)

    def test_existing_ios_cli_still_uses_settings_and_plain_launch(self):
        harness = BackgroundHarness(self, platform='ios')
        harness.execute()
        self.assertEqual([command for _, command in harness.commands], [
            ['xcrun','simctl','launch',IOS,'com.apple.Preferences'],
            ['xcrun','simctl','launch',IOS,'app.djl.mobile'],
            ['xcrun','simctl','launch',IOS,'com.apple.Preferences'],
            ['xcrun','simctl','launch',IOS,'app.djl.mobile'],
        ])
        self.assertEqual(harness.commands[3][0] - harness.commands[2][0], 305)

    def test_runner_privacy_requires_frame_and_background_helpers_to_finish(self):
        harness = RunnerHarness(self)
        harness.execute()
        frame = next(entry for entry in harness.processes if entry[0] == 'native_frame_harness.py')
        background = next(entry for entry in harness.processes if entry[0] == 'native_lock_background.py')
        self.assertEqual(frame[1][frame[1].index('--prefix') + 1], 'DJL_PRIVACY')
        self.assertEqual(frame[1][frame[1].index('--timeout') + 1], '660')
        self.assertEqual(background[1], [sys.executable, str(ROOT / 'tool/native_lock_background.py'), str(harness.log), '--platform', 'android'])
        self.assertTrue(background[2].endswith('.background.log'))
        self.assertNotEqual(background[2], frame[2])
        self.assertEqual(background[3].waits, [15])
        self.assertEqual(background[3].returncode, 0)
        self.assertIn('Native assertions and host checks passed.', harness.output.getvalue())

    def test_runner_undo_requires_its_own_frame_and_finish_marker(self):
        harness = RunnerHarness(self, 'undo')
        harness.execute()
        self.assertEqual(len(harness.processes), 1)
        frame = harness.processes[0]
        self.assertEqual(frame[0], 'native_frame_harness.py')
        self.assertEqual(frame[1][frame[1].index('--prefix') + 1], 'DJL_UNDO')
        self.assertEqual(frame[3].waits, [15])
        self.assertEqual(frame[3].returncode, 0)
        self.assertIn('Native assertions and host checks passed.', harness.output.getvalue())
        wrong = RunnerHarness(self, 'undo')
        wrong.finish_marker = 'DJL_SETTINGS_FINISHED'
        with self.assertRaisesRegex(RuntimeError, 'final assertions'):
            wrong.execute()

    def test_runner_draft_requires_its_own_frame_driver_and_finish_marker(self):
        harness = RunnerHarness(self, 'draft')
        harness.execute()
        self.assertEqual(len(harness.processes), 1)
        frame = harness.processes[0]
        self.assertEqual(frame[0], 'native_frame_harness.py')
        self.assertEqual(frame[1][frame[1].index('--prefix') + 1], 'DJL_DRAFT')
        self.assertEqual(frame[1][frame[1].index('--timeout') + 1], '360')
        self.assertEqual(frame[3].waits, [15])
        for code, failure, marker in [(1, False, None), (0, True, None), (0, False, 'DJL_UNDO_FINISHED')]:
            refused = RunnerHarness(self, 'draft')
            refused.driver_code, refused.failure_text, refused.finish_marker = code, failure, marker
            with self.assertRaises(RuntimeError):
                refused.execute()
        refused = RunnerHarness(self, 'draft')
        refused.wrong_hash = True
        with self.assertRaisesRegex(RuntimeError, 'does not match'):
            refused.execute()
        self.assertEqual(refused.processes, [])

    def test_runner_rejects_failed_or_unproven_background_exit_despite_native_marker(self):
        for code in [1, None]:
            harness = RunnerHarness(self)
            harness.background_code = code
            with self.subTest(code=code), self.assertRaisesRegex(RuntimeError, 'background'):
                harness.execute()
            self.assertNotIn('Native assertions and host checks passed.', harness.output.getvalue())

    def test_runner_driver_or_failure_text_cleans_up_both_helpers(self):
        for driver_code, failure in [(1, False), (0, True)]:
            harness = RunnerHarness(self)
            harness.driver_code, harness.failure_text = driver_code, failure
            with self.subTest(code=driver_code, failure=failure), self.assertRaises(RuntimeError):
                harness.execute()
            self.assertEqual(len(harness.processes), 2)
            self.assertTrue(all(process.terminated for _, _, _, process in harness.processes))

    def test_runner_existing_journeys_do_not_start_background_helper(self):
        for journey in ['desktop','links','settings','settings-restore','advanced','lock','composer','undo','draft']:
            harness = RunnerHarness(self, journey)
            harness.execute()
            self.assertFalse(any(script == 'native_lock_background.py' for script, _, _, _ in harness.processes))
            self.assertFalse(harness.log.with_suffix('.background.log').exists())

    def test_large_debug_apk_hash_has_a_separate_bounded_read_budget(self):
        harness = RunnerHarness(self, 'lock')
        harness.hash_requires_seconds = 30
        harness.execute()
        self.assertEqual(harness.hash_timeout, 60)
        self.assertIn('Native assertions and host checks passed.', harness.output.getvalue())

    def test_runner_still_rejects_wrong_installed_hash_before_helpers(self):
        harness = RunnerHarness(self)
        harness.wrong_hash = True
        with self.assertRaisesRegex(RuntimeError, 'does not match'):
            harness.execute()
        self.assertEqual(harness.processes, [])


    def test_runner_checks_both_owned_avds_before_preparation_for_every_journey(self):
        for journey in ['desktop','links','settings','settings-restore','advanced','lock','composer','privacy','undo','draft']:
            for avd in ['DJLFlutterAOSP35QA\nOK\n', ' DJLFlutterQA \r\nOK\r\n']:
                with self.subTest(journey=journey, avd=avd):
                    harness = RunnerHarness(self, journey)
                    harness.avd = avd
                    harness.execute()
                    self.assertEqual(harness.events[0], ('query', BASE + ['emu', 'avd', 'name']))
                    self.assertTrue(harness.commands)

    def test_runner_rejects_missing_ambiguous_or_unowned_avd_before_any_preparation(self):
        for journey in ['desktop','links','settings','settings-restore','advanced','lock','composer','privacy','undo','draft']:
            for avd in ['', 'OK\n', 'UnownedAVD\nOK\n', 'DJLFlutterQA-other\nOK\n', 'DJLFlutterQA\nDJLFlutterAOSP35QA\nOK\n']:
                with self.subTest(journey=journey, avd=avd):
                    harness = RunnerHarness(self, journey)
                    harness.avd = avd
                    with self.assertRaisesRegex(RuntimeError, 'owned'):
                        harness.execute()
                    self.assertEqual(harness.commands, [])
                    self.assertEqual(harness.processes, [])

    def test_runner_failed_or_timed_out_avd_query_prevents_any_preparation(self):
        query = BASE + ['emu', 'avd', 'name']
        for journey in ['desktop','links','settings','settings-restore','advanced','lock','composer','privacy','undo','draft']:
            for failure in [subprocess.CalledProcessError(1, query), subprocess.TimeoutExpired(query, 10)]:
                with self.subTest(journey=journey, failure=type(failure).__name__):
                    harness = RunnerHarness(self, journey)
                    harness.avd_error = failure
                    with self.assertRaises(type(failure)):
                        harness.execute()
                    self.assertEqual(harness.commands, [])
                    self.assertEqual(harness.processes, [])


if __name__ == '__main__':
    unittest.main()
