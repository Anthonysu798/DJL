"""Native frame orchestration tests; all device operations are mocked."""
import importlib.util
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tool'))
import subprocess
import struct
import zlib
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('qa_android_frame', ROOT / 'tool/android_native_frame.py')
FRAME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FRAME)
PNG = (ROOT / 'integration_test/fixtures/djl-local-qa.png').read_bytes()


class AndroidNativeFrameTests(unittest.TestCase):
    def test_console_capture_returns_native_png_and_removes_private_temporary_file(self):
        paths = []

        def capture(command, **kwargs):
            self.assertEqual(command[:-1], [FRAME.ADB, '-s', 'emulator-5556', 'emu', 'screenrecord', 'screenshot'])
            self.assertTrue(kwargs['check'])
            self.assertEqual(kwargs['timeout'], 10)
            path = Path(command[-1])
            self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
            paths.append(path)
            path.write_bytes(PNG)

        with mock.patch.object(FRAME.subprocess, 'check_output', return_value=b'DJLFlutterAOSP35QA\nOK\n') as read, mock.patch.object(FRAME.subprocess, 'run', side_effect=capture):
            self.assertEqual(FRAME.capture_owned_android_frame(), PNG)
        self.assertEqual(read.call_args.args[0], [FRAME.ADB, '-s', 'emulator-5556', 'emu', 'avd', 'name'])
        self.assertEqual(len(paths), 1)
        self.assertFalse(paths[0].parent.exists())

    def test_pixel9_capture_preserves_actual_bytes_and_checks_frame_dimensions(self):
        def chunk(kind, data):
            return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
        # Public, host-only test image; never supplied to the native viewer.
        png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1080,2424,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+bytes(1080*3))*2424))+chunk(b'IEND',b'')
        for name,sdk in [(b'DJLFlutterPixel9QA',b'36'),(b'DJLFlutterPixel9AOSP35QA',b'35')]:
            for data,accepted in [(png,True),(PNG,False)]:
                queries=[]
                def read(command,**kwargs):
                    args=tuple(command[3:]);queries.append(args)
                    return {('emu','avd','name'):name+b'\nOK',('shell','getprop','ro.build.version.sdk'):sdk,('shell','wm','size'):b'Physical size: 1080x2424'}[args]
                def capture(command,**kwargs): Path(command[-1]).write_bytes(data)
                with mock.patch.object(FRAME.subprocess,'check_output',side_effect=read),mock.patch.object(FRAME.subprocess,'run',side_effect=capture):
                    if accepted: self.assertEqual(FRAME.capture_owned_android_frame(),data)
                    else:
                        with self.assertRaises(ValueError): FRAME.capture_owned_android_frame()
                self.assertEqual(queries,[('emu','avd','name'),('shell','getprop','ro.build.version.sdk'),('shell','wm','size')])

    def test_pixel9_wrong_metadata_refuses_before_capture(self):
        for name,expected,wrong in [(b'DJLFlutterPixel9QA',b'36',b'35'),(b'DJLFlutterPixel9AOSP35QA',b'35',b'36')]:
            for sdk,size in [(wrong,b'Physical size: 1080x2424'),(expected,b'Physical size: 1080x2400'),(expected,b'Physical size: 1080x2424\nOverride size: 1080x2424')]:
                def read(command,**kwargs):
                    return {('emu','avd','name'):name+b'\nOK',('shell','getprop','ro.build.version.sdk'):sdk,('shell','wm','size'):size}[tuple(command[3:])]
                with mock.patch.object(FRAME.subprocess,'check_output',side_effect=read),mock.patch.object(FRAME.subprocess,'run') as capture:
                    with self.assertRaises(RuntimeError): FRAME.capture_owned_android_frame()
                    capture.assert_not_called()

    def test_missing_ambiguous_and_unowned_devices_fail_before_capture(self):
        for name in [b'', b'OK\n', b'PersonalAVD\nOK\n', b'DJLFlutterQA\nDJLFlutterAOSP35QA\nOK\n']:
            with self.subTest(name=name), mock.patch.object(FRAME.subprocess, 'check_output', return_value=name), mock.patch.object(FRAME.subprocess, 'run') as capture:
                with self.assertRaises(RuntimeError):
                    FRAME.capture_owned_android_frame()
                capture.assert_not_called()

    def test_ownership_timeout_cannot_fall_back_to_unchecked_capture(self):
        with mock.patch.object(FRAME.subprocess, 'check_output', side_effect=subprocess.TimeoutExpired('owned QA query', 10)), mock.patch.object(FRAME.subprocess, 'run') as capture:
            with self.assertRaises(subprocess.TimeoutExpired):
                FRAME.capture_owned_android_frame()
            capture.assert_not_called()

    def test_failed_capture_cleans_up_and_never_returns_a_stale_frame(self):
        paths = []

        def capture(command, **kwargs):
            paths.append(Path(command[-1]))
            raise subprocess.CalledProcessError(1, command)

        with mock.patch.object(FRAME.subprocess, 'check_output', return_value=b'DJLFlutterQA\nOK\n'), mock.patch.object(FRAME.subprocess, 'run', side_effect=capture):
            with self.assertRaises(subprocess.CalledProcessError):
                FRAME.capture_owned_android_frame()
        self.assertEqual(len(paths), 1)
        self.assertFalse(paths[0].parent.exists())

    def test_missing_truncated_or_invalid_png_cannot_be_reported_as_a_frame(self):
        for data in [None, b'', b'not a native PNG', PNG[:22], PNG[:-12], PNG[:16] + b'\0' * 8 + PNG[24:]]:
            def capture(command, **kwargs):
                if data is not None:
                    Path(command[-1]).write_bytes(data)

            with self.subTest(data=data is None), mock.patch.object(FRAME.subprocess, 'check_output', return_value=b'DJLFlutterQA\nOK\n'), mock.patch.object(FRAME.subprocess, 'run', side_effect=capture):
                with self.assertRaises((ValueError, OSError)):
                    FRAME.capture_owned_android_frame()


if __name__ == '__main__':
    unittest.main()
