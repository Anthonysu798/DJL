import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_response_footer.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_active_turn_snapshot_test.dart'
    show ActiveSnapshotTransport, connectedSnapshot;

class StopRecoveryTransport extends ActiveSnapshotTransport {
  final interrupts = <Object>[];
  final interruptStarted = Completer<void>();
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method != 'turn/interrupt') {
      return super.request(method, params, timeout: timeout);
    }
    calls.add({'method': method, 'params': params});
    if (!interruptStarted.isCompleted) interruptStarted.complete();
    if (interrupts.isEmpty) return {};
    final next = interrupts.removeAt(0);
    if (next is Completer<RemoteJson>) return next.future;
    if (next is RemoteJson) return next;
    throw next;
  }
}

void stopStart(StopRecoveryTransport t, {String thread = 't1', String? turn}) =>
    t.events.add({
      'method': 'turn/started',
      'params': {
        'threadId': thread,
        'turn': {'id': ?turn, 'status': 'inProgress'},
      },
    });

Future<DesktopController> stopDesktop(
  StopRecoveryTransport t, {
  String? turn = 'live',
}) async {
  final d = await connectedSnapshot(t);
  d.turnId = turn;
  stopStart(t, turn: turn);
  t.calls.clear();
  return d;
}

const stopPage = <String, dynamic>{
  'data': [
    {'id': 'live', 'status': 'inProgress'},
  ],
};

void main() {
  test(
    'refreshed real target may use one source legacy parameter fallback',
    () async {
      final t = StopRecoveryTransport()
        ..interrupts.addAll([
          const RemoteRpcException(-32000, 'turn not found', null),
          const RemoteRpcException(
            -32600,
            'invalid request: missing turn_id',
            null,
          ),
          <String, dynamic>{},
        ])
        ..pages.add(stopPage);
      final d = await stopDesktop(t, turn: 'stale');
      addTearDown(d.dispose);
      await d.stop();
      expect(t.calls.map((row) => row['method']), [
        'turn/interrupt',
        'thread/turns/list',
        'turn/interrupt',
        'turn/interrupt',
      ]);
      expect(
        t.calls
            .where((row) => row['method'] == 'turn/interrupt')
            .map((row) => row['params']),
        [
          {'threadId': 't1', 'turnId': 'stale'},
          {'threadId': 't1', 'turnId': 'live'},
          {'thread_id': 't1', 'turn_id': 'live'},
        ],
      );
      expect(d.error, isNull);
    },
  );

  test(
    'owned terminal event retires cached active root eligibility immediately',
    () async {
      final t = StopRecoveryTransport()
        ..reads.add({
          'thread': {
            'id': 't1',
            'cwd': '/qa',
            'status': {'type': 'idle'},
            'turns': [
              {'id': 'live', 'status': 'interrupted'},
            ],
          },
        });
      final d = await stopDesktop(t);
      d.thread!['status'] = {'type': 'active'};
      addTearDown(d.dispose);
      t.events.add({
        'method': 'turn/completed',
        'params': {
          'threadId': 't1',
          'turn': {'id': 'live', 'status': 'interrupted'},
        },
      });
      expect(d.shouldQueueComposer, isFalse);
    },
  );

  test(
    'an older terminal event cannot retire a newer ID-less active root',
    () async {
      final t = StopRecoveryTransport()
        ..reads.add({
          'thread': {
            'id': 't1',
            'cwd': '/qa',
            'status': {'type': 'active'},
            'turns': [
              {'id': 'live', 'status': 'interrupted'},
              {'status': 'running'},
            ],
          },
        });
      final d = await stopDesktop(t);
      d.thread!['status'] = {'type': 'active'};
      addTearDown(d.dispose);
      stopStart(t);
      t.events.add({
        'method': 'turn/completed',
        'params': {
          'threadId': 't1',
          'turn': {'id': 'live', 'status': 'interrupted'},
        },
      });
      expect(d.selectedResponseFooter.pending, isTrue);
      expect(d.shouldQueueComposer, isTrue);
    },
  );

  for (final message in [
    'already completed',
    'no active turn',
    'not running',
    'turn not found',
    'already finished',
    'not active',
  ]) {
    test(
      'terminal stale Stop "$message" retires eligibility without invented work success',
      () async {
        final t = StopRecoveryTransport()
          ..interrupts.add(RemoteRpcException(-32000, message, null))
          ..pages.add({
            'data': [
              {'id': 'live', 'status': 'completed'},
            ],
          });
        final d = await stopDesktop(t);
        addTearDown(d.dispose);
        await d.stop();
        expect(d.turnId, isNull);
        expect(d.selectedResponseFooter.suppressesLatest, isFalse);
        expect(
          d.selectedResponseFooter.outcome('live'),
          message == 'already completed'
              ? DesktopResponseOutcome.completed
              : DesktopResponseOutcome.unknown,
        );
        expect(d.error, isNull);
        expect(t.calls.map((row) => row['method']), [
          'turn/interrupt',
          'thread/turns/list',
        ]);
      },
    );
  }

  test(
    'fresh unpublished run after stale Stop drops only the old ID and stays pending',
    () async {
      final t = StopRecoveryTransport()
        ..interrupts.add(
          const RemoteRpcException(-32000, 'no active turn', null),
        )
        ..pages.addAll(
          List.generate(
            3,
            (_) => <String, dynamic>{
              'data': [
                {'status': 'inProgress'},
              ],
            },
          ),
        );
      final d = await stopDesktop(t, turn: 'stale');
      addTearDown(d.dispose);
      await d.stop();
      expect(d.turnId, isNull);
      expect(d.selectedResponseFooter.pending, isTrue);
      expect(
        d.selectedResponseFooter.outcome('stale'),
        DesktopResponseOutcome.unknown,
      );
      expect(d.error, contains('not published'));
      expect(
        t.calls.where((row) => row['method'] == 'turn/interrupt'),
        hasLength(1),
      );
      expect(
        t.calls.where((row) => row['method'] == 'thread/turns/list'),
        hasLength(3),
      );
    },
  );

  for (final failure in ['unknown method', 'strict parameters']) {
    test(
      'definite $failure rejection cannot leave a false stopping marker',
      () async {
        final t = StopRecoveryTransport();
        if (failure == 'unknown method') {
          t.interrupts.add(
            const RemoteRpcException(-32601, 'Unknown method', null),
          );
        } else {
          t.interrupts.addAll([
            const RemoteRpcException(-32602, 'missing field turn_id', null),
            const RemoteRpcException(-32602, 'unknown field turn_id', null),
          ]);
        }
        final d = await stopDesktop(t);
        addTearDown(d.dispose);
        await d.stop();
        expect(d.selectedResponseFooter.interrupting, isEmpty);
        expect(
          d.selectedResponseFooter.outcome('live'),
          DesktopResponseOutcome.running,
        );
        expect(d.error, isNotNull);
      },
    );
  }

  test(
    'canonical active thread metadata keeps an ID-less Stop reachable',
    () async {
      final t = StopRecoveryTransport()..pages.add(stopPage);
      final d = await connectedSnapshot(t);
      d.thread = {
        'id': 't1',
        'cwd': '/qa',
        'status': {'type': 'active'},
      };
      d.turnId = null;
      addTearDown(d.dispose);
      await d.stop();
      expect(t.calls.map((row) => row['method']), [
        'thread/turns/list',
        'turn/interrupt',
      ]);
      expect(t.calls.last['params']['turnId'], 'live');
    },
  );

  test(
    'fresh active root metadata cannot clear a newer unpublished run behind old completed history',
    () async {
      final t = StopRecoveryTransport()
        ..interrupts.add(
          const RemoteRpcException(-32000, 'no active turn', null),
        )
        ..pages.add(const RemoteRpcException(-32601, 'Unknown method', null))
        ..reads.addAll(
          List.generate(
            3,
            (_) => <String, dynamic>{
              'thread': {
                'id': 't1',
                'cwd': '/qa',
                'status': {'type': 'active'},
                'turns': [
                  {'id': 'older-completed', 'status': 'completed'},
                ],
              },
            },
          ),
        );
      final d = await stopDesktop(t, turn: 'stale');
      addTearDown(d.dispose);
      await d.stop();
      expect(d.turnId, isNull);
      expect(d.selectedResponseFooter.pending, isTrue);
      expect(d.error, contains('not published'));
      expect(
        t.calls.where((row) => row['method'] == 'turn/interrupt'),
        hasLength(1),
      );
    },
  );

  test(
    'known real Stop preserves its existing single camelCase packet',
    () async {
      final t = StopRecoveryTransport();
      final d = await stopDesktop(t);
      addTearDown(d.dispose);
      await d.stop();
      expect(t.calls, [
        {
          'method': 'turn/interrupt',
          'params': {'threadId': 't1', 'turnId': 'live'},
        },
      ]);
      expect(
        d.selectedResponseFooter.outcome('live'),
        DesktopResponseOutcome.running,
      );
      expect(
        d.turnId,
        'live',
        reason: 'An interrupt acknowledgement is not a completion event.',
      );
    },
  );

  test(
    'Stop resolves a published target for the owned ID-less pending run',
    () async {
      final t = StopRecoveryTransport()..pages.add(stopPage);
      final d = await stopDesktop(t, turn: null);
      addTearDown(d.dispose);
      expect(d.selectedResponseFooter.pending, isTrue);
      await d.stop();
      expect(t.calls.map((row) => row['method']), [
        'thread/turns/list',
        'turn/interrupt',
      ]);
      expect(t.calls.last['params'], {'threadId': 't1', 'turnId': 'live'});
      expect(d.error, isNull);
    },
  );

  test(
    'Stop resolves a bridge placeholder instead of sending it as a target',
    () async {
      final t = StopRecoveryTransport()..pages.add(stopPage);
      final d = await stopDesktop(t, turn: 'rollout-stale');
      addTearDown(d.dispose);
      await d.stop();
      expect(t.calls.map((row) => row['method']), [
        'thread/turns/list',
        'turn/interrupt',
      ]);
      expect(t.calls.last['params'], {'threadId': 't1', 'turnId': 'live'});
    },
  );

  test(
    'strict legacy Stop retries snake_case only after explicit invalid parameters',
    () async {
      final t = StopRecoveryTransport()
        ..interrupts.addAll([
          const RemoteRpcException(-32602, 'missing field turn_id', null),
          <String, dynamic>{},
        ]);
      final d = await stopDesktop(t);
      addTearDown(d.dispose);
      await d.stop();
      expect(t.calls.map((row) => row['params']), [
        {'threadId': 't1', 'turnId': 'live'},
        {'thread_id': 't1', 'turn_id': 'live'},
      ]);
      expect(d.error, isNull);
    },
  );

  test('explicit stale Stop refreshes a different target once', () async {
    final t = StopRecoveryTransport()
      ..interrupts.addAll([
        const RemoteRpcException(-32000, 'turn not found', null),
        <String, dynamic>{},
      ])
      ..pages.add(stopPage);
    final d = await stopDesktop(t, turn: 'stale');
    addTearDown(d.dispose);
    await d.stop();
    expect(t.calls.map((row) => row['method']), [
      'turn/interrupt',
      'thread/turns/list',
      'turn/interrupt',
    ]);
    expect(t.calls.last['params'], {'threadId': 't1', 'turnId': 'live'});
    expect(d.error, isNull);
  });

  test(
    'repeated Stop while its owned packet is pending emits one interrupt',
    () async {
      final reply = Completer<RemoteJson>();
      final t = StopRecoveryTransport()..interrupts.add(reply);
      final d = await stopDesktop(t);
      addTearDown(d.dispose);
      final first = d.stop();
      await t.interruptStarted.future;
      await d.stop();
      final beforeReply = t.calls
          .where((row) => row['method'] == 'turn/interrupt')
          .toList();
      reply.complete({});
      await first;
      expect(beforeReply, hasLength(1));
    },
  );

  test(
    'a resolved bridge alias cannot suppress output after its real run settles',
    () async {
      final t = StopRecoveryTransport()
        ..pages.add(stopPage)
        ..responses.add({'turnId': 'live'})
        ..reads.add({
          'thread': {
            'id': 't1',
            'cwd': '/qa',
            'turns': [
              {'id': 'live', 'status': 'interrupted', 'items': []},
            ],
          },
        });
      final d = await stopDesktop(t, turn: 'rollout-stale');
      addTearDown(d.dispose);
      expect(await d.send('owned manual follow-up'), isTrue, reason: d.error);
      t.events.add({
        'method': 'turn/completed',
        'params': {
          'threadId': 't1',
          'turn': {'id': 'live', 'status': 'interrupted'},
        },
      });
      await Future<void>.delayed(Duration.zero);
      expect(d.turnId, isNull);
      expect(d.selectedResponseFooter.suppressesLatest, isFalse);
      expect(
        d.selectedResponseFooter.outcome('rollout-stale'),
        DesktopResponseOutcome.unknown,
      );
    },
  );

  test(
    'a settled turn ID in one chat does not suppress the same ID in another',
    () async {
      final t = StopRecoveryTransport()
        ..reads.add({
          'thread': {
            'id': 't1',
            'cwd': '/qa',
            'turns': [
              {'id': 'ipc-turn-0', 'status': 'interrupted', 'items': []},
            ],
          },
        });
      final d = await stopDesktop(t, turn: 'ipc-turn-0');
      addTearDown(d.dispose);
      t.events.add({
        'method': 'turn/completed',
        'params': {
          'threadId': 't1',
          'turn': {'id': 'ipc-turn-0', 'status': 'interrupted'},
        },
      });
      await Future<void>.delayed(Duration.zero);
      d.thread = {'id': 'other', 'cwd': '/qa'};
      d.turnId = null;
      stopStart(t, thread: 'other', turn: 'ipc-turn-0');
      expect(d.turnId, 'ipc-turn-0');
      expect(
        d.selectedResponseFooter.latestOutcome,
        DesktopResponseOutcome.running,
      );
    },
  );

  test(
    'uncertain Stop result never retries or invents successful work',
    () async {
      final t = StopRecoveryTransport()
        ..interrupts.add(TimeoutException('interrupt reply lost'));
      final d = await stopDesktop(t);
      addTearDown(d.dispose);
      await d.stop();
      expect(t.calls.map((row) => row['method']), ['turn/interrupt']);
      expect(d.turnId, 'live');
      expect(
        d.selectedResponseFooter.outcome('live'),
        DesktopResponseOutcome.running,
      );
      expect(d.error, contains('reply lost'));
    },
  );
}
