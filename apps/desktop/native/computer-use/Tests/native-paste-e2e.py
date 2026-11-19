#!/usr/bin/env python3
"""Public paste path with one attested test-clone board substitution. Never general."""
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import time

SOURCE = pathlib.Path(__file__).resolve().parents[1]
ROOT = pathlib.Path('/private/tmp/djl-cua-guarded-paste')
HELPER = ROOT / 'test-helper/DJL Computer Use.app/Contents/MacOS/DJLComputerUse'
CONTROL = ROOT / 'PasteboardFixtureControl'
FIXTURE = pathlib.Path('/private/tmp/djl-cua-background-probe/DJLBackgroundFixture.app/Contents/MacOS/DJLBackgroundFixture')
BOARD = json.loads((ROOT / 'board.json').read_text())['name']
assert BOARD.startswith('com.djl.computer-use.synthetic.')
for source in (SOURCE / 'Sources').glob('*.swift'):
    expected = source.read_text()
    if source.name == 'main.swift':
        needle = 'board: NSPasteboard.general'
        assert expected.count(needle) == 1
        expected = expected.replace(needle, 'board: NSPasteboard(name: .init("' + BOARD + '"))')
    assert (ROOT / 'prepared/Sources' / source.name).read_text() == expected, source
subprocess.run(['codesign', '--verify', '--strict', str(HELPER.parents[2])], check=True)
spec = importlib.util.spec_from_file_location('native_input_support', SOURCE / 'Tests/native-input-e2e.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.OUT = ROOT / time.strftime('native-case-%Y%m%d-%H%M%S')
m.OUT.mkdir(mode=0o700)
m.STATE = pathlib.Path('/private/tmp/djl-cua-keyboard-protection/native-paste-state.json')
m.STATE.touch()
client = None


def board(command):
    result = subprocess.check_output([str(CONTROL), command, BOARD], timeout=5)
    return json.loads(result) if result else None


def observed(session):
    return m.success(client.request({'method': 'session.observe', 'sessionId': session, 'maxElements': 500}))


def editor(snapshot):
    return m.reference(snapshot, 'AXTextArea')


def start_fixture(*flags):
    m.fixture = subprocess.Popen([str(FIXTURE), '--input-matrix', '--self-deactivate', '--defer-first-responder', '--paste-rich',
        '--pasteboard-name', BOARD, '--state-file', str(m.STATE), *flags], stdout=subprocess.DEVNULL,
        stderr=(m.OUT / ('fixture-' + str(len(m.processes)) + '.log')).open('w'))
    m.processes.append(m.fixture)
    time.sleep(.7)
    state = m.settle(lambda s: not s['isActive'] and not s['isKey'])
    human_after = m.human()
    m.record('fixture-launch-human-check', before=original, after=human_after,
        preserved=human_after == original)
    assert human_after == original
    session = m.success(client.request({'method': 'session.open', 'target': {k: state[k] for k in ['bundleId', 'pid', 'windowId']}}))['sessionId']
    # Create the fixture's responder only after keyboard protection is installed.
    snapshot = observed(session)
    bounds = snapshot['bounds']; location = state['matrix']['editorPoint']
    response = client.request({'method': 'session.perform', 'sessionId': session,
        'action': {'type': 'click', 'target': {'kind': 'point',
            'x': location['x'] - bounds['x'], 'y': location['y'] - bounds['y']}}})
    m.record('protected-first-responder-click', response=response)
    m.success(response)
    m.settle(lambda value: not value['isActive'] and not value['isKey'])
    human_after_click = m.human()
    m.record('post-click-human-check', before=original, after=human_after_click,
        preserved=human_after_click == original)
    assert human_after_click == original
    return session


def clear_editor(session):
    target = editor(observed(session))
    m.success(client.request({'method': 'session.perform', 'sessionId': session,
        'action': {'type': 'setValue', 'target': target, 'value': ''}}))
    m.settle(lambda s: s['matrix']['textLength'] == 0)
    return editor(observed(session))


def preserved():
    state = m.state()
    assert not state['isActive'] and not state['isKey'], state
    assert m.human() == original


def stop_fixture(session):
    m.success(client.request({'method': 'stop', 'sessionId': session}))
    m.fixture.terminate(); m.fixture.wait(timeout=5)


try:
    original = m.human()
    m.record('idle-ack', helperSha256=hashlib.sha256(HELPER.read_bytes()).hexdigest(), board=BOARD,
        sourceAdapterChanges=1, generalClipboardAccess=False, human=original)
    client = m.Client(helper=HELPER)
    status = m.success(client.request({'method': 'status'}))
    assert 'paste' in status['capabilities']['backgroundActions']
    assert status['permissions'] == {'accessibility': 'granted', 'screenRecording': 'granted'}
    session = start_fixture()
    for format, text, expected, bold in [
        ('text', '  Synthetic café ✓\n', '  Synthetic café ✓\n', False),
        ('md', '**Bold** and *italic*', 'Bold and italic', True),
        ('html', '<p><b>HTML</b> café ✓</p>', 'HTML café ✓', True),
    ]:
        board('seed'); backup = board('read'); target = clear_editor(session)
        before = m.state()
        response = client.request({'method': 'session.perform', 'sessionId': session,
            'action': {'type': 'paste', 'target': target, 'format': format, 'text': text}})
        m.record('paste-' + format + '-response', response=response, before=before, after=m.state(), boardRestored=board('read') == backup, humanAfter=m.human())
        result = m.success(response)
        after = m.settle(lambda s: s['matrix']['pastes'] == before['matrix']['pastes'] + 1)
        value = next(e['value'] for e in observed(session)['elements'] if e['role'] == 'AXTextArea')
        assert (value if format == 'text' else value.rstrip('\n')) == expected, value
        if bold: assert after['matrix']['boldCharacters'] >= 4, after['matrix']
        assert board('read') == backup
        assert result['acknowledgement'] == 'dispatched' and result['effect'] == 'unverified'
        preserved(); m.record('paste-' + format, result=result, fixture=after, restored=True, passed=True)
    stop_fixture(session)

    session = start_fixture('--paste-no-read')
    board('seed'); backup = board('read'); target = clear_editor(session)
    response = client.request({'method': 'session.perform', 'sessionId': session,
        'action': {'type': 'paste', 'target': target, 'format': 'text', 'text': 'unread synthetic'}})
    assert response['error']['code'] == 'timeout', response
    assert board('read') == backup and m.state()['matrix']['pastes'] == 0
    preserved(); m.record('no-read-timeout', response=response, restored=True, passed=True)

    board('seed'); backup = board('read'); target = editor(observed(session)); before = m.state()
    pending = client.send({'method': 'session.perform', 'sessionId': session,
        'action': {'type': 'paste', 'target': target, 'format': 'text', 'text': 'cancelled synthetic'}})
    m.settle(lambda s: s['matrix']['pasteAttempts'] > before['matrix']['pasteAttempts'], timeout=1)
    start = time.monotonic()
    stopped = m.success(client.request({'method': 'stop', 'sessionId': session}))
    response = client.receive(pending)
    assert response['error']['code'] == 'cancelled' and stopped['stoppedSessionIds'] == [session], response
    assert time.monotonic() - start < .5
    assert board('read') == backup
    preserved(); m.record('stop-during-paste', response=response, restored=True, passed=True)
    m.fixture.terminate(); m.fixture.wait(timeout=5)

    session = start_fixture('--paste-no-read')
    board('seed'); target = clear_editor(session); before = m.state()
    pending = client.send({'method': 'session.perform', 'sessionId': session,
        'action': {'type': 'paste', 'target': target, 'format': 'text', 'text': 'conflicting synthetic'}})
    m.settle(lambda s: s['matrix']['pasteAttempts'] > before['matrix']['pasteAttempts'], timeout=1)
    board('foreign'); foreign = [{'public.utf8-plain-text': 'Zm9yZWlnbi1zZW50aW5lbA=='}]
    response = client.receive(pending)
    assert response['error']['code'] == 'clipboard-conflict', response
    assert board('read') == foreign
    preserved(); m.record('foreign-writer', response=response, newerWriterPreserved=True, passed=True)
    stop_fixture(session)
    m.record('summary', allAssertionsPassed=True, generalClipboardAccess=False, humanStatePreserved=True)
finally:
    # Retire/reap only our fixtures first. If a failed scope retained protection,
    # target exit lets the helper prove safe retirement during its EOF cleanup.
    for process in reversed(m.processes):
        if client is not None and process is client.process: continue
        if process.poll() is None: process.terminate(); process.wait(timeout=5)
    if client is not None and client.process.poll() is None:
        client.process.stdin.close()
        try: client.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            m.record('cleanup-retained', helperPid=client.process.pid, fixturePids=[p.pid for p in m.processes if p is not client.process])
            raise  # Never force-kill a helper retaining input protection.
    board('release')
    m.record('released', children=[{'pid': p.pid, 'exitCode': p.poll()} for p in m.processes])
