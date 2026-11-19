import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_composer_send_test.dart' show MixedTransport, setup, mixed;

const staleTurn = RemoteRpcException(
  -32000,
  'expected active turn id live but found stale',
  null,
);

class SteerRecoveryTransport extends MixedTransport {
  SteerRecoveryTransport({PairingRepository? pairings})
    : super(pairings ?? PairingRepository(TestCredentials()));
  final reads = <Object>[];
  final readStarted = Completer<void>();
  final retryStarted = Completer<void>();
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'thread/turns/list') {
      calls.add({'method': method, 'params': params});
      throw const RemoteRpcException(
        -32601,
        'Unknown method thread/turns/list',
        null,
      );
    }
    if (method != 'thread/read') {
      if (method == 'turn/steer' &&
          calls.any((call) => call['method'] == 'turn/steer') &&
          !retryStarted.isCompleted) {
        retryStarted.complete();
      }
      return super.request(method, params, timeout: timeout);
    }
    calls.add({'method': method, 'params': params});
    if (!readStarted.isCompleted) readStarted.complete();
    final next = reads.removeAt(0);
    if (next is Completer<RemoteJson>) return next.future;
    if (next is RemoteJson) return next;
    throw next;
  }
}

RemoteJson history(List<RemoteJson> turns, {String thread = 't1'}) => {
  'thread': {
    'id': thread,
    'model': 'qa',
    'modelProvider': 'codex',
    'turns': turns,
  },
};
RemoteJson liveHistory() => history([
  {'id': 'old', 'status': 'completed'},
  {'id': 'live', 'status': 'inProgress'},
]);

void main() {
  test(
    'canonical echo before retry acknowledgement replaces the existing message once',
    () async {
      final reply = Completer<RemoteJson>();
      final transport = SteerRecoveryTransport()
        ..responses.addAll([staleTurn, reply])
        ..reads.add(liveHistory());
      final desktop = setup(transport)..turnId = 'stale';
      final sending = desktop.send('follow the live run');
      await transport.retryStarted.future.timeout(const Duration(seconds: 2));
      transport.events.add({
        'method': 'item/started',
        'params': {
          'threadId': 't1',
          'turnId': 'live',
          'item': {
            'id': 'canonical-user',
            'type': 'userMessage',
            'content': [
              {'type': 'text', 'text': 'follow the live run'},
            ],
          },
        },
      });
      final visibleIds = desktop.timeline.map((row) => row['id']).toList();
      reply.complete({'turnId': 'live'});
      expect(await sending, isTrue);
      expect(visibleIds, ['canonical-user']);
      expect(desktop.timeline.single['id'], 'canonical-user');
      expect(desktop.timeline.single['turnId'], 'live');
      desktop.dispose();
    },
  );
  test(
    'rejected stale steer refreshes once and Stop owns the accepted run',
    () async {
      final transport = SteerRecoveryTransport()
        ..responses.addAll([
          staleTurn,
          <String, dynamic>{'turnId': 'live'},
        ])
        ..reads.add(liveHistory());
      final desktop = setup(transport)..turnId = 'stale';
      expect(await desktop.send('follow the live run'), isTrue);
      expect(transport.calls.map((c) => c['method']), [
        'turn/steer',
        'thread/turns/list',
        'thread/read',
        'turn/steer',
      ]);
      expect((transport.calls.last['params'] as Map)['expectedTurnId'], 'live');
      expect(desktop.timeline, hasLength(1));
      expect(desktop.timeline.single['delivery'], 'confirmed');
      expect(desktop.timeline.single['turnId'], 'live');
      expect(desktop.turnId, 'live');
      await desktop.stop();
      expect((transport.calls.last['params'] as Map)['turnId'], 'live');
      desktop.dispose();
    },
  );

  for (final placeholder in [
    'turn-line-7',
    'rollout-live',
    'djl-history-compacted-7',
  ]) {
    test('resolves $placeholder before sending an actionable steer', () async {
      final transport = SteerRecoveryTransport()
        ..reads.add(liveHistory())
        ..responses.add(<String, dynamic>{});
      final desktop = setup(transport)..turnId = placeholder;
      expect(await desktop.send('resolved follow-up'), isTrue);
      expect(transport.calls.map((c) => c['method']), [
        'thread/turns/list',

        'thread/read',
        'turn/steer',
      ]);
      expect((transport.calls.last['params'] as Map)['expectedTurnId'], 'live');
      expect(desktop.turnId, 'live');
      expect(desktop.timeline.single['turnId'], 'live');
      desktop.dispose();
    });
  }

  for (final (name, snapshot) in [
    (
      'compaction marker',
      history([
        {'id': 'live', 'status': 'inProgress'},
        {'id': 'djl-history-compacted-banner'},
      ]),
    ),
    (
      'legacy ID without status',
      history([
        {'turnId': 'live'},
      ]),
    ),
    (
      'structured status and snake ID',
      history([
        {
          'turn_id': 'live',
          'status': {'type': 'in_progress'},
        },
      ]),
    ),
  ]) {
    test(
      'active ID snapshot accepts $name without steering a marker',
      () async {
        final transport = SteerRecoveryTransport()
          ..reads.add(snapshot)
          ..responses.add(<String, dynamic>{});
        final desktop = setup(transport)..turnId = 'turn-line-7';
        expect(await desktop.send('resolved follow-up'), isTrue);
        expect(
          (transport.calls.last['params'] as Map)['expectedTurnId'],
          'live',
        );
        expect(desktop.timeline.single['turnId'], 'live');
        desktop.dispose();
      },
    );
  }

  for (final failure in [
    TimeoutException('expected active turn reply lost'),
    StateError('Disconnected'),
    const RemoteRpcException(-32000, 'input file does not exist', null),
  ]) {
    test(
      'unknown or unrelated steer outcome never refreshes or resends: $failure',
      () async {
        final transport = SteerRecoveryTransport()..responses.add(failure);
        final desktop = setup(transport)..turnId = 'stale';
        desktop.threadList.data.setComposerDraft('t1', mixed());
        expect(await desktop.sendDraft(mixed()), isFalse);
        expect(transport.calls.map((c) => c['method']), ['turn/steer']);
        expect(
          desktop.threadList.data.composerDraft('t1').images,
          hasLength(1),
        );
        desktop.dispose();
      },
    );
  }

  for (final snapshot in [
    history([
      {'id': 'stale', 'status': 'inProgress'},
    ]),
    history([
      {'id': 'older-live', 'status': 'inProgress'},
      {'id': 'latest-done', 'status': 'completed'},
    ]),
    history([
      {'id': 'live', 'status': 'inProgress'},
    ], thread: 'other'),
  ]) {
    test(
      'unchanged, terminal-boundary or wrong-thread snapshot cannot resend $snapshot',
      () async {
        final transport = SteerRecoveryTransport()
          ..responses.add(staleTurn)
          ..reads.add(snapshot);
        final desktop = setup(transport)..turnId = 'stale';
        expect(await desktop.send('preserve this draft'), isFalse);
        expect(transport.calls.map((c) => c['method']), [
          'turn/steer',
          'thread/turns/list',
          'thread/read',
        ]);
        expect(desktop.turnId, 'stale');
        expect(desktop.timeline.single['delivery'], 'unknown');
        desktop.dispose();
      },
    );
  }

  test('a second explicit rejection never causes a third steer', () async {
    final transport = SteerRecoveryTransport()
      ..responses.addAll([staleTurn, staleTurn])
      ..reads.add(liveHistory());
    final desktop = setup(transport)..turnId = 'stale';
    expect(await desktop.send('bounded retry'), isFalse);
    expect(transport.calls.map((c) => c['method']), [
      'turn/steer',
      'thread/turns/list',
      'thread/read',
      'turn/steer',
    ]);
    expect(desktop.timeline, hasLength(1));
    expect(desktop.timeline.single['delivery'], 'unknown');
    desktop.dispose();
  });

  test(
    'unpublished synthetic run ID has three bounded reads and no mutation',
    () async {
      final pending = history([
        {'status': 'inProgress'},
      ]);
      final transport = SteerRecoveryTransport()
        ..reads.addAll([pending, pending, pending]);
      final desktop = setup(transport)..turnId = 'turn-line-7';
      expect(await desktop.send('wait for a real run ID'), isFalse);
      expect(transport.calls.map((c) => c['method']), [
        'thread/turns/list',

        'thread/read',
        'thread/read',
        'thread/read',
      ]);
      expect(desktop.turnId, 'turn-line-7');
      desktop.dispose();
    },
  );

  test(
    'published ID after one bounded read binds the existing optimistic message',
    () async {
      final transport = SteerRecoveryTransport()
        ..reads.addAll([
          history([
            {'status': 'inProgress'},
          ]),
          liveHistory(),
        ])
        ..responses.add(<String, dynamic>{});
      final desktop = setup(transport)..turnId = 'turn-line-7';
      expect(await desktop.send('wait for publication'), isTrue);
      expect(transport.calls.map((c) => c['method']), [
        'thread/turns/list',

        'thread/read',
        'thread/read',
        'turn/steer',
      ]);
      expect(desktop.timeline.single['turnId'], 'live');
      desktop.dispose();
    },
  );

  for (final change in ['thread', 'turn', 'device']) {
    test(
      '$change change during active-ID refresh prevents retry or ownership overwrite',
      () async {
        final gate = Completer<RemoteJson>();
        final transport = SteerRecoveryTransport()
          ..responses.add(staleTurn)
          ..reads.add(gate);
        final desktop = setup(transport)..turnId = 'stale';
        final sending = desktop.send('keep the original owner');
        await transport.readStarted.future.timeout(const Duration(seconds: 2));
        if (change == 'thread') desktop.thread = {'id': 'other'};
        if (change == 'device') {
          desktop.active = Pairing({
            'macDeviceId': 'other',
            'macIdentityPublicKey': 'other-pin',
          });
        }
        desktop.turnId = change == 'turn' ? null : 'other-live';
        gate.complete(liveHistory());
        expect(await sending, isFalse);
        expect(transport.calls.map((c) => c['method']), [
          'turn/steer',
          'thread/turns/list',
          'thread/read',
        ]);
        expect(desktop.turnId, change == 'turn' ? null : 'other-live');
        desktop.dispose();
      },
    );
  }

  test(
    'active-ID retry preserves mixed input compatibility and a missing reply ID',
    () async {
      final transport = SteerRecoveryTransport()
        ..responses.addAll([
          staleTurn,
          const RemoteRpcException(
            -32602,
            'Missing input image_url field',
            null,
          ),
          <String, dynamic>{},
        ])
        ..reads.add(liveHistory());
      final desktop = setup(transport)..turnId = 'stale';
      expect(await desktop.sendDraft(mixed()), isTrue);
      expect(desktop.turnId, 'live');
      expect(desktop.timeline, hasLength(1));
      expect(desktop.timeline.single['turnId'], 'live');
      final params = transport.calls.last['params'] as Map;
      expect(params['expectedTurnId'], 'live');
      expect((params['input'] as List).first, {
        'type': 'image',
        'image_url': 'data:image/jpeg;base64,YQ==',
      });
      expect(
        transport.calls.where((c) => c['method'] == 'turn/start'),
        isEmpty,
      );
      desktop.dispose();
    },
  );
}
