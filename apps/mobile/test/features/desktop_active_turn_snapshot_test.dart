import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'desktop_composer_send_test.dart' show setup;
import 'desktop_recovery_test.dart' show RecoveryMemoryStore;
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_steer_recovery_test.dart'
    show SteerRecoveryTransport, liveHistory;

class SnapshotPairings extends PairingRepository {
  SnapshotPairings() : super(TestCredentials());
  @override
  Future<List<Pairing>> trusted() async => [snapshotPair];
}

class ActiveSnapshotTransport extends SteerRecoveryTransport {
  ActiveSnapshotTransport() : super(pairings: SnapshotPairings());
  final pages = <Object>[];
  final initializeReplies = <Object>[];
  String? agent, mac, session;
  String agentField = 'userAgent';
  @override
  String? get macDeviceId => mac;
  @override
  String? get sessionId => session;
  @override
  Future<void> connect(Pairing pair, {required bool bootstrap}) async {
    mac = pair.macDeviceId;
    session = pair.sessionId;
  }

  @override
  Future<void> disconnect() async {}
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'initialize') {
      calls.add({'method': method, 'params': params});
      if (initializeReplies.isNotEmpty) {
        final next = initializeReplies.removeAt(0);
        if (next is RemoteJson) return next;
        throw next;
      }
      return {if (agent != null) agentField: agent};
    }
    if ({
      'thread/list',
      'model/list',
      'project/projectlessRoots',
    }.contains(method)) {
      calls.add({'method': method, 'params': params});
      return {'data': <RemoteJson>[]};
    }
    if (method != 'thread/turns/list') {
      return super.request(method, params, timeout: timeout);
    }
    calls.add({'method': method, 'params': params, 'timeout': timeout});
    final next = pages.removeAt(0);
    if (next is Completer<RemoteJson>) return next.future;
    if (next is RemoteJson) return next;
    throw next;
  }
}

const snapshotPair = Pairing({
  'macDeviceId': 'mac-a',
  'macIdentityPublicKey': 'pin-a',
  'sessionId': 'session-a',
});

Future<DesktopController> connectedSnapshot(ActiveSnapshotTransport t) async {
  final d = DesktopController(
    t.pairings,
    connection: t,
    localStore: RecoveryMemoryStore(),
  );
  await d.connect(snapshotPair, resolve: false);
  expect(d.state, 'connected', reason: d.error);
  d.thread = {'id': 't1', 'cwd': '/qa'};
  d.model = 'qa';
  d.turnId = 'turn-line-bridge';
  t.calls.clear();
  return d;
}

void main() {
  test(
    'legacy initialize capability fallback still learns the old agent version',
    () async {
      final t = ActiveSnapshotTransport()
        ..initializeReplies.addAll([
          const RemoteRpcException(
            -32602,
            'experimental capabilities unsupported',
            null,
          ),
          {'user_agent': 'codex_cli_rs/0.124.0'},
        ])
        ..reads.add(liveHistory())
        ..responses.add({'turnId': 'live'});
      final d = await connectedSnapshot(t);
      addTearDown(d.dispose);
      expect(await d.send('old initialize shape'), isTrue, reason: d.error);
      expect(t.calls.map((row) => row['method']), [
        'thread/read',
        'turn/steer',
      ]);
    },
  );

  for (final agent in [
    'codex_cli_rs/0.125.0',
    'codex_cli_rs/1.0.0',
    'other/0.1.0',
    'codex_cli_rs/invalid',
  ]) {
    test(
      'supported or unrecognized agent $agent probes the source turn page',
      () async {
        final t = ActiveSnapshotTransport()
          ..agent = agent
          ..pages.add({
            'data': [
              {'id': 'live', 'status': 'running'},
            ],
          })
          ..responses.add({'turnId': 'live'});
        final d = await connectedSnapshot(t);
        addTearDown(d.dispose);
        expect(await d.send('version probe'), isTrue, reason: d.error);
        expect(t.calls.map((row) => row['method']), [
          'thread/turns/list',
          'turn/steer',
        ]);
      },
    );
  }

  for (final unsupported in <Object>[
    const RemoteRpcException(-32601, 'Unknown method', null),
    <String, dynamic>{'acknowledged': true},
  ]) {
    test(
      'unsupported page $unsupported falls back only once in a connection',
      () async {
        final t = ActiveSnapshotTransport()
          ..pages.add(unsupported)
          ..reads.addAll([liveHistory(), liveHistory()]);
        final d = setup(t)..turnId = 'turn-line-bridge';
        addTearDown(d.dispose);
        expect(await d.send('first lookup'), isTrue, reason: d.error);
        d.turnId = 'turn-line-bridge';
        expect(await d.send('second lookup'), isTrue, reason: d.error);
        expect(
          t.calls.where((row) => row['method'] == 'thread/turns/list'),
          hasLength(1),
        );
        expect(
          t.calls.where((row) => row['method'] == 'thread/read'),
          hasLength(2),
        );
      },
    );
  }

  test(
    'fresh materialization fallback does not disable a later supported page',
    () async {
      final t = ActiveSnapshotTransport()
        ..pages.addAll([
          const RemoteRpcException(
            -32000,
            'thread is not yet materialized',
            null,
          ),
          {
            'data': [
              {'id': 'live', 'status': 'running'},
            ],
          },
        ])
        ..reads.add(liveHistory());
      final d = setup(t)..turnId = 'turn-line-bridge';
      addTearDown(d.dispose);
      expect(
        await d.send('first materialization lookup'),
        isTrue,
        reason: d.error,
      );
      d.turnId = 'turn-line-bridge';
      expect(await d.send('later supported lookup'), isTrue, reason: d.error);
      expect(
        t.calls.where((row) => row['method'] == 'thread/turns/list'),
        hasLength(2),
      );
      expect(
        t.calls.where((row) => row['method'] == 'thread/read'),
        hasLength(1),
      );
    },
  );

  for (final page in <Object>[
    {
      'threadId': 'foreign',
      'data': [
        {'id': 'live'},
      ],
    },
    {
      'thread_id': 'foreign',
      'data': [
        {'id': 'live'},
      ],
    },
    {
      'data': [null],
    },
    const RemoteRpcException(-32000, 'permission denied', null),
    TimeoutException('page reply lost'),
  ]) {
    test(
      'malformed foreign or failed page $page cannot fall through to a mutation',
      () async {
        final t = ActiveSnapshotTransport()..pages.add(page);
        final d = setup(t)..turnId = 'turn-line-bridge';
        addTearDown(d.dispose);
        expect(await d.send('must remain unsent'), isFalse);
        expect(t.calls.map((row) => row['method']), ['thread/turns/list']);
      },
    );
  }

  for (final rejection in <Object>[
    const RemoteRpcException(-32000, 'invalid thread_id', null),
    const RemoteRpcException(-32602, 'permission denied', null),
    TimeoutException('legacy read lost'),
  ]) {
    test(
      'legacy read $rejection does not authorize a compatibility retry',
      () async {
        final t = ActiveSnapshotTransport()
          ..pages.add(const RemoteRpcException(-32601, 'Unknown method', null))
          ..reads.add(rejection);
        final d = setup(t)..turnId = 'turn-line-bridge';
        addTearDown(d.dispose);
        expect(await d.send('must remain unsent'), isFalse);
        expect(t.calls.map((row) => row['method']), [
          'thread/turns/list',
          'thread/read',
        ]);
      },
    );
  }

  for (final row in <RemoteJson>[
    {'turnId': ' live ', 'turnStatus': 'running'},
    {'turn_id': 'live', 'turn_status': 'pending'},
    {
      'id': 'live',
      'status': {'status_type': 'inProgress'},
    },
    {'id': 'live', 'status': 'future-executing-status'},
  ]) {
    test(
      'source aliases and nonterminal unknown status $row retain the target',
      () async {
        final t = ActiveSnapshotTransport()
          ..pages.add({
            'data': [row],
          })
          ..responses.add({'turnId': 'live'});
        final d = setup(t)..turnId = 'turn-line-bridge';
        addTearDown(d.dispose);
        expect(await d.send('alias lookup'), isTrue, reason: d.error);
        expect(t.calls.last['params']['expectedTurnId'], 'live');
      },
    );
  }

  for (final change in ['folder', 'pin', 'session']) {
    test(
      'late page after $change ownership change cannot issue Steer',
      () async {
        final reply = Completer<RemoteJson>();
        final t = ActiveSnapshotTransport()..pages.add(reply);
        final d = await connectedSnapshot(t);
        addTearDown(d.dispose);
        final sending = d.send('old owner lookup');
        await Future<void>.delayed(Duration.zero);
        if (change == 'folder') {
          d.thread = {'id': 't1', 'cwd': '/another'};
        } else if (change == 'pin') {
          d.active = const Pairing({
            'macDeviceId': 'mac-a',
            'macIdentityPublicKey': 'new-pin',
            'sessionId': 'session-a',
          });
        } else {
          t.session = 'new-session';
        }
        reply.complete({
          'data': [
            {'id': 'live', 'status': 'running'},
          ],
        });
        expect(await sending, isFalse);
        expect(
          t.calls.where(
            (row) => {'turn/start', 'turn/steer'}.contains(row['method']),
          ),
          isEmpty,
        );
      },
    );
  }

  for (final field in ['userAgent', 'user_agent']) {
    test(
      'initialize $field older than source0.125.0 uses legacy target reads',
      () async {
        final t = ActiveSnapshotTransport()
          ..agentField = field
          ..agent = 'codex_cli_rs/0.124.9'
          ..reads.add(liveHistory())
          ..responses.add({'turnId': 'live'});
        final d = await connectedSnapshot(t);
        addTearDown(d.dispose);
        expect(await d.send('old runtime follow-up'), isTrue, reason: d.error);
        expect(t.calls.map((row) => row['method']), [
          'thread/read',
          'turn/steer',
        ]);
      },
    );
  }

  test(
    'a new connection probes again after the old runtime rejected pagination',
    () async {
      final t = ActiveSnapshotTransport()
        ..pages.addAll([
          const RemoteRpcException(-32601, 'Unknown method', null),
          {
            'data': [
              {'id': 'live', 'status': 'running'},
            ],
          },
        ])
        ..reads.add(liveHistory())
        ..responses.add({'turnId': 'live'});
      final d = await connectedSnapshot(t);
      addTearDown(d.dispose);
      expect(await d.send('first connection'), isTrue, reason: d.error);
      await d.connect(snapshotPair, resolve: false);
      d.thread = {'id': 't1', 'cwd': '/qa'};
      d.model = 'qa';
      d.turnId = 'turn-line-bridge';
      t.calls.clear();
      t.reads.add(StateError('New connection should probe its supported page'));
      t.responses.add({'turnId': 'live'});
      expect(await d.send('new connection'), isTrue, reason: d.error);
      expect(t.calls.map((row) => row['method']), [
        'thread/turns/list',
        'turn/steer',
      ]);
    },
  );

  test(
    'strict legacy target read retries snake_case only after explicit parameter rejection',
    () async {
      final t = ActiveSnapshotTransport()
        ..pages.add(const RemoteRpcException(-32601, 'Unknown method', null))
        ..reads.addAll([
          const RemoteRpcException(-32602, 'missing field thread_id', null),
          liveHistory(),
        ])
        ..responses.add({'turnId': 'live'});
      final d = setup(t)..turnId = 'turn-line-bridge';
      addTearDown(d.dispose);
      expect(await d.send('legacy parser follow-up'), isTrue, reason: d.error);
      final reads = t.calls
          .where((row) => row['method'] == 'thread/read')
          .toList();
      expect(reads.map((row) => row['params']), [
        {'threadId': 't1', 'includeTurns': true},
        {'thread_id': 't1', 'include_turns': true},
      ]);
      expect(
        t.calls.where((row) => row['method'] == 'turn/steer'),
        hasLength(1),
      );
    },
  );

  test(
    'foreign project tag on a paged target cannot authorize Steer',
    () async {
      final t = ActiveSnapshotTransport()
        ..pages.add({
          'cwd': '/another-project',
          'data': [
            {'id': 'live', 'status': 'running'},
          ],
        });
      final d = setup(t)
        ..thread = {'id': 't1', 'cwd': '/qa'}
        ..turnId = 'turn-line-bridge';
      addTearDown(d.dispose);
      expect(await d.send('must stay unsent'), isFalse);
      expect(
        t.calls.where(
          (row) => {'turn/start', 'turn/steer'}.contains(row['method']),
        ),
        isEmpty,
      );
    },
  );

  test(
    'late page for another selected chat cannot mutate either run',
    () async {
      final reply = Completer<RemoteJson>();
      final t = ActiveSnapshotTransport()..pages.add(reply);
      final d = setup(t)..turnId = 'turn-line-bridge';
      addTearDown(d.dispose);
      final sending = d.send('owned old chat');
      await Future<void>.delayed(Duration.zero);
      d.thread = {'id': 'other'};
      d.turnId = 'other-running';
      reply.complete({
        'data': [
          {'id': 'live', 'status': 'running'},
        ],
      });
      expect(await sending, isFalse);
      expect(d.turnId, 'other-running');
      expect(
        t.calls.where(
          (row) => {'turn/start', 'turn/steer'}.contains(row['method']),
        ),
        isEmpty,
      );
    },
  );

  test(
    'an unpublished paged run gets only three snapshot attempts and no mutation',
    () async {
      final t = ActiveSnapshotTransport()
        ..pages.addAll(
          List.generate(
            3,
            (_) => <String, dynamic>{
              'data': [
                {'status': 'running'},
              ],
            },
          ),
        );
      final d = setup(t)..turnId = 'turn-line-bridge';
      addTearDown(d.dispose);
      expect(await d.send('must wait for the real target'), isFalse);
      expect(
        t.calls.map((row) => row['method']),
        List.filled(3, 'thread/turns/list'),
      );
      expect(d.error, contains('not published'));
    },
  );

  for (final field in ['data', 'items', 'turns']) {
    test(
      'fresh $field descending page resolves the real target before Steer',
      () async {
        final transport = ActiveSnapshotTransport()
          ..pages.add({
            field: [
              {'id': 'live', 'status': 'inProgress'},
              {'id': 'old', 'status': 'completed'},
            ],
          })
          ..reads.add(StateError('Paged runtime must not use embedded history'))
          ..responses.add({'turnId': 'live'});
        final desktop = setup(transport)..turnId = 'turn-line-bridge';
        addTearDown(desktop.dispose);
        expect(
          await desktop.send('public paged follow-up'),
          isTrue,
          reason: desktop.error,
        );
        expect(transport.calls.map((row) => row['method']), [
          'thread/turns/list',
          'turn/steer',
        ]);
        expect(transport.calls.first['params'], {
          'threadId': 't1',
          'limit': 8,
          'sortDirection': 'desc',
        });
        expect(transport.calls.first['timeout'], const Duration(seconds: 30));
        expect(transport.calls.last['params']['expectedTurnId'], 'live');
        expect(desktop.turnId, 'live');
      },
    );
  }

  test(
    'explicit unsupported page falls back to the owned legacy snapshot',
    () async {
      final transport = ActiveSnapshotTransport()
        ..pages.add(
          const RemoteRpcException(
            -32601,
            'Unknown method thread/turns/list',
            null,
          ),
        )
        ..reads.add(liveHistory())
        ..responses.add({'turnId': 'live'});
      final desktop = setup(transport)..turnId = 'turn-line-bridge';
      addTearDown(desktop.dispose);
      expect(
        await desktop.send('public legacy follow-up'),
        isTrue,
        reason: desktop.error,
      );
      expect(transport.calls.map((row) => row['method']), [
        'thread/turns/list',
        'thread/read',
        'turn/steer',
      ]);
      expect(transport.calls.last['params']['expectedTurnId'], 'live');
    },
  );

  test(
    'latest terminal boundary in descending page never steers an older running row',
    () async {
      final transport = ActiveSnapshotTransport()
        ..pages.add({
          'data': [
            {'id': 'djl-history-compacted-banner'},
            {'id': 'latest', 'status': 'completed'},
            {'id': 'stale-older', 'status': 'running'},
          ],
        })
        ..reads.add(StateError('The supported page owns this lookup'));
      final desktop = setup(transport)..turnId = 'turn-line-bridge';
      addTearDown(desktop.dispose);
      expect(await desktop.send('must remain unsent'), isFalse);
      expect(transport.calls.map((row) => row['method']), [
        'thread/turns/list',
      ]);
      expect(
        transport.calls.where(
          (row) => {'turn/start', 'turn/steer'}.contains(row['method']),
        ),
        isEmpty,
      );
    },
  );
}
