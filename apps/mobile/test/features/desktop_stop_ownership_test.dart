import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_response_footer.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_stop_recovery_test.dart'
    show StopRecoveryTransport, stopDesktop, stopStart, stopPage;

void main() {
  test('a replaced cache cannot receive the old Stop failure', () async {
    final reply = Completer<RemoteJson>();
    final t = StopRecoveryTransport()..interrupts.add(reply);
    final d = await stopDesktop(t);
    addTearDown(d.dispose);
    final stopping = d.stop();
    await t.interruptStarted.future;
    d.threadList.data = ThreadLocalState();
    d.error = 'new cache notice';
    reply.completeError(
      const RemoteRpcException(-32601, 'Unknown method', null),
    );
    await stopping;
    expect(d.error, 'new cache notice');
    expect(
      t.calls.where((row) => row['method'] == 'turn/interrupt'),
      hasLength(1),
    );
  });

  for (final change in ['pending', 'published', 'folder']) {
    test(
      'Stop lookup superseded by $change cannot dispatch an interrupt',
      () async {
        final page = Completer<RemoteJson>();
        final t = StopRecoveryTransport()..pages.add(page);
        final d = await stopDesktop(t, turn: null);
        addTearDown(d.dispose);
        final stopping = d.stop();
        await Future<void>.delayed(Duration.zero);
        expect(t.calls.last['method'], 'thread/turns/list');
        if (change == 'folder') {
          d.thread = {'id': 't1', 'cwd': '/other'};
        } else {
          stopStart(t, turn: change == 'published' ? 'newer' : null);
        }
        d.error = 'new lookup owner notice';
        page.complete(stopPage);
        await stopping;
        expect(
          t.calls.where((row) => row['method'] == 'turn/interrupt'),
          isEmpty,
        );
        expect(d.error, 'new lookup owner notice');
        if (change == 'pending') {
          expect(d.selectedResponseFooter.pending, isTrue);
        }
        if (change == 'published') expect(d.turnId, 'newer');
      },
    );
  }

  test(
    'a real completion before Stop acknowledgement stays terminal',
    () async {
      final reply = Completer<RemoteJson>();
      final t = StopRecoveryTransport()
        ..interrupts.add(reply)
        ..reads.add({
          'thread': {
            'id': 't1',
            'cwd': '/qa',
            'turns': [
              {'id': 'live', 'status': 'interrupted', 'items': []},
            ],
          },
        });
      final d = await stopDesktop(t);
      addTearDown(d.dispose);
      final stopping = d.stop();
      await t.interruptStarted.future;
      t.events.add({
        'method': 'turn/completed',
        'params': {
          'threadId': 't1',
          'turn': {'id': 'live', 'status': 'interrupted'},
        },
      });
      reply.complete({});
      await stopping;
      expect(d.turnId, isNull);
      expect(
        d.selectedResponseFooter.outcome('live'),
        DesktopResponseOutcome.stopped,
      );
      expect(d.selectedResponseFooter.suppressesLatest, isFalse);
    },
  );

  test(
    'Stop acknowledgement preserves a newer draft, runtime selection and local queue',
    () async {
      final reply = Completer<RemoteJson>();
      final t = StopRecoveryTransport()..interrupts.add(reply);
      final d = await stopDesktop(t);
      addTearDown(d.dispose);
      final stopping = d.stop();
      await t.interruptStarted.future;
      expect(
        await d.submitComposerDraft(
          DesktopComposerDraft(text: 'queued after Stop'),
        ),
        isTrue,
      );
      d.threadList.data.setComposerDraft(
        't1',
        DesktopComposerDraft(text: 'new unsent text'),
      );
      d.model = 'another-model';
      d.effort = 'high';
      reply.complete({});
      await stopping;
      expect(d.queuedDrafts.single.draft.text, 'queued after Stop');
      expect(d.threadList.data.composerDraft('t1').text, 'new unsent text');
      expect(d.model, 'another-model');
      expect(d.effort, 'high');
      expect(
        t.calls.where(
          (row) => {'turn/start', 'turn/steer'}.contains(row['method']),
        ),
        isEmpty,
      );
    },
  );

  test(
    'old interruption cleanup cannot remove a newer mark for the same turn',
    () {
      final lifecycle = DesktopResponseLifecycle()..starting('t1', 'live');
      lifecycle.interrupt('t1', 'live');
      final old = lifecycle.revision;
      lifecycle.interrupt('t1', 'live');
      lifecycle.cancelInterrupt('t1', 'live', old);
      expect(lifecycle.facts('t1').interrupting, {'live'});
      lifecycle.cancelInterrupt('t1', 'live', lifecycle.revision);
      expect(lifecycle.facts('t1').interrupting, isEmpty);
      expect(
        lifecycle.facts('t1').outcome('live'),
        DesktopResponseOutcome.running,
      );
    },
  );

  for (final change in ['thread', 'folder', 'pin', 'session', 'suspension']) {
    test(
      'late Stop failure after $change cannot overwrite the new context error',
      () async {
        final reply = Completer<RemoteJson>();
        final t = StopRecoveryTransport()..interrupts.add(reply);
        final d = await stopDesktop(t);
        addTearDown(d.dispose);
        final stopping = d.stop();
        await t.interruptStarted.future;
        if (change == 'thread') {
          d.thread = {'id': 'other', 'cwd': '/qa'};
          d.turnId = 'other-live';
        } else if (change == 'folder') {
          d.thread = {'id': 't1', 'cwd': '/other'};
        } else if (change == 'pin') {
          d.active = const Pairing({
            'macDeviceId': 'mac-a',
            'macIdentityPublicKey': 'other-pin',
            'sessionId': 'session-a',
          });
        } else if (change == 'session') {
          t.session = 'new-session';
        } else {
          d.suspend();
        }
        d.error = 'new context notice';
        reply.completeError(
          const RemoteRpcException(-32000, 'no active turn', null),
        );
        await stopping;
        expect(d.error, 'new context notice');
        expect(
          t.calls.where((row) => row['method'] == 'turn/interrupt'),
          hasLength(1),
        );
        expect(
          t.calls.where((row) => row['method'] == 'thread/turns/list'),
          isEmpty,
        );
      },
    );
  }

  for (final newer in ['pending', 'published']) {
    test('old Stop acknowledgement preserves the newer $newer run', () async {
      final reply = Completer<RemoteJson>();
      final t = StopRecoveryTransport()..interrupts.add(reply);
      final d = await stopDesktop(t);
      addTearDown(d.dispose);
      final stopping = d.stop();
      await t.interruptStarted.future;
      stopStart(t, turn: newer == 'pending' ? null : 'newer');
      d.error = 'new run notice';
      reply.complete({});
      await stopping;
      expect(d.error, 'new run notice');
      if (newer == 'pending') {
        expect(d.selectedResponseFooter.pending, isTrue);
        expect(d.selectedResponseFooter.latestTurn, isNull);
      } else {
        expect(d.turnId, 'newer');
        expect(d.selectedResponseFooter.latestTurn, 'newer');
      }
    });
  }

  test('A to B to A preserves one pending Stop per owned run', () async {
    final a = Completer<RemoteJson>(), b = Completer<RemoteJson>();
    final t = StopRecoveryTransport()..interrupts.addAll([a, b]);
    final d = await stopDesktop(t);
    addTearDown(d.dispose);
    final first = d.stop();
    await t.interruptStarted.future;
    d.thread = {'id': 'other', 'cwd': '/qa'};
    stopStart(t, thread: 'other', turn: 'other-live');
    final second = d.stop();
    await Future<void>.delayed(Duration.zero);
    d.thread = {'id': 't1', 'cwd': '/qa'};
    d.turnId = 'live';
    await d.stop();
    final pending = t.calls
        .where((row) => row['method'] == 'turn/interrupt')
        .toList();
    a.complete({});
    b.complete({});
    await Future.wait([first, second]);
    expect(pending.map((row) => row['params']), [
      {'threadId': 't1', 'turnId': 'live'},
      {'threadId': 'other', 'turnId': 'other-live'},
    ]);
  });

  test(
    'selection change during Stop notification cannot dispatch or leave a false interruption',
    () async {
      final t = StopRecoveryTransport();
      final d = await stopDesktop(t);
      addTearDown(d.dispose);
      var changed = false;
      d.addListener(() {
        if (!changed &&
            d.selectedResponseFooter.interrupting.contains('live')) {
          changed = true;
          d.thread = {'id': 'other', 'cwd': '/qa'};
          d.turnId = 'other-live';
        }
      });
      await d.stop();
      expect(changed, isTrue);
      expect(
        t.calls.where((row) => row['method'] == 'turn/interrupt'),
        isEmpty,
      );
      d.thread = {'id': 't1', 'cwd': '/qa'};
      d.turnId = 'live';
      expect(d.selectedResponseFooter.interrupting, isEmpty);
    },
  );
}
