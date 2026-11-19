import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/activity/domain/desktop_activity.dart';
import 'package:djl_mobile/features/reasoning/domain/desktop_reasoning.dart';
import 'package:djl_mobile/features/guardian/domain/guardian_review.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_response_footer.dart';
import 'package:djl_mobile/features/subagents/domain/subagent_action.dart';
import 'package:djl_mobile/features/workspace/domain/response_change_set.dart';
import 'guardian_review_test.dart' show guardianParams;
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop;

class HistorySendTransport extends ReasoningTransport {
  final sending = Completer<void>();
  final reply = Completer<RemoteJson>();
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'turn/start') {
      calls.add({'method': method, 'params': params});
      if (!sending.isCompleted) sending.complete();
      return reply.future;
    }
    return super.request(method, params, timeout: timeout);
  }
}

RemoteJson historyUser(
  String id,
  String turn,
  String text, {
  String delivery = 'confirmed',
  String? image,
  List<String>? files,
}) => {
  'id': id,
  'turnId': turn,
  'type': 'userMessage',
  'delivery': delivery,
  'content': <dynamic>[
    if (image != null) {'type': 'image', 'url': image},
    {'type': 'text', 'text': text},
  ],
  'fileMentions': ?files,
};
RemoteJson historyAnswer(String id, String turn, String text) => {
  'id': id,
  'turnId': turn,
  'type': 'agentMessage',
  'text': text,
};
RemoteJson historyPage(List<RemoteJson> rows, {bool running = false}) {
  final turns = <String, List<RemoteJson>>{};
  for (final row in rows) {
    (turns[row['turnId'] as String] ??= []).add(row);
  }
  return {
    'id': 'thread',
    'cwd': '/qa',
    'turns': [
      for (final entry in turns.entries)
        {
          'id': entry.key,
          'status': running ? 'inProgress' : 'completed',
          'items': entry.value,
        },
    ],
  };
}

Future<DesktopController> historyDesktop(
  ReasoningTransport t,
  List<RemoteJson> rows, {
  bool running = false,
}) async {
  t.history = historyPage(rows, running: running);
  final d = await reasoningDesktop(t);
  t.calls.clear();
  return d;
}

Future<void> refreshHistory(
  ReasoningTransport t,
  DesktopController d,
  List<RemoteJson> rows, {
  bool running = false,
}) async {
  t.history = historyPage(rows, running: running);
  await d.openThread({'id': 'thread', 'cwd': '/qa'}, readOnlyNavigation: true);
  expect(
    t.calls.where((c) => c['method'] != 'thread/read'),
    isEmpty,
    reason: 'Reconciliation must remain read-only',
  );
}

String historyText(RemoteJson row) => row['type'] == 'userMessage'
    ? (row['content'] as List? ?? [])
          .whereType<Map>()
          .where((p) => p['text'] is String)
          .map((p) => p['text'])
          .join('\n')
    : row['text'] as String? ?? '';
Object? historyWireId(RemoteJson row) => row['sourceItemId'] ?? row['id'];

void main() {
  test(
    'a committed project move rejects the previous folder history response',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyAnswer('saved', 'saved-turn', 'Saved before move'),
      ]);
      addTearDown(d.dispose);
      t.readGate = Completer();
      final reading = d.openThread({
        'id': 'thread',
        'cwd': '/qa',
      }, readOnlyNavigation: true);
      await Future<void>.delayed(Duration.zero);
      d.threadList.data.bindProject('thread', '/new-project');
      d.thread = {...d.thread!, 'cwd': '/new-project'};
      t.readGate!.complete({
        'thread': historyPage([
          historyAnswer('foreign-folder', 'old-turn', 'Old folder result'),
        ]),
      });
      await reading;
      expect(d.thread?['cwd'], '/new-project');
      expect(d.timeline.map(historyText), ['Saved before move']);
    },
  );

  test(
    'a newer inactive replacement schedules a fresh read after coalescing',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      d.threadList.data.upsert({'id': 'child', 'cwd': '/qa'});
      final first = Completer<RemoteJson>(), second = Completer<RemoteJson>();
      t.readGate = first;
      t.events.add({
        'method': 'thread/replaced',
        'params': {'threadId': 'child'},
      });
      for (var i = 0; i < 5; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      t.readGate = second;
      t.events.add({
        'method': 'thread/replaced',
        'params': {'threadId': 'child'},
      });
      first.complete({
        'thread': {...historyPage([]), 'id': 'child'},
      });
      for (var i = 0; i < 5; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(t.calls.where((c) => c['method'] == 'thread/read'), hasLength(2));
      second.complete({
        'thread': {
          ...historyPage([
            historyAnswer('latest', 'canonical', 'Latest child'),
          ]),
          'id': 'child',
        },
      });
      for (var i = 0; i < 5; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(d.threadList.data.timelines['child']!.map(historyText), [
        'Latest child',
      ]);
      expect(d.thread?['id'], 'thread');
      expect(t.calls.map((c) => c['method']).toSet(), {'thread/read'});
    },
  );
  test(
    'a long projected prompt transcript upgrades without duplicate prompts',
    () async {
      final t = ReasoningTransport();
      final seed = List.generate(
        1500,
        (i) =>
            historyUser('ipc-turn-$i:input', 'ipc-turn-$i', 'Unique prompt $i'),
      );
      final d = await historyDesktop(t, seed);
      addTearDown(d.dispose);
      final watch = Stopwatch()..start();
      await refreshHistory(
        t,
        d,
        List.generate(
          1500,
          (i) => historyUser(
            'canonical-user-$i',
            'canonical-turn-$i',
            'Unique prompt $i',
          ),
        ),
      );
      expect(d.timeline, hasLength(1500));
      expect(
        d.timeline.every(
          (r) => (r['turnId'] as String).startsWith('canonical-turn-'),
        ),
        isTrue,
      );
      debugPrint(
        'history72 1500 projected prompt upgrades: ${watch.elapsedMilliseconds}ms',
      );
    },
    timeout: const Timeout(Duration(seconds: 60)),
  );

  for (final kind in ['commandExecution', 'reasoning']) {
    for (final localCount in [1, 2]) {
      test(
        'ambiguous $kind detail identities remain separate local=$localCount',
        () async {
          final t = ReasoningTransport();
          RemoteJson detail(String item, String turn) => {
            'id': item,
            'turnId': turn,
            'type': kind,
            'status': 'completed',
            'command': 'echo QA',
            'summary': 'Same detail',
          };
          final d = await historyDesktop(t, [
            historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Fix this'),
            for (var i = 0; i < localCount; i++)
              detail('rollout-$i', 'ipc-turn-0'),
          ]);
          addTearDown(d.dispose);
          final canonicalCount = localCount == 1 ? 2 : 1;
          await refreshHistory(t, d, [
            historyUser('canonical-user', 'canonical-turn', 'Fix this'),
            for (var i = 0; i < canonicalCount; i++)
              detail('provider-$i', 'canonical-turn'),
          ]);
          expect(d.timeline.where((r) => r['type'] == kind), hasLength(3));
        },
      );
    }
  }
  for (final kind in [
    'commandExecution',
    'reasoning',
    'collabAgentToolCall',
    'plan',
  ]) {
    test(
      'canonical $kind item identity replaces a unique mirror detail',
      () async {
        final t = ReasoningTransport();
        RemoteJson detail(String item, String turn) => {
          'id': item,
          'turnId': turn,
          'type': kind,
          'status': 'completed',
          'command': 'echo QA',
          'summary': 'Saved reasoning',
          'output': 'Saved output',
          'text': 'Saved plan',
          'tool': 'wait',
          'receiverAgents': [
            {'threadId': 'child', 'agentNickname': 'Known child'},
          ],
        };
        final d = await historyDesktop(t, [
          historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Fix this'),
          detail('rollout-detail', 'ipc-turn-0'),
        ]);
        addTearDown(d.dispose);
        await refreshHistory(t, d, [
          historyUser('canonical-user', 'canonical-turn', 'Fix this'),
          detail('canonical-detail', 'canonical-turn'),
        ]);
        final row = d.timeline.singleWhere(
          (r) =>
              r['type'] ==
              (kind == 'collabAgentToolCall' ? 'subagentAction' : kind),
        );
        expect(row['turnId'], 'canonical-turn');
        if (kind == 'reasoning') {
          expect(
            DesktopReasoning.fromRow(row)?.identity.item,
            'canonical-detail',
          );
        } else if (kind == 'commandExecution') {
          expect(DesktopActivity.fromRow(row)?.item, 'canonical-detail');
        } else if (kind == 'collabAgentToolCall') {
          expect((row['subagent'] as Map)['item'], 'canonical-detail');
        } else {
          expect(historyWireId(row), 'canonical-detail');
        }
      },
    );
  }
  for (final kind in ['userMessage', 'commandExecution', 'reasoning']) {
    for (final alias in ['threadId', 'turn_id']) {
      test('history cannot transplant $kind with a foreign $alias', () async {
        final t = ReasoningTransport();
        final d = await historyDesktop(t, []);
        addTearDown(d.dispose);
        await refreshHistory(t, d, [
          {
            ...historyUser('foreign', 'canonical-turn', 'Foreign payload'),
            'type': kind,
            alias: 'foreign-context',
            'command': 'echo foreign',
            'summary': 'Foreign payload',
          },
        ]);
        expect(d.timeline, isEmpty);
        expect(d.activity.items, isEmpty);
      });
    }
  }

  test(
    'a proven upgrade retains an omitted raw plan in its owned block while running',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Fix this'),
        {
          'id': 'rollout-plan',
          'turnId': 'ipc-turn-0',
          'type': 'plan',
          'text': 'Saved plan',
        },
      ], running: true);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        historyUser('canonical-user', 'canonical-turn', 'Fix this'),
      ]);
      expect(
        d.timeline.singleWhere((r) => r['type'] == 'plan')['turnId'],
        'canonical-turn',
      );
    },
  );

  for (final kind in ['agentMessage', 'commandExecution', 'reasoning']) {
    test('source replacement protects newer live $kind data', () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Fix this'),
      ], running: true);
      addTearDown(d.dispose);
      t.readGate = Completer();
      t.events.add({
        'method': 'thread/replaced',
        'params': {'threadId': 'thread'},
      });
      for (var i = 0; i < 5; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      t.events.add({
        'method': 'item/started',
        'params': {
          'threadId': 'thread',
          'turnId': 'ipc-turn-0',
          'item': {
            'id': 'rollout-new',
            'type': kind,
            'text': 'Newer live',
            'summary': 'Newer live',
            'command': 'echo newer',
          },
        },
      });
      expect(
        d.timeline.where((r) => r['type'] == kind),
        hasLength(1),
        reason: 'The live item must exist before the old response arrives',
      );
      t.readGate!.complete({
        'thread': historyPage([
          historyUser('canonical-user', 'canonical-turn', 'Fix this'),
        ]),
      });
      for (var i = 0; i < 5; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(d.timeline.where((r) => r['type'] == kind), hasLength(1));
      expect(
        d.timeline.singleWhere((r) => r['type'] == kind)['turnId'],
        'ipc-turn-0',
      );
    });
  }
  for (final anchored in [false, true]) {
    test(
      'canonical source replacement prunes only a proven mirrored tail anchored=$anchored',
      () async {
        final t = ReasoningTransport();
        final d = await historyDesktop(t, [
          historyAnswer(
            'rollout-older',
            'ipc-turn-earlier',
            'Older cached page',
          ),
          historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Fix this'),
          historyAnswer('rollout-stale', 'ipc-turn-0', 'Stale mirror finding'),
          {
            'id': 'rollout-command',
            'turnId': 'ipc-turn-0',
            'type': 'commandExecution',
            'command': 'echo stale',
            'status': 'completed',
          },
          historyAnswer(
            'stable-provider-answer',
            'stable-turn',
            'Stable saved answer',
          ),
        ]);
        addTearDown(d.dispose);
        final pending = historyUser(
          'local-unsent',
          '',
          'Unsent input',
          delivery: 'unknown',
        )..remove('turnId');
        d.timeline.add(pending);
        t.readGate = Completer();
        t.events.add({
          'method': 'thread/replaced',
          'params': {'threadId': 'thread'},
        });
        for (var i = 0; i < 5; i++) {
          await Future<void>.delayed(Duration.zero);
        }
        expect(t.calls.map((c) => c['method']), ['thread/read']);
        t.readGate!.complete({
          'thread': historyPage([
            historyUser(
              'canonical-user',
              'canonical-turn',
              anchored ? 'Fix this' : 'Unrelated prompt',
            ),
          ]),
        });
        for (var i = 0; i < 5; i++) {
          await Future<void>.delayed(Duration.zero);
        }
        expect(d.error, isNull);
        expect(
          d.timeline.where((r) => historyText(r) == 'Older cached page'),
          hasLength(1),
        );
        expect(
          d.timeline.where((r) => historyText(r) == 'Stable saved answer'),
          hasLength(1),
        );
        expect(
          d.timeline.where((r) => historyText(r) == 'Stale mirror finding'),
          hasLength(anchored ? 0 : 1),
        );
        expect(d.activity.items, hasLength(anchored ? 0 : 1));
        expect(
          d.timeline.singleWhere((r) => r['id'] == 'local-unsent')['delivery'],
          'unknown',
        );
      },
    );
  }
  test(
    'read-only child hydration reconciles canonical ordinary data without changing selection',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyAnswer('parent-answer', 'parent-turn', 'Parent stays selected'),
      ]);
      addTearDown(d.dispose);
      d.threadList.data.timelines['child'] = [
        historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Child prompt'),
        historyAnswer('rollout-answer', 'ipc-turn-0', 'Child saved answer'),
      ];
      t.history = {
        ...historyPage([
          historyUser('child-user', 'child-canonical', 'Child prompt'),
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
      expect(rows.map(historyText), ['Child prompt']);
      expect(rows.map((r) => r['turnId']).toSet(), {'child-canonical'});
      expect(d.thread?['id'], 'thread');
      expect(d.timeline.map(historyText), ['Parent stays selected']);
      expect(t.calls.map((c) => c['method']).toSet(), {'thread/read'});
    },
  );

  test(
    'inactive fork hydration cannot shorten assistant data received after its read',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      t.forkGate = Completer();
      final forking = d.forkThread();
      await Future<void>.delayed(Duration.zero);
      t.history = {'id': 'other', 'turns': []};
      await d.openThread({'id': 'other'}, readOnlyNavigation: true);
      t.history = {
        ...historyPage([historyAnswer('answer', 'fork-turn', 'Old')]),
        'id': 'forked',
      };
      t.readGate = Completer();
      t.forkGate!.complete({'thread': t.history});
      for (var i = 0; i < 5; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(
        t.calls.where(
          (c) =>
              c['method'] == 'thread/read' &&
              (c['params'] as Map)['threadId'] == 'forked',
        ),
        hasLength(1),
      );
      t.events.add({
        'method': 'item/agentMessage/delta',
        'params': {
          'threadId': 'forked',
          'turnId': 'fork-turn',
          'itemId': 'answer',
          'delta': 'Newer live answer',
        },
      });
      t.readGate!.complete({'thread': t.history});
      expect(await forking, isTrue);
      expect(d.thread?['id'], 'other');
      expect(d.threadList.data.timelines['forked']!.map(historyText), [
        'Newer live answer',
      ]);
    },
  );
  for (final blocked in ['applying', 'conflicting canonical provenance']) {
    test('a turn upgrade preserves ownership during $blocked', () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Fix this'),
      ]);
      addTearDown(d.dispose);
      final ledger = d.threadList.data.responseChanges;
      final old = ledger.entry('thread', 'ipc-turn-0', '/qa')
        ..applying = blocked == 'applying';
      if (blocked != 'applying') {
        ledger.entry('thread', 'canonical-turn', '/other-workspace');
      }
      await refreshHistory(t, d, [
        historyUser('canonical-user', 'canonical-turn', 'Fix this'),
      ]);
      expect(old.turn, 'ipc-turn-0');
      expect(identical(ledger.entries[old.id], old), isTrue);
      expect(
        d.timeline.where((r) => r['turnId'] == 'ipc-turn-0'),
        hasLength(1),
      );
      expect(
        d.timeline.where((r) => r['turnId'] == 'canonical-turn'),
        hasLength(1),
      );
    });
  }
  test(
    'a proven turn upgrade retains exact undo provenance and review state',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Fix this'),
        historyAnswer('rollout-answer', 'ipc-turn-0', 'Saved answer'),
      ]);
      addTearDown(d.dispose);
      const rawPatch =
          'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old  \n+new  \n';
      final entry =
          d.threadList.data.responseChanges.entry('thread', 'ipc-turn-0', '/qa')
            ..aggregate = ResponsePatch('raw', rawPatch)
            ..assistant = 'rollout-answer'
            ..terminal = true
            ..uncertain = true
            ..reviewRevision = 7;
      entry.evidence.add('a.txt');
      await refreshHistory(t, d, [
        historyUser('canonical-user', 'canonical-turn', 'Fix this'),
      ]);
      final rebound = d.responseChangesFor('rollout-answer')!;
      expect(rebound.turn, 'canonical-turn');
      expect(rebound.aggregate?.forwardPatch, rawPatch);
      expect(rebound.uncertain, isTrue);
      expect(rebound.reviewRevision, 7);
      expect(rebound.applying, isFalse);
      expect(d.threadList.data.responseChanges.entries, hasLength(1));
    },
  );

  test(
    'an older snapshot cannot reassign a newer live projected turn',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      t.readGate = Completer();
      final reading = d.openThread({
        'id': 'thread',
        'cwd': '/qa',
      }, readOnlyNavigation: true);
      await Future<void>.delayed(Duration.zero);
      t.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread',
          'turnId': 'ipc-turn-new',
          'item': historyUser(
            'ipc-turn-new:input',
            'ipc-turn-new',
            'Run again',
          ),
        },
      });
      t.readGate!.complete({
        'thread': historyPage([
          historyUser(
            'older-canonical-user',
            'older-canonical-turn',
            'Run again',
          ),
        ]),
      });
      await reading;
      expect(
        d.timeline.singleWhere(
          (r) => historyWireId(r) == 'ipc-turn-new:input',
        )['turnId'],
        'ipc-turn-new',
      );
      expect(
        d.timeline.where((r) => r['turnId'] == 'older-canonical-turn'),
        hasLength(1),
      );
    },
  );
  test(
    'a canonical terminal retires the proven provisional running footer',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Fix this'),
      ], running: true);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        historyUser('canonical-user', 'canonical-turn', 'Fix this'),
      ]);
      expect(d.selectedResponseFooter.outcomes.keys, ['canonical-turn']);
      expect(
        d.selectedResponseFooter.latestOutcome,
        DesktopResponseOutcome.completed,
      );
      expect(d.selectedResponseFooter.suppressesLatest, isFalse);
    },
  );

  test('a proven opener upgrade rebinds omitted subagent ownership', () async {
    final t = ReasoningTransport();
    final d = await historyDesktop(t, [
      historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Fix this'),
      {
        'id': 'wait-detail',
        'type': 'collabAgentToolCall',
        'tool': 'wait',
        'status': 'completed',
        'turnId': 'ipc-turn-0',
      },
    ]);
    addTearDown(d.dispose);
    await refreshHistory(t, d, [
      historyUser('canonical-user', 'canonical-turn', 'Fix this'),
    ]);
    final row = d.timeline.singleWhere(isSubagentItem);
    expect(row['turnId'], 'canonical-turn');
    expect((row['subagent'] as Map)['turn'], 'canonical-turn');
    expect(d.subagents.items.values.single.turn, 'canonical-turn');
  });

  test(
    'a proven guardian display upgrade cannot carry a live retry grant',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Fix this'),
      ]);
      addTearDown(d.dispose);
      t.events.add({
        'method': 'item/autoApprovalReview/completed',
        'params': {...guardianParams(thread: 'thread'), 'turnId': 'ipc-turn-0'},
      });
      expect(
        d.guardian.find('thread', 'review-1')?.retryUnavailableReason,
        isNull,
      );
      expect(d.timeline.where(isGuardianRow), hasLength(1));
      await refreshHistory(t, d, [
        historyUser('canonical-user', 'canonical-turn', 'Fix this'),
      ]);
      final row = d.timeline.singleWhere(isGuardianRow);
      expect(row['turnId'], 'canonical-turn');
      expect(GuardianReview.fromRow(row)?.turnId, 'canonical-turn');
      expect(d.guardian.find('thread', 'review-1')?.turnId, 'canonical-turn');
      expect(
        d.guardian.consume('thread', 'review-1', 'mac-a', 'secure-a'),
        isNull,
      );
    },
  );
  for (final kind in ['commandExecution', 'reasoning']) {
    test('a proven opener upgrade rebinds omitted $kind ownership', () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Fix this'),
        {
          'id': 'detail',
          'type': kind,
          'turnId': 'ipc-turn-0',
          'command': 'echo QA',
          'status': 'completed',
          'summary': 'Saved reasoning',
          'output': 'Saved output',
        },
      ]);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        historyUser('canonical-user', 'canonical-turn', 'Fix this'),
      ]);
      final row = d.timeline.singleWhere((r) => r['type'] == kind);
      expect(row['turnId'], 'canonical-turn');
      if (kind == 'reasoning') {
        expect(DesktopReasoning.fromRow(row)?.turn, 'canonical-turn');
        expect(row['text'], 'Saved reasoning');
      } else {
        expect(DesktopActivity.fromRow(row)?.turn, 'canonical-turn');
        expect(d.activity.items.values.single.turn, 'canonical-turn');
      }
      await refreshHistory(t, d, []);
      expect(d.timeline.where((r) => r['type'] == kind), hasLength(1));
      expect(d.timeline.map((r) => r['turnId']).toSet(), {'canonical-turn'});
    });
  }
  test(
    'canonical order moves each represented turn with its local-only rows',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('user-a', 'turn-a', 'Prompt A'),
        historyAnswer('local-a', 'turn-a', 'Local A'),
        historyUser('user-b', 'turn-b', 'Prompt B'),
        historyAnswer('local-b', 'turn-b', 'Local B'),
      ]);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        historyUser('user-b', 'turn-b', 'Prompt B'),
        historyUser('user-a', 'turn-a', 'Prompt A'),
      ]);
      expect(d.timeline.map(historyText), [
        'Prompt B',
        'Local B',
        'Prompt A',
        'Local A',
      ]);
    },
  );

  test(
    'newly recovered history stays before a trailing turnless pending prompt',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('user-a', 'turn-a', 'Prompt A'),
        historyAnswer('local-a', 'turn-a', 'Local A'),
      ]);
      addTearDown(d.dispose);
      d.timeline.add(
        historyUser('local-pending', '', 'Unsent pending', delivery: 'pending')
          ..remove('turnId'),
      );
      await refreshHistory(t, d, [
        historyUser('user-b', 'turn-b', 'Recovered B'),
        historyUser('user-a', 'turn-a', 'Prompt A'),
      ]);
      expect(d.timeline.map(historyText), [
        'Recovered B',
        'Prompt A',
        'Local A',
        'Unsent pending',
      ]);
      expect(d.timeline.last['delivery'], 'pending');
    },
  );

  test(
    'one canonical provider item heals exact duplicate assistant rows already cached',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyAnswer('answer', 'real-turn', 'Partial'),
      ]);
      addTearDown(d.dispose);
      d.timeline.add({...d.timeline.single});
      await refreshHistory(t, d, [
        historyAnswer('answer', 'real-turn', 'Canonical complete'),
      ]);
      expect(d.timeline, hasLength(1));
      expect(historyWireId(d.timeline.single), 'answer');
      expect(historyText(d.timeline.single), 'Canonical complete');
    },
  );

  test(
    'a long provider transcript preserves canonical order and all exact identities',
    () async {
      final t = ReasoningTransport();
      final seed = List.generate(
        1500,
        (i) => historyAnswer('answer-$i', 'real-turn', 'Saved entry $i'),
      );
      final watch = Stopwatch()..start();
      final d = await historyDesktop(t, seed);
      addTearDown(d.dispose);
      await refreshHistory(
        t,
        d,
        seed.reversed
            .map((r) => {...r, 'text': 'Canonical ${r['id']}'})
            .toList(),
      );
      expect(d.timeline, hasLength(1500));
      expect(d.timeline.map(historyWireId).toSet(), hasLength(1500));
      expect(historyWireId(d.timeline.first), 'answer-1499');
      expect(historyWireId(d.timeline.last), 'answer-0');
      debugPrint(
        'history72 1500-row load and refresh: ${watch.elapsedMilliseconds}ms',
      );
    },
    timeout: const Timeout(Duration(seconds: 10)),
  );

  test(
    'an identity-less running snapshot cannot append beside a stable live assistant',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyAnswer('answer', 'running', 'Initial'),
      ], running: true);
      addTearDown(d.dispose);
      t.events.add({
        'method': 'item/agentMessage/delta',
        'params': {
          'threadId': 'thread',
          'turnId': 'running',
          'itemId': 'answer',
          'delta': ' plus live',
        },
      });
      await refreshHistory(t, d, [
        historyAnswer('', 'running', 'Flattened unrelated snapshot')
          ..remove('id'),
      ], running: true);
      expect(d.timeline.map(historyText), ['Initial plus live']);
      expect(historyWireId(d.timeline.single), 'answer');
    },
  );

  test(
    'one provisional assistant cannot absorb several distinct canonical assistant items',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyAnswer('rollout-answer', 'real-turn', 'Provisional combined'),
      ]);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        historyAnswer('part-one', 'real-turn', 'First canonical item'),
        historyAnswer('part-two', 'real-turn', 'Second canonical item'),
      ]);
      expect(d.timeline.map(historyWireId).toSet(), {
        'rollout-answer',
        'part-one',
        'part-two',
      });
    },
  );

  test(
    'an active live bubble remains authoritative on a later running snapshot',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyAnswer('answer', 'running', 'Initial'),
      ], running: true);
      addTearDown(d.dispose);
      t.events.add({
        'method': 'item/agentMessage/delta',
        'params': {
          'threadId': 'thread',
          'turnId': 'running',
          'itemId': 'answer',
          'delta': ' plus live',
        },
      });
      await refreshHistory(t, d, [
        historyAnswer('answer', 'running', 'Older flattened snapshot'),
      ], running: true);
      expect(d.timeline.map(historyText), ['Initial plus live']);
    },
  );

  test(
    'newer live completion survives an already pending running read',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyAnswer('answer', 'running', 'Initial'),
      ], running: true);
      addTearDown(d.dispose);
      t.readGate = Completer();
      final reading = d.openThread({
        'id': 'thread',
        'cwd': '/qa',
      }, readOnlyNavigation: true);
      await Future<void>.delayed(Duration.zero);
      t.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread',
          'turnId': 'running',
          'item': historyAnswer(
            'answer',
            'running',
            'Different canonical completion',
          ),
        },
      });
      t.readGate!.complete({
        'thread': historyPage([
          historyAnswer('answer', 'running', 'Initial'),
        ], running: true),
      });
      await reading;
      expect(d.timeline.map(historyText), ['Different canonical completion']);
    },
  );

  test(
    'source-line identity alone cannot reconcile two provisional assistant rows',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyAnswer('response-item-line-1', 'turn-line-1', 'Repeated'),
      ]);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        historyAnswer('response-item-line-1', 'turn-line-1', 'Repeated'),
      ]);
      expect(d.timeline, hasLength(2));
      expect(d.timeline.map((r) => r['id']).toSet(), hasLength(2));
    },
  );

  test(
    'a line fallback with one real shared turn and exact text upgrades safely',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyAnswer('response-item-line-1', 'real-turn', 'Answer'),
      ]);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        historyAnswer('real-answer', 'real-turn', 'Answer'),
      ]);
      expect(d.timeline, hasLength(1));
      expect(historyWireId(d.timeline.single), 'real-answer');
    },
  );

  for (final incoming in ['Partial', 'Canonical complete']) {
    test(
      'closed provisional assistant reconciles a unique same-turn snapshot: $incoming',
      () async {
        final t = ReasoningTransport();
        final d = await historyDesktop(t, [
          historyAnswer(
            'rollout-answer',
            'real-turn',
            'Partial completed answer',
          ),
        ]);
        addTearDown(d.dispose);
        await refreshHistory(t, d, [
          historyAnswer('real-answer', 'real-turn', incoming),
        ]);
        expect(d.timeline, hasLength(1));
        expect(
          historyText(d.timeline.single),
          incoming == 'Partial' ? 'Partial completed answer' : incoming,
        );
      },
    );
  }

  for (final shape in ['snake', 'foreign', 'conflict', 'stale-session']) {
    test('ordinary item scope is normalized or rejected for $shape', () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      final params = <String, dynamic>{
        if (shape != 'snake') 'threadId': 'thread',
        if (shape == 'snake' || shape == 'foreign')
          'thread_id': shape == 'foreign' ? 'other' : 'thread',
        'turnId': 'real-turn',
        'item': {
          ...historyUser('user-real', 'real-turn', 'Scoped input'),
          if (shape == 'conflict') 'threadId': 'other',
        },
      };
      t.events.add({
        'method': 'item/completed',
        'params': params,
        if (shape == 'stale-session') '_sessionId': 'obsolete-session',
      });
      if (shape == 'snake') {
        expect(d.timeline, hasLength(1));
        expect(historyText(d.timeline.single), 'Scoped input');
      } else {
        expect(d.timeline, isEmpty);
      }
    });
  }

  for (final text in ['x' * 64001, '🙂' * 17000]) {
    test(
      'oversized user text keeps exact bytes instead of whitespace normalization length=${text.length}',
      () async {
        final t = ReasoningTransport();
        final d = await historyDesktop(t, [
          historyUser('ipc-turn-0:input', 'ipc-turn-0', ' $text'),
        ]);
        addTearDown(d.dispose);
        await refreshHistory(t, d, [
          historyUser('real-user', 'real-turn', text),
        ]);
        expect(d.timeline, hasLength(2));
        expect(d.timeline.map((r) => r['turnId']).toSet(), {
          'ipc-turn-0',
          'real-turn',
        });
      },
    );
  }

  test(
    'canonical source identity still receives later live deltas and completion',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Fix'),
        historyAnswer(
          'turn:ipc-turn-0|kind:assistant',
          'ipc-turn-0',
          'Initial',
        ),
      ], running: true);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        historyUser('real-user', 'real-turn', 'Fix'),
        historyAnswer('real-answer', 'real-turn', 'Initial'),
      ], running: true);
      final uiId = d.timeline.singleWhere(
        (r) => r['type'] == 'agentMessage',
      )['id'];
      t.events.add({
        'method': 'item/agentMessage/delta',
        'params': {
          'threadId': 'thread',
          'turnId': 'real-turn',
          'itemId': 'real-answer',
          'delta': ' plus live',
        },
      });
      var answers = d.timeline
          .where((r) => r['type'] == 'agentMessage')
          .toList();
      expect(answers, hasLength(1));
      expect(answers.single['id'], uiId);
      expect(historyText(answers.single), 'Initial plus live');
      t.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread',
          'turnId': 'real-turn',
          'item': historyAnswer('real-answer', 'real-turn', 'Canonical final'),
        },
      });
      answers = d.timeline.where((r) => r['type'] == 'agentMessage').toList();
      expect(answers, hasLength(1));
      expect(answers.single['id'], uiId);
      expect(historyWireId(answers.single), 'real-answer');
      expect(historyText(answers.single), 'Canonical final');
    },
  );

  test(
    'live projected item collision preserves both different prompts',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('ipc-turn-0:input', 'ipc-turn-0', 'First prompt'),
      ]);
      addTearDown(d.dispose);
      t.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread',
          'turnId': 'ipc-turn-0',
          'djlDesktopMirror': true,
          'item': historyUser(
            'ipc-turn-0:input',
            'ipc-turn-0',
            'Second prompt',
          ),
        },
      });
      expect(d.timeline.map(historyText).toSet(), {
        'First prompt',
        'Second prompt',
      });
      expect(d.timeline.map((r) => r['id']).toSet(), hasLength(2));
    },
  );

  test(
    'live projected replay coalesces a real prompt without identity downgrade',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('real-user', 'real-turn', 'Prompt'),
      ]);
      addTearDown(d.dispose);
      t.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread',
          'turnId': 'ipc-turn-0',
          'djlDesktopMirror': true,
          'item': historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Prompt'),
        },
      });
      expect(d.timeline, hasLength(1));
      expect(historyWireId(d.timeline.single), 'real-user');
      expect(d.timeline.single['turnId'], 'real-turn');
    },
  );

  test(
    'live distinct provider user IDs preserve an intentional same-turn repeat',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('user-a', 'real-turn', 'Repeat'),
      ]);
      addTearDown(d.dispose);
      t.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread',
          'turnId': 'real-turn',
          'item': historyUser('user-b', 'real-turn', 'Repeat'),
        },
      });
      expect(d.timeline.map(historyWireId), ['user-a', 'user-b']);
    },
  );

  test(
    'legacy mirrored user message appears as one confirmed user row',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      t.events.add({
        'method': 'codex/event/user_message',
        'params': {
          'threadId': 'thread',
          'turnId': 'real-turn',
          'id': 'legacy-user',
          'message': 'Public desktop prompt',
          'djlDesktopMirror': true,
        },
      });
      expect(d.timeline, hasLength(1));
      expect(d.timeline.single['type'], 'userMessage');
      expect(d.timeline.single['delivery'], 'confirmed');
      expect(historyText(d.timeline.single), 'Public desktop prompt');
    },
  );

  test(
    'late send acknowledgement updates the pending row retained through a sparse refresh',
    () async {
      final t = HistorySendTransport();
      final d = await historyDesktop(t, [
        historyAnswer('old-answer', 'old-turn', 'Saved'),
      ]);
      addTearDown(d.dispose);
      d.model = 'qa';
      final sending = d.send('Local pending input');
      await t.sending.future;
      t.calls.clear();
      await refreshHistory(t, d, [
        historyAnswer('old-answer', 'old-turn', 'Saved'),
      ]);
      t.reply.complete({
        'turn': {'id': 'accepted-turn'},
      });
      expect(await sending, isTrue, reason: d.error);
      final row = d.timeline.singleWhere(
        (r) => historyText(r) == 'Local pending input',
      );
      expect(row['delivery'], 'confirmed');
      expect(row['turnId'], 'accepted-turn');
    },
  );

  test(
    'structured skill/plugin mentions reconcile their legacy text projection',
    () async {
      final t = ReasoningTransport();
      final local = historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Inspect');
      (local['content'] as List).addAll([
        {
          'type': 'skill',
          'id': 'review-id',
          'name': 'Review',
          'path': '/skills/review',
        },
        {'type': 'mention', 'name': 'Drive', 'path': 'plugin://drive@official'},
      ]);
      final d = await historyDesktop(t, [local]);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        historyUser('real-user', 'real-turn', 'inspect\n\n\$review @drive'),
      ]);
      expect(d.timeline, hasLength(1));
      expect(d.timeline.single['turnId'], 'real-turn');
      final content = (d.timeline.single['content'] as List).whereType<Map>();
      expect(content.where((p) => p['type'] == 'skill'), hasLength(1));
      expect(content.where((p) => p['type'] == 'mention'), hasLength(1));
    },
  );

  test(
    'omitted canonical attachment metadata retains the known local attachment',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser(
          'ipc-turn-0:input',
          'ipc-turn-0',
          'Inspect',
          image: 'data:image/png;base64,YQ==',
        ),
      ]);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        historyUser('real-user', 'real-turn', 'Inspect'),
      ]);
      expect(d.timeline, hasLength(1));
      final image = (d.timeline.single['content'] as List)
          .whereType<Map>()
          .singleWhere(desktopIsImage);
      expect(desktopImageSource(image), 'data:image/png;base64,YQ==');
    },
  );

  for (final conflict in ['image', 'file']) {
    test(
      'contradictory confirmed $conflict metadata cannot prove a turn upgrade',
      () async {
        final t = ReasoningTransport();
        final d = await historyDesktop(t, [
          historyUser(
            'ipc-turn-0:input',
            'ipc-turn-0',
            'Inspect',
            image: conflict == 'image' ? 'data:image/png;base64,YQ==' : null,
            files: conflict == 'file' ? ['a.dart'] : null,
          ),
        ]);
        addTearDown(d.dispose);
        await refreshHistory(t, d, [
          historyUser(
            'real-user',
            'real-turn',
            'Inspect',
            image: conflict == 'image' ? 'data:image/png;base64,Yg==' : null,
            files: conflict == 'file' ? ['b.dart'] : null,
          ),
        ]);
        expect(d.timeline.map((r) => r['turnId']).toSet(), {
          'ipc-turn-0',
          'real-turn',
        });
      },
    );
  }

  test(
    'one canonical page keeps intentionally repeated projected prompts separate',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Run again'),
        historyUser('ipc-turn-1:input', 'ipc-turn-1', 'Run again'),
      ]);
      addTearDown(d.dispose);
      expect(d.timeline.map((r) => r['turnId']), ['ipc-turn-0', 'ipc-turn-1']);
      expect(d.timeline.map(historyWireId), [
        'ipc-turn-0:input',
        'ipc-turn-1:input',
      ]);
    },
  );

  for (final empty in [false, true]) {
    test(
      'a ${empty ? 'empty' : 'sparse'} page retains older cached ordinary rows',
      () async {
        final t = ReasoningTransport();
        final d = await historyDesktop(t, [
          historyAnswer('older', 'turn-older', 'Older saved answer'),
          historyAnswer('latest', 'turn-latest', 'Latest saved answer'),
        ]);
        addTearDown(d.dispose);
        await refreshHistory(
          t,
          d,
          empty
              ? []
              : [historyAnswer('latest', 'turn-latest', 'Canonical latest')],
        );
        expect(
          d.timeline.map(historyText),
          empty
              ? ['Older saved answer', 'Latest saved answer']
              : ['Older saved answer', 'Canonical latest'],
        );
      },
    );
  }

  test(
    'reused projected prompt identity never overwrites different prompt text',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('ipc-turn-1:input', 'ipc-turn-1', 'Prompt B'),
      ]);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        historyUser('ipc-turn-1:input', 'ipc-turn-1', 'Prompt A'),
      ]);
      expect(d.timeline.map(historyText).toSet(), {'Prompt A', 'Prompt B'});
      expect(d.timeline.map((r) => r['id']).toSet(), hasLength(2));
      expect(d.timeline.map(historyWireId).toSet(), {'ipc-turn-1:input'});
    },
  );

  test(
    'equal assistant text under distinct real identities remains two rows',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyAnswer('answer-a', 'turn-a', 'Done'),
      ]);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [historyAnswer('answer-b', 'turn-b', 'Done')]);
      expect(d.timeline.map(historyWireId), ['answer-a', 'answer-b']);
      expect(d.timeline.map((r) => r['turnId']), ['turn-a', 'turn-b']);
    },
  );

  test(
    'a unique opener upgrades its omitted local ordinary turn block while running',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Fix this'),
        historyAnswer('rollout-answer', 'ipc-turn-0', 'Local finding'),
      ], running: true);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        historyUser('user-real', 'turn-real', 'Fix this'),
      ]);
      expect(d.timeline.map(historyText), ['Fix this', 'Local finding']);
      expect(d.timeline.map((r) => r['turnId']).toSet(), {'turn-real'});
      expect(historyWireId(d.timeline.first), 'user-real');
    },
  );

  test(
    'repeated provisional openers cannot collapse onto one canonical opener',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Run again'),
        historyAnswer('rollout-first', 'ipc-turn-0', 'First finding'),
        historyUser('ipc-turn-1:input', 'ipc-turn-1', 'Run again'),
        historyAnswer('rollout-second', 'ipc-turn-1', 'Second finding'),
      ]);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        historyUser('canonical-user', 'turn-real', 'Run again'),
      ]);
      expect(
        d.timeline.where((r) => r['turnId'] == 'ipc-turn-0').map(historyText),
        ['Run again', 'First finding'],
      );
      expect(
        d.timeline.where((r) => r['turnId'] == 'ipc-turn-1').map(historyText),
        ['Run again', 'Second finding'],
      );
      expect(d.timeline.where((r) => r['turnId'] == 'turn-real'), hasLength(1));
    },
  );

  test(
    'distinct stable opener identities cannot promote an unrelated turn',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('old-provider-user', 'ipc-turn-0', 'Run again'),
        historyAnswer('rollout-first', 'ipc-turn-0', 'Earlier finding'),
      ]);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        historyUser('new-provider-user', 'canonical-turn', 'Run again'),
      ]);
      expect(
        d.timeline.where((r) => r['turnId'] == 'ipc-turn-0'),
        hasLength(2),
      );
      expect(
        d.timeline.where((r) => r['turnId'] == 'canonical-turn'),
        hasLength(1),
      );
    },
  );

  test(
    'projected replay of a real prompt cannot downgrade its real turn or source ID',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyUser('real-user', 'real-turn', 'Same prompt'),
      ]);
      addTearDown(d.dispose);
      await refreshHistory(t, d, [
        historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Same prompt'),
      ]);
      expect(d.timeline, hasLength(1));
      expect(d.timeline.single['turnId'], 'real-turn');
      expect(historyWireId(d.timeline.single), 'real-user');
    },
  );

  test(
    'history echo retains the pending inline preview and file mentions',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      final local = historyUser(
        'local-pending',
        '',
        ' inspect ',
        delivery: 'pending',
        image: 'data:image/png;base64,YQ==',
        files: ['hello.txt'],
      )..remove('turnId');
      d.timeline.add(local);
      await refreshHistory(t, d, [
        historyUser(
          'canonical',
          'turn-real',
          'inspect',
          image: '/qa/image.png',
          files: ['hello.txt'],
        ),
      ]);
      expect(d.timeline, hasLength(1));
      final image = (d.timeline.single['content'] as List)
          .whereType<Map>()
          .firstWhere(desktopIsImage);
      expect(image['_previewUrl'], 'data:image/png;base64,YQ==');
      expect(d.timeline.single['fileMentions'], ['hello.txt']);
      expect(d.timeline.single['delivery'], 'confirmed');
    },
  );

  for (final delivery in ['pending', 'unknown']) {
    test(
      'an omitted $delivery local user row remains unconfirmed and raw',
      () async {
        final t = ReasoningTransport();
        final d = await historyDesktop(t, [
          historyAnswer('answer', 'old', 'Saved'),
        ]);
        addTearDown(d.dispose);
        final local = historyUser(
          'local-unsent',
          '',
          '  Raw local input  ',
          delivery: delivery,
        )..remove('turnId');
        d.timeline.add(local);
        await refreshHistory(t, d, [historyAnswer('answer', 'old', 'Saved')]);
        final saved = d.timeline.singleWhere((r) => r['id'] == 'local-unsent');
        expect(saved, local);
        expect(saved['delivery'], delivery);
      },
    );
  }

  test(
    'a late stale history response cannot shorten newer live assistant text',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        historyAnswer('answer', 'running', 'Initial'),
      ], running: true);
      addTearDown(d.dispose);
      t.readGate = Completer();
      final reading = d.openThread({
        'id': 'thread',
        'cwd': '/qa',
      }, readOnlyNavigation: true);
      await Future<void>.delayed(Duration.zero);
      t.events.add({
        'method': 'item/agentMessage/delta',
        'params': {
          'threadId': 'thread',
          'turnId': 'running',
          'itemId': 'answer',
          'delta': ' plus live',
        },
      });
      t.readGate!.complete({
        'thread': historyPage([
          historyAnswer('answer', 'running', 'Initial'),
        ], running: true),
      });
      await reading;
      expect(d.timeline.map(historyText), ['Initial plus live']);
      expect(d.turnId, 'running');
    },
  );
}
