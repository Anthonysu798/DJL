#!/usr/bin/env python3
"""Only synthetic negative fixtures: focus cleanup refusal and editable auto-advance."""
import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import time

spec = importlib.util.spec_from_file_location('native_input_e2e_support', Path(__file__).with_name('native-input-e2e.py'))
t = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t)


def launch(option):
    original = t.human()
    fixture = subprocess.Popen([str(t.FIXTURE), '--self-deactivate', option], stdout=subprocess.DEVNULL,
                               stderr=(t.OUT / (option[2:] + '-stderr.log')).open('w'))
    t.processes.append(fixture)
    t.fixture = fixture
    time.sleep(1)
    assert t.state()['isActive'] is False and t.state()['isKey'] is False, t.state()
    client = t.Client()
    t.client = client
    t.original = original
    target = {key: t.state()[key] for key in ['bundleId', 'pid', 'windowId']}
    session = t.success(client.request({'method': 'session.open', 'target': target}))['sessionId']
    t.bounds = t.observe(session)['bounds']
    assert t.human() == original
    return client, fixture, target, session, original


def finish_processes():
    for process in reversed(t.processes):
        if process.poll() is None:
            process.terminate()
    # A zombie fixture still has libproc identity until its parent reaps it.
    for process in t.processes:
        if process.poll() is None:
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                t.record('owned-process-retained-after-shutdown', pid=process.pid)
                raise
    t.processes.clear()


try:
    client, fixture, target, session, original = launch('--ignore-local-deactivation')
    response = client.request({'method': 'session.perform', 'sessionId': session,
        'action': {'type': 'click', 'target': t.point('button')}})
    assert response['error']['code'] == 'unsupported' and 'quarantin' in response['error']['message'], response
    leaked = t.state()
    assert leaked['buttonCount'] == 1 and leaked['isActive'] is True and leaked['isKey'] is True, leaked
    reopened = client.request({'method': 'session.open', 'target': target})
    assert reopened['error']['code'] == 'unsupported' and 'quarantin' in reopened['error']['message'], reopened
    assert t.human() == original
    t.record('failed-cleanup-quarantine', response=response, newSession=reopened, after=leaked,
             humanStatePreserved=True, passed=True)
    # Real self-deactivation is the only test intervention clearing the dirty state.
    os.kill(fixture.pid, signal.SIGUSR1)
    t.settle(lambda value: value['isActive'] is False and value['isKey'] is False)
    session = t.success(client.request({'method': 'session.open', 'target': target}))['sessionId']
    t.observe(session)
    drag_baseline = t.state()
    drag = client.send({'method': 'session.perform', 'sessionId': session,
        'action': {'type': 'drag', 'from': t.point('dragStart'), 'to': t.point('dragEnd'), 'durationMs': 3000}})
    t.settle(lambda value: value['isActive'] is True and value['leftDownCount'] == drag_baseline['leftDownCount'] + 1 and value['leftMouseHeld'] is True)
    time.sleep(0.12)
    start = time.monotonic()
    stopped = t.success(client.request({'method': 'stop', 'sessionId': session}))
    stop_latency = time.monotonic() - start
    cancelled = client.receive(drag)
    assert cancelled['error']['code'] == 'unsupported' and 'quarantin' in cancelled['error']['message'], cancelled
    after_stop = t.state()
    assert after_stop['leftUpCount'] == drag_baseline['leftUpCount'] + 1 and after_stop['leftDownCount'] == drag_baseline['leftDownCount'] + 1 and after_stop['leftMouseHeld'] is False and after_stop['isActive'] is True, after_stop
    rejected = client.request({'method': 'session.open', 'target': target})
    assert rejected['error']['code'] == 'unsupported' and 'quarantin' in rejected['error']['message'], rejected
    assert stop_latency < 0.5 and stopped['stoppedSessionIds'] == [session] and t.human() == original
    t.record('post-stop-cleanup-failure', response=cancelled, newSession=rejected, after=after_stop,
             mouseReleaseObserved=True, stopLatencySeconds=stop_latency, humanStatePreserved=True, passed=True)
    os.kill(fixture.pid, signal.SIGUSR1)
    t.settle(lambda value: value['isActive'] is False and value['isKey'] is False)
    t.success(client.request({'method': 'session.open', 'target': target}))
    t.record('quarantine-cleared-only-after-real-inactive', passed=True)
    finish_processes()

    client, fixture, target, session, original = launch('--advance-focus-on-type')
    t.perform(session, {'type': 'click', 'target': t.point('text')})
    snapshot = t.observe(session)
    original_text = t.state()['text']
    reference = t.reference(snapshot, 'AXTextField', original_text)
    value = 'FOCUS-CHECK-CHUNK-' * 200
    response = client.request({'method': 'session.perform', 'sessionId': session,
                              'action': {'type': 'type', 'target': reference, 'text': value}})
    assert response['error']['code'] == 'unsupported', response
    final = t.settle(lambda row: row['advancedFocus'] is True and row['isActive'] is False and row['isKey'] is False)
    assert final['secondaryText'] == '' and final['keyCount'] == 1, final
    assert final['text'] != original_text and len(final['text']) < len(value), final
    assert t.human() == original
    t.record('unicode-auto-advance-stops-before-second-field', response=response, after=final,
             secondFieldUntouched=True, exactlyOneChunk=True, humanStatePreserved=True, passed=True)
    t.record('negative-summary', passed=True, output=str(t.OUT))
except Exception as error:
    t.record('negative-failure', error=repr(error), output=str(t.OUT))
    raise
finally:
    finish_processes()
