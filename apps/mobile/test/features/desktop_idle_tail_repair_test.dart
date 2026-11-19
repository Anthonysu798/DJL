import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/subagents/domain/subagent_action.dart';
import 'package:djl_mobile/features/guardian/domain/guardian_review.dart';
import 'guardian_review_test.dart' show guardianParams;
import 'desktop_reasoning_controller_test.dart' show ReasoningTransport;
import 'desktop_history_reconciliation_test.dart'
    show
        historyDesktop,
        historyPage,
        historyUser,
        historyAnswer,
        historyText,
        refreshHistory;

List<RemoteJson> mirroredTail() => [
  historyAnswer('rollout-older', 'ipc-turn-older', 'Older page'),
  historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Repair this'),
  historyAnswer('rollout-stale', 'ipc-turn-0', 'Stale finding'),
  {
    'id': 'rollout-command',
    'turnId': 'ipc-turn-0',
    'type': 'commandExecution',
    'command': 'echo stale',
    'status': 'completed',
  },
  historyAnswer('stable-answer', 'stable-turn', 'Stable answer'),
];

void main() {
  test(
    'idle repair removes an omitted mirrored plan and preserves stable plans and Guardian tombstones',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        ...mirroredTail(),
        {
          'id': 'rollout-plan',
          'type': 'plan',
          'turnId': 'ipc-turn-0',
          'text': 'Stale plan',
        },
        {
          'id': 'provider-plan',
          'type': 'plan',
          'turnId': 'stable-turn',
          'text': 'Stable plan',
        },
      ]);
      addTearDown(d.dispose);
      t.events.add({
        'method': 'item/autoApprovalReview/completed',
        'params': {...guardianParams(thread: 'thread'), 'turnId': 'ipc-turn-0'},
      });
      expect(d.timeline.where(isGuardianRow), hasLength(1));
      await refreshHistory(t, d, [
        historyUser('canonical-user', 'real-turn', 'Repair this'),
      ]);
      expect(
        d.timeline.where((row) => row['type'] == 'plan').map(historyText),
        ['Stable plan'],
      );
      expect(d.timeline.where(isGuardianRow), hasLength(1));
      expect(
        d.guardian.consume('thread', 'review-1', 'mac-a', 'secure-a'),
        isNull,
      );
    },
  );

  for (final running in [false, true]) {
    test(
      'unopened child applies its own idle repair without moving selection running=$running',
      () async {
        final t = ReasoningTransport();
        final d = await historyDesktop(t, [
          historyAnswer('parent-answer', 'parent-turn', 'Parent stays'),
        ]);
        addTearDown(d.dispose);
        d.threadList.data.timelines['child'] = mirroredTail();
        d.threadList.data.upsert({'id': 'child', 'cwd': '/qa'});
        if (running) {
          t.events.add({
            'method': 'turn/started',
            'params': {'threadId': 'child', 'turnId': 'ipc-turn-0'},
          });
        }
        t.history = {
          ...historyPage([
            historyUser('canonical-user', 'real-turn', 'Repair this'),
          ]),
          'id': 'child',
        };
        await d.hydrateSubagents(
          SubagentAction(
            mac: 'mac-a',
            thread: 'thread',
            turn: 'parent-turn',
            item: 'spawn',
            tool: 'spawnagent',
            status: 'completed',
            children: [SubagentChild('child')],
          ),
        );
        final rows = d.threadList.data.timelines['child']!;
        expect(rows.any((row) => historyText(row) == 'Stale finding'), running);
        expect(
          rows.where((row) => historyText(row) == 'Older page'),
          hasLength(1),
        );
        expect(d.thread?['id'], 'thread');
        expect(d.timeline.map(historyText), ['Parent stays']);
        expect(t.calls.map((call) => call['method']).toSet(), {'thread/read'});
      },
    );
  }

  test(
    'newer closed-turn evidence protects the whole tail during an idle read',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, mirroredTail());
      addTearDown(d.dispose);
      final read = Completer<RemoteJson>();
      t.readGate = read;
      final loading = d.openThread({
        'id': 'thread',
        'cwd': '/qa',
      }, readOnlyNavigation: true);
      await Future<void>.delayed(Duration.zero);
      t.events.add({
        'method': 'item/agentMessage/delta',
        'params': {
          'threadId': 'thread',
          'turnId': 'ipc-turn-0',
          'itemId': 'rollout-stale',
          'delta': ' + late evidence',
        },
      });
      read.complete({
        'thread': historyPage([
          historyUser('canonical-user', 'real-turn', 'Repair this'),
        ]),
      });
      await loading;
      expect(
        d.timeline.where((row) => historyText(row).contains('late evidence')),
        hasLength(1),
      );
      expect(d.activity.items, hasLength(1));
      expect(d.turnId, isNull);
      expect(t.calls.map((call) => call['method']), ['thread/read']);
    },
  );

  for (final mode in ['idle', 'running', 'other-running']) {
    test(
      'ordinary canonical read repairs only its idle tail mode=$mode',
      () async {
        final t = ReasoningTransport();
        final d = await historyDesktop(
          t,
          mirroredTail(),
          running: mode == 'running',
        );
        addTearDown(d.dispose);
        if (mode == 'other-running') {
          d.threadList.data.upsert({'id': 'other', 'cwd': '/qa'});
          t.events.add({
            'method': 'turn/started',
            'params': {'threadId': 'other', 'turnId': 'other-turn'},
          });
        }
        d.timeline.add(
          historyUser('local-unsent', '', 'Keep unsent', delivery: 'unknown')
            ..remove('turnId'),
        );
        await refreshHistory(t, d, [
          historyUser('canonical-user', 'real-turn', 'Repair this'),
        ]);
        expect(
          d.timeline.any((row) => historyText(row) == 'Stale finding'),
          mode == 'running',
        );
        expect(d.activity.items.length, mode == 'running' ? 1 : 0);
        expect(
          d.timeline.where((row) => historyText(row) == 'Older page'),
          hasLength(1),
        );
        expect(
          d.timeline.where((row) => historyText(row) == 'Stable answer'),
          hasLength(1),
        );
        expect(
          d.timeline.singleWhere(
            (row) => row['id'] == 'local-unsent',
          )['delivery'],
          'unknown',
        );
        expect(d.thread?['id'], 'thread');
      },
    );
  }

  for (final empty in [false, true]) {
    test('idle repair retains an unanchored page empty=$empty', () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, mirroredTail());
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        if (!empty) historyUser('foreign-user', 'foreign-turn', 'Other prompt'),
      ]);
      expect(
        d.timeline.where((row) => historyText(row) == 'Stale finding'),
        hasLength(1),
      );
      expect(d.activity.items, hasLength(1));
    });
  }

  for (final pending in [false, true]) {
    test(
      'new live ownership during a held idle read prevents repair pending=$pending',
      () async {
        final t = ReasoningTransport();
        final d = await historyDesktop(t, mirroredTail());
        addTearDown(d.dispose);
        final read = Completer<RemoteJson>();
        t.readGate = read;
        final loading = d.openThread({
          'id': 'thread',
          'cwd': '/qa',
        }, readOnlyNavigation: true);
        await Future<void>.delayed(Duration.zero);
        t.events.add({
          'method': 'turn/started',
          'params': {'threadId': 'thread', if (!pending) 'turnId': 'new-live'},
        });
        read.complete({
          'thread': historyPage([
            historyUser('canonical-user', 'real-turn', 'Repair this'),
          ]),
        });
        await loading;
        expect(d.error, isNull);
        expect(
          d.timeline.where((row) => historyText(row) == 'Stale finding'),
          hasLength(1),
        );
        expect(d.activity.items, hasLength(1));
        expect(t.calls.map((call) => call['method']), ['thread/read']);
      },
    );
  }
}
