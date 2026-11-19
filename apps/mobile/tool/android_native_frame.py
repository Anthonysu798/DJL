"""Capture an actual frame from the owned Android QA emulator."""
from pathlib import Path
import subprocess
import struct
import tempfile
from android_qa_device import read_owned_profile

ADB = str(Path.home() / 'Library/Android/sdk/platform-tools/adb')
DEVICE = 'emulator-5556'


def capture_owned_android_frame():
    base = [ADB, '-s', DEVICE]
    profile = read_owned_profile(lambda args: subprocess.check_output(
        base + args, timeout=10, stderr=subprocess.DEVNULL))
    # The emulator console reads its actual framebuffer without Android's stalled
    # screencap process. The unique host directory prevents stale-file reuse.
    with tempfile.TemporaryDirectory(prefix='djl-native-frame-') as folder:
        path = Path(folder) / 'frame.png'
        subprocess.run(
            base + ['emu', 'screenrecord', 'screenshot', str(path)],
            check=True, timeout=10, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL)
        if not 45 <= path.stat().st_size <= 16 * 1024 * 1024:
            raise ValueError('Native PNG size is invalid')
        data = path.read_bytes()
        if (not data.startswith(b'\x89PNG\r\n\x1a\n') or
                data[12:16] != b'IHDR' or
                data[-12:] != b'\x00\x00\x00\x00IEND\xaeB\x60\x82'):
            raise ValueError('Native frame is not a complete PNG')
        if any(not 0 < value <= 16384 for value in struct.unpack('>II', data[16:24])):
            raise ValueError('Native PNG dimensions are invalid')
        if profile.get('physicalSize') and struct.unpack('>II', data[16:24]) != profile['physicalSize']:
            raise ValueError('Native PNG does not match verified Pixel9 geometry')
        return data
