"""Host tools only: OS captures/HTTP are mocked; stall workers are owned Python sleepers."""
import contextlib
import errno
import importlib.util
import io
import json
from pathlib import Path
import signal
import struct
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zlib

TOOL = Path(__file__).resolve().parents[2] / 'tool'
sys.path.insert(0, str(TOOL))
spec = importlib.util.spec_from_file_location('native_frame_harness', TOOL / 'native_frame_harness.py')
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


def chunk(kind, body):
    return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))


def png(width=1080, height=2424, pixels=None):
    raw = (b'\0' + b'\x80\x40\x20' * width) * height if pixels is None else pixels
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


class ReasoningHarnessTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.now = 0
        self.serial = 0

    def case(self, mode='live', platform='android'):
        self.serial += 1
        output = Path(self.folder.name) / f'case-{self.serial}'
        output.mkdir()
        run = f'run-{self.serial}'
        session = harness.ReasoningCapture(run, mode, platform, output, 'a' * 64, self.serial, (1080, 2424), now=0, clock=lambda: self.now)
        return SimpleNamespace(run=run, output=output, session=session, calls=[], budgets=[], log=harness.DRIVER_CONNECTED + '\n')

    def capture(self, case, path, budget):
        case.calls.append(path)
        case.budgets.append(budget)
        path.write_bytes(png())

    def ready(self, case, phase):
        case.log += f'DJL_REASONING_READY {case.run} {phase}\n'
        case.session.poll(case.log, self.now, lambda p, b: self.capture(case, p, b), refresh=lambda: case.log)

    def ack(self, case, phase, run=None):
        return case.session.authorize(lambda: case.log, run or case.run, phase)['ack']

    def test_live_and_cold_order_exact_ack_unique_capture_metadata(self):
        for mode, platform, phases in [('live', 'android', harness.REASONING_PHASES[:4]), ('cold', 'ios', harness.REASONING_PHASES[4:])]:
            with self.subTest(mode=mode):
                c = self.case(mode, platform)
                self.assertFalse(self.ack(c, phases[0]))
                for phase in phases:
                    self.ready(c, phase)
                    self.assertTrue(self.ack(c, phase))
                    self.assertFalse(self.ack(c, phase, 'stale'))
                    self.assertFalse(self.ack(c, 'wrong'))
                    if len(c.session.records) > 1:
                        self.assertFalse(self.ack(c, phases[0]))
                self.assertEqual(len(set(c.calls)), len(phases))
                records = json.loads((c.output / f'{c.run}-{mode}-manifest.json').read_text())
                self.assertEqual(records, c.session.records)
                self.assertTrue(all(r['sha256'] and r['capturedAt'] and r['platform'] == platform for r in records))
                c.log += f'DJL_REASONING_FINISHED {c.run} {mode}\n'
                c.session.poll(c.log, self.now, lambda p, b: self.fail('Finish must not capture'))
                self.assertTrue(c.session.finished)

    def test_each_driver_failure_is_recognized_from_a_fresh_session(self):
        for failure in harness.FAILURES:
            with self.subTest(failure=failure):
                c = self.case()
                self.assertFalse(c.session.failed)
                c.log += failure
                with self.assertRaisesRegex(RuntimeError, 'driver failure'):
                    c.session.poll(c.log, self.now, lambda p, b: self.capture(c, p, b))
                self.assertEqual(c.calls, [])
                self.assertFalse(self.ack(c, 'STREAM_COLLAPSED'))

    def test_distinct_capture_failures_execute_each_intended_callback(self):
        cases = [
            ('missing-file', lambda p: p.unlink(), FileNotFoundError, None),
            ('empty-file', lambda p: None, ValueError, 'not a PNG'),
            ('invalid-bytes', lambda p: p.write_bytes(b'bad'), ValueError, 'not a PNG'),
            ('wrong-geometry', lambda p: p.write_bytes(png(2, 2)), ValueError, 'geometry mismatch'),
            ('incomplete-png', lambda p: p.write_bytes(png()[:-12]), ValueError, 'not a PNG'),
            ('incomplete-pixels', lambda p: p.write_bytes(png(pixels=b'one scanline')), ValueError, 'image data is incomplete'),
        ]
        for name, action, category, message in cases:
            with self.subTest(name=name):
                c = self.case()
                c.log += f'DJL_REASONING_READY {c.run} STREAM_COLLAPSED\n'
                def capture(path, budget):
                    c.calls.append(path)
                    action(path)
                with self.assertRaises(category) as raised:
                    c.session.poll(c.log, self.now, capture)
                self.assertEqual(len(c.calls), 1, name)
                if message:
                    self.assertIn(message, str(raised.exception))
                self.assertFalse(self.ack(c, 'STREAM_COLLAPSED'))
                self.assertEqual(c.session.records, [])

    def test_explicit_capture_exception_is_not_a_file_collision(self):
        c = self.case()
        c.log += f'DJL_REASONING_READY {c.run} STREAM_COLLAPSED\n'
        def capture(path, budget):
            c.calls.append(path)
            raise OSError(errno.EIO, 'explicit capture exception')
        with self.assertRaisesRegex(OSError, 'explicit capture exception') as raised:
            c.session.poll(c.log, self.now, capture)
        self.assertEqual(raised.exception.errno, errno.EIO)
        self.assertEqual(len(c.calls), 1)
        self.assertFalse(self.ack(c, 'STREAM_COLLAPSED'))

    def test_file_collision_has_its_own_guard_and_never_invokes_capture(self):
        c = self.case()
        path = c.output / f'{c.run}-live-STREAM_COLLAPSED.png'
        path.write_bytes(png())
        with self.assertRaises(FileExistsError):
            self.ready(c, 'STREAM_COLLAPSED')
        self.assertEqual(c.calls, [])
        self.assertFalse(self.ack(c, 'STREAM_COLLAPSED'))

    def test_initial_protocol_refusals_are_independent_and_before_capture(self):
        for marker in ['DJL_REASONING_READY old STREAM_COLLAPSED', 'DJL_REASONING_READY {run} HISTORY', 'DJL_REASONING_FINISHED {run} live', 'DJL_REASONING_READY {run} STREAM_COLLAPSED\nDJL_REASONING_READY {run} STREAM_COLLAPSED']:
            with self.subTest(marker=marker):
                c = self.case()
                c.log += marker.format(run=c.run) + '\n'
                with self.assertRaises(RuntimeError):
                    c.session.poll(c.log, self.now, lambda p, b: self.capture(c, p, b))
                self.assertEqual(c.calls, [])
                self.assertFalse(self.ack(c, 'STREAM_COLLAPSED'))
        c = self.case()
        c.log = f'DJL_REASONING_READY {c.run} STREAM_COLLAPSED\n'
        with self.assertRaisesRegex(RuntimeError, 'missing driver'):
            c.session.poll(c.log, self.now, lambda p, b: self.capture(c, p, b))
        self.assertEqual(c.calls, [])

    def test_capture_and_metadata_write_keep_get_responsive_without_ack(self):
        c = self.case()
        c.log += f'DJL_REASONING_READY {c.run} STREAM_COLLAPSED\n'
        original = c.session.write_manifest
        observed = []
        def request_ack():
            thread = harness.threading.Thread(target=lambda: observed.append(self.ack(c, 'STREAM_COLLAPSED')))
            thread.start()
            thread.join(timeout=1)
            self.assertFalse(thread.is_alive(), 'GET must not block on capture/metadata I/O')
        def capture(path, budget):
            request_ack()
            self.capture(c, path, budget)
        def write(records):
            request_ack()
            self.assertEqual(c.session.records, [])
            original(records)
        with patch.object(c.session, 'write_manifest', side_effect=write):
            c.session.poll(c.log, self.now, capture, refresh=lambda: c.log)
        self.assertEqual(observed, [False, False])
        self.assertTrue(self.ack(c, 'STREAM_COLLAPSED'))

    def test_manifest_failure_never_publishes_record_or_ack(self):
        for failure in ['write', 'replace', 'fsync']:
            with self.subTest(failure=failure):
                c = self.case()
                c.log += f'DJL_REASONING_READY {c.run} STREAM_COLLAPSED\n'
                target, name = (c.session, 'write_manifest') if failure == 'write' else (harness.os, failure)
                with patch.object(target, name, side_effect=OSError(errno.EIO, f'metadata {failure} failed')):
                    with self.assertRaisesRegex(OSError, f'metadata {failure} failed'):
                        c.session.poll(c.log, self.now, lambda p, b: self.capture(c, p, b))
                self.assertEqual(len(c.calls), 1)
                self.assertEqual(c.session.records, [])
                self.assertFalse(self.ack(c, 'STREAM_COLLAPSED'))
                self.assertEqual(list(c.output.glob('*manifest.json.*')), [])

    def test_changes_during_capture_or_manifest_revoke_all_authorization(self):
        for during in ['capture', 'manifest']:
            with self.subTest(during=during):
                c = self.case()
                c.log += f'DJL_REASONING_READY {c.run} STREAM_COLLAPSED\n'
                original = c.session.write_manifest
                def capture(path, budget):
                    self.capture(c, path, budget)
                    if during == 'capture':
                        c.log += 'DriverError: changed during capture\n'
                def write(records):
                    original(records)
                    c.log += f'DJL_REASONING_READY {c.run} STREAM_EXPANDED\n'
                with patch.object(c.session, 'write_manifest', side_effect=write):
                    with self.assertRaises(RuntimeError):
                        c.session.poll(c.log, self.now, capture, refresh=lambda: c.log)
                self.assertEqual(len(c.calls), 1)
                self.assertFalse(self.ack(c, 'STREAM_COLLAPSED'))
                self.assertEqual(c.session.records, [])

    def test_valid_next_phase_pending_get_cannot_reuse_previous_ack(self):
        c = self.case()
        self.ready(c, 'STREAM_COLLAPSED')
        c.log += f'DJL_REASONING_READY {c.run} STREAM_EXPANDED\n'
        self.assertFalse(self.ack(c, 'STREAM_COLLAPSED'))
        self.assertFalse(self.ack(c, 'STREAM_EXPANDED'))
        self.assertFalse(c.session.failed)
        c.session.poll(c.log, self.now, lambda p, b: self.capture(c, p, b))
        self.assertTrue(self.ack(c, 'STREAM_EXPANDED'))

    def test_capture_receives_remaining_phase_and_run_budget_both_platforms(self):
        for platform in ['ios', 'android']:
            for now, checkpoint, expected in [(44.5, 0, .5), (179, 160, 1)]:
                with self.subTest(platform=platform, budget=expected):
                    c = self.case(platform=platform)
                    self.now = now
                    c.session.checkpoint = checkpoint
                    self.ready(c, 'STREAM_COLLAPSED')
                    self.assertEqual(c.budgets, [expected])
        self.now = 0

    def test_expiry_and_legacy_captured_flag_never_authorize(self):
        for now, checkpoint in [(45, 0), (180, 179)]:
            c = self.case()
            self.ready(c, 'STREAM_COLLAPSED')
            self.now = now
            c.session.checkpoint = checkpoint
            self.assertFalse(self.ack(c, 'STREAM_COLLAPSED'))
            self.assertTrue(c.session.failed)
            self.now = 0
        c = self.case()
        c.log += '{"captured": true}\n'
        c.session.poll(c.log, self.now, lambda p, b: self.fail('No READY'))
        self.assertFalse(self.ack(c, 'STREAM_COLLAPSED'))

    def test_actual_handler_revalidates_each_invalid_append_before_next_poll(self):
        for invalid in ['duplicate', 'stale', 'order', 'error', 'phase-deadline', 'run-deadline']:
            with self.subTest(invalid=invalid):
                self.now = 0
                c = self.case(platform='ios')
                log = c.output / 'driver.log'
                log.write_text('')
                args = SimpleNamespace(platform='ios', log=log, reasoning='live', geometry='1080x2424', artifact_sha256='a' * 64, app_process_id=1, simulator='mock', port=0)
                ready = c.log + f'DJL_REASONING_READY {c.run} STREAM_COLLAPSED\n'
                def session(*a, **kw):
                    c.log = ready
                    log.write_text(ready)
                    return c.session
                def get_before_poll(_):
                    extra = {'duplicate': f'DJL_REASONING_READY {c.run} STREAM_COLLAPSED\n', 'stale': 'DJL_REASONING_READY stale STREAM_EXPANDED\n', 'order': f'DJL_REASONING_READY {c.run} HISTORY\n', 'error': 'DriverError: after capture\n'}.get(invalid, '')
                    log.write_text(ready + extra)
                    if invalid == 'phase-deadline':
                        self.now = 45
                    if invalid == 'run-deadline':
                        self.now = 180
                        c.session.checkpoint = 179
                    handler = object.__new__(server.call_args.args[1])
                    handler.path = f'/?run={c.run}&phase=STREAM_COLLAPSED'
                    handler.wfile = io.BytesIO()
                    handler.send_response = lambda *a: None
                    handler.send_header = lambda *a: None
                    handler.end_headers = lambda: None
                    handler.do_GET()  # Deliberately no intervening poll.
                    self.assertFalse(json.loads(handler.wfile.getvalue())['ack'])
                    self.assertTrue(c.session.failed)
                    raise RuntimeError('Host test stop')
                with patch.dict(harness.os.environ, {'DJL_QA_REASONING_RUN_ID': c.run}), patch.object(harness, '__file__', str(c.output / 'tool/harness.py')), patch.object(harness, 'ReasoningCapture', side_effect=session), patch.object(harness, 'ThreadingHTTPServer') as server, patch.object(harness.threading, 'Thread'), patch.object(harness, 'capture_reasoning_frame', side_effect=lambda platform, sim, path, budget: self.capture(c, path, budget)), patch.object(harness.time, 'sleep', side_effect=get_before_poll), patch.object(harness.time, 'monotonic', side_effect=lambda: self.now):
                    with self.assertRaisesRegex(RuntimeError, 'Host test stop'):
                        harness.reasoning_main(args)
                self.assertEqual(len(c.calls), 1)
                server.return_value.shutdown.assert_called_once()

    def test_owned_stalled_capture_is_killed_and_reaped_both_platforms(self):
        # Substitute only owned Python sleepers; never start adb/simctl or a service.
        real_popen = subprocess.Popen
        for platform, code in [('ios', 'import time;time.sleep(60)'), ('android', 'import time;time.sleep(.03);time.sleep(.03);time.sleep(60)')]:
            with self.subTest(platform=platform):
                c = self.case(platform=platform)
                workers = []
                def spawn(command, **kw):
                    self.assertEqual(command[-3:-1], [platform, 'mock'])
                    self.assertTrue(kw['start_new_session'])
                    process = real_popen([sys.executable, '-c', code], **kw)
                    workers.append(process)
                    return process
                self.now = 44.88
                c.log += f'DJL_REASONING_READY {c.run} STREAM_COLLAPSED\n'
                def capture(path, budget):
                    c.calls.append(path)
                    self.assertAlmostEqual(budget, .12)
                    harness.capture_reasoning_frame(platform, 'mock', path, budget)
                start = time.monotonic()
                with patch.object(harness.subprocess, 'Popen', side_effect=spawn), patch.object(harness.os, 'killpg', wraps=harness.os.killpg) as kill:
                    with self.assertRaisesRegex(TimeoutError, 'remaining budget'):
                        c.session.poll(c.log, self.now, capture)
                    kill.assert_called_once_with(workers[0].pid, signal.SIGKILL)
                self.assertLess(time.monotonic() - start, .3)
                self.assertIsNotNone(workers[0].poll())
                self.assertEqual(len(c.calls), 1)
                self.assertFalse(self.ack(c, 'STREAM_COLLAPSED'))
                self.assertEqual(c.session.records, [])

    def test_worker_launch_and_cleanup_consume_the_same_deadline(self):
        for platform in ['ios', 'android']:
            with self.subTest(platform=platform):
                with patch.object(harness.subprocess, 'Popen') as factory, patch.object(harness.os, 'killpg') as kill, patch.object(harness.time, 'monotonic', side_effect=[100, 100.2, 100.7]):
                    worker = factory.return_value
                    worker.pid = 987654
                    worker.wait.side_effect = [subprocess.TimeoutExpired('owned mock worker', .55), -9]
                    with self.assertRaisesRegex(TimeoutError, 'remaining budget'):
                        harness.capture_reasoning_frame(platform, 'mock', Path('unused.png'), 1)
                    waits = worker.wait.call_args_list
                    self.assertAlmostEqual(waits[0].kwargs['timeout'], .55)
                    self.assertAlmostEqual(waits[1].kwargs['timeout'], .3)
                    kill.assert_called_once_with(worker.pid, signal.SIGKILL)

    def test_exhausted_capture_budget_never_launches_worker(self):
        with patch.object(harness.subprocess, 'Popen') as process:
            with self.assertRaisesRegex(TimeoutError, 'budget exhausted'):
                harness.capture_reasoning_frame('ios', 'mock', Path('unused.png'), 0)
            process.assert_not_called()

    def test_default_cli_status_and_both_original_os_capture_branches(self):
        c = self.case()
        path = c.output / 'frame.png'
        with patch.object(harness, 'capture_owned_android_frame', return_value=png()) as android:
            harness.capture_frame('android', 'mock', path)
            android.assert_called_once()
        with patch.object(harness.subprocess, 'run') as ios:
            harness.capture_frame('ios', 'mock', path)
            ios.assert_called_once_with(['xcrun', 'simctl', 'io', 'mock', 'screenshot', str(path)], check=True)
        args = harness.arguments(['android', 'driver.log', '--prefix', 'OLD', '--screenshot', 'old'])
        self.assertIsNone(args.reasoning)
        self.assertEqual((args.port, args.timeout), (8855, 180))
        self.assertEqual(harness.single_status(harness.DRIVER_CONNECTED, True), {'driverConnected': True, 'captured': True})

    def test_single_frame_default_runs_original_capture_and_finish_flow(self):
        c = self.case()
        log = c.output / 'default.log'
        log.write_text(harness.DRIVER_CONNECTED + '\nOLD_FRAME_READY\nOLD_FINISHED\n')
        args = harness.arguments(['android', str(log), '--prefix', 'OLD', '--screenshot', 'original'])
        with patch.object(harness, '__file__', str(c.output / 'tool/harness.py')), patch.object(harness, 'ThreadingHTTPServer') as server, patch.object(harness.threading, 'Thread'), patch.object(harness, 'capture_owned_android_frame', return_value=png()) as capture, contextlib.redirect_stdout(io.StringIO()) as output:
            harness.single_main(args)
            self.assertEqual(server.call_args.args[0], ('127.0.0.1', 8855))
            server.return_value.shutdown.assert_called_once()
            capture.assert_called_once()
        self.assertIn('journey completed', output.getvalue())
        self.assertEqual((c.output / 'build/device-evidence/android/original.png').read_bytes(), png())


if __name__ == '__main__':
    unittest.main()
