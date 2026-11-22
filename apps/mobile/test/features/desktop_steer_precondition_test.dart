import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'desktop_active_turn_snapshot_test.dart'
    show ActiveSnapshotTransport, connectedSnapshot;

const freshPage = <String, dynamic>{
  'data': [
    {'id': 'live', 'status': 'inProgress'},
  ],
};

void main() {
  for (final state in ['same target', 'second rejection']) {
    test(
      'broader stale recovery with $state cannot produce a third Steer',
      () async {
        final t = ActiveSnapshotTransport()
          ..responses.addAll([
            const RemoteRpcException(-32000, 'turn not found', null),
            const RemoteRpcException(-32000, 'no active turn', null),
          ])
          ..pages.add({
            'data': [
              {
                'id': state == 'same target' ? 'stale' : 'live',
                'status': 'running',
              },
            ],
          });
        final d = await connectedSnapshot(t);
        d.turnId = 'stale';
        addTearDown(d.dispose);
        expect(await d.send('one rejected intent'), isFalse);
        expect(
          t.calls.where((row) => row['method'] == 'turn/steer'),
          hasLength(state == 'same target' ? 1 : 2),
        );
        expect(
          t.calls.where((row) => row['method'] == 'thread/turns/list'),
          hasLength(1),
        );
        expect(t.calls.where((row) => row['method'] == 'turn/start'), isEmpty);
      },
    );
  }

  test(
    'a second definite stale rejection retains a queued item without pausing it',
    () async {
      final t = ActiveSnapshotTransport()
        ..responses.addAll([
          const RemoteRpcException(-32000, 'turn not found', null),
          const RemoteRpcException(-32000, 'no active turn', null),
        ])
        ..pages.add(freshPage);
      final d = await connectedSnapshot(t);
      d.turnId = 'stale';
      addTearDown(d.dispose);
      expect(
        await d.submitComposerDraft(
          DesktopComposerDraft(text: 'retained queued intent'),
        ),
        isTrue,
      );
      expect(await d.steerQueuedDraft(d.queuedDrafts.single.id), isFalse);
      expect(d.queuedDrafts.single.draft.text, 'retained queued intent');
      expect(d.queuePauseMessage, isNull);
      expect(d.timeline.where((row) => row['type'] == 'userMessage'), isEmpty);
      expect(
        t.calls.where((row) => row['method'] == 'turn/steer'),
        hasLength(2),
      );
    },
  );

  test(
    'a missing old acknowledgement keeps the original message owner after a newer run completes',
    () async {
      final reply = Completer<Map<String, dynamic>>();
      final t = ActiveSnapshotTransport()
        ..responses.addAll([
          const RemoteRpcException(
            -32000,
            'expected active turn id live but found stale',
            null,
          ),
          reply,
        ])
        ..pages.add(freshPage);
      final d = await connectedSnapshot(t);
      d.turnId = 'stale';
      addTearDown(d.dispose);
      final sending = d.send('accepted older intent');
      await t.retryStarted.future.timeout(const Duration(seconds: 2));
      t.events.add({
        'method': 'turn/started',
        'params': {
          'threadId': 't1',
          'turn': {'id': 'newer', 'status': 'inProgress'},
        },
      });
      t.events.add({
        'method': 'turn/completed',
        'params': {
          'threadId': 't1',
          'turn': {'id': 'newer', 'status': 'completed'},
        },
      });
      expect(d.turnId, isNull);
      reply.complete({});
      expect(await sending, isTrue);
      expect(d.turnId, isNull);
      expect(d.selectedResponseFooter.latestTurn, 'newer');
      expect(
        d.timeline
            .where((row) => row['type'] == 'userMessage')
            .single['turnId'],
        'live',
      );
    },
  );

  for (final newer in ['pending', 'published']) {
    test('input compatibility cannot resend into a newer $newer run', () async {
      final rejection = Completer<Map<String, dynamic>>();
      final t = ActiveSnapshotTransport()..responses.add(rejection);
      final d = await connectedSnapshot(t);
      d.turnId = 'old-live';
      addTearDown(d.dispose);
      final sending = d.sendDraft(
        DesktopComposerDraft(
          text: 'old rich intent',
          images: [
            const DesktopComposerImage(
              id: 'image',
              name: 'qa.png',
              dataUrl: 'data:image/png;base64,YQ==',
            ),
          ],
        ),
      );
      await Future<void>.delayed(Duration.zero);
      expect(t.calls.last['method'], 'turn/steer');
      t.events.add({
        'method': 'turn/started',
        'params': {
          'threadId': 't1',
          'turn': newer == 'pending'
              ? <String, dynamic>{}
              : {'id': 'newer', 'status': 'inProgress'},
        },
      });
      rejection.completeError(
        const RemoteRpcException(-32602, 'missing field input.image_url', null),
      );
      expect(await sending, isFalse);
      expect(
        t.calls.where((row) => row['method'] == 'turn/steer'),
        hasLength(1),
      );
      if (newer == 'pending') {
        expect(d.selectedResponseFooter.pending, isTrue);
      } else {
        expect(d.turnId, 'newer');
        expect(d.selectedResponseFooter.latestTurn, 'newer');
      }
      expect(d.error, isNull);
    });
  }

  for (final message in [
    'turn not found',
    'no active turn',
    'not in progress',
    'not running',
    'already completed',
    'already finished',
    'invalid turn',
    'no such turn',
    'not active',
    'does not exist',
    'cannot interrupt',
    'expected active turn id live but found stale',
    'Turn with id stale is already completed.',
  ]) {
    test(
      'explicit turn rejection "$message" refreshes once without a new start',
      () async {
        final t = ActiveSnapshotTransport()
          ..responses.addAll([
            RemoteRpcException(-32000, message, null),
            {'turnId': 'live'},
          ])
          ..pages.add(freshPage);
        final d = await connectedSnapshot(t);
        d.turnId = 'stale';
        addTearDown(d.dispose);
        expect(await d.send('one intended follow-up'), isTrue, reason: d.error);
        expect(t.calls.map((row) => row['method']), [
          'turn/steer',
          'thread/turns/list',
          'turn/steer',
        ]);
        final steers = t.calls
            .where((row) => row['method'] == 'turn/steer')
            .toList();
        expect(steers.map((row) => row['params']['expectedTurnId']), [
          'stale',
          'live',
        ]);
        expect(
          d.timeline.where((row) => row['type'] == 'userMessage'),
          hasLength(1),
        );
        expect(d.turnId, 'live');
      },
    );
  }

  for (final failure in <Object>[
    const RemoteRpcException(-32000, 'File does not exist', null),
    const RemoteRpcException(-32000, 'Command is not running', null),
    const RemoteRpcException(-32000, 'Task already completed', null),
    const RemoteRpcException(-32000, 'Permission denied', null),
    TimeoutException('reply may have been lost after acceptance'),
  ]) {
    test('unrelated or uncertain rejection $failure never resends', () async {
      final t = ActiveSnapshotTransport()..responses.add(failure);
      final d = await connectedSnapshot(t);
      d.turnId = 'stale';
      addTearDown(d.dispose);
      expect(await d.send('one attempted follow-up'), isFalse);
      expect(t.calls.map((row) => row['method']), ['turn/steer']);
    });
  }

  test(
    'a fresh ID-less start during lookup preserves its pending state and blocks the old intent',
    () async {
      final page = Completer<Map<String, dynamic>>();
      final t = ActiveSnapshotTransport()
        ..responses.add(
          const RemoteRpcException(
            -32000,
            'expected active turn id live but found stale',
            null,
          ),
        )
        ..pages.add(page);
      final d = await connectedSnapshot(t);
      d.turnId = 'stale';
      addTearDown(d.dispose);
      final sending = d.send('old pending intent');
      await Future<void>.delayed(Duration.zero);
      expect(t.calls.last['method'], 'thread/turns/list');
      t.events.add({
        'method': 'turn/started',
        'params': {'threadId': 't1', 'turn': <String, dynamic>{}},
      });
      expect(d.selectedResponseFooter.pending, isTrue);
      page.complete(freshPage);
      expect(await sending, isFalse);
      expect(
        t.calls.where((row) => row['method'] == 'turn/steer'),
        hasLength(1),
      );
      expect(d.selectedResponseFooter.pending, isTrue);
      expect(d.error, isNull);
    },
  );

  for (final acknowledgement in ['canonical', 'missing', 'pending']) {
    test(
      'late $acknowledgement old steer cannot replace a newer observed run',
      () async {
        final reply = Completer<Map<String, dynamic>>();
        final t = ActiveSnapshotTransport()
          ..responses.addAll([
            const RemoteRpcException(
              -32000,
              'expected active turn id live but found stale',
              null,
            ),
            reply,
          ])
          ..pages.add(freshPage);
        final d = await connectedSnapshot(t);
        d.turnId = 'stale';
        addTearDown(d.dispose);
        final sending = d.send('accepted older intent');
        await t.retryStarted.future.timeout(const Duration(seconds: 2));
        t.events.add({
          'method': 'turn/started',
          'params': {
            'threadId': 't1',
            'turn': acknowledgement == 'pending'
                ? <String, dynamic>{}
                : {'id': 'newer', 'status': 'inProgress'},
          },
        });
        reply.complete(acknowledgement == 'missing' ? {} : {'turnId': 'live'});
        expect(await sending, isTrue);
        if (acknowledgement == 'pending') {
          expect(d.selectedResponseFooter.pending, isTrue);
          expect(d.selectedResponseFooter.latestTurn, isNull);
        } else {
          expect(d.turnId, 'newer');
          expect(d.selectedResponseFooter.latestTurn, 'newer');
        }
        expect(
          d.timeline
              .where((row) => row['type'] == 'userMessage')
              .single['turnId'],
          'live',
        );
        expect(
          t.calls.where((row) => row['method'] == 'turn/steer'),
          hasLength(2),
        );
      },
    );
  }

  test(
    'canonical echo before broader retry acknowledgement owns one user row',
    () async {
      final reply = Completer<Map<String, dynamic>>();
      final t = ActiveSnapshotTransport()
        ..responses.addAll([
          const RemoteRpcException(-32000, 'turn not found', null),
          reply,
        ])
        ..pages.add(freshPage);
      final d = await connectedSnapshot(t);
      d.turnId = 'stale';
      addTearDown(d.dispose);
      final sending = d.send('one source-shaped follow-up');
      await t.retryStarted.future.timeout(const Duration(seconds: 2));
      t.events.add({
        'method': 'item/started',
        'params': {
          'threadId': 't1',
          'turnId': 'live',
          'item': {
            'id': 'canonical-user',
            'type': 'userMessage',
            'content': [
              {'type': 'text', 'text': 'one source-shaped follow-up'},
            ],
          },
        },
      });
      expect(
        d.timeline.where((row) => row['type'] == 'userMessage'),
        hasLength(1),
      );
      expect(
        d.timeline.where((row) => row['type'] == 'userMessage').single['id'],
        'canonical-user',
      );
      reply.complete({'turnId': 'live'});
      expect(await sending, isTrue);
      expect(
        d.timeline.where((row) => row['type'] == 'userMessage'),
        hasLength(1),
      );
      expect(d.turnId, 'live');
    },
  );

  test(
    'broader stale retry retains queued rich Plan, live selection and unsent composer',
    () async {
      final t = ActiveSnapshotTransport()
        ..responses.addAll([
          const RemoteRpcException(-32000, 'turn not found', null),
          {'turnId': 'live'},
        ])
        ..pages.add(freshPage);
      final d = await connectedSnapshot(t);
      addTearDown(d.dispose);
      d.models = [
        {'id': 'qa', 'model': 'qa-wire', 'djlProvider': 'codex'},
        {'id': 'next', 'model': 'next-wire', 'djlProvider': 'codex'},
      ];
      d.turnId = 'stale';
      d.plan = true;
      final queued = DesktopComposerDraft(
        text: '  planned raw follow-up\n',
        images: [
          const DesktopComposerImage(
            id: 'qa-image',
            name: 'qa.png',
            dataUrl: 'data:image/png;base64,YQ==',
          ),
        ],
      );
      expect(await d.submitComposerDraft(queued), isTrue);
      d.plan = false;
      d.model = 'next';
      d.effort = 'high';
      d.threadList.data.setComposerDraft(
        't1',
        DesktopComposerDraft(text: 'unsent newer input'),
      );
      expect(
        await d.steerQueuedDraft(d.queuedDrafts.single.id),
        isTrue,
        reason: d.error,
      );
      final steers = t.calls
          .where((row) => row['method'] == 'turn/steer')
          .toList();
      expect(steers, hasLength(2));
      for (final row in steers) {
        expect(row['params']['input'], queued.input());
        expect(row['params']['collaborationMode'], {
          'mode': 'plan',
          'settings': {
            'model': 'next-wire',
            'reasoning_effort': 'high',
            'developer_instructions': null,
          },
        });
      }
      expect(d.queuedDrafts, isEmpty);
      expect(d.threadList.data.composerDraft('t1').text, 'unsent newer input');
      expect(d.model, 'next');
      expect(d.plan, isFalse);
    },
  );
}
