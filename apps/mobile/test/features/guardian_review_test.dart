import 'dart:async';
import 'dart:convert';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_requests_test.dart' show TestTransport;
import 'desktop_recovery_test.dart' show RecoveryMemoryStore;
import '../core/cloud_client_test.dart' show TestCredentials;

RemoteJson guardianParams({
  String id = 'review-1',
  String thread = 'thread-1',
  String status = 'denied',
  Object? action,
}) => {
  'threadId': thread,
  'turnId': 'turn-1',
  'reviewId': id,
  'targetItemId': 'item-1',
  'startedAtMs': 10,
  if (status != 'inProgress') 'completedAtMs': 20,
  'decisionSource': 'agent',
  'action':
      action ??
      {
        'type': 'command',
        'source': 'unifiedExec',
        'command': 'curl https://example.com',
        'cwd': '/tmp',
      },
  'review': {
    'status': status,
    'riskLevel': 'high',
    'userAuthorization': 'low',
    'rationale': 'Writes outside workspace',
  },
};

class GuardianTransport extends TestTransport {
  GuardianTransport(super.pairings);
  String mac = 'mac-a', session = 'secure-a';
  bool online = true;
  Completer<RemoteJson>? retry;
  Object? retryFailure;
  RemoteJson? history;
  @override
  String? get macDeviceId => mac;
  @override
  String? get sessionId => session;
  @override
  bool get connected => online;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'thread/read' || method == 'thread/resume') {
      return {
        'thread': history ?? {'id': params['threadId'], 'turns': []},
      };
    }
    if (method != 'thread/approveGuardianDeniedAction') {
      return super.request(method, params, timeout: timeout);
    }
    calls.add({'method': method, 'params': params});
    if (retryFailure != null) throw retryFailure!;
    return retry == null ? {} : retry!.future;
  }
}

void emitGuardian(
  GuardianTransport transport,
  RemoteJson params, {
  bool replay = false,
}) => transport.events.add({
  'method':
      'item/autoApprovalReview/${(params['review'] is Map ? (params['review'] as Map)['status'] : null) == 'inProgress' ? 'started' : 'completed'}',
  'params': {...params, if (replay) 'djlReplayedEvent': true},
});

DesktopController guardianDesktop(
  GuardianTransport transport, {
  DateTime Function()? clock,
}) =>
    DesktopController(
        transport.pairings,
        connection: transport,
        localStore: RecoveryMemoryStore(),
        guardianClock: clock,
      )
      ..active = Pairing({
        'macDeviceId': transport.mac,
        'sessionId': transport.session,
      })
      ..thread = {'id': 'thread-1'};
Map reviewRow(DesktopController desktop, [String id = 'review-1']) =>
    desktop.timeline.firstWhere(
          (row) => row['id'] == 'auto-approval-review:$id',
        )['guardianReview']
        as Map;

void main() {
  test(
    'guardian started and completed project one stable terminal row and ignore late started',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop =
          DesktopController(
              transport.pairings,
              connection: transport,
              localStore: RecoveryMemoryStore(),
            )
            ..active = const Pairing({
              'macDeviceId': 'mac-a',
              'sessionId': 'secure-a',
            })
            ..thread = {'id': 'thread-1'};
      emitGuardian(transport, guardianParams(status: 'inProgress'));
      emitGuardian(transport, guardianParams());
      emitGuardian(transport, guardianParams(status: 'inProgress'));
      expect(desktop.timeline, hasLength(1));
      expect(desktop.timeline.single['id'], 'auto-approval-review:review-1');
      expect(
        (desktop.timeline.single['guardianReview'] as Map)['status'],
        'denied',
      );
      desktop.dispose();
    },
  );
  test(
    'one retry consumes authority before await, deduplicates live completion and only shows approved after acknowledgement',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()))
        ..retry = Completer<RemoteJson>();
      final desktop = guardianDesktop(transport);
      emitGuardian(transport, guardianParams());
      final pending = desktop.approveGuardianRetry('thread-1', 'review-1');
      expect(reviewRow(desktop)['retryApproved'], false);
      expect(reviewRow(desktop)['submitting'], true);
      emitGuardian(transport, guardianParams());
      expect(await desktop.approveGuardianRetry('thread-1', 'review-1'), false);
      expect(transport.calls, hasLength(1));
      expect(transport.calls.single, {
        'method': 'thread/approveGuardianDeniedAction',
        'params': {
          'threadId': 'thread-1',
          'event': {
            'id': 'review-1',
            'turn_id': 'turn-1',
            'started_at_ms': 10,
            'completed_at_ms': 20,
            'target_item_id': 'item-1',
            'status': 'denied',
            'risk_level': 'high',
            'user_authorization': 'low',
            'rationale': 'Writes outside workspace',
            'decision_source': 'agent',
            'action': {
              'type': 'command',
              'source': 'unified_exec',
              'command': 'curl https://example.com',
              'cwd': '/tmp',
            },
          },
        },
      });
      transport.retry!.complete({});
      expect(await pending, true);
      expect(reviewRow(desktop)['retryApproved'], true);
      emitGuardian(transport, guardianParams());
      expect(await desktop.approveGuardianRetry('thread-1', 'review-1'), false);
      expect(transport.calls, hasLength(1));
      desktop.dispose();
    },
  );
  for (final failure in [
    TimeoutException('lost reply'),
    StateError('Disconnected'),
    const RemoteRpcException(-32602, 'unknown field', null),
  ]) {
    test(
      'all retry errors consume authority without automatic or duplicate retry: $failure',
      () async {
        final transport = GuardianTransport(
          PairingRepository(TestCredentials()),
        )..retryFailure = failure;
        final desktop = guardianDesktop(transport);
        emitGuardian(transport, guardianParams());
        expect(
          await desktop.approveGuardianRetry('thread-1', 'review-1'),
          false,
        );
        emitGuardian(transport, guardianParams());
        expect(
          await desktop.approveGuardianRetry('thread-1', 'review-1'),
          false,
        );
        expect(transport.calls, hasLength(1));
        expect(reviewRow(desktop)['retryApproved'], false);
        expect(
          reviewRow(desktop)['retryUnavailableReason'],
          contains('may not have reached'),
        );
        desktop.dispose();
      },
    );
  }
  test(
    'replay, mirror, unsupported capability, history and restored caches never mint a retry',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      emitGuardian(transport, guardianParams(id: 'replay'), replay: true);
      emitGuardian(
        transport,
        guardianParams(id: 'mirror')..['djlDesktopIpcMirror'] = true,
      );
      emitGuardian(
        transport,
        guardianParams(id: 'unsupported')
          ..['djlGuardianRetrySupported'] = false,
      );
      emitGuardian(transport, guardianParams(id: 'replay'));
      for (final id in ['replay', 'mirror', 'unsupported']) {
        expect(await desktop.approveGuardianRetry('thread-1', id), false);
      }
      expect(
        reviewRow(desktop, 'mirror')['retryUnavailableReason'],
        'Approve this retry in Codex Desktop.',
      );
      final historyReview = guardianParams(id: 'history');
      transport.history = {
        'id': 'thread-1',
        'turns': [
          {
            'id': 'turn-1',
            'items': [
              {'type': 'automaticApprovalReview', ...historyReview},
            ],
          },
        ],
      };
      await desktop.openThread({'id': 'thread-1'});
      expect(await desktop.approveGuardianRetry('thread-1', 'history'), false);
      emitGuardian(transport, guardianParams(id: 'history'));
      expect(await desktop.approveGuardianRetry('thread-1', 'history'), false);
      final cache = ThreadLocalState()
        ..timelines['thread-1'] = [
          {
            ...guardianParams(),
            'type': 'automaticApprovalReview',
            '_token': 'never-save',
          },
        ];
      final saved = cache.toJson();
      expect(jsonEncode(saved), isNot(contains('"action"')));
      expect(jsonEncode(saved), isNot(contains('_token')));
      expect(jsonEncode(saved), contains('curl https://example.com'));
      final restored = ThreadLocalState.fromJson(saved);
      expect(
        (restored.timelines['thread-1']!.single['guardianReview']
            as Map)['retryUnavailableReason'],
        'Retry approvals are available only during the live session.',
      );
      desktop.threadList.data.timelines['cached'] =
          restored.timelines['thread-1']!;
      transport.online = false;
      await desktop.openThread({'id': 'cached'});
      expect(await desktop.approveGuardianRetry('cached', 'review-1'), false);
      expect(transport.calls, isEmpty);
      desktop.dispose();
    },
  );
  test(
    'cap is ten, duplicate completion never refreshes expiry, and evicted grant cannot be reminted',
    () async {
      var now = DateTime.utc(2026);
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport, clock: () => now);
      for (var i = 0; i < 11; i++) {
        emitGuardian(transport, guardianParams(id: 'review-$i'));
      }
      expect(await desktop.approveGuardianRetry('thread-1', 'review-0'), false);
      emitGuardian(transport, guardianParams(id: 'review-0'));
      expect(await desktop.approveGuardianRetry('thread-1', 'review-0'), false);
      expect(await desktop.approveGuardianRetry('thread-1', 'review-1'), true);
      now = now.add(const Duration(minutes: 14));
      emitGuardian(transport, guardianParams(id: 'review-2'));
      now = now.add(const Duration(minutes: 1));
      expect(await desktop.approveGuardianRetry('thread-1', 'review-2'), false);
      expect(
        reviewRow(desktop, 'review-2')['retryUnavailableReason'],
        contains('no longer available'),
      );
      expect(transport.calls, hasLength(1));
      desktop.dispose();
    },
  );
  test(
    'disconnect and secure-session replacement clear grants and duplicated denial never restores them',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      emitGuardian(transport, guardianParams());
      await desktop.disconnect();
      emitGuardian(transport, guardianParams());
      expect(await desktop.approveGuardianRetry('thread-1', 'review-1'), false);
      emitGuardian(transport, guardianParams(id: 'second'));
      transport.session = 'secure-new';
      expect(await desktop.approveGuardianRetry('thread-1', 'second'), false);
      emitGuardian(transport, guardianParams(id: 'second'));
      expect(await desktop.approveGuardianRetry('thread-1', 'second'), false);
      expect(transport.calls, isEmpty);
      desktop.dispose();
    },
  );
  test(
    'cross-thread review order and history reconciliation retain terminal notification-only reviews',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      desktop.timeline.add({
        'id': 'before',
        'type': 'agentMessage',
        'text': 'Before',
      });
      emitGuardian(transport, guardianParams());
      desktop.timeline.add({
        'id': 'after',
        'type': 'agentMessage',
        'text': 'After',
      });
      emitGuardian(
        transport,
        guardianParams(id: 'other-review', thread: 'other-thread'),
      );
      expect(desktop.timeline.map((row) => row['id']), [
        'before',
        'auto-approval-review:review-1',
        'after',
      ]);
      expect(
        desktop.threadList.data.timelines['other-thread']!.single['id'],
        'auto-approval-review:other-review',
      );
      transport.history = {
        'id': 'thread-1',
        'turns': [
          {
            'id': 'turn-1',
            'items': [
              {'id': 'before', 'type': 'agentMessage', 'text': 'Before'},
              {
                'type': 'automaticApprovalReview',
                ...guardianParams(status: 'inProgress'),
              },
              {'id': 'after', 'type': 'agentMessage', 'text': 'After'},
            ],
          },
        ],
      };
      await desktop.openThread({'id': 'thread-1'});
      expect(desktop.timeline.map((row) => row['id']), [
        'before',
        'auto-approval-review:review-1',
        'after',
      ]);
      expect(reviewRow(desktop)['status'], 'denied');
      transport.history = {
        'id': 'thread-1',
        'turns': [
          {
            'id': 'turn-1',
            'items': [
              {'id': 'before', 'type': 'agentMessage', 'text': 'Before'},
              {'id': 'after', 'type': 'agentMessage', 'text': 'After'},
            ],
          },
        ],
      };
      await desktop.openThread({'id': 'thread-1'});
      expect(desktop.timeline.map((row) => row['id']), [
        'before',
        'auto-approval-review:review-1',
        'after',
      ]);
      desktop.dispose();
    },
  );
  for (final changeDevice in [false, true]) {
    test(
      'delayed retry acknowledgement cannot mutate a replacement ${changeDevice ? 'device' : 'session'}',
      () async {
        final transport = GuardianTransport(
          PairingRepository(TestCredentials()),
        )..retry = Completer<RemoteJson>();
        final desktop = guardianDesktop(transport);
        emitGuardian(transport, guardianParams());
        final pending = desktop.approveGuardianRetry('thread-1', 'review-1');
        transport.session = 'secure-new';
        if (changeDevice) {
          transport.mac = 'mac-b';
          desktop.active = Pairing({
            'macDeviceId': 'mac-b',
            'sessionId': 'secure-new',
          });
          desktop.timeline = [];
          desktop.thread = {'id': 'replacement'};
        }
        emitGuardian(
          transport,
          guardianParams(
            id: 'new-review',
            thread: changeDevice ? 'replacement' : 'thread-1',
          ),
        );
        final before = jsonEncode(desktop.timeline);
        transport.retry!.complete({});
        expect(await pending, false);
        expect(jsonEncode(desktop.timeline), before);
        expect(
          desktop.guardian
              .find(changeDevice ? 'replacement' : 'thread-1', 'new-review')!
              .retryApproved,
          false,
        );
        desktop.dispose();
      },
    );
  }
  test(
    'old-device notification metadata and malformed or unknown statuses fail closed',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      transport.events.add({
        'method': 'item/autoApprovalReview/completed',
        '_macDeviceId': 'mac-old',
        '_sessionId': 'old',
        'params': guardianParams(),
      });
      emitGuardian(transport, guardianParams()..remove('review'));
      expect(desktop.timeline, isEmpty);
      emitGuardian(transport, guardianParams(status: 'futureTerminal'));
      emitGuardian(transport, guardianParams(status: 'inProgress'));
      expect(reviewRow(desktop)['status'], 'futureTerminal');
      expect(await desktop.approveGuardianRetry('thread-1', 'review-1'), false);
      expect(transport.calls, isEmpty);
      desktop.dispose();
    },
  );

  test(
    'a duplicate live denial cannot mint authority from a cached terminal review before history finishes loading',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      final cache = ThreadLocalState()
        ..timelines['thread-1'] = [
          {...guardianParams(), 'type': 'automaticApprovalReview'},
        ];
      final restored = ThreadLocalState.fromJson(cache.toJson());
      desktop.threadList.data.timelines['thread-1'] =
          restored.timelines['thread-1']!;
      desktop.timeline = List.of(restored.timelines['thread-1']!);
      emitGuardian(transport, guardianParams());
      expect(await desktop.approveGuardianRetry('thread-1', 'review-1'), false);
      expect(transport.calls, isEmpty);
      expect(desktop.timeline, hasLength(1));
      desktop.dispose();
    },
  );

  test(
    'failed new-device connection cannot copy old-device reviews into the new cache',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      await desktop.threadList.attach('mac-a');
      emitGuardian(transport, guardianParams());
      desktop.thread = null;
      desktop.timeline = [];
      desktop.active = const Pairing({
        'macDeviceId': 'mac-b',
        'sessionId': 'new-session',
      });
      await desktop.threadList.attach('mac-b');
      transport.mac = 'mac-b';
      transport.session = 'new-session';
      transport.online = false;
      transport.onDisconnected?.call(StateError('Handshake failed'), null);
      expect(desktop.threadList.data.timelines, isEmpty);
      desktop.dispose();
    },
  );
  test(
    'changed action under a terminal review ID revokes the old unspent grant',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      emitGuardian(transport, guardianParams());
      emitGuardian(
        transport,
        guardianParams(
          action: {
            'type': 'command',
            'source': 'unifiedExec',
            'command': 'different action',
            'cwd': '/tmp',
          },
        ),
      );
      expect(await desktop.approveGuardianRetry('thread-1', 'review-1'), false);
      expect(transport.calls, isEmpty);
      expect(
        reviewRow(desktop)['retryUnavailableReason'],
        contains('cannot be retried safely'),
      );
      desktop.dispose();
    },
  );
  test(
    'openThread serializes the whole state without guardian authority-shaped fields and preserves other history',
    () async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      transport.history = {
        'id': 'thread-1',
        'name': 'History title',
        'cwd': '/project',
        'turns': [
          {
            'id': 'turn-1',
            'status': 'completed',
            'items': [
              {
                'id': 'message-1',
                'type': 'agentMessage',
                'text': 'Unrelated history',
              },
              {
                'type': 'automaticApprovalReview',
                ...guardianParams(),
                '_token': 'never-save',
                'coreDeniedEvent': {'unsafe': true},
                'arbitraryGuardianField': 'drop-me',
              },
            ],
          },
        ],
      };
      final desktop = guardianDesktop(transport);
      await desktop.openThread({'id': 'thread-1'});
      final serialized = desktop.threadList.data.toJson();
      for (final section in ['threads', 'timelines']) {
        final encoded = jsonEncode(serialized[section]);
        for (final forbidden in [
          '"action"',
          'coreDeniedEvent',
          '_token',
          'arbitraryGuardianField',
        ]) {
          expect(encoded, isNot(contains(forbidden)), reason: section);
        }
      }
      final restored = ThreadLocalState.fromJson(serialized);
      expect(restored.find('thread-1')?['name'], 'History title');
      expect(restored.find('thread-1')?['cwd'], '/project');
      expect(
        restored.timelines['thread-1']!.first['text'],
        'Unrelated history',
      );
      final card =
          restored.timelines['thread-1']!.last['guardianReview'] as Map;
      expect(card['summary'], 'curl https://example.com');
      expect(card['rationale'], 'Writes outside workspace');
      expect(card['retryUnavailableReason'], isNotNull);
      expect(await desktop.approveGuardianRetry('thread-1', 'review-1'), false);
      desktop.dispose();
    },
  );
  test(
    'legacy raw nested thread snapshots sanitize on load and whole-state save through openThread',
    () async {
      final rawReview =
          {
              'type': 'automaticApprovalReview',
              ...guardianParams(),
              '_token': 'never-save',
              'coreDeniedEvent': {'unsafe': true},
              'arbitraryGuardianField': 'drop-me',
            }
            ..remove('threadId')
            ..remove('turnId');
      final original = {
        'id': 'thread-1',
        'name': 'Legacy title',
        'turns': [
          {
            'id': 'turn-1',
            'status': 'completed',
            'items': [
              {
                'id': 'message-1',
                'type': 'agentMessage',
                'text': 'Unrelated history',
              },
              rawReview,
            ],
          },
        ],
      };
      final legacy = ThreadLocalState.fromJson({
        'threads': [original],
        'timelines': {
          'thread-1': [
            {...rawReview, 'turnId': 'turn-1'},
          ],
        },
      });
      final nestedItems =
          ((legacy.snapshots.single['turns'] as List).single as Map)['items']
              as List;
      final nestedCard = (nestedItems.last as Map)['guardianReview'] as Map?;
      expect(nestedCard?['summary'], 'curl https://example.com');
      expect(nestedCard?['rationale'], 'Writes outside workspace');
      expect((nestedItems.first as Map)['text'], 'Unrelated history');
      for (final forbidden in [
        '"action"',
        'coreDeniedEvent',
        '_token',
        'arbitraryGuardianField',
      ]) {
        expect(jsonEncode(legacy.snapshots), isNot(contains(forbidden)));
      }
      // Raw snapshots may also exist in memory before serialization; both boundaries must sanitize.
      legacy.snapshots[0] = original;
      final savedDirectly = legacy.toJson();
      expect(jsonEncode(savedDirectly['threads']), isNot(contains('"action"')));
      final transport = GuardianTransport(PairingRepository(TestCredentials()))
        ..history = original;
      final desktop = guardianDesktop(transport);
      desktop.threadList.data.snapshots.addAll(legacy.snapshots);
      desktop.threadList.data.timelines.addAll(legacy.timelines);
      await desktop.openThread({'id': 'thread-1'});
      final saved = desktop.threadList.data.toJson();
      for (final section in ['threads', 'timelines']) {
        for (final forbidden in [
          '"action"',
          'coreDeniedEvent',
          '_token',
          'arbitraryGuardianField',
        ]) {
          expect(
            jsonEncode(saved[section]),
            isNot(contains(forbidden)),
            reason: section,
          );
        }
      }
      final restored = ThreadLocalState.fromJson(saved);
      expect(restored.find('thread-1')?['name'], 'Legacy title');
      expect(
        (restored.timelines['thread-1']!.last['guardianReview']
            as Map)['summary'],
        'curl https://example.com',
      );
      expect(await desktop.approveGuardianRetry('thread-1', 'review-1'), false);
      desktop.dispose();
    },
  );
  for (final changedWhilePending in [true, false]) {
    test(
      'changed action ${changedWhilePending ? 'during' : 'after'} retry acknowledgement never inherits approval',
      () async {
        final transport = GuardianTransport(
          PairingRepository(TestCredentials()),
        )..retry = Completer<RemoteJson>();
        final desktop = guardianDesktop(transport);
        emitGuardian(transport, guardianParams());
        final pending = desktop.approveGuardianRetry('thread-1', 'review-1');
        if (!changedWhilePending) {
          transport.retry!.complete({});
          expect(await pending, true);
          expect(reviewRow(desktop)['retryApproved'], true);
        }
        emitGuardian(
          transport,
          guardianParams(
            action: {
              'type': 'command',
              'source': 'unifiedExec',
              'command': 'different replacement action',
              'cwd': '/tmp',
            },
          ),
        );
        expect(reviewRow(desktop)['summary'], 'different replacement action');
        expect(reviewRow(desktop)['retryApproved'], false);
        expect(reviewRow(desktop)['submitting'], false);
        expect(reviewRow(desktop)['retryUnavailableReason'], isNotNull);
        if (changedWhilePending) {
          transport.retry!.complete({});
          expect(await pending, false);
        }
        expect(reviewRow(desktop)['retryApproved'], false);
        expect(reviewRow(desktop)['submitting'], false);
        expect(
          await desktop.approveGuardianRetry('thread-1', 'review-1'),
          false,
        );
        emitGuardian(
          transport,
          guardianParams(
            action: {
              'type': 'command',
              'source': 'unifiedExec',
              'command': 'different replacement action',
              'cwd': '/tmp',
            },
          ),
        );
        expect(
          await desktop.approveGuardianRetry('thread-1', 'review-1'),
          false,
        );
        expect(transport.calls, hasLength(1));
        final event = (transport.calls.single['params'] as Map)['event'] as Map;
        expect((event['action'] as Map)['command'], 'curl https://example.com');
        desktop.dispose();
      },
    );
  }
}
