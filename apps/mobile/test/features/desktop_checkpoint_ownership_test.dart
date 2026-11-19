import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/workspace/data/workspace_repository.dart';
import 'package:djl_mobile/features/workspace/presentation/checkpoint_page.dart';
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop, reasoningEvent;

class ScopedCheckpointTransport extends ReasoningTransport {
  final ends = <String, Completer<RemoteJson>>{};
  final preparations = <String, Completer<RemoteJson>>{};
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'turn/start' || method.startsWith('workspace/checkpoint')) {
      calls.add({'method': method, 'params': Map.of(params)});
      if (method == 'turn/start') {
        return {
          'turn': {'id': 'ipc-turn-0'},
        };
      }
      if (method == 'workspace/checkpointCopy') return {'copied': true};
      if (method == 'workspace/checkpointDiff') {
        return {'diff': 'Public diff for ${params['threadId']}'};
      }
      if (params['checkpointKind'] == 'messageStart') {
        return preparations[params['threadId']]?.future ?? {};
      }
      if (params['checkpointKind'] == 'turnEnd') {
        return ends[params['threadId']]?.future ?? {};
      }
      return {};
    }
    return super.request(method, params, timeout: timeout);
  }
}

Future<void> selectCheckpointScope(
  ScopedCheckpointTransport t,
  DesktopController d,
  String id,
  String cwd, {
  bool running = false,
}) async {
  t.history = {
    'id': id,
    'cwd': cwd,
    'turns': [
      if (running) {'id': 'ipc-turn-0', 'status': 'inProgress', 'items': []},
    ],
  };
  await d.openThread({'id': id, 'cwd': cwd}, readOnlyNavigation: true);
  d.model = 'qa';
}

Future<DesktopController> twoCheckpointScopes(
  ScopedCheckpointTransport t, {
  String second = 'other',
}) async {
  t.history = {'id': 'thread', 'cwd': '/qa/a', 'turns': []};
  final d = await reasoningDesktop(t);
  d.model = 'qa';
  expect(await d.send('First public request'), isTrue, reason: d.error);
  await selectCheckpointScope(t, d, second, '/qa/b');
  expect(await d.send('Second public request'), isTrue, reason: d.error);
  return d;
}

void completeCheckpointScope(
  ScopedCheckpointTransport t,
  String thread,
  String cwd,
) {
  t.history = {
    'id': thread,
    'cwd': cwd,
    'turns': [
      {'id': 'ipc-turn-0', 'status': 'completed', 'items': []},
    ],
  };
  reasoningEvent(
    t,
    'turn/completed',
    thread: thread,
    turn: 'ipc-turn-0',
    extra: {
      'turn': {'id': 'ipc-turn-0', 'status': 'completed'},
      'djlDesktopMirror': true,
    },
  );
}

Future<void> settleCheckpointCallbacks() async {
  for (var i = 0; i < 16; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  for (final envelope in [false, true]) {
    test(
      'replayed completion cannot capture a checkpoint with outer flag=$envelope',
      () async {
        final t = ScopedCheckpointTransport();
        final d = await twoCheckpointScopes(t);
        addTearDown(d.dispose);
        await selectCheckpointScope(t, d, 'thread', '/qa/a', running: true);
        t.calls.clear();
        t.events.add({
          'method': 'turn/completed',
          if (envelope) 'djlReplayedEvent': true,
          'params': {
            'threadId': 'thread',
            'turnId': 'ipc-turn-0',
            if (!envelope) 'djlReplayedEvent': true,
            'turn': {'id': 'ipc-turn-0', 'status': 'completed'},
          },
        });
        await settleCheckpointCallbacks();
        expect(
          t.calls.where(
            (c) => c['method'].toString().startsWith('workspace/checkpoint'),
          ),
          isEmpty,
        );
      },
    );

    test(
      'replayed start cannot bind pending preparation with outer flag=$envelope',
      () async {
        final t = ScopedCheckpointTransport()
          ..history = {'id': 'thread', 'cwd': '/qa/a', 'turns': []};
        final d = await reasoningDesktop(t);
        addTearDown(d.dispose);
        d.model = 'qa';
        final gate = Completer<RemoteJson>();
        t.preparations['thread'] = gate;
        final sending = d.send('Not replayed local request');
        await Future<void>.delayed(Duration.zero);
        t.events.add({
          'method': 'turn/started',
          if (envelope) 'djlReplayedEvent': true,
          'params': {
            'threadId': 'thread',
            'turnId': 'replayed-turn',
            if (!envelope) 'djlReplayedEvent': true,
          },
        });
        final replayTurn = d.turnId;
        gate.complete({});
        final sent = await sending;
        await settleCheckpointCallbacks();
        expect(replayTurn, isNull);
        expect(sent, isTrue, reason: d.error);
        expect(t.calls.where((c) => c['method'] == 'turn/start'), hasLength(1));
        final copies = t.calls
            .where((c) => c['method'] == 'workspace/checkpointCopy')
            .toList();
        expect(copies, hasLength(1));
        expect((copies.single['params'] as Map)['targetTurnId'], 'ipc-turn-0');
      },
    );
  }

  for (final second in ['other', 'thread']) {
    for (final method in ['turn/started', 'turn/completed']) {
      test(
        'foreign pending preparation is not borrowed by $method with second=$second',
        () async {
          final t = ScopedCheckpointTransport()
            ..history = {'id': 'thread', 'cwd': '/qa/a', 'turns': []};
          final d = await reasoningDesktop(t);
          addTearDown(d.dispose);
          await selectCheckpointScope(t, d, second, '/qa/b');
          final preparing = Completer<RemoteJson>();
          t.preparations[second] = preparing;
          final sending = d.send('Not yet dispatched in B');
          await Future<void>.delayed(Duration.zero);
          expect(
            t.calls.where(
              (c) => (c['params'] as Map)['checkpointKind'] == 'messageStart',
            ),
            hasLength(1),
          );
          await selectCheckpointScope(t, d, 'thread', '/qa/a', running: true);
          t.calls.clear();
          if (method == 'turn/completed') {
            completeCheckpointScope(t, 'thread', '/qa/a');
          } else {
            reasoningEvent(t, method, thread: 'thread', turn: 'ipc-turn-0');
          }
          preparing.complete({});
          expect(await sending, isFalse);
          await settleCheckpointCallbacks();
          expect(
            t.calls.where((c) => c['method'] == 'workspace/checkpointCopy'),
            isEmpty,
          );
          final ends = t.calls.where(
            (c) => (c['params'] as Map)['checkpointKind'] == 'turnEnd',
          );
          expect(ends, hasLength(method == 'turn/completed' ? 1 : 0));
          for (final end in ends) {
            expect((end['params'] as Map)['threadId'], 'thread');
            expect((end['params'] as Map)['cwd'], '/qa/a');
          }
        },
      );
    }
  }

  for (final second in ['other', 'thread']) {
    test(
      'late completion keeps the original checkpoint with repeated ID and second=$second',
      () async {
        final t = ScopedCheckpointTransport();
        final d = await twoCheckpointScopes(t, second: second);
        addTearDown(d.dispose);
        await selectCheckpointScope(t, d, 'thread', '/qa/a', running: true);
        t.calls.clear();
        completeCheckpointScope(t, 'thread', '/qa/a');
        await d.waitForCheckpoint('ipc-turn-0');
        await settleCheckpointCallbacks();
        final ends = t.calls
            .where((c) => (c['params'] as Map)['checkpointKind'] == 'turnEnd')
            .toList();
        expect(ends, hasLength(1));
        expect((ends.single['params'] as Map)['threadId'], 'thread');
        expect((ends.single['params'] as Map)['cwd'], '/qa/a');
        completeCheckpointScope(t, 'thread', '/qa/a');
        await settleCheckpointCallbacks();
        expect(
          t.calls.where(
            (c) => (c['params'] as Map)['checkpointKind'] == 'turnEnd',
          ),
          hasLength(1),
        );
      },
    );
  }

  for (final stale in [false, true]) {
    testWidgets(
      'checkpoint page uses its captured chat and connection stale=$stale',
      (tester) async {
        final t = ScopedCheckpointTransport();
        final d = (await tester.runAsync(() => twoCheckpointScopes(t)))!;
        addTearDown(d.dispose);
        final a = Completer<RemoteJson>(), b = Completer<RemoteJson>();
        t.ends.addAll({'thread': a, 'other': b});
        addTearDown(() {
          if (!a.isCompleted) a.complete({});
          if (!b.isCompleted) b.complete({});
        });
        await tester.runAsync(() async {
          await selectCheckpointScope(t, d, 'thread', '/qa/a', running: true);
          completeCheckpointScope(t, 'thread', '/qa/a');
          await settleCheckpointCallbacks();
        });
        final repository = WorkspaceRepository(
          t,
          cwd: '/qa/a',
          threadId: 'thread',
        );
        await tester.runAsync(() async {
          await selectCheckpointScope(t, d, 'other', '/qa/b', running: true);
          completeCheckpointScope(t, 'other', '/qa/b');
          await settleCheckpointCallbacks();
        });
        t.calls.clear();
        if (stale) t.session = 'replacement-session';
        await tester.pumpWidget(
          MaterialApp(
            home: CheckpointPage(
              repository: repository,
              desktop: d,
              turns: const ['ipc-turn-0'],
            ),
          ),
        );
        await tester.pump();
        expect(
          t.calls.where((c) => c['method'] == 'workspace/checkpointDiff'),
          isEmpty,
        );
        if (stale) {
          for (var i = 0; i < 8; i++) {
            await tester.pump(const Duration(milliseconds: 10));
          }
          expect(find.textContaining('Reopen this workspace'), findsOneWidget);
          expect(
            t.calls.where((c) => c['method'] == 'workspace/checkpointDiff'),
            isEmpty,
          );
          expect(b.isCompleted, isFalse);
          a.complete({});
          b.complete({});
          await tester.pumpWidget(const SizedBox.shrink());
          return;
        }
        await tester.runAsync(() async {
          a.complete({});
          await settleCheckpointCallbacks();
        });
        for (var i = 0; i < 8; i++) {
          await tester.pump(const Duration(milliseconds: 10));
        }
        final diffs = t.calls
            .where((c) => c['method'] == 'workspace/checkpointDiff')
            .toList();
        expect(diffs, hasLength(1));
        expect((diffs.single['params'] as Map)['threadId'], 'thread');
        expect((diffs.single['params'] as Map)['cwd'], '/qa/a');
        expect(b.isCompleted, isFalse);
        b.complete({});
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }
}
