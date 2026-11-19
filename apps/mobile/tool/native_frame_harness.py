"""Capture one completed native frame on dedicated QA devices after driver attachment."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import threading
import time
from android_native_frame import capture_owned_android_frame

import hashlib
import os
import re
import struct
import signal
import sys
import tempfile
import zlib
from datetime import datetime, timezone

DRIVER_CONNECTED = 'VMServiceFlutterDriver: Connected to Flutter application.'
REASONING_PHASES = ('STREAM_COLLAPSED', 'STREAM_EXPANDED', 'STREAM_UPDATED', 'HISTORY', 'COLD_COLLAPSED', 'COLD_EXPANDED')
FAILURES = ('Some tests failed', 'Failure Details:', 'TimeoutException', 'DriverError:', 'Unhandled exception:')


def single_status(log, captured):
    return {'driverConnected': DRIVER_CONNECTED in log, 'captured': captured}


def capture_frame(platform, simulator, path):
    if platform == 'ios':
        subprocess.run(['xcrun', 'simctl', 'io', simulator, 'screenshot', str(path)], check=True)
    else:
        path.write_bytes(capture_owned_android_frame())


def validate_png(data, geometry):
    if not 45 <= len(data) <= 16 * 1024 * 1024 or data[:8] != b'\x89PNG\r\n\x1a\n' or data[-12:] != b'\0\0\0\0IEND\xaeB\x60\x82':
        raise ValueError('Native frame is not a PNG')
    offset, kinds, pixels = 8, [], bytearray()
    channels = None
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError('Incomplete PNG chunk')
        size = struct.unpack('>I', data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        end = offset + size + 12
        if end > len(data) or zlib.crc32(data[offset + 4:end - 4]) != struct.unpack('>I', data[end - 4:end])[0]:
            raise ValueError('Incomplete or corrupt PNG')
        body = data[offset + 8:end - 4]
        kinds.append(kind)
        if kind == b'IHDR':
            if size != 13 or struct.unpack('>II', body[:8]) != geometry:
                raise ValueError('Native PNG geometry mismatch')
            if body[8] != 8 or body[9] not in (2, 6) or body[10:] != b'\0\0\0':
                raise ValueError('Unsupported native OS PNG encoding')
            channels = 3 if body[9] == 2 else 4
        if kind == b'IDAT':
            pixels.extend(body)
        offset = end
    if kinds.count(b'IHDR') != 1 or kinds.count(b'IEND') != 1 or kinds[0] != b'IHDR' or kinds[-1] != b'IEND' or not pixels or channels is None:
        raise ValueError('Native PNG is incomplete')
    decoder = zlib.decompressobj()
    stride = geometry[0] * channels + 1
    raw = decoder.decompress(pixels, stride * geometry[1] + 1)
    if not decoder.eof or decoder.unused_data or len(raw) != stride * geometry[1] or any(raw[i] > 4 for i in range(0, len(raw), stride)):
        raise ValueError('Native PNG image data is incomplete')


def capture_reasoning_frame(platform, simulator, path, remaining):
    """Bound the whole OS capture, including all sequential Android commands."""
    if remaining <= 0:
        raise TimeoutError('Reasoning capture budget exhausted')
    deadline = time.monotonic() + remaining
    # Reaping has its own reserve inside the same remaining deadline.
    cleanup_budget = min(1, remaining / 4)
    process = subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), '--reasoning-capture-worker', platform, simulator, str(path)],
        start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        process.wait(timeout=max(0, deadline - cleanup_budget - time.monotonic()))
    except BaseException as error:
        # This new session belongs only to this capture and its simctl/adb children.
        # Kill the group even if its leader exited while a child remained alive.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=max(0, deadline - time.monotonic()))
        if isinstance(error, subprocess.TimeoutExpired):
            raise TimeoutError('Reasoning capture exceeded remaining budget') from None
        raise
    if process.returncode != 0:
        raise RuntimeError('Owned native capture worker failed')


class ReasoningCapture:
    """Capture publication and fresh HTTP authorization share one state lock."""
    def __init__(self, run, mode, platform, output, artifact, process_id, geometry, now=None, clock=None):
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', run or ''):
            raise ValueError('Explicit public DJL_QA_REASONING_RUN_ID required')
        if mode not in ('live', 'cold') or platform not in ('ios', 'android'):
            raise ValueError('Unsupported reasoning capture mode')
        if not re.fullmatch(r'[a-f0-9]{64}', artifact or '') or not process_id or process_id <= 0:
            raise ValueError('Verified installed artifact hash and actual OS process ID required')
        if len(geometry) != 2 or any(not 0 < n <= 16384 for n in geometry):
            raise ValueError('Verified native geometry required')
        if platform == 'android' and geometry != (1080, 2424):
            raise ValueError('Reasoning Android requires verified Pixel9 geometry')
        self.run, self.mode, self.platform = run, mode, platform
        self.output, self.artifact, self.process_id, self.geometry = output, artifact, process_id, geometry
        self.phases = REASONING_PHASES[:4] if mode == 'live' else REASONING_PHASES[4:]
        self.clock = clock or time.monotonic
        self.started = self.clock() if now is None else now
        self.checkpoint = self.started
        self.markers = []
        self.records = []
        self.failed = self.finished = self.driver = self.capturing = False
        self.lock = threading.RLock()

    def _remaining(self, now):
        return min(self.started + 180, self.checkpoint + 45) - now

    def _health(self, log, now):
        self.driver = DRIVER_CONNECTED in log
        if self.failed or any(f in log for f in FAILURES):
            raise RuntimeError('Reasoning driver failure')
        if self._remaining(now) <= 0:
            raise RuntimeError('Reasoning capture deadline')

    def _next(self, log, now):
        self._health(log, now)
        markers = re.findall(r'DJL_REASONING_(READY|FINISHED) ([^\s]+) ([^\s]+)', log)
        if markers[:len(self.markers)] != self.markers or len(markers) > len(self.markers) + 1:
            raise RuntimeError('Changed or multiple unacknowledged reasoning markers')
        if len(markers) == len(self.markers):
            return None
        kind, run, phase = markers[-1]
        if run != self.run or not self.driver:
            raise RuntimeError('Stale run or missing driver attachment')
        if kind == 'FINISHED':
            if phase != self.mode or len(self.records) != len(self.phases) or self.finished:
                raise RuntimeError('Premature or duplicate reasoning finish')
        elif self.finished or len(self.records) >= len(self.phases) or phase != self.phases[len(self.records)]:
            raise RuntimeError('Duplicate or out of order reasoning phase')
        return markers[-1]

    def _current(self, log, now):
        if self._next(log, now) is not None:
            raise RuntimeError('Markers changed during native capture')

    def _status(self, run, phase, pending=False):
        return {'driverConnected': self.driver, 'runId': self.run, 'phase': self.records[-1]['phase'] if self.records else None,
                'ack': not (self.failed or self.capturing or pending) and bool(self.records) and run == self.run and phase == self.records[-1]['phase']}

    def authorize(self, read_log, run, phase):
        # This is the GET authorization boundary, not a cached polling result.
        with self.lock:
            try:
                pending = self._next(read_log(), self.clock()) is not None
            except Exception:
                self.failed = True
                pending = False
            return self._status(run, phase, pending)

    def write_manifest(self, records):
        target = self.output / f'{self.run}-{self.mode}-manifest.json'
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', dir=self.output, prefix=target.name + '.', delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(json.dumps(records, indent=2))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
            directory = os.open(self.output, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def poll(self, log, now, capture, refresh=None):
        read_log = refresh or (lambda: log)
        try:
            with self.lock:
                if self.capturing:
                    raise RuntimeError('Capture already in progress')
                marker = self._next(log, now)
                if marker is None:
                    return
                self.markers.append(marker)
                if marker[0] == 'FINISHED':
                    self.finished = True
                    return
                self.capturing = True
                phase = marker[2]
                path = self.output / f'{self.run}-{self.mode}-{phase}.png'
            # GETs remain responsive and return ack:false throughout capture/write.
            with path.open('xb'):
                pass
            budget = self._remaining(self.clock())
            if budget <= 0:
                raise TimeoutError('Reasoning capture budget exhausted')
            capture(path, budget)
            data = path.read_bytes()
            validate_png(data, self.geometry)
            record = {'runId': self.run, 'phase': phase, 'platform': self.platform, 'artifactSha256': self.artifact,
                      'processId': self.process_id, 'width': self.geometry[0], 'height': self.geometry[1],
                      'path': str(path), 'sha256': hashlib.sha256(data).hexdigest(),
                      'capturedAt': datetime.now(timezone.utc).isoformat()}
            with self.lock:
                self._current(read_log(), self.clock())
                candidate = self.records + [record]
            self.write_manifest(candidate)
            with self.lock:
                self._current(read_log(), self.clock())
                self.records = candidate
                self.checkpoint = self.clock()
                self.capturing = False
        except BaseException:
            with self.lock:
                self.failed = True
                self.capturing = False
            raise


def reasoning_main(args):
    from urllib.parse import urlparse, parse_qs
    geometry = tuple(map(int, (args.geometry or '').split('x')))
    output = Path(__file__).resolve().parents[1] / 'build/device-evidence' / args.platform
    output.mkdir(parents=True, exist_ok=True)
    initial_log = args.log.read_text(errors='replace') if args.log.exists() else ''
    if DRIVER_CONNECTED in initial_log or 'DJL_REASONING_' in initial_log:
        raise RuntimeError('Reasoning harness must start before fresh driver attachment in a new log')
    session = ReasoningCapture(os.environ.get('DJL_QA_REASONING_RUN_ID'), args.reasoning, args.platform, output,
                               args.artifact_sha256, args.app_process_id, geometry)
    def content():
        return args.log.read_text(errors='replace') if args.log.exists() else ''
    class Status(BaseHTTPRequestHandler):
        def do_GET(self):
            query = parse_qs(urlparse(self.path).query)
            body = json.dumps(session.authorize(content, query.get('run', [''])[0], query.get('phase', [''])[0])).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Status)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        while not session.finished:
            session.poll(content(), time.monotonic(), lambda p, budget: capture_reasoning_frame(args.platform, args.simulator, p, budget), refresh=content)
            time.sleep(.2)
        print('Reasoning native captures recorded; root must inspect pixels and driver exit.')
    finally:
        server.shutdown()


def arguments(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('platform', choices=['ios', 'android'])
    parser.add_argument('log', type=Path)
    parser.add_argument('--prefix', required=True)
    parser.add_argument('--port', type=int, default=8855)
    parser.add_argument('--screenshot', required=True)
    parser.add_argument('--timeout', type=int, default=180)
    parser.add_argument('--simulator', default='3526719A-27DA-4F9A-9CC0-C83AA94FD935')
    parser.add_argument('--reasoning', choices=['live', 'cold'])
    parser.add_argument('--artifact-sha256')
    parser.add_argument('--app-process-id', type=int)
    parser.add_argument('--geometry', help='Verified native WIDTHxHEIGHT; required for reasoning')
    return parser.parse_args(argv)


def single_main(args):
    output = Path(__file__).resolve().parents[1] / 'build/device-evidence' / args.platform
    output.mkdir(parents=True, exist_ok=True)
    captured = False

    def content():
        return args.log.read_text(errors='replace') if args.log.exists() else ''

    class Status(BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps(single_status(content(), captured)).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Status)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        deadline = time.monotonic() + args.timeout
        while args.prefix + '_FRAME_READY' not in content():
            if 'Some tests failed' in content() or 'Failure Details:' in content() or 'TimeoutException' in content() or 'DriverError: Failed to fulfill RequestData' in content() or time.monotonic() >= deadline:
                raise RuntimeError('Native frame was not verified by the app test')
            time.sleep(.2)
        path = output / (args.screenshot + '.png')
        if args.platform == 'ios':
            subprocess.run(['xcrun', 'simctl', 'io', args.simulator, 'screenshot', str(path)], check=True)
        else:
            path.write_bytes(capture_owned_android_frame())
        captured = True
        while args.prefix + '_FINISHED' not in content():
            if 'Some tests failed' in content() or 'Failure Details:' in content() or 'TimeoutException' in content() or 'DriverError: Failed to fulfill RequestData' in content() or time.monotonic() >= deadline:
                raise RuntimeError('Native journey did not finish after capture')
            time.sleep(.2)
        print('Verified native frame captured and journey completed.')
    finally:
        server.shutdown()


if __name__ == '__main__':
    if sys.argv[1:2] == ['--reasoning-capture-worker']:
        _, platform, simulator, filename = sys.argv[1:]
        if platform not in ('ios', 'android'):
            raise ValueError('Unsupported capture platform')
        capture_frame(platform, simulator, Path(filename))
    else:
        args = arguments()
        if args.reasoning:
            reasoning_main(args)
        else:
            single_main(args)
