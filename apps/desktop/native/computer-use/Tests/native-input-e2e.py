#!/usr/bin/env python3
"""Actual helper input tests. Only dedicated fixture, no permissions/global input."""
import json
import os
from pathlib import Path
import selectors
import subprocess
import time

SOURCE = Path(__file__).resolve().parents[1]
FIXTURE = Path('/private/tmp/djl-cua-background-probe/DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture')
STATE = FIXTURE.parents[3] / 'fixture-state.json'
ROOT = Path('/private/tmp/djl-cua-native-input-e2e')
ROOT.mkdir(mode=0o700, exist_ok=True)
OUT = ROOT / time.strftime('%Y%m%d-%H%M%S')
OUT.mkdir(mode=0o700)
processes = []


def record(phase, **fields):
    row = {'phase': phase, **fields}
    with (OUT / 'results.jsonl').open('a') as stream:
        stream.write(json.dumps(row, ensure_ascii=False) + '\n')
    print(json.dumps(row, ensure_ascii=False), flush=True)


def human():
    value = json.loads(subprocess.check_output([str(SOURCE / '.build/HumanStateObserver')], timeout=5))['human']
    focus = value['keyboardFocus']
    if value.get('foregroundBundle') in {'com.apple.UserNotificationCenter', 'com.apple.SecurityAgent', 'com.apple.loginwindow'}:
        record('guarded-abort', reason='system-dialog-owns-foreground', human=value)
        raise SystemExit(20)
    assert focus.get('cpsStatus') == 0 and focus.get('pidStatus') == 0 and focus.get('pid', 0) > 0, focus
    return value


def state():
    row = json.loads(STATE.read_text())
    assert row['pid'] == fixture.pid and row['bundleId'] == 'com.djl.computer-use.background-fixture', row
    return row


def settle(predicate, timeout=2):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = state()
        if predicate(value):
            return value
        time.sleep(0.03)
    raise AssertionError({'conditionTimeout': value})


class Client:
    def __init__(self, helper=None):
        environment = dict(os.environ)
        environment['DJL_COMPUTER_USE_EXPERIMENTAL_INPUT'] = '1'
        self.process = subprocess.Popen([str(helper or SOURCE / '.build/DJL Computer Use.app/Contents/MacOS/DJLComputerUse')],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=(OUT / 'helper-stderr.log').open('w'), env=environment)
        processes.append(self.process)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.buffer = b''
        self.replies = {}
        self.events = []
        self.counter = 0

    def send(self, request):
        self.counter += 1
        identifier = f'raw-input-{self.counter}'
        frame = {'id': identifier, 'threadId': 'controlled-raw-input', 'request': request}
        self.process.stdin.write((json.dumps(frame) + '\n').encode())
        self.process.stdin.flush()
        return identifier

    def receive(self, identifier):
        deadline = time.monotonic() + 15
        while identifier not in self.replies:
            while b'\n' not in self.buffer:
                assert self.selector.select(max(0.01, deadline - time.monotonic())), 'Native reply timeout'
                chunk = os.read(self.process.stdout.fileno(), 1048576)
                assert chunk, 'Native helper exited'
                self.buffer += chunk
            line, self.buffer = self.buffer.split(b'\n', 1)
            frame = json.loads(line)
            if 'event' in frame:
                self.events.append(frame['event'])
            else:
                self.replies[frame['id']] = frame['response']
        return self.replies.pop(identifier)

    def request(self, request):
        return self.receive(self.send(request))


def success(response):
    assert 'result' in response and 'error' not in response, response
    return response['result']


def observe(session):
    return success(client.request({'method': 'session.observe', 'sessionId': session, 'maxElements': 500}))


def reference(snapshot, role, value=None):
    rows = [row for row in snapshot['elements'] if row['role'] == role and (value is None or row.get('value') == value)]
    assert len(rows) == 1, rows
    return {'kind': 'element', 'snapshotId': snapshot['snapshotId'], 'elementId': rows[0]['elementId']}


def point(name):
    global_point = state()['points'][name]
    return {'kind': 'point', 'x': global_point['x'] - bounds['x'], 'y': global_point['y'] - bounds['y']}


def perform(session, action):
    return success(client.request({'method': 'session.perform', 'sessionId': session, 'action': action}))


def action_trial(name, session, action, effect, expected_active=False):
    before_human, before = human(), state()
    assert before_human == original and before['isActive'] is expected_active and before['isKey'] is expected_active, before
    result = perform(session, action)
    after = settle(lambda value: value['stateRevision'] > before['stateRevision'] and effect(before, value) and value['isActive'] is expected_active and value['isKey'] is expected_active)
    if expected_active:
        assert after['activationCount'] == before['activationCount'] and after['deactivationCount'] == before['deactivationCount'], after
    else:
        assert after['activationCount'] == before['activationCount'] + 1 and after['deactivationCount'] == before['deactivationCount'] + 1, after
    after_human = human()
    assert result['acknowledgement'] == 'dispatched' and result['effect'] == 'unverified', result
    assert after_human == before_human, {'before': before_human, 'after': after_human}
    record(name, before=before, after=after, result=result, humanBefore=before_human, humanAfter=after_human,
           humanStatePreserved=True, localFocusRestored=True, passed=True)


if __name__ == '__main__':
    try:
        subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', '-module-cache-path', str(SOURCE / '.build/module-cache'),
                        str(SOURCE / 'Tests/FixtureLocalFocus.swift'), '-framework', 'AppKit', '-framework', 'ApplicationServices',
                        '-o', str(SOURCE / '.build/FixtureLocalFocus')], check=True)
        original = human()
        fixture = subprocess.Popen([str(FIXTURE), '--self-deactivate'], stdout=subprocess.DEVNULL,
                                   stderr=(OUT / 'fixture-stderr.log').open('w'))
        processes.append(fixture)
        time.sleep(1)
        assert state()['isActive'] is False and state()['isKey'] is False
        client = Client()
        status = success(client.request({'method': 'status'}))
        assert set(status['capabilities']['backgroundActions']) == {'click', 'drag', 'scroll', 'type', 'paste', 'pressKey', 'setValue', 'performAction'}, status
        assert human() == original
        target = {key: state()[key] for key in ['bundleId', 'pid', 'windowId']}
        session = success(client.request({'method': 'session.open', 'target': target}))['sessionId']
        snapshot = observe(session)
        bounds = snapshot['bounds']
        record('setup', target=target, originalHuman=original, capabilities=status['capabilities'])
        # Unsupported variants must leave fixture active/key state and event count unchanged.
        for button, count in [('unknown', 1), ('left', 4), ('middle', 0)]:
            prior = state()
            response = client.request({'method': 'session.perform', 'sessionId': session,
                'action': {'type': 'click', 'target': point('button'), 'button': button, 'count': count}})
            assert response['error']['code'] == 'invalid-request', response
            after = settle(lambda row: row['stateRevision'] > prior['stateRevision'])
            assert after['eventCount'] == prior['eventCount'] and after['isActive'] is False and after['isKey'] is False, after
            assert after['activationCount'] == prior['activationCount'] and after['deactivationCount'] == prior['deactivationCount'], after
            record('invalid-pointer-variant', button=button, count=count, response=response, noSeed=True, passed=True)
        snapshot = observe(session)
        button_rows = [row for row in snapshot['elements'] if row['role'] == 'AXButton' and row['label'] == 'Increment fixture counter']
        assert len(button_rows) == 1
        noneditable = {'kind': 'element', 'snapshotId': snapshot['snapshotId'], 'elementId': button_rows[0]['elementId']}
        prior = state()
        rejected = client.request({'method': 'session.perform', 'sessionId': session,
            'action': {'type': 'type', 'target': noneditable, 'text': 'must-not-be-typed'}})
        assert rejected['error']['code'] == 'unsupported', rejected
        rejected_after = settle(lambda row: row['stateRevision'] > prior['stateRevision'])
        assert rejected_after['eventCount'] == prior['eventCount'] and rejected_after['isActive'] is False
        assert rejected_after['activationCount'] == prior['activationCount'] and rejected_after['deactivationCount'] == prior['deactivationCount']
        record('noneditable-keyboard-rejected-before-seed', response=rejected, passed=True)
        action_trial('coordinate-click', session, {'type': 'click', 'target': point('button')}, lambda a, b: b['buttonCount'] == a['buttonCount'] + 1)
        action_trial('coordinate-scroll', session, {'type': 'scroll', 'target': point('scroll'), 'deltaX': 0, 'deltaY': 160},
                     lambda a, b: b['scrollCount'] > a['scrollCount'] and b['scrollOffset'] != a['scrollOffset'])
        action_trial('coordinate-drag', session, {'type': 'drag', 'from': point('dragStart'), 'to': point('dragEnd'), 'durationMs': 300},
                     lambda a, b: b['dragCount'] == a['dragCount'] + 1)
        # Point click gives the fixture's text field its app-local responder, without OS activation.
        action_trial('text-field-click', session, {'type': 'click', 'target': point('text')}, lambda a, b: b['eventCount'] > a['eventCount'])
        snapshot = observe(session)
        text = reference(snapshot, 'AXTextField', state()['text'])
        typed = ' native输入🧪'
        action_trial('unicode-type', session, {'type': 'type', 'target': text, 'text': typed},
                     lambda a, b: b['text'] != a['text'] and typed in b['text'])
        snapshot = observe(session)
        text = reference(snapshot, 'AXTextField', state()['text'])
        action_trial('named-key-backspace', session, {'type': 'pressKey', 'target': text, 'key': 'Backspace', 'modifiers': []},
                     lambda a, b: b['text'] != a['text'] and b['keyCount'] > a['keyCount'])
        # This unprotected seed takes real CPS ownership. It must be rejected,
        # even though the fixture has not become NSWorkspace foreground.
        subprocess.run([str(SOURCE / '.build/FixtureLocalFocus'), str(fixture.pid), '1'], check=True)
        settle(lambda value: value['isActive'] is True and value['isKey'] is True)
        borrowed_before = state()
        rejected = client.request({'method': 'session.perform', 'sessionId': session,
                                  'action': {'type': 'click', 'target': point('button')}})
        assert rejected['error']['code'] == 'unsupported' and 'belongs to the target' in rejected['error']['message'], rejected
        borrowed_after = settle(lambda row: row['stateRevision'] > borrowed_before['stateRevision'])
        assert borrowed_after['buttonCount'] == borrowed_before['buttonCount'] and borrowed_after['isActive'] is True and borrowed_after['isKey'] is True
        assert borrowed_after['activationCount'] == borrowed_before['activationCount'] and borrowed_after['deactivationCount'] == borrowed_before['deactivationCount']
        record('reject-initial-target-keyboard-ownership', response=rejected, noHelperEffect=True, preservedHumanOwnedLocalState=True, passed=True)
        subprocess.run([str(SOURCE / '.build/FixtureLocalFocus'), str(fixture.pid), '2'], check=True)
        settle(lambda value: value['isActive'] is False and value['isKey'] is False)
        # A real in-flight drag must release its mouse-down and restore temporary local focus.
        drag_baseline = state()
        drag = client.send({'method': 'session.perform', 'sessionId': session, 'action': {
            'type': 'drag', 'from': point('dragStart'), 'to': point('dragEnd'), 'durationMs': 3000}})
        try:
            settle(lambda value: value['isActive'] is True and value['leftDownCount'] == drag_baseline['leftDownCount'] + 1 and value['leftMouseHeld'] is True)
        except AssertionError:
            if b'\n' in client.buffer or client.selector.select(0.1):
                record('drag-not-started-native-response', response=client.receive(drag), human=human(), after=state())
            raise
        time.sleep(0.12)
        started = time.monotonic()
        stopped = success(client.request({'method': 'stop', 'sessionId': session}))
        latency = time.monotonic() - started
        response = client.receive(drag)
        final = settle(lambda value: value['isActive'] is False and value['isKey'] is False and value['leftUpCount'] == drag_baseline['leftUpCount'] + 1 and value['leftMouseHeld'] is False)
        assert response['error']['code'] == 'cancelled', response
        assert final['leftDownCount'] == drag_baseline['leftDownCount'] + 1, final
        assert final['activationCount'] == drag_baseline['activationCount'] + 1 and final['deactivationCount'] == drag_baseline['deactivationCount'] + 1, final
        assert stopped['stoppedSessionIds'] == [session] and latency < 0.5, (stopped, latency)
        assert human() == original
        record('stop-during-drag', response=response, stopped=stopped, latencySeconds=latency, after=final,
               humanAfter=human(), mouseUpObserved=True, localFocusRestored=True, passed=True)
        assert human() == original
        record('summary', passed=True, experimentalOnly=True, humanBefore=original, humanAfter=human(), output=str(OUT))
    except Exception as error:
        record('failure', error=repr(error), humanAfter=human(), fixtureAfter=state(), fixtureExit=fixture.poll(), nativeExit=client.process.poll(), ownWindowMetadata=json.loads(subprocess.check_output([str(SOURCE / '.build/HumanStateObserver'), '--fixture-pid', str(fixture.pid)], timeout=5))['windows'], output=str(OUT))
        raise
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
        # Reap fixture children before a retained helper waits for positive PID exit.
        for process in processes:
            if process.poll() is None:
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    record('owned-process-retained-after-shutdown', pid=process.pid)
                    raise
