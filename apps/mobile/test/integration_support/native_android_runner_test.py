"""Exercise the runner CLI with device, process and HTTP boundaries isolated."""
import contextlib
import hashlib
import io
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

TOOL = Path(__file__).resolve().parents[2] / 'tool'


class AndroidRunnerBudgetTest(unittest.TestCase):
    def test_actual_cli_dispatches_journey_host_budgets(self):
        for journey, expected in [('draft', '360'), ('settings', '180'),
                                  ('advanced', '180'), ('lock', '300'),
                                  ('privacy', '660')]:
            with self.subTest(journey=journey), tempfile.TemporaryDirectory() as folder:
                directory = Path(folder)
                apk = directory / 'test.apk'
                apk.write_bytes(b'host-only-qa-bundle')
                apk_hash = hashlib.sha256(apk.read_bytes()).hexdigest()
                processes = []

                def read(command, **kwargs):
                    self.assertEqual(command[1:3], ['-s', 'emulator-5556'])
                    args = tuple(command[3:])
                    values = {
                        ('emu', 'avd', 'name'): 'DJLFlutterPixel9AOSP35QA\nOK\n',
                        ('shell', 'getprop', 'ro.build.version.sdk'): '35\n',
                        ('shell', 'wm', 'size'): 'Physical size: 1080x2424\n',
                        ('shell', 'pm', 'path', 'app.djl.mobile'): 'package:/data/app/qa/base.apk\n',
                        ('shell', 'sha256sum', '/data/app/qa/base.apk'): apk_hash + '  /data/app/qa/base.apk\n',
                        ('shell', 'pidof', 'app.djl.mobile'): '123\n',
                        ('logcat', '-d', '--pid=123', '-s', 'flutter'): 'VM service http://127.0.0.1:58670/host-test/\n',
                    }
                    if args not in values:
                        self.fail('Unexpected external read: ' + repr(args))
                    return values[args]

                def spawn(command, **kwargs):
                    process = SimpleNamespace(command=command, returncode=None)
                    process.poll = lambda: process.returncode
                    def wait(**kwargs):
                        process.returncode = 0
                        return 0
                    process.wait = wait
                    process.terminate = lambda: setattr(process, 'returncode', 0)
                    processes.append(process)
                    return process

                def run(command, **kwargs):
                    if 'drive' in command:
                        kwargs['stdout'].write('DJL_' + journey.upper() + '_FINISHED\n')
                        return subprocess.CompletedProcess(command, 0)
                    self.assertEqual(command[1:3], ['-s', 'emulator-5556'])
                    return subprocess.CompletedProcess(command, 0)

                argv = [str(TOOL / 'run_native_android.py'), str(apk),
                        'integration_test/desktop_draft_test.dart',
                        str(directory / 'driver.log'), '--journey', journey]
                previous_umask = os.umask(0o077)
                try:
                    with patch.object(sys, 'argv', argv), \
                            patch.object(sys, 'path', [str(TOOL), *sys.path]), \
                            patch('subprocess.check_output', side_effect=read), \
                            patch('subprocess.Popen', side_effect=spawn), \
                            patch('subprocess.run', side_effect=run), \
                            patch('urllib.request.urlopen', return_value=contextlib.nullcontext(SimpleNamespace(status=200))), \
                            contextlib.redirect_stdout(io.StringIO()):
                        runpy.run_path(str(TOOL / 'run_native_android.py'), run_name='__main__')
                finally:
                    os.umask(previous_umask)
                harnesses = [p.command for p in processes
                             if Path(p.command[1]).name == 'native_frame_harness.py']
                self.assertEqual(len(harnesses), 1)
                command = harnesses[0]
                self.assertEqual(command[command.index('--timeout') + 1], expected)
                self.assertEqual(command[command.index('--prefix') + 1],
                                 'DJL_' + journey.upper())


if __name__ == '__main__':
    unittest.main()
