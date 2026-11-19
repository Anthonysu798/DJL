import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_response_footer.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_connected_switch_test.dart'
    show switchFixture, switchPair, drainSwitch;
import 'desktop_activity_test.dart' show ActivityCacheStore;
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop, reasoningPair, reasoningEvent;

class FooterSendTransport extends ReasoningTransport {
  Completer<Map<String, dynamic>>? sendGate;
  @override
  Future<Map<String, dynamic>> request(
    String method,
    Map<String, dynamic> params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'turn/start' && sendGate != null) return sendGate!.future;
    return super.request(method, params, timeout: timeout);
  }
}

Map<String, dynamic> history(Object? status, {String id = 'turn'}) => {
  'id': 'thread',
  'turns': [
    {
      'id': id,
      'status': status,
      'items': [
        {'id': 'answer', 'type': 'agentMessage', 'text': 'Full answer'},
      ],
    },
  ],
};

void main() {
  test(
    'unknown history is not a terminal tombstone for a later real start',
    () async {
      final t = ReasoningTransport()..history = history(null);
      final d = await reasoningDesktop(t);
      reasoningEvent(t, 'turn/started');
      expect(
        d.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.running,
      );
      expect(d.selectedResponseFooter.suppressesLatest, isTrue);
      d.dispose();
    },
  );

  test(
    'fresh running parent without an ID still suppresses without inventing one',
    () async {
      final t = ReasoningTransport()
        ..history = {
          'id': 'thread',
          'turns': [
            {'status': 'running', 'items': []},
          ],
        };
      final d = await reasoningDesktop(t);
      expect(d.selectedResponseFooter.outcomes, isEmpty);
      expect(d.selectedResponseFooter.pending, isTrue);
      d.dispose();
    },
  );

  test(
    'conflicting envelope identities cannot grant a terminal outcome',
    () async {
      final t = ReasoningTransport();
      final d = await reasoningDesktop(t);
      reasoningEvent(
        t,
        'turn/completed',
        extra: {
          'status': 'completed',
          'event': {'threadId': 'other', 'turnId': 'turn'},
        },
      );
      expect(
        d.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.unknown,
      );
      d.dispose();
    },
  );

  test(
    'local send suppresses before a turn ID exists and does not infer completion from response',
    () async {
      final t = FooterSendTransport()..history = history('completed');
      final d = await reasoningDesktop(t);
      d.model = 'test-model';
      t.sendGate = Completer();
      final sending = d.send('Next request');
      await Future<void>.delayed(Duration.zero);
      expect(d.selectedResponseFooter.pending, isTrue);
      expect(d.selectedResponseFooter.outcomes.keys, ['turn']);
      t.sendGate!.complete({
        'turn': {'id': 'next'},
      });
      expect(await sending, isTrue, reason: d.error);
      expect(
        d.selectedResponseFooter.outcome('next'),
        DesktopResponseOutcome.running,
      );
      expect(d.selectedResponseFooter.pending, isFalse);
      d.dispose();
    },
  );

  test('paused history cannot replace newer running with completed', () async {
    final t = ReasoningTransport();
    final d = await reasoningDesktop(t);
    t.readGate = Completer();
    final reading = d.openThread({'id': 'thread'}, readOnlyNavigation: true);
    await Future<void>.delayed(Duration.zero);
    reasoningEvent(t, 'turn/started');
    t.readGate!.complete({'thread': history('completed')});
    await reading;
    expect(
      d.selectedResponseFooter.outcome('turn'),
      DesktopResponseOutcome.running,
    );
    expect(d.selectedResponseFooter.suppressesLatest, isTrue);
    d.dispose();
  });

  test(
    'cold offline timeline metadata cannot grant received outcome',
    () async {
      final cache = ActivityCacheStore();
      final t = ReasoningTransport()..history = history('stopped');
      final d = await reasoningDesktop(t, store: cache);
      await d.disconnect();
      await d.openThread({'id': 'thread'}, readOnlyNavigation: true);
      expect(d.timeline.single['text'], 'Full answer');
      expect(
        d.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.unknown,
      );
      d.dispose();
    },
  );

  test(
    'cancelled B switch and late A read cannot restore A lifecycle facts',
    () async {
      final f = await switchFixture();
      final d = f.desktop;
      f.transport.histories['thread'] = history('completed');
      await d.openThread({'id': 'thread'}, readOnlyNavigation: true);
      expect(
        d.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.completed,
      );
      f.transport.gateMethod = 'thread/read';
      final readGate = f.transport.requestGate = Completer();
      final reading = d.openThread({'id': 'thread'}, readOnlyNavigation: true);
      await Future<void>.delayed(Duration.zero);
      f.store.values['B'] = {
        'drafts': {'saved': 'Original B'},
      };
      final originalB = jsonEncode(f.store.values['B']);
      f.transport.gateMethod = 'initialize';
      final connectGate = f.transport.requestGate = Completer();
      final switching = d.selectSaved(switchPair('B'));
      await drainSwitch();
      await d.cancelSavedSwitch();
      readGate.complete({'thread': history('completed')});
      connectGate.complete({'data': []});
      await reading;
      await switching;
      expect(d.selectedResponseFooter.outcomes, isEmpty);
      expect(d.active, isNull);
      expect(jsonEncode(f.store.values['B']), originalB);
      d.dispose();
    },
  );

  test(
    'turn started without ID is pending and a stale-session start is ignored',
    () async {
      final t = ReasoningTransport();
      final d = await reasoningDesktop(t);
      t.events.add({
        'method': 'turn/started',
        '_sessionId': 'stale',
        'params': {'threadId': 'thread'},
      });
      expect(d.selectedResponseFooter.pending, isFalse);
      t.events.add({
        'method': 'turn/started',
        'params': {'threadId': 'thread'},
      });
      expect(d.selectedResponseFooter.pending, isTrue);
      expect(d.selectedResponseFooter.outcomes, isEmpty);
      reasoningEvent(t, 'turn/started');
      expect(d.selectedResponseFooter.pending, isFalse);
      expect(
        d.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.running,
      );
      d.dispose();
    },
  );

  test('explicit live failure event settles only its real turn', () async {
    final t = ReasoningTransport();
    final d = await reasoningDesktop(t);
    reasoningEvent(t, 'turn/started');
    reasoningEvent(
      t,
      'turn/failed',
      extra: {
        'error': {'message': 'Request failed'},
      },
    );
    expect(
      d.selectedResponseFooter.outcome('turn'),
      DesktopResponseOutcome.failed,
    );
    expect(d.selectedResponseFooter.suppressesLatest, isFalse);
    d.dispose();
  });

  test('fresh selected synthetic history cannot certify a response', () async {
    final t = ReasoningTransport()
      ..history = {
        'id': 'thread',
        'turns': [
          {
            'id': 'turn',
            'status': 'completed',
            'djlHistoryCompacted': true,
            'items': [
              {
                'id': 'answer',
                'type': 'agentMessage',
                'text': 'Archive summary',
              },
            ],
          },
        ],
      };
    final d = await reasoningDesktop(t);
    expect(d.timeline.single['text'], 'Archive summary');
    expect(
      d.selectedResponseFooter.outcome('turn'),
      DesktopResponseOutcome.unknown,
    );
    d.dispose();
  });

  for (final replay in [false, true]) {
    test(
      'fix1 unseen older ${replay ? 'replayed stop' : 'completion'} cannot settle an ID-less pending start',
      () async {
        final t = ReasoningTransport();
        final d = await reasoningDesktop(t);
        t.events.add({
          'method': 'turn/started',
          'params': {'threadId': 'thread'},
        });
        expect(d.selectedResponseFooter.pending, isTrue);
        reasoningEvent(
          t,
          'turn/completed',
          turn: 'unseen-older',
          extra: {
            'status': replay ? 'stopped' : 'completed',
            if (replay) 'djlReplayedEvent': true,
          },
        );
        expect(d.selectedResponseFooter.pending, isTrue);
        expect(d.selectedResponseFooter.suppressesLatest, isTrue);
        d.dispose();
      },
    );
  }

  test(
    'fix1 same-ID thread running status preserves association through completion',
    () async {
      final t = ReasoningTransport();
      final d = await reasoningDesktop(t);
      reasoningEvent(t, 'turn/started');
      t.events.add({
        'method': 'thread/status/changed',
        'params': {'threadId': 'thread', 'turnId': 'turn', 'status': 'running'},
      });
      expect(d.selectedResponseFooter.suppressesLatest, isTrue);
      reasoningEvent(t, 'turn/completed', extra: {'status': 'completed'});
      expect(
        d.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.completed,
      );
      expect(d.selectedResponseFooter.pending, isFalse);
      expect(d.selectedResponseFooter.suppressesLatest, isFalse);
      d.dispose();
    },
  );

  for (final status in ['stopped', 'completed', 'failed']) {
    test(
      'fix1 fresh post-interrupt $status history resolves only that interrupt',
      () async {
        final t = ReasoningTransport()..history = history('running');
        final d = await reasoningDesktop(t);
        await d.stop();
        expect(d.selectedResponseFooter.interrupting, {'turn'});
        t.history = history(status);
        await d.openThread({'id': 'thread'}, readOnlyNavigation: true);
        expect(d.selectedResponseFooter.interrupting, isEmpty);
        expect(d.selectedResponseFooter.outcome('turn').name, status);
        expect(d.selectedResponseFooter.suppressesLatest, isFalse);
        reasoningEvent(t, 'turn/started', turn: 'independent');
        reasoningEvent(
          t,
          'turn/completed',
          turn: 'independent',
          extra: {'status': 'completed'},
        );
        expect(d.selectedResponseFooter.suppressesLatest, isFalse);
        d.dispose();
      },
    );
  }

  test(
    'fix1 unknown and unrelated fresh history cannot acknowledge the interrupted turn',
    () async {
      final t = ReasoningTransport()..history = history('running');
      final d = await reasoningDesktop(t);
      await d.stop();
      for (final value in [
        history(null),
        history('completed', id: 'unrelated'),
      ]) {
        t.history = value;
        await d.openThread({'id': 'thread'}, readOnlyNavigation: true);
        expect(d.selectedResponseFooter.interrupting, {'turn'});
        expect(d.selectedResponseFooter.suppressesLatest, isTrue);
      }
      d.dispose();
    },
  );

  test(
    'fix1 a pre-interrupt paused read cannot resolve the subsequent interrupt',
    () async {
      final t = ReasoningTransport()..history = history('running');
      final d = await reasoningDesktop(t);
      t.readGate = Completer();
      final reading = d.openThread({'id': 'thread'}, readOnlyNavigation: true);
      await Future<void>.delayed(Duration.zero);
      // The selected read clears active turnId; a real start restores interruptibility.
      reasoningEvent(t, 'turn/started');
      await d.stop();
      expect(d.selectedResponseFooter.interrupting, {'turn'});
      t.readGate!.complete({'thread': history('completed')});
      await reading;
      expect(d.selectedResponseFooter.interrupting, {'turn'});
      expect(d.selectedResponseFooter.suppressesLatest, isTrue);
      d.dispose();
    },
  );

  test('older terminal event cannot clear a newer pending start', () async {
    final t = ReasoningTransport()..history = history('completed');
    final d = await reasoningDesktop(t);
    t.events.add({
      'method': 'thread/status/changed',
      'params': {'threadId': 'thread', 'status': 'starting'},
    });
    reasoningEvent(t, 'turn/completed', extra: {'status': 'completed'});
    expect(d.selectedResponseFooter.pending, isTrue);
    d.dispose();
  });

  test('fresh parent outcome is captured before timeline flattening', () async {
    final t = ReasoningTransport()..history = history('failed');
    final d = await reasoningDesktop(t);
    expect(d.timeline.single['text'], 'Full answer');
    expect(
      d.selectedResponseFooter.outcome('turn'),
      DesktopResponseOutcome.failed,
    );
    final snapshot = d.selectedResponseFooter;
    expect(() => snapshot.outcomes.clear(), throwsUnsupportedError);
    reasoningEvent(t, 'turn/started', turn: 'next');
    expect(snapshot.outcome('next'), DesktopResponseOutcome.unknown);
    d.dispose();
  });

  for (final pausedResume in [false, true]) {
    test(
      'paused ${pausedResume ? 'resume' : 'read'} cannot erase a newer stop',
      () async {
        final t = ReasoningTransport()..history = history('running');
        final d = await reasoningDesktop(t);
        final gate = Completer<Map<String, dynamic>>();
        if (pausedResume) {
          t.resumeGate = gate;
        } else {
          t.readGate = gate;
        }
        final reading = d.openThread({
          'id': 'thread',
        }, readOnlyNavigation: !pausedResume);
        await Future<void>.delayed(Duration.zero);
        reasoningEvent(
          t,
          'turn/completed',
          extra: {
            'turn': {'id': 'turn', 'status': 'interrupted'},
          },
        );
        t.history = history('completed');
        gate.complete({'thread': history('completed')});
        await reading;
        await Future<void>.delayed(Duration.zero);
        expect(
          d.selectedResponseFooter.outcome('turn'),
          DesktopResponseOutcome.stopped,
        );
        t.resumeGate = null;
        t.readGate = null;
        await d.openThread({'id': 'thread'}, readOnlyNavigation: true);
        expect(
          d.selectedResponseFooter.outcome('turn'),
          DesktopResponseOutcome.stopped,
        );
        d.dispose();
      },
    );
  }

  test(
    'paused history cannot erase pending without a fabricated turn ID',
    () async {
      final t = ReasoningTransport()..history = history('completed');
      final d = await reasoningDesktop(t);
      t.readGate = Completer();
      final reading = d.openThread({'id': 'thread'}, readOnlyNavigation: true);
      await Future<void>.delayed(Duration.zero);
      t.events.add({
        'method': 'thread/status/changed',
        'params': {
          'threadId': 'thread',
          'status': {'type': 'pending'},
        },
      });
      expect(d.selectedResponseFooter.pending, isTrue);
      expect(d.selectedResponseFooter.outcomes.keys, ['turn']);
      t.readGate!.complete({'thread': history('completed')});
      await reading;
      expect(d.selectedResponseFooter.suppressesLatest, isTrue);
      d.dispose();
    },
  );

  test(
    'interrupt return is pending until an actual terminal observation',
    () async {
      final t = ReasoningTransport()..history = history('running');
      final d = await reasoningDesktop(t);
      await d.stop();
      expect(d.selectedResponseFooter.interrupting, contains('turn'));
      expect(
        d.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.running,
      );
      reasoningEvent(
        t,
        'turn/completed',
        extra: {
          'turn': {'id': 'turn', 'status': 'stopped'},
        },
      );
      expect(d.selectedResponseFooter.interrupting, isEmpty);
      expect(
        d.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.stopped,
      );
      d.dispose();
    },
  );

  test(
    'status-less completed event stays unknown despite clear active ID',
    () async {
      final t = ReasoningTransport()..history = history('running');
      final d = await reasoningDesktop(t);
      t.readGate = Completer();
      reasoningEvent(t, 'turn/completed');
      expect(d.turnId, isNull);
      expect(
        d.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.unknown,
      );
      t.readGate!.complete({'thread': history(null)});
      await Future<void>.delayed(Duration.zero);
      expect(
        d.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.unknown,
      );
      d.dispose();
    },
  );

  test(
    'background equal turn IDs remain separate and do not move selection',
    () async {
      final t = ReasoningTransport()..history = history('completed');
      final d = await reasoningDesktop(t);
      reasoningEvent(
        t,
        'turn/completed',
        thread: 'other',
        extra: {'status': 'cancelled'},
      );
      expect(d.thread?['id'], 'thread');
      expect(
        d.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.completed,
      );
      t.history = {'id': 'other', 'turns': []};
      await d.openThread({'id': 'other'}, readOnlyNavigation: true);
      expect(
        d.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.stopped,
      );
      d.dispose();
    },
  );

  for (final boundary in [
    'pin',
    'mac',
    'cache',
    'session',
    'disconnect',
    'suspend',
    'forget',
    'dispose',
  ]) {
    test(
      '$boundary invalidates selected lifecycle authority and pending reads',
      () async {
        final t = ReasoningTransport()..history = history('completed');
        final d = await reasoningDesktop(t);
        t.readGate = Completer();
        final reading = d.openThread({
          'id': 'thread',
        }, readOnlyNavigation: true);
        await Future<void>.delayed(Duration.zero);
        switch (boundary) {
          case 'pin':
            d.active = const Pairing({
              'macDeviceId': 'mac-a',
              'sessionId': 'secure-a',
              'macIdentityPublicKey': 'other-pin',
            });
          case 'mac':
            d.active = const Pairing({
              'macDeviceId': 'other-mac',
              'sessionId': 'secure-a',
              'macIdentityPublicKey': 'trusted-pin',
            });
          case 'cache':
            d.threadList.data = ThreadLocalState();
          case 'session':
            t.session = 'other-session';
          case 'disconnect':
            await d.disconnect();
          case 'suspend':
            d.suspend();
          case 'forget':
            await d.forget(reasoningPair);
          case 'dispose':
            d.dispose();
        }
        t.readGate!.complete({'thread': history('completed')});
        await reading;
        expect(d.selectedResponseFooter.outcomes, isEmpty);
        if (boundary != 'dispose') d.dispose();
      },
    );
  }

  test(
    'reconnect has no cached outcome and stale session cannot grant one',
    () async {
      final t = ReasoningTransport()..history = history('completed');
      final d = await reasoningDesktop(t);
      await d.disconnect();
      t.history = {'id': 'thread', 'turns': []};
      await d.connect(reasoningPair);
      await d.openThread({'id': 'thread'}, readOnlyNavigation: true);
      expect(
        d.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.unknown,
      );
      t.events.add({
        'method': 'turn/completed',
        '_sessionId': 'stale',
        'params': {
          'threadId': 'thread',
          'turnId': 'turn',
          'status': 'completed',
        },
      });
      expect(
        d.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.unknown,
      );
      reasoningEvent(t, 'turn/completed', extra: {'status': 'stopped'});
      reasoningEvent(t, 'turn/started', extra: {'djlReplayedEvent': true});
      reasoningEvent(
        t,
        'turn/completed',
        extra: {'status': 'completed', 'djlReplayedEvent': true},
      );
      expect(
        d.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.stopped,
      );
      reasoningEvent(t, 'turn/started', turn: 'new');
      reasoningEvent(
        t,
        'turn/completed',
        turn: 'new',
        extra: {'status': 'completed'},
      );
      expect(
        d.selectedResponseFooter.outcome('new'),
        DesktopResponseOutcome.completed,
      );
      d.dispose();
    },
  );
}
