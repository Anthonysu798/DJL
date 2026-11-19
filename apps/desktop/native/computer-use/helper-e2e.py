#!/usr/bin/env python3
"""Dedicated fixture only; AX actions, exact-window captures, no permission prompts or CG input."""
import base64
import hashlib
import json
import os
import selectors
import subprocess
import sys
import time
from pathlib import Path

SOURCE = Path(__file__).resolve().parent
ROOT = Path('/private/tmp/djl-cua-helper-e2e')
ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(ROOT, 0o700)
RUN = ROOT / time.strftime('%Y%m%d-%H%M%S')
RUN.mkdir(mode=0o700)
OBSERVER = SOURCE / '.build/HumanStateObserver'
STOP_BUTTON = SOURCE / '.build/HelperStopButton'
HELPER = SOURCE / '.build/DJL Computer Use.app/Contents/MacOS/DJLComputerUse'
FIXTURE = Path('/private/tmp/djl-cua-background-probe/DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture')
STATE = FIXTURE.parents[3] / 'fixture-state.json'
records = []
processes = []


def record(phase, **data):
    value = {'phase': phase, **data}
    records.append(value)
    with (RUN / 'results.jsonl').open('a') as stream:
        stream.write(json.dumps(value, ensure_ascii=False) + '\n')
    os.chmod(RUN / 'results.jsonl', 0o600)
    print(json.dumps(value, ensure_ascii=False), flush=True)


def observer(helper=None, fixture=None, capture=None, output=None):
    args = [str(OBSERVER)]
    if helper:
        args += ['--helper-pid', str(helper.pid)]
    if fixture:
        args += ['--fixture-pid', str(fixture.pid)]
    if capture:
        args += ['--capture-window', str(capture), '--output', str(output)]
    return json.loads(subprocess.check_output(args, timeout=10))


def state(fixture):
    value = json.loads(STATE.read_text())
    assert value['pid'] == fixture.pid and value['bundleId'] == 'com.djl.computer-use.background-fixture', value
    return value


def wait_state(fixture):
    for _ in range(50):
        try:
            return state(fixture)
        except (AssertionError, FileNotFoundError, json.JSONDecodeError):
            time.sleep(0.1)
    raise AssertionError('Fixture did not publish its own identity')


class Client:
    def __init__(self):
        environment = dict(os.environ)
        environment.pop('DJL_COMPUTER_USE_EXPERIMENTAL_INPUT', None)
        self.stderr = (RUN / 'helper-stderr.log').open('w')
        self.process = subprocess.Popen([str(HELPER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=self.stderr, env=environment)
        processes.append(self.process)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.counter = 0
        self.events = []
        self.pending = {}
        self.received = {}
        self.buffer = b''

    def send(self, request, owner='fixture-owner'):
        self.counter += 1
        identifier = f'helper-e2e-{self.counter}'
        envelope = {'id': identifier, 'threadId': owner, 'request': request}
        self.pending[identifier] = request['method']
        self.process.stdin.write((json.dumps(envelope) + '\n').encode())
        self.process.stdin.flush()
        return identifier

    def read_frame(self, deadline):
        while b'\n' not in self.buffer:
            assert self.selector.select(max(0.1, deadline - time.monotonic())), 'Helper response timeout'
            chunk = os.read(self.process.stdout.fileno(), 1048576)
            assert chunk, f'Helper exited {self.process.poll()}'
            self.buffer += chunk
        line, self.buffer = self.buffer.split(b'\n', 1)
        return json.loads(line)

    def wait_event(self, expected_type):
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            frame = self.read_frame(deadline)
            assert 'event' in frame, frame
            self.events.append(frame['event'])
            record('native-event', event=frame['event'])
            if frame['event']['type'] == expected_type:
                return frame['event']
        raise AssertionError(f'Expected native event not exercised: {expected_type}')

    def wait_thread_stop(self):
        return self.wait_event('thread-stopped')

    def receive(self, identifier):
        deadline = time.monotonic() + 20
        while identifier not in self.received:
            frame = self.read_frame(deadline)
            if 'event' in frame:
                self.events.append(frame['event'])
                record('native-event', event=frame['event'])
            else:
                response = frame['response']
                assert response['method'] == self.pending[frame['id']], frame
                self.received[frame['id']] = response
            assert time.monotonic() < deadline, 'Helper response deadline'
        return self.received.pop(identifier)

    def request(self, request, owner='fixture-owner'):
        return self.receive(self.send(request, owner))


def successful(response):
    assert 'result' in response and 'error' not in response, response
    return response['result']


def element(observation, predicate):
    matches = [row for row in observation['elements'] if predicate(row)]
    assert len(matches) == 1, matches
    return {'kind': 'element', 'snapshotId': observation['snapshotId'], 'elementId': matches[0]['elementId']}


def preserved(before, after):
    assert before['human'] == after['human'], {'humanBefore': before['human'], 'humanAfter': after['human']}


def step(name, client, fixture, operation, verify=None):
    before = observer(client.process, fixture)
    assert before['human']['foregroundPid'] not in [client.process.pid, fixture.pid], before
    prior = state(fixture)
    if '--inactive' in sys.argv:
        assert prior['isActive'] is False and prior['isKey'] is False, prior
    result = operation()
    time.sleep(0.25)
    after = observer(client.process, fixture)
    current = state(fixture)
    preserved(before, after)
    if verify:
        assert verify(prior, current), {'before': prior, 'after': current, 'result': result}
    record(name, result=result, humanBefore=before['human'], humanAfter=after['human'],
           humanStatePreserved=True, fixtureBefore=prior, fixtureAfter=current,
           helperWindows=after['windows'], helperAccessibility=after.get('helperAccessibility', []), passed=True)
    return result


def observation(client, session, screenshot=False, limit=500):
    return successful(client.request({'method': 'session.observe', 'sessionId': session,
                                      'screenshot': screenshot, 'maxElements': limit}))


def save_observation(value, name):
    shot = value['screenshot']
    data = base64.b64decode(shot['payload']['base64'], validate=True)
    assert data.startswith(b'\x89PNG\r\n\x1a\n') and 0 < shot['width'] <= 8192 and 0 < shot['height'] <= 8192
    destination = RUN / name
    destination.write_bytes(data)
    os.chmod(destination, 0o600)
    return {'path': str(destination), 'width': shot['width'], 'height': shot['height'],
            'sha256': hashlib.sha256(data).hexdigest(), 'elementCount': len(value['elements']),
            'target': value['target'], 'bounds': value['bounds']}


try:
    assert HELPER.is_file() and FIXTURE.is_file(), 'Build helper and dedicated fixture first'
    subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', '-target', 'arm64-apple-macos14.4',
                    '-module-cache-path', str(SOURCE / '.build/module-cache'),
                    str(SOURCE / 'Tests/HumanStateObserver.swift'), '-framework', 'AppKit',
                    '-framework', 'ApplicationServices', '-framework', 'ScreenCaptureKit', '-o', str(OBSERVER)], check=True)
    if '--human-stop' in sys.argv:
        subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', '-target', 'arm64-apple-macos14.4',
                        '-module-cache-path', str(SOURCE / '.build/module-cache'),
                        str(SOURCE / 'Tests/HelperStopButton.swift'), '-framework', 'AppKit',
                        '-framework', 'ApplicationServices', '-o', str(STOP_BUTTON)], check=True)
    initial = observer()
    assert all(initial['permissions'].values()), initial
    fixture = subprocess.Popen([str(FIXTURE)] + (['--self-deactivate'] if '--inactive' in sys.argv else []), stdout=subprocess.DEVNULL, stderr=(RUN / 'fixture-stderr.log').open('w'))
    processes.append(fixture)
    initial_state = wait_state(fixture)
    if '--inactive' in sys.argv:
        time.sleep(0.9)
        initial_state = state(fixture)
        assert initial_state['isActive'] is False and initial_state['isKey'] is False, initial_state
    client = Client()
    time.sleep(0.3)
    after_launch = observer(client.process, fixture)
    preserved(initial, after_launch)
    record('launch', humanBefore=initial['human'], humanAfter=after_launch['human'],
           fixturePid=fixture.pid, helperPid=client.process.pid, fixtureState=initial_state, passed=True)
    status = step('status', client, fixture, lambda: successful(client.request({'method': 'status'})))
    assert status['permissions'] == {'accessibility': 'granted', 'screenRecording': 'granted'}, status
    assert 'drag' not in status['capabilities']['backgroundActions'], status
    apps = successful(client.request({'method': 'apps.list'}))
    target_app = [row for row in apps if row['pid'] == fixture.pid and row['bundleId'] == initial_state['bundleId']]
    assert len(target_app) == 1, target_app
    targets = [row for row in target_app[0]['windows'] if row['windowId'] == initial_state['windowId']]
    assert len(targets) == 1, targets
    target = {key: initial_state[key] for key in ['bundleId', 'pid', 'windowId']}
    session = step('session-open', client, fixture, lambda: successful(client.request({'method': 'session.open', 'target': target})))['sessionId']
    first = observation(client, session, screenshot=True)
    assert first['target'] == target and len(first['elements']) <= 500
    record('first-observation', **save_observation(first, 'fixture-initial.png'), passed=True)
    limited = observation(client, session, limit=3)
    assert len(limited['elements']) <= 3 and limited['truncated'] is True, limited
    record('bounded-observation', elementCount=len(limited['elements']), truncated=limited['truncated'], passed=True)
    fresh = observation(client, session)
    button = element(fresh, lambda row: row['role'] == 'AXButton' and row['label'] == 'Increment fixture counter')
    press = step('ax-press', client, fixture, lambda: successful(client.request({'method': 'session.perform', 'sessionId': session,
        'action': {'type': 'performAction', 'target': button, 'action': 'press'}})), lambda a, b: b['buttonCount'] == a['buttonCount'] + 1)
    assert press['acknowledgement'] == 'dispatched' and press['effect'] == 'unverified'
    stale = client.request({'method': 'session.perform', 'sessionId': session,
                            'action': {'type': 'performAction', 'target': button, 'action': 'press'}})
    assert stale['error']['code'] == 'stale-snapshot', stale
    record('stale-reference', response=stale, passed=True)
    fresh = observation(client, session)
    text = element(fresh, lambda row: row['role'] == 'AXTextField' and row.get('value') == 'fixture-initial')
    before_set = observer(client.process, fixture)
    preview = [row for row in before_set['windows'] if row['pid'] == client.process.pid and row['title'] == 'DJL Computer Use' and row['onscreen']]
    assert len(preview) == 1, before_set
    captured = observer(client.process, fixture, preview[0]['windowId'], RUN / 'preview-before.png')
    assert 'path' in captured.get('capture', {}), captured
    value = 'DJL helper 测试 café 🧪 live preview'
    step('ax-unicode-set-value', client, fixture, lambda: successful(client.request({'method': 'session.perform', 'sessionId': session,
        'action': {'type': 'setValue', 'target': text, 'value': value}})), lambda a, b: b['text'] == value)
    # Do not observe through the helper before this capture: only SCStream can refresh its preview.
    time.sleep(1)
    captured = observer(client.process, fixture, preview[0]['windowId'], RUN / 'preview-after.png')
    assert 'path' in captured.get('capture', {}), captured
    preserved(before_set, captured)
    after_set = observer(client.process, fixture)
    virtual = [row for row in after_set['windows'] if row['pid'] == client.process.pid and row['onscreen']
               and row['bounds'].get('Width') == 44 and row['bounds'].get('Height') == 56]
    assert len(virtual) == 1, after_set
    expected_point = state(fixture)['points']['text']
    assert abs(virtual[0]['bounds']['X'] - (expected_point['x'] - 8)) <= 1, virtual
    assert abs(virtual[0]['bounds']['Y'] - (expected_point['y'] - 20)) <= 1, virtual
    cursor_capture = observer(client.process, fixture, virtual[0]['windowId'], RUN / 'virtual-cursor.png')
    assert 'path' in cursor_capture.get('capture', {}), cursor_capture
    record('presentation', before=str(RUN / 'preview-before.png'), after=str(RUN / 'preview-after.png'),
           cursor=str(RUN / 'virtual-cursor.png'), windows=after_set['windows'], humanStatePreserved=True,
           livePreviewNeedsVisualInspection=True, passed=True)
    wrong_owner = client.request({'method': 'session.observe', 'sessionId': session}, owner='unrelated-owner')
    assert wrong_owner['error']['code'] == 'unauthorized-session', wrong_owner
    fresh = observation(client, session, screenshot=True)
    record('final-observation', **save_observation(fresh, 'fixture-final.png'), passed=True)
    final_ref = element(fresh, lambda row: row['role'] == 'AXButton' and row['label'] == 'Increment fixture counter')
    settings = {'enabled': True, 'paused': True, 'retentionDays': 1, 'intervalSeconds': 5,
                'includedBundleIds': [target['bundleId']], 'includedDomains': [],
                'excludedBundleIds': [], 'excludedDomains': []}
    assert successful(client.request({'method': 'activity.capture', 'settings': settings}, owner='desktop:recorder')) is None
    settings['paused'] = False
    # Keep the serialized worker inside a real, verified fixture AX dispatch while
    # capture requests queue. Scoped Stop must revoke them before their AX reads.
    blocker = client.send({'method': 'session.perform', 'sessionId': session,
                          'action': {'type': 'performAction', 'target': final_ref, 'action': 'press'}})
    time.sleep(0.02)
    activity = [client.send({'method': 'activity.capture', 'settings': settings}, owner='desktop:recorder') for _ in range(8)]
    recorder_stop = client.send({'method': 'stop'}, owner='desktop:recorder')
    successful(client.receive(recorder_stop))
    successful(client.receive(blocker))
    for identifier in activity:
        response = client.receive(identifier)
        assert response['error']['code'] == 'cancelled', response
    record('recorder-cancellation', pausedReturnsNull=True, queuedCancelled=len(activity),
           capturedPersonalContext=False, fixtureAllowlist=[target['bundleId']], passed=True)
    stop = step('stop', client, fixture, lambda: successful(client.request({'method': 'stop', 'sessionId': session})))
    assert stop['stoppedSessionIds'] == [session], stop
    stopped_response = client.request({'method': 'session.perform', 'sessionId': session,
        'action': {'type': 'performAction', 'target': final_ref, 'action': 'press'}})
    assert stopped_response['error']['code'] in ['cancelled', 'unauthorized-session'], stopped_response
    # Burst read-only/open work then out-of-band Stop; epochs must prevent late sessions being usable.
    queued = [client.send({'method': 'session.open', 'target': target}, owner='pending-owner') for _ in range(8)]
    stop_id = client.send({'method': 'stop'}, owner='pending-owner')
    stop_result = successful(client.receive(stop_id))
    opened = []
    cancelled = 0
    for identifier in queued:
        response = client.receive(identifier)
        if 'result' in response:
            late_session = response['result']['sessionId']
            opened.append(late_session)
            revoked = client.request({'method': 'session.observe', 'sessionId': late_session}, owner='pending-owner')
            assert revoked['error']['code'] in ['cancelled', 'unauthorized-session'], revoked
        else:
            assert response['error']['code'] == 'cancelled', response
            cancelled += 1
    record('pending-open-stop', cancelled=cancelled, openedBeforeStop=opened, stop=stop_result, passed=True)
    if '--human-stop' in sys.argv:
        human_sessions = [successful(client.request({'method': 'session.open', 'target': target}, owner='human-stop-owner'))['sessionId'] for _ in range(2)]
        time.sleep(0.5)
        human_before = observer(client.process, fixture)
        record('human-stop-ready', helperPid=client.process.pid, sessions=human_sessions, owner='human-stop-owner',
               output=str(RUN), humanBefore=human_before['human'])
        chat_before = state(fixture)
        chat_control = json.loads(subprocess.check_output([str(STOP_BUTTON), str(client.process.pid), 'Open chat'], timeout=5))
        assert chat_control['axError'] == 0
        chat_event = client.wait_event('show-thread')
        assert chat_event == {'type': 'show-thread', 'sessionId': human_sessions[-1]}, chat_event
        time.sleep(0.15)
        chat_after = state(fixture)
        assert chat_after['stateRevision'] > chat_before['stateRevision']
        for key in ['buttonCount', 'text', 'eventCount', 'activationCount', 'deactivationCount']:
            assert chat_after[key] == chat_before[key], (key, chat_before, chat_after)
        for live_session in human_sessions:
            successful(client.request({'method': 'session.observe', 'sessionId': live_session}, owner='human-stop-owner'))
        record('human-open-chat', event=chat_event, fixtureUnchanged=True, sessionsPreserved=True, passed=True)
        control = json.loads(subprocess.check_output([str(STOP_BUTTON), str(client.process.pid)], timeout=5))
        assert control['axError'] == 0 and control['helperPid'] == client.process.pid, control
        event = client.wait_thread_stop()
        assert event == {'type': 'thread-stopped', 'threadId': 'human-stop-owner'}, event
        for stopped_session in human_sessions:
            revoked = client.request({'method': 'session.observe', 'sessionId': stopped_session}, owner='human-stop-owner')
            assert revoked['error']['code'] in ['cancelled', 'unauthorized-session'], revoked
        human_after = observer(client.process, fixture)
        preserved(human_before, human_after)
        record('human-stop', event=event, revokedSessions=human_sessions, humanStatePreserved=True, passed=True)
    time.sleep(0.3)
    final = observer(client.process, fixture)
    preserved(initial, final)
    panels = [row for row in final['windows'] if row['pid'] == client.process.pid and row['onscreen']]
    assert not panels, final
    record('summary', allAssertionsPassed=True, humanBefore=initial['human'], humanAfter=final['human'],
           stoppedPanelsHidden=True, rawInputEnabled=False, events=client.events, output=str(RUN))
except Exception as error:
    record('failure', error=repr(error), output=str(RUN))
    raise
finally:
    for process in reversed(processes):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
