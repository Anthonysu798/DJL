"""Simulator identity must come from the executable, not its signing summary."""
import importlib.util
from pathlib import Path
import plistlib
import struct
import sys
import tempfile
import unittest

TOOL = Path(__file__).resolve().parents[2] / 'tool/verify_ios_simulator_identity.py'
spec = importlib.util.spec_from_file_location('ios_simulator_identity', TOOL)
identity = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = identity
spec.loader.exec_module(identity)


def executable(identifier='TESTTEAM01.app.djl.mobile'):
    payload = plistlib.dumps({'application-identifier': identifier})
    offset = 32 + 72 + 80
    header = struct.pack('<IiiIIIII', 0xfeedfacf, 0x100000c, 0, 2, 1, 152, 0, 0)
    segment = struct.pack('<II16sQQQQiiII', 0x19, 152, b'__TEXT', 0,
                          offset + len(payload), 0, offset + len(payload), 7, 5, 1, 0)
    section = struct.pack('<16s16sQQIIIIIIII', b'__entitlements', b'__TEXT',
                          offset, len(payload), offset, 0, 0, 0, 0, 0, 0, 0)
    return header + segment + section + payload


class SimulatorIdentityTest(unittest.TestCase):
    def test_reads_the_embedded_simulated_application_identifier(self):
        self.assertEqual(identity.application_identifier(executable()),
                         'TESTTEAM01.app.djl.mobile')

    def test_rejects_a_different_team_even_when_bundle_suffix_matches(self):
        with tempfile.TemporaryDirectory() as directory:
            # A correct-looking path must not substitute for artifact evidence.
            path = Path(directory) / 'TESTTEAM01.app.djl.mobile'
            path.write_bytes(executable('OTHERTEAM1.app.djl.mobile'))
            with self.assertRaisesRegex(ValueError, 'identity mismatch'):
                identity.verify(path, 'TESTTEAM01.app.djl.mobile')

    def test_accepts_the_exact_expected_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'Runner'
            path.write_bytes(executable())
            self.assertEqual(identity.verify(path, 'TESTTEAM01.app.djl.mobile'),
                             'TESTTEAM01.app.djl.mobile')

    def test_rejects_missing_entitlements_and_non_architecture_specific_input(self):
        no_sections = struct.pack('<IiiIIIII', 0xfeedfacf, 0x100000c, 0, 2, 0, 0, 0, 0)
        for blob in [b'', b'\xca\xfe\xba\xbe' + bytes(100), no_sections]:
            with self.subTest(size=len(blob)), self.assertRaises(ValueError):
                identity.application_identifier(blob)

    def test_rejects_truncated_load_commands_and_section_payloads(self):
        blob = executable()
        for malformed in [blob[:40], blob[:-20], blob[:32] + bytes(152) + blob[184:]]:
            with self.subTest(size=len(malformed)), self.assertRaises(ValueError):
                identity.application_identifier(malformed)


if __name__ == '__main__':
    unittest.main()
