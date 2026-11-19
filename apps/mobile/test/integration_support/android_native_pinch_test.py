"""Native test-tool boundary checks; no device, SDK process or server input."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tool'))
import android_native_pinch as pinch


class NativePinchBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='djl-native-pinch-host-')
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.patch = mock.patch.object(pinch, 'ROOT', self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        contents = {
            'build/native-input49/public-preview-pinch.jar': b'owned test jar',
            'test/native_ui_android/PublicPreviewPinchTest.java': b'fixed public test',
            'build/qa-artifacts/source-response-actions-v48-android-main.apk': b'ordinary QA app',
        }
        for name, value in contents.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(value)
        self.remote = '/data/local/tmp/djl-public-pinch49-' + 'a' * 32 + '.jar'
        self.receipt = {'remote_jar': self.remote,
                        'jar_sha256': hashlib.sha256(list(contents.values())[0]).hexdigest(),
                        'source_sha256': hashlib.sha256(list(contents.values())[1]).hexdigest(),
                        'ordinary_app_sha256': hashlib.sha256(list(contents.values())[2]).hexdigest()}
        self.receipt_path = self.root / 'build/native-input49/receipt.json'
        self.save()
        self.package = '/data/app/~~owned/app.djl.mobile-qa/base.apk'
        self.read = mock.Mock(side_effect=self.respond)

    def save(self):
        self.receipt_path.write_text(json.dumps(self.receipt))

    def respond(self, args):
        if args == ['shell', 'stat', '-c', '%F', self.remote]:
            return b'regular file\n'
        if args == ['shell', 'sha256sum', self.remote]:
            return (self.receipt['jar_sha256'] + '  ' + self.remote).encode()
        if args == ['shell', 'pm', 'path', 'app.djl.mobile']:
            return ('package:' + self.package).encode()
        if args == ['shell', 'sha256sum', self.package]:
            return (self.receipt['ordinary_app_sha256'] + '  ' + self.package).encode()
        raise AssertionError('No test execution or other package access is allowed')

    def test_command_verifies_both_remote_runner_and_ordinary_app_before_returning(self):
        self.assertEqual(pinch.native_pinch_command(self.read),
                         ['shell', 'uiautomator', 'runtest', self.remote, '-c', pinch.CASE, '-s'])
        self.assertEqual(self.read.call_count, 4)

    def test_changed_local_artifact_or_source_stops_before_any_device_access(self):
        for name in ['build/native-input49/public-preview-pinch.jar',
                     'test/native_ui_android/PublicPreviewPinchTest.java',
                     'build/qa-artifacts/source-response-actions-v48-android-main.apk']:
            with self.subTest(name=name):
                path = self.root / name
                original = path.read_bytes()
                path.write_bytes(b'changed')
                with self.assertRaises(ValueError):
                    pinch.native_pinch_command(self.read)
                self.read.assert_not_called()
                path.write_bytes(original)

    def test_foreign_remote_path_is_rejected_before_device_access(self):
        self.receipt['remote_jar'] = '/data/user/0/another.app/private.jar'
        self.save()
        with self.assertRaises(ValueError):
            pinch.native_pinch_command(self.read)
        self.read.assert_not_called()

    def test_remote_symlink_or_wrong_hash_never_returns_a_test_command(self):
        for output in [b'symbolic link\n', b'unknown\n']:
            with self.subTest(output=output), self.assertRaises(ValueError):
                pinch.native_pinch_command(mock.Mock(return_value=output))
        def changed(args):
            if args == ['shell', 'sha256sum', self.remote]:
                return b'wrong hash'
            return self.respond(args)
        with self.assertRaises(ValueError):
            pinch.native_pinch_command(changed)

    def test_changed_installed_app_never_returns_a_test_command(self):
        def changed(args):
            if args == ['shell', 'sha256sum', self.package]:
                return b'wrong hash'
            return self.respond(args)
        with self.assertRaises(ValueError):
            pinch.native_pinch_command(changed)

    def test_sdk_success_requires_whitelisted_asset_and_complete_test_result(self):
        pinch.record_native_pinch_result(b'QA_PUBLIC_PINCH_OK asset=p.png\nOK (1 test)\n')
        result = json.loads((self.root / 'build/native-input49/invocations.jsonl').read_text())
        self.assertEqual(result['outcome'], 'injected')
        self.assertEqual(result['public_asset'], 'p.png')
        self.assertFalse(result['rendered_zoom_proven'])

    def test_rejected_or_incomplete_sdk_result_is_not_success_and_keeps_output_private(self):
        for output, outcome in [
            (b'PRIVATE QA_PUBLIC_PINCH_REJECTED input_attempted=0', 'rejected_before_touch'),
            (b'PRIVATE QA_PUBLIC_PINCH_OK asset=p.png\nFAILED', 'failed_or_unknown'),
            (b'PRIVATE QA_PUBLIC_PINCH_OK asset=private.png\nOK (1 test)', 'failed_or_unknown'),
        ]:
            with self.subTest(outcome=outcome), self.assertRaises(RuntimeError):
                pinch.record_native_pinch_result(output)
            text = (self.root / 'build/native-input49/invocations.jsonl').read_text()
            self.assertNotIn('PRIVATE', text)
            self.assertEqual(json.loads(text.splitlines()[-1])['outcome'], outcome)


if __name__ == '__main__':
    unittest.main()
