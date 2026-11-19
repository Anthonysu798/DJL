import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_response_footer.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/reasoning/domain/desktop_reasoning.dart';
import 'package:djl_mobile/features/status/domain/run_status.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/workspace/domain/response_change_set.dart';
import 'package:djl_mobile/features/workspace/data/workspace_repository.dart';
import 'desktop_activity_test.dart' show ActivityCacheStore;
import 'desktop_checkpoint_ownership_test.dart' show ScopedCheckpointTransport;
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, ReasoningPairings, reasoningPair;
import 'desktop_history_reconciliation_test.dart'
    show
        HistorySendTransport,
        historyDesktop,
        historyPage,
        historyText,
        historyUser,
        historyAnswer,
        refreshHistory;

ReasoningTransport backgroundTransport() {
  final transport = ReasoningTransport();
  (transport.pairings as ReasoningPairings).pair = Pairing({
    ...reasoningPair.data,
    'macIdentityPublicKey': base64Encode(List.filled(32, 1)),
  });
  return transport;
}

void main() {
  test(
    'a new local run after handoff cannot inherit the prior run continuity rows',
    () async {
      final t = ScopedCheckpointTransport();
      final d = await historyDesktop(t, [
        historyUser('ipc-turn-0:input', 'ipc-turn-0', 'Old prompt'),
        historyAnswer('old-answer', 'ipc-turn-0', 'Old output'),
        {
          'id': 'old-thinking',
          'turnId': 'ipc-turn-0',
          'type': 'reasoning',
          'summary': 'Old reasoning',
        },
        {
          'id': 'old-command',
          'turnId': 'ipc-turn-0',
          'type': 'commandExecution',
          'command': 'echo old',
          'status': 'completed',
        },
      ]);
      addTearDown(d.dispose);
      d.model = 'qa';
      final read = Completer<RemoteJson>();
      t.readGate = read;
      final ledger = d.threadList.data.responseChanges;
      final oldChanges = ledger.entry('thread', 'ipc-turn-0', '/qa')
        ..assistant = 'old-answer'
        ..terminal = true
        ..aggregate = ResponsePatch('old', 'old patch  \n');
      try {
        t.events.add({
          'method': 'thread/replaced',
          'params': {'threadId': 'thread'},
        });
        expect(await d.send('New prompt'), isTrue, reason: d.error);
        final newChanges = ledger.entry('thread', 'ipc-turn-0', '/qa')
          ..assistant = 'new-answer'
          ..aggregate = ResponsePatch('new', 'new patch  \n');
        t.events.add({
          'method': 'turn/started',
          'params': {
            'threadId': 'thread',
            'turnId': 'new-canonical',
            'djlDesktopMirror': true,
            'djlTurnIdentityContinuity': true,
          },
        });
        expect(
          d.timeline.singleWhere(
            (row) => historyText(row) == 'Old prompt',
          )['turnId'],
          'ipc-turn-0',
        );
        expect(
          d.timeline.singleWhere(
            (row) => historyText(row) == 'Old output',
          )['turnId'],
          'ipc-turn-0',
        );
        expect(
          d.timeline.singleWhere(
            (row) => historyText(row) == 'New prompt',
          )['turnId'],
          'new-canonical',
        );
        expect(d.turnId, 'new-canonical');
        expect(
          d.timeline
              .map(DesktopReasoning.fromRow)
              .whereType<DesktopReasoning>()
              .single
              .turn,
          'ipc-turn-0',
        );
        expect(d.activity.items.values.single.turn, 'ipc-turn-0');
        expect(ledger.forAssistant('thread', 'old-answer'), same(oldChanges));
        expect(oldChanges.turn, 'ipc-turn-0');
        expect(ledger.forAssistant('thread', 'new-answer'), same(newChanges));
        expect(newChanges.turn, 'new-canonical');
        final restored = ResponseChangeLedger.fromJson(ledger.toJson());
        expect(
          restored
              .forAssistant('thread', 'old-answer')
              ?.aggregate
              ?.forwardPatch,
          'old patch  \n',
        );
        expect(
          restored
              .forAssistant('thread', 'new-answer')
              ?.aggregate
              ?.forwardPatch,
          'new patch  \n',
        );
      } finally {
        read.complete({'thread': historyPage([])});
        await Future<void>.delayed(Duration.zero);
      }
    },
  );
  test(
    'a fresh background start recovers a stopped history baseline after reconnect',
    () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      t.history = historyPage([
        historyAnswer('answer', 'live', 'Interrupted history'),
      ]);
      ((t.history!['turns'] as List).single as Map)['status'] = 'interrupted';
      await d.openThread({
        'id': 'thread',
        'cwd': '/qa',
      }, readOnlyNavigation: true);
      expect(
        d.selectedResponseFooter.latestOutcome,
        DesktopResponseOutcome.stopped,
      );
      t.events.add({
        'method': 'turn/started',
        'params': {
          'threadId': 'thread',
          'turnId': 'live',
          'djlDesktopMirror': true,
          'djlBackgroundDiscovery': true,
        },
      });
      expect(d.turnId, 'live');
      expect(
        d.selectedResponseFooter.latestOutcome,
        DesktopResponseOutcome.running,
      );
    },
  );

  test(
    'nested-thread lifecycle scope is recognized without selected fallback',
    () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      d.threadList.data.upsert({'id': 'other', 'cwd': '/qa'});
      t.events.add({
        'method': 'turn/started',
        'params': {'threadId': 'thread', 'turnId': 'own'},
      });
      t.events.add({
        'method': 'turn/started',
        'params': {
          'thread': {'id': 'other'},
          'turn': {'id': 'foreign'},
        },
      });
      expect(d.turnId, 'own');
      expect(d.activity.runningTurns['other'], 'foreign');
    },
  );
  test(
    'a late start cannot reopen cached canonical completion in any live projection',
    () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, [
        historyAnswer('answer', 'ended', 'Done'),
      ]);
      final status = RunStatusProjector();
      addTearDown(() {
        d.dispose();
        status.dispose();
      });
      d.attachRunStatus(status);
      t.events.add({
        'method': 'turn/started',
        'params': {'threadId': 'thread', 'turnId': 'ended'},
      });
      expect(d.turnId, isNull);
      expect(
        d.selectedResponseFooter.latestOutcome,
        DesktopResponseOutcome.completed,
      );
      expect(d.activity.runningTurns, isEmpty);
      expect(status.project().running, isEmpty);
    },
  );

  test(
    'snake-case lifecycle for another chat cannot steal the selected active turn',
    () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      d.threadList.data.upsert({'id': 'other', 'cwd': '/qa'});
      t.events.add({
        'method': 'turn/started',
        'params': {'threadId': 'thread', 'turnId': 'own'},
      });
      t.events.add({
        'method': 'turn/started',
        'params': {
          'thread_id': 'other',
          'turn': {'id': 'foreign'},
        },
      });
      expect(d.turnId, 'own');
      expect(d.selectedResponseFooter.latestTurn, 'own');
      expect(d.activity.runningTurns['other'], 'foreign');
    },
  );

  test(
    'conflicting lifecycle scope is rejected before live reducers',
    () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      final status = RunStatusProjector();
      addTearDown(() {
        d.dispose();
        status.dispose();
      });
      d.attachRunStatus(status);
      t.events.add({
        'method': 'turn/started',
        'params': {
          'threadId': 'thread',
          'turn': {'id': 'foreign', 'threadId': 'other'},
        },
      });
      expect(d.turnId, isNull);
      expect(d.selectedResponseFooter.outcomes, isEmpty);
      expect(d.activity.runningTurns, isEmpty);
      expect(status.project().running, isEmpty);
    },
  );

  test(
    'lifecycle plain turn ID alias is normalized only in notification scope',
    () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      t.events.add({
        'method': 'turn/started',
        'params': {'thread_id': 'thread', 'id': 'plain-turn'},
      });
      expect(d.turnId, 'plain-turn');
      expect(d.selectedResponseFooter.latestTurn, 'plain-turn');
      expect(d.activity.runningTurns['thread'], 'plain-turn');
      expect(t.calls, isEmpty);
    },
  );
  test(
    'canonical child completion updates its badge without a live completion event',
    () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      t.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread',
          'turnId': 'parent',
          'item': {
            'id': 'spawn',
            'type': 'collabAgentToolCall',
            'tool': 'spawnAgent',
            'status': 'completed',
            'receiverAgents': [
              {
                'threadId': 'child',
                'agentNickname': 'Known child',
                'status': 'running',
              },
            ],
          },
        },
      });
      final child = d.subagents.items.values.single.children.single;
      t.events.add({
        'method': 'turn/started',
        'params': {
          'threadId': 'child',
          'turnId': 'child-live',
          'djlBackgroundDiscovery': true,
          'djlDesktopMirror': true,
        },
      });
      expect(d.resolvedSubagent(child).status, 'running');
      t.calls.clear();
      t.history = {
        ...historyPage([historyAnswer('answer', 'child-live', 'Done')]),
        'id': 'child',
      };
      await d.openThread({
        'id': 'child',
        'cwd': '/qa',
      }, readOnlyNavigation: true);
      expect(d.resolvedSubagent(child).status, 'completed');
      expect(t.calls.map((call) => call['method']).toSet(), {'thread/read'});
    },
  );
  for (final terminal in ['completed', 'failed']) {
    test('running history cannot reopen an observed $terminal turn', () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      final read = Completer<RemoteJson>();
      t.readGate = read;
      t.events.add({
        'method': 'turn/started',
        'params': {'threadId': 'thread', 'turnId': 'ended'},
      });
      t.events.add({
        'method': 'turn/completed',
        'params': {
          'threadId': 'thread',
          'turn': {'id': 'ended', 'status': terminal},
        },
      });
      read.complete({
        'thread': historyPage([
          historyAnswer('answer', 'ended', 'Old running snapshot'),
        ], running: true),
      });
      for (var i = 0; i < 8; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      t.readGate = null;
      t.calls.clear();
      await refreshHistory(t, d, [
        historyAnswer('answer', 'ended', 'Old running snapshot'),
      ], running: true);
      expect(d.turnId, isNull);
      expect(
        d.selectedResponseFooter.latestOutcome,
        terminal == 'completed'
            ? DesktopResponseOutcome.completed
            : DesktopResponseOutcome.failed,
      );
    });
  }

  test(
    'background recovery updates a known child badge without opening its history',
    () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      t.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread',
          'turnId': 'parent',
          'item': {
            'id': 'spawn',
            'type': 'collabAgentToolCall',
            'tool': 'spawnAgent',
            'status': 'completed',
            'receiverAgents': [
              {
                'threadId': 'child',
                'agentNickname': 'Known child',
                'status': 'running',
              },
            ],
          },
        },
      });
      final child = d.subagents.items.values.single.children.single;
      t.calls.clear();
      final base = <String, dynamic>{
        'threadId': 'child',
        'turnId': 'ipc-turn-0',
        'djlDesktopMirror': true,
      };
      t.events.add({
        'method': 'turn/started',
        'params': {...base, 'djlBackgroundDiscovery': true},
      });
      t.events.add({
        'method': 'turn/completed',
        'params': {
          ...base,
          'turn': {'id': 'ipc-turn-0', 'status': 'interrupted'},
        },
      });
      expect(d.resolvedSubagent(child).status, 'stopped');
      t.events.add({
        'method': 'turn/started',
        'params': {...base, 'djlBackgroundDiscovery': true},
      });
      expect(d.resolvedSubagent(child).status, 'running');
      expect(d.thread?['id'], 'thread');
      expect(d.turnId, isNull);
      expect(t.calls, isEmpty);
    },
  );
  for (final terminal in ['interrupted', 'failed', 'cancelled']) {
    test(
      'top-level $terminal completion never captures a successful turn checkpoint',
      () async {
        final t = backgroundTransport();
        final d = await historyDesktop(t, []);
        addTearDown(d.dispose);
        final read = Completer<RemoteJson>();
        t.readGate = read;
        try {
          t.events.add({
            'method': 'turn/started',
            'params': {'threadId': 'thread', 'turnId': 'live'},
          });
          t.events.add({
            'method': 'turn/completed',
            'params': {
              'threadId': 'thread',
              'turnId': 'live',
              'status': terminal,
            },
          });
          for (var i = 0; i < 8; i++) {
            await Future<void>.delayed(Duration.zero);
          }
          expect(
            t.calls.where(
              (call) => call['method'] == 'workspace/checkpointCapture',
            ),
            isEmpty,
          );
        } finally {
          read.complete({'thread': historyPage([])});
          await Future<void>.delayed(Duration.zero);
        }
      },
    );
  }

  test(
    'fresh owned start and end verify a reused projected checkpoint slot',
    () async {
      final t = ScopedCheckpointTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      d.model = 'qa';
      final read = Completer<RemoteJson>();
      t.readGate = read;
      try {
        t.events.add({
          'method': 'turn/started',
          'params': {'threadId': 'thread', 'turnId': 'ipc-turn-0'},
        });
        t.events.add({
          'method': 'turn/completed',
          'params': {
            'threadId': 'thread',
            'turn': {'id': 'ipc-turn-0', 'status': 'completed'},
          },
        });
        t.events.add({
          'method': 'thread/replaced',
          'params': {'threadId': 'thread'},
        });
        expect(await d.send('New owned snapshot'), isTrue, reason: d.error);
        final repo = WorkspaceRepository(t, cwd: '/qa', threadId: 'thread');
        await expectLater(
          d.waitForCheckpoint('ipc-turn-0', workspace: repo),
          throwsStateError,
        );
        t.events.add({
          'method': 'turn/completed',
          'params': {
            'threadId': 'thread',
            'turn': {'id': 'ipc-turn-0', 'status': 'completed'},
          },
        });
        await d.waitForCheckpoint('ipc-turn-0', workspace: repo);
        expect(
          t.calls.where((call) => call['method'] == 'workspace/checkpointCopy'),
          hasLength(1),
        );
      } finally {
        read.complete({'thread': historyPage([])});
        await Future<void>.delayed(Duration.zero);
      }
    },
  );
  test(
    'continuity restores only turn-closed rows and retains the original running clock',
    () async {
      var at = DateTime.utc(2026, 11, 8);
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      final status = RunStatusProjector(now: () => at);
      addTearDown(() {
        d.dispose();
        status.dispose();
      });
      d.attachRunStatus(status);
      final old = <String, dynamic>{
        'threadId': 'thread',
        'turnId': 'ipc-turn-0',
        'djlDesktopMirror': true,
      };
      t.events.add({'method': 'turn/started', 'params': old});
      final started = status.project().running.single.startedAt;
      for (final done in [false, true]) {
        t.events.add({
          'method': done ? 'item/completed' : 'item/started',
          'params': {
            ...old,
            'item': {
              'id': done ? 'done-thinking' : 'live-thinking',
              'type': 'reasoning',
              'summary': done ? 'Final' : 'Working',
            },
          },
        });
        t.events.add({
          'method': done ? 'item/completed' : 'item/started',
          'params': {
            ...old,
            'item': {
              'id': done ? 'done-command' : 'live-command',
              'type': 'commandExecution',
              'command': 'echo QA',
              'status': done ? 'completed' : 'inProgress',
            },
          },
        });
      }
      final read = Completer<RemoteJson>();
      t.readGate = read;
      try {
        at = at.add(const Duration(seconds: 5));
        t.events.add({
          'method': 'turn/completed',
          'params': {
            ...old,
            'turn': {'id': 'ipc-turn-0', 'status': 'interrupted'},
          },
        });
        t.events.add({
          'method': 'thread/replaced',
          'params': {'threadId': 'thread'},
        });
        final next = <String, dynamic>{
          'threadId': 'thread',
          'turnId': 'real',
          'djlDesktopMirror': true,
          'djlBackgroundDiscovery': true,
          'djlTurnIdentityContinuity': true,
        };
        t.events.add({'method': 'turn/started', 'params': next});
        t.events.add({
          'method': 'item/reasoning/summaryTextDelta',
          'params': {...next, 'itemId': 'live-thinking', 'delta': ' again'},
        });
        final thoughts = d.timeline
            .map(DesktopReasoning.fromRow)
            .whereType<DesktopReasoning>()
            .toList();
        expect(
          thoughts
              .singleWhere((row) => row.identity.item == 'live-thinking')
              .terminal,
          isFalse,
        );
        expect(
          thoughts
              .singleWhere((row) => row.identity.item == 'live-thinking')
              .text,
          'Working again',
        );
        expect(
          thoughts
              .singleWhere((row) => row.identity.item == 'done-thinking')
              .terminal,
          isTrue,
        );
        expect(
          d.activity.items.values
              .singleWhere((row) => row.item == 'live-command')
              .status,
          'running',
        );
        expect(
          d.activity.items.values
              .singleWhere((row) => row.item == 'done-command')
              .status,
          'completed',
        );
        expect(status.project().running.single.startedAt, started);
      } finally {
        read.complete({'thread': historyPage([])});
        await Future<void>.delayed(Duration.zero);
      }
    },
  );
  test(
    'producer continuity preserves live rows, patch ownership and elapsed time',
    () async {
      var at = DateTime.utc(2026, 11, 8);
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      final status = RunStatusProjector(now: () => at);
      addTearDown(() {
        d.dispose();
        status.dispose();
      });
      d.attachRunStatus(status);
      final old = <String, dynamic>{
        'threadId': 'thread',
        'turnId': 'ipc-turn-0',
        'djlDesktopMirror': true,
      };
      const patch =
          'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n';
      t.events.add({'method': 'turn/started', 'params': old});
      t.events.add({
        'method': 'item/started',
        'params': {
          ...old,
          'item': {'id': 'thinking', 'type': 'reasoning', 'summary': 'Working'},
        },
      });
      t.events.add({
        'method': 'item/started',
        'params': {
          ...old,
          'item': {
            'id': 'command',
            'type': 'commandExecution',
            'command': 'echo working',
            'status': 'inProgress',
          },
        },
      });
      t.events.add({
        'method': 'turn/diff/updated',
        'params': {...old, 'diff': patch},
      });
      final started = status.project().running.single.startedAt;
      final read = Completer<RemoteJson>();
      t.readGate = read;
      try {
        at = at.add(const Duration(seconds: 5));
        t.events.add({
          'method': 'thread/replaced',
          'params': {'threadId': 'thread', 'djlDesktopMirror': true},
        });
        final next = <String, dynamic>{
          'threadId': 'thread',
          'turnId': 'real-turn',
          'djlDesktopMirror': true,
          'djlBackgroundDiscovery': true,
          'djlTurnIdentityContinuity': true,
        };
        t.events.add({'method': 'turn/started', 'params': next});
        t.events.add({
          'method': 'item/reasoning/summaryTextDelta',
          'params': {...next, 'itemId': 'thinking', 'delta': ' again'},
        });
        final thinking = d.timeline
            .map(DesktopReasoning.fromRow)
            .whereType<DesktopReasoning>()
            .toList();
        expect(thinking, hasLength(1));
        expect(thinking.single.turn, 'real-turn');
        expect(thinking.single.text, 'Working again');
        expect(d.activity.items.values.single.turn, 'real-turn');
        expect(
          d.threadList.data.responseChanges.entries.values.single.turn,
          'real-turn',
        );
        expect(
          d
              .threadList
              .data
              .responseChanges
              .entries
              .values
              .single
              .aggregate
              ?.forwardPatch,
          patch,
        );
        expect(status.project().running.single.startedAt, started);
        expect(status.project().running.single.turn, 'real-turn');
        expect(d.turnId, 'real-turn');
      } finally {
        read.complete({'thread': historyPage([])});
        await Future<void>.delayed(Duration.zero);
      }
    },
  );

  test(
    'producer background start revives an untagged stopped notification',
    () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      final read = Completer<RemoteJson>();
      t.readGate = read;
      try {
        t.events.add({
          'method': 'turn/started',
          'params': {
            'threadId': 'thread',
            'turnId': 'live',
            'djlDesktopMirror': true,
            'djlBackgroundDiscovery': true,
          },
        });
        t.events.add({
          'method': 'turn/completed',
          'params': {
            'threadId': 'thread',
            'turnId': 'live',
            'status': 'interrupted',
            'djlDesktopMirror': true,
            'djlBackgroundDiscovery': false,
          },
        });
        t.events.add({
          'method': 'turn/started',
          'params': {
            'threadId': 'thread',
            'turnId': 'live',
            'status': 'inProgress',
            'djlDesktopMirror': true,
            'djlBackgroundDiscovery': true,
          },
        });
        expect(d.turnId, 'live');
        expect(
          d.selectedResponseFooter.latestOutcome,
          DesktopResponseOutcome.running,
        );
      } finally {
        read.complete({'thread': historyPage([])});
        await Future<void>.delayed(Duration.zero);
      }
    },
  );
  test(
    'a source handoff during checkpoint waiting revokes the old owner',
    () async {
      final t = ScopedCheckpointTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      d.model = 'qa';
      expect(await d.send('Old owned source'), isTrue);
      final end = Completer<RemoteJson>();
      t.ends['thread'] = end;
      final read = Completer<RemoteJson>();
      t.readGate = read;
      try {
        t.events.add({
          'method': 'turn/completed',
          'params': {
            'threadId': 'thread',
            'turn': {'id': 'ipc-turn-0', 'status': 'completed'},
          },
        });
        final waiting = d.waitForCheckpoint(
          'ipc-turn-0',
          workspace: WorkspaceRepository(t, cwd: '/qa', threadId: 'thread'),
        );
        t.events.add({
          'method': 'thread/replaced',
          'params': {'threadId': 'thread'},
        });
        end.complete({});
        await expectLater(waiting, throwsStateError);
      } finally {
        if (!end.isCompleted) end.complete({});
        read.complete({'thread': historyPage([])});
        await Future<void>.delayed(Duration.zero);
      }
    },
  );

  test(
    'an old projected fast-terminal ACK cannot bind the replacement run checkpoint',
    () async {
      final t = HistorySendTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      d.model = 'qa';
      final sending = d.send('Old source input');
      await t.sending.future;
      final read = Completer<RemoteJson>();
      t.readGate = read;
      try {
        t.events.add({
          'method': 'turn/completed',
          'params': {
            'threadId': 'thread',
            'turn': {'id': 'ipc-turn-0', 'status': 'completed'},
          },
        });
        t.events.add({
          'method': 'thread/replaced',
          'params': {'threadId': 'thread'},
        });
        t.events.add({
          'method': 'turn/started',
          'params': {
            'threadId': 'thread',
            'turnId': 'ipc-turn-0',
            'djlDesktopMirror': true,
          },
        });
        t.reply.complete({
          'turn': {'id': 'ipc-turn-0'},
        });
        expect(await sending, isTrue);
        for (var i = 0; i < 8; i++) {
          await Future<void>.delayed(Duration.zero);
        }
        expect(d.turnId, 'ipc-turn-0');
        expect(d.selectedResponseFooter.pending, isFalse);
        expect(
          t.calls.where((call) => call['method'] == 'workspace/checkpointCopy'),
          isEmpty,
        );
      } finally {
        read.complete({'thread': historyPage([])});
        await Future<void>.delayed(Duration.zero);
      }
    },
  );
  test('a reused projected source retains both response patch histories', () async {
    final t = backgroundTransport();
    final d = await historyDesktop(t, []);
    addTearDown(d.dispose);
    final read = Completer<RemoteJson>();
    t.readGate = read;
    final base = <String, dynamic>{
      'threadId': 'thread',
      'turnId': 'ipc-turn-0',
      'djlDesktopMirror': true,
    };
    const oldPatch =
        'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old  \n+first  \n';
    const newPatch =
        'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-first  \n+second  \n';
    void episode(String assistant, String patch) {
      t.events.add({'method': 'turn/started', 'params': base});
      t.events.add({
        'method': 'turn/diff/updated',
        'params': {...base, 'diff': patch},
      });
      t.events.add({
        'method': 'item/completed',
        'params': {
          ...base,
          'item': {'id': assistant, 'type': 'agentMessage', 'text': assistant},
        },
      });
      t.events.add({
        'method': 'turn/completed',
        'params': {
          ...base,
          'turn': {'id': 'ipc-turn-0', 'status': 'completed'},
        },
      });
    }

    try {
      episode('old-answer', oldPatch);
      t.events.add({
        'method': 'thread/replaced',
        'params': {'threadId': 'thread'},
      });
      episode('new-answer', newPatch);
      final ledger = d.threadList.data.responseChanges;
      expect(
        ledger.forAssistant('thread', 'old-answer')?.aggregate?.forwardPatch,
        oldPatch,
      );
      expect(
        ledger.forAssistant('thread', 'new-answer')?.aggregate?.forwardPatch,
        newPatch,
      );
      final restored = ResponseChangeLedger.fromJson(ledger.toJson());
      expect(
        restored.forAssistant('thread', 'old-answer')?.aggregate?.forwardPatch,
        oldPatch,
      );
      expect(
        restored.forAssistant('thread', 'new-answer')?.aggregate?.forwardPatch,
        newPatch,
      );
    } finally {
      read.complete({'thread': historyPage([])});
      await Future<void>.delayed(Duration.zero);
    }
  });

  test(
    'source replacement cannot reuse a previous projected checkpoint owner',
    () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      final read = Completer<RemoteJson>();
      t.readGate = read;
      try {
        t.events.add({
          'method': 'turn/started',
          'params': {'threadId': 'thread', 'turnId': 'ipc-turn-0'},
        });
        t.events.add({
          'method': 'turn/completed',
          'params': {
            'threadId': 'thread',
            'turn': {'id': 'ipc-turn-0', 'status': 'completed'},
          },
        });
        t.events.add({
          'method': 'thread/replaced',
          'params': {'threadId': 'thread'},
        });
        await expectLater(
          d.waitForCheckpoint(
            'ipc-turn-0',
            workspace: WorkspaceRepository(t, cwd: '/qa', threadId: 'thread'),
          ),
          throwsStateError,
        );
      } finally {
        read.complete({'thread': historyPage([])});
        await Future<void>.delayed(Duration.zero);
      }
    },
  );
  for (final projected in [false, true]) {
    test(
      'source replacement clears only projected terminal barriers projected=$projected',
      () async {
        final t = backgroundTransport();
        final d = await historyDesktop(t, []);
        final status = RunStatusProjector();
        addTearDown(() {
          d.dispose();
          status.dispose();
        });
        d.attachRunStatus(status);
        final id = projected ? 'ipc-turn-0' : 'provider-turn';
        final base = <String, dynamic>{
          'threadId': 'thread',
          'turnId': id,
          'djlDesktopMirror': true,
        };
        final read = Completer<RemoteJson>();
        t.readGate = read;
        try {
          t.events.add({'method': 'turn/started', 'params': base});
          t.events.add({
            'method': 'turn/completed',
            'params': {
              ...base,
              'turn': {'id': id, 'status': 'completed'},
            },
          });
          t.events.add({
            'method': 'thread/replaced',
            'params': {'threadId': 'thread', 'djlDesktopMirror': true},
          });
          t.events.add({'method': 'turn/started', 'params': base});
          expect(d.turnId, projected ? id : null);
          expect(
            d.selectedResponseFooter.latestOutcome,
            projected
                ? DesktopResponseOutcome.running
                : DesktopResponseOutcome.completed,
          );
          expect(d.activity.runningTurns['thread'], projected ? id : null);
          expect(
            status.project().running.map((row) => row.turn),
            projected ? [id] : <String>[],
          );
          if (projected) {
            t.events.add({
              'method': 'item/reasoning/summaryTextDelta',
              'params': {
                ...base,
                'itemId': 'new-thinking',
                'delta': 'New source work',
              },
            });
            expect(
              d.timeline
                  .map(DesktopReasoning.fromRow)
                  .whereType<DesktopReasoning>()
                  .single
                  .text,
              'New source work',
            );
          }
        } finally {
          read.complete({'thread': historyPage([])});
          await Future<void>.delayed(Duration.zero);
        }
      },
    );
  }

  test(
    'replacing one source never clears another chat projected terminal',
    () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      d.threadList.data.upsert({'id': 'child', 'cwd': '/qa'});
      t.events.add({
        'method': 'turn/started',
        'params': {'threadId': 'child', 'turnId': 'ipc-turn-0'},
      });
      t.events.add({
        'method': 'turn/completed',
        'params': {
          'threadId': 'child',
          'turn': {'id': 'ipc-turn-0', 'status': 'completed'},
        },
      });
      final read = Completer<RemoteJson>();
      t.readGate = read;
      try {
        t.events.add({
          'method': 'thread/replaced',
          'params': {'threadId': 'thread'},
        });
        t.events.add({
          'method': 'turn/started',
          'params': {'threadId': 'child', 'turnId': 'ipc-turn-0'},
        });
        expect(d.activity.runningTurns.containsKey('child'), isFalse);
        expect(d.thread?['id'], 'thread');
        expect(d.turnId, isNull);
      } finally {
        read.complete({'thread': historyPage([])});
        await Future<void>.delayed(Duration.zero);
      }
    },
  );
  for (final mirror in ['djlDesktopMirror', 'djlRolloutLiveMirror']) {
    for (final kind in ['agent-start', 'agent-delta', 'reasoning-delta']) {
      test(
        'live $mirror $kind establishes a missing start without RPC side effects',
        () async {
          final t = backgroundTransport();
          final d = await historyDesktop(t, []);
          final status = RunStatusProjector();
          addTearDown(() {
            d.dispose();
            status.dispose();
          });
          d.attachRunStatus(status);
          final params = <String, dynamic>{
            'threadId': 'thread',
            'turnId': 'live',
            mirror: true,
            'itemId': 'detail',
          };
          final method = kind == 'agent-start'
              ? 'item/started'
              : kind == 'agent-delta'
              ? 'item/agentMessage/delta'
              : 'item/reasoning/summaryTextDelta';
          t.events.add({
            'method': method,
            'params': {
              ...params,
              if (kind == 'agent-start')
                'item': {
                  'id': 'detail',
                  'type': 'agentMessage',
                  'text': 'Live text',
                },
              if (kind != 'agent-start') 'delta': 'Live text',
            },
          });
          expect(d.turnId, 'live');
          expect(
            d.selectedResponseFooter.latestOutcome,
            DesktopResponseOutcome.running,
          );
          expect(d.shouldQueueComposer, isTrue);
          expect(d.activity.runningTurns['thread'], 'live');
          expect(status.project().running.map((row) => row.turn), ['live']);
          expect(d.threadList.data.responseChanges.running['thread'], 'live');
          if (kind == 'reasoning-delta') {
            expect(
              d.timeline
                  .map(DesktopReasoning.fromRow)
                  .whereType<DesktopReasoning>()
                  .single
                  .text,
              'Live text',
            );
          } else {
            expect(d.timeline.single['text'], 'Live text');
          }
          expect(t.calls, isEmpty);
        },
      );
    }
  }
  for (final replay in [false, true]) {
    test(
      'completion-only and replay mirror data cannot invent a running turn replay=$replay',
      () async {
        final t = backgroundTransport();
        final d = await historyDesktop(t, []);
        addTearDown(d.dispose);
        t.events.add({
          'method': replay ? 'item/started' : 'item/completed',
          'params': {
            'threadId': 'thread',
            'turnId': 'saved',
            'djlDesktopMirror': true,
            'djlReplayedEvent': replay,
            'item': {
              'id': 'answer',
              'type': 'agentMessage',
              'text': 'Saved text',
            },
          },
        });
        expect(d.turnId, isNull);
        expect(d.selectedResponseFooter.suppressesLatest, isFalse);
        expect(d.timeline.single['isStreaming'], isFalse);
        expect(t.calls, isEmpty);
      },
    );
  }
  for (final kind in ['agentMessage', 'reasoning', 'commandExecution']) {
    for (final mirrored in [false, true]) {
      test(
        'newer $kind activity fences a stale terminal read mirrored=$mirrored',
        () async {
          final t = backgroundTransport();
          final d = await historyDesktop(t, []);
          addTearDown(d.dispose);
          final base = <String, dynamic>{
            'threadId': 'thread',
            'turnId': 'live',
            'djlDesktopMirror': mirrored,
          };
          t.events.add({'method': 'turn/started', 'params': base});
          final item = <String, dynamic>{
            'id': 'detail',
            'type': kind,
            'turnId': 'live',
            'status': 'inProgress',
            'command': 'echo working',
            'text': 'Before',
            'summary': 'Before',
            'output': 'Before',
          };
          t.events.add({
            'method': 'item/started',
            'params': {...base, 'item': item},
          });
          final read = Completer<RemoteJson>();
          t.readGate = read;
          final reading = d.openThread({
            'id': 'thread',
            'cwd': '/qa',
          }, readOnlyNavigation: true);
          await Future<void>.delayed(Duration.zero);
          final method = kind == 'agentMessage'
              ? 'item/agentMessage/delta'
              : kind == 'reasoning'
              ? 'item/reasoning/summaryTextDelta'
              : 'item/commandExecution/outputDelta';
          t.events.add({
            'method': method,
            'params': {...base, 'itemId': 'detail', 'delta': ' after'},
          });
          read.complete({
            'thread': historyPage([
              {...item, 'status': 'completed'},
            ]),
          });
          await reading;
          expect(d.turnId, 'live');
          expect(
            d.selectedResponseFooter.latestOutcome,
            DesktopResponseOutcome.running,
          );
          t.events.add({
            'method': method,
            'params': {...base, 'itemId': 'detail', 'delta': ' again'},
          });
          if (kind == 'reasoning') {
            final row = d.timeline
                .map(DesktopReasoning.fromRow)
                .whereType<DesktopReasoning>()
                .single;
            expect(row.text, 'Before after again');
            expect(row.terminal, isFalse);
          } else if (kind == 'commandExecution') {
            expect(d.activity.items.values.single.status, 'running');
            expect(
              d.activity.items.values.single.outputTail,
              'Before after again',
            );
          } else {
            expect(d.timeline.single['text'], 'Before after again');
            expect(d.timeline.single['isStreaming'], isTrue);
          }
        },
      );
    }
  }

  test(
    'fresh matching terminal history retires live feature state without a ready notification',
    () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      final status = RunStatusProjector();
      addTearDown(() {
        d.dispose();
        status.dispose();
      });
      d.attachRunStatus(status);
      final base = <String, dynamic>{
        'threadId': 'thread',
        'turnId': 'live',
        'djlDesktopMirror': true,
      };
      t.events.add({'method': 'turn/started', 'params': base});
      t.events.add({
        'method': 'item/started',
        'params': {
          ...base,
          'item': {'id': 'thinking', 'type': 'reasoning', 'summary': 'Working'},
        },
      });
      t.events.add({
        'method': 'item/started',
        'params': {
          ...base,
          'item': {
            'id': 'command',
            'type': 'commandExecution',
            'command': 'echo working',
            'status': 'inProgress',
          },
        },
      });
      expect(status.project().running, hasLength(1));
      t.calls.clear();
      await refreshHistory(t, d, [historyAnswer('answer', 'live', 'Done')]);
      expect(d.turnId, isNull);
      expect(
        d.selectedResponseFooter.latestOutcome,
        DesktopResponseOutcome.completed,
      );
      expect(d.activity.runningTurns.containsKey('thread'), isFalse);
      expect(d.activity.items.values.single.status, 'completed');
      expect(status.project().rows, isEmpty);
      expect(
        d.threadList.data.responseChanges.running.containsKey('thread'),
        isFalse,
      );
    },
  );
  test(
    'three stale mirror snapshots and twenty seconds close only an unconfirmed guess',
    () async {
      var at = DateTime.utc(2026, 11, 8);
      final t = backgroundTransport()..history = historyPage([]);
      final d = DesktopController(
        t.pairings,
        connection: t,
        localStore: ActivityCacheStore(),
        runClock: () => at,
      );
      final status = RunStatusProjector(now: () => at);
      addTearDown(() {
        d.dispose();
        status.dispose();
      });
      await d.connect((t.pairings as ReasoningPairings).pair);
      await d.openThread({
        'id': 'thread',
        'cwd': '/qa',
      }, readOnlyNavigation: true);
      d.attachRunStatus(status);
      t.calls.clear();
      final base = {
        'threadId': 'thread',
        'turnId': 'live',
        'djlDesktopMirror': true,
      };
      t.events.add({'method': 'turn/started', 'params': base});
      t.events.add({
        'method': 'item/started',
        'params': {
          ...base,
          'item': {'id': 'thinking', 'type': 'reasoning', 'summary': 'Working'},
        },
      });
      t.events.add({
        'method': 'item/started',
        'params': {
          ...base,
          'item': {
            'id': 'command',
            'type': 'commandExecution',
            'command': 'echo working',
            'status': 'inProgress',
          },
        },
      });
      expect(status.project().running, hasLength(1));
      t.history = historyPage([
        historyAnswer('old-answer', 'older', 'Older snapshot'),
      ]);
      at = at.add(const Duration(seconds: 21));
      for (var i = 0; i < 3; i++) {
        await d.openThread({
          'id': 'thread',
          'cwd': '/qa',
        }, readOnlyNavigation: true);
        expect(d.turnId, 'live');
      }
      await d.openThread({
        'id': 'thread',
        'cwd': '/qa',
      }, readOnlyNavigation: true);
      expect(d.turnId, isNull);
      expect(
        d.selectedResponseFooter.latestOutcome,
        DesktopResponseOutcome.stopped,
      );
      expect(d.activity.runningTurns.containsKey('thread'), isFalse);
      expect(status.project().running, isEmpty);
      expect(
        d.timeline
            .map(DesktopReasoning.fromRow)
            .whereType<DesktopReasoning>()
            .single
            .terminal,
        isTrue,
      );
      expect(
        d.threadList.data.responseChanges.running.containsKey('thread'),
        isFalse,
      );
      expect(
        d.threadList.data.responseChanges.entries.values.single.terminal,
        isFalse,
      );
      expect(d.switchNeedsConfirmation, isFalse);
      expect(t.calls.map((call) => call['method']).toSet(), {'thread/read'});
    },
  );
  for (final afterRead in [false, true]) {
    for (final closesCurrent in [false, true]) {
      test(
        'mirrored running history respects read ownership after=$afterRead closes=$closesCurrent',
        () async {
          final t = backgroundTransport();
          final d = await historyDesktop(t, []);
          addTearDown(d.dispose);
          void start() => t.events.add({
            'method': 'turn/started',
            'params': {
              'threadId': 'thread',
              'turnId': 'live-turn',
              'djlDesktopMirror': true,
            },
          });
          if (!afterRead) start();
          final read = Completer<RemoteJson>();
          t.readGate = read;
          final reading = d.openThread({
            'id': 'thread',
            'cwd': '/qa',
          }, readOnlyNavigation: true);
          await Future<void>.delayed(Duration.zero);
          if (afterRead) start();
          read.complete({
            'thread': historyPage([
              historyAnswer(
                'snapshot-answer',
                closesCurrent ? 'live-turn' : 'older-turn',
                'Saved snapshot',
              ),
            ]),
          });
          await reading;
          final shouldClose = closesCurrent && !afterRead;
          expect(d.turnId, shouldClose ? null : 'live-turn');
          expect(
            d.selectedResponseFooter.latestOutcome,
            shouldClose
                ? DesktopResponseOutcome.completed
                : DesktopResponseOutcome.running,
          );
        },
      );
    }
  }

  test(
    'late mirrored activity for a closed old turn cannot append a live bubble',
    () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      final read = Completer<RemoteJson>();
      t.readGate = read;
      try {
        t.events.add({
          'method': 'turn/started',
          'params': {'threadId': 'thread', 'turnId': 'old'},
        });
        t.events.add({
          'method': 'turn/completed',
          'params': {
            'threadId': 'thread',
            'turn': {'id': 'old', 'status': 'completed'},
          },
        });
        t.events.add({
          'method': 'turn/started',
          'params': {'threadId': 'thread', 'turnId': 'newer'},
        });
        t.events.add({
          'method': 'item/agentMessage/delta',
          'params': {
            'threadId': 'thread',
            'turnId': 'old',
            'itemId': 'late-old',
            'delta': 'Closed old text',
            'djlDesktopMirror': true,
          },
        });
        expect(d.turnId, 'newer');
        expect(
          d.timeline.where(
            (row) => historyText(row).contains('Closed old text'),
          ),
          isEmpty,
        );
        expect(d.selectedResponseFooter.latestTurn, 'newer');
      } finally {
        read.complete({'thread': historyPage([])});
        await Future<void>.delayed(Duration.zero);
      }
    },
  );
  test(
    'unopened background lifecycle updates status without hydrating the chat',
    () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      final status = RunStatusProjector();
      addTearDown(() {
        d.dispose();
        status.dispose();
      });
      d.threadList.data.upsert({'id': 'child', 'cwd': '/qa', 'name': 'Child'});
      d.attachRunStatus(status);
      final base = {
        'threadId': 'child',
        'turnId': 'ipc-turn-0',
        'djlDesktopMirror': true,
        'djlBackgroundDiscovery': true,
      };
      t.events.add({'method': 'turn/started', 'params': base});
      expect(status.project().running.map((row) => row.thread), ['child']);
      t.events.add({
        'method': 'turn/completed',
        'params': {...base, 'status': 'completed'},
      });
      await Future<void>.delayed(Duration.zero);
      expect(status.project().ready.map((row) => row.thread), ['child']);
      expect(d.thread?['id'], 'thread');
      expect(d.turnId, isNull);
      expect(d.threadList.data.timelines.containsKey('child'), isFalse);
      expect(t.calls, isEmpty);
    },
  );

  for (final variant in [
    'live-bg',
    'replay-bg',
    'plain-live',
    'completed-bg',
    'failed-bg',
    'bg-after-newer',
  ]) {
    test('background interruption recovery is scoped for $variant', () async {
      final t = backgroundTransport();
      final d = await historyDesktop(t, []);
      final status = RunStatusProjector();
      addTearDown(() {
        d.dispose();
        status.dispose();
      });
      d.attachRunStatus(status);
      final read = Completer<RemoteJson>();
      t.readGate = read;
      final base = <String, dynamic>{
        'threadId': 'thread',
        'turnId': 'ipc-turn-0',
        'djlDesktopMirror': true,
        'djlBackgroundDiscovery': true,
      };
      try {
        t.events.add({'method': 'turn/started', 'params': base});
        expect(status.project().running, hasLength(1));
        t.events.add({
          'method': 'item/started',
          'params': {
            ...base,
            'item': {
              'id': 'thinking-live',
              'type': 'reasoning',
              'summary': 'Working',
            },
          },
        });
        t.events.add({
          'method': 'item/completed',
          'params': {
            ...base,
            'item': {
              'id': 'thinking-done',
              'type': 'reasoning',
              'summary': 'Finished reasoning',
            },
          },
        });
        t.events.add({
          'method': 'item/started',
          'params': {
            ...base,
            'item': {
              'id': 'command-live',
              'type': 'commandExecution',
              'command': 'echo working',
              'status': 'inProgress',
            },
          },
        });
        t.events.add({
          'method': 'item/completed',
          'params': {
            ...base,
            'item': {
              'id': 'command-done',
              'type': 'commandExecution',
              'command': 'echo done',
              'status': 'completed',
            },
          },
        });
        final terminal = variant == 'completed-bg'
            ? 'completed'
            : variant == 'failed-bg'
            ? 'failed'
            : 'interrupted';
        t.events.add({
          'method': 'turn/completed',
          'params': {
            ...base,
            'turn': {'id': 'ipc-turn-0', 'status': terminal},
          },
        });
        if (variant == 'bg-after-newer') {
          t.events.add({
            'method': 'turn/started',
            'params': {'threadId': 'thread', 'turnId': 'newer'},
          });
        }
        t.events.add({
          'method': 'turn/started',
          'params': {
            ...base,
            'djlBackgroundDiscovery': variant != 'plain-live',
            'djlReplayedEvent': variant == 'replay-bg',
          },
        });
        final revived = variant == 'live-bg';
        final active = revived
            ? 'ipc-turn-0'
            : variant == 'bg-after-newer'
            ? 'newer'
            : null;
        expect(d.turnId, active);
        expect(
          d.selectedResponseFooter.outcome('ipc-turn-0'),
          revived
              ? DesktopResponseOutcome.running
              : terminal == 'completed'
              ? DesktopResponseOutcome.completed
              : terminal == 'failed'
              ? DesktopResponseOutcome.failed
              : DesktopResponseOutcome.stopped,
        );
        expect(
          status.project().running.map((row) => row.turn),
          active == null ? <String>[] : [active],
        );
        expect(d.activity.runningTurns['thread'], active);
        if (revived) {
          t.events.add({
            'method': 'item/reasoning/summaryTextDelta',
            'params': {...base, 'itemId': 'thinking-live', 'delta': ' again'},
          });
          final thinking = d.timeline
              .map(DesktopReasoning.fromRow)
              .whereType<DesktopReasoning>()
              .toList();
          expect(
            thinking
                .singleWhere((item) => item.identity.item == 'thinking-live')
                .text,
            'Working again',
          );
          expect(
            thinking
                .singleWhere((item) => item.identity.item == 'thinking-live')
                .terminal,
            isFalse,
          );
          expect(
            thinking
                .singleWhere((item) => item.identity.item == 'thinking-done')
                .terminal,
            isTrue,
          );
          expect(
            d.activity.items.values
                .singleWhere((item) => item.item == 'command-live')
                .status,
            'running',
          );
          expect(
            d.activity.items.values
                .singleWhere((item) => item.item == 'command-done')
                .status,
            'completed',
          );
        }
      } finally {
        read.complete({'thread': historyPage([])});
        await Future<void>.delayed(Duration.zero);
      }
    });
  }
  test(
    'a proven canonical history upgrade retains its local start owner',
    () async {
      final t = HistorySendTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      d.model = 'qa';
      final sending = d.send('Owned canonical input');
      await t.sending.future.timeout(const Duration(seconds: 5));
      t.events.add({
        'method': 'turn/started',
        'params': {'threadId': 'thread', 'turnId': 'ipc-turn-0'},
      });
      t.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread',
          'turnId': 'ipc-turn-0',
          'item': historyUser(
            'ipc-turn-0:input',
            'ipc-turn-0',
            'Owned canonical input',
          ),
        },
      });
      t.calls.clear();
      await refreshHistory(t, d, [
        historyUser('provider-user', 'accepted-turn', 'Owned canonical input'),
      ], running: true);
      t.reply.complete({
        'turn': {'id': 'accepted-turn'},
      });
      expect(await sending, isTrue, reason: d.error);
      for (var i = 0; i < 8; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(d.turnId, 'accepted-turn');
      final copies = t.calls.where(
        (call) => call['method'] == 'workspace/checkpointCopy',
      );
      expect(copies, hasLength(1));
      expect((copies.single['params'] as Map)['targetTurnId'], 'accepted-turn');
      expect(d.timeline.where((r) => r['type'] == 'userMessage'), hasLength(1));
    },
  );
  for (final identified in [false, true]) {
    test(
      'an ID-less running status preserves the dispatched owner identified=$identified',
      () async {
        final t = HistorySendTransport();
        final d = await historyDesktop(t, []);
        addTearDown(d.dispose);
        d.model = 'qa';
        final sending = d.send('Owned status input');
        await t.sending.future.timeout(const Duration(seconds: 5));
        if (identified) {
          t.events.add({
            'method': 'turn/started',
            'params': {'threadId': 'thread', 'turnId': 'accepted-turn'},
          });
        }
        t.events.add({
          'method': 'thread/status/changed',
          'params': {
            'threadId': 'thread',
            'status': {'type': 'active'},
          },
        });
        t.reply.complete({
          'turn': {'id': 'accepted-turn'},
        });
        expect(await sending, isTrue, reason: d.error);
        expect(d.turnId, 'accepted-turn');
        expect(d.selectedResponseFooter.latestTurn, 'accepted-turn');
        expect(d.selectedResponseFooter.pending, isFalse);
      },
    );
  }

  test(
    'reusing the same turn ID after a distinct run cannot inherit an old ACK checkpoint',
    () async {
      final t = HistorySendTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      d.model = 'qa';
      final sending = d.send('First generation input');
      await t.sending.future.timeout(const Duration(seconds: 5));
      for (final id in [
        'accepted-turn',
        'intermediate-turn',
        'accepted-turn',
      ]) {
        t.events.add({
          'method': 'turn/started',
          'params': {'threadId': 'thread', 'turnId': id},
        });
      }
      t.reply.complete({
        'turn': {'id': 'accepted-turn'},
      });
      expect(await sending, isTrue, reason: d.error);
      for (var i = 0; i < 8; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(d.turnId, 'accepted-turn');
      expect(
        t.calls.where((call) => call['method'] == 'workspace/checkpointCopy'),
        isEmpty,
      );
    },
  );
  for (final method in ['turn/started', 'turn/completed']) {
    test(
      '$method cannot bind pending local snapshots to an unrelated turn',
      () async {
        final t = HistorySendTransport();
        final d = await historyDesktop(t, []);
        addTearDown(d.dispose);
        d.model = 'qa';
        final sending = d.send('Owned snapshot input');
        await t.sending.future.timeout(const Duration(seconds: 5));
        final read = Completer<RemoteJson>();
        t.readGate = read;
        try {
          t.events.add({
            'method': method,
            'params': {
              'threadId': 'thread',
              'turn': {
                'id': 'unrelated-turn',
                'status': method == 'turn/completed'
                    ? 'completed'
                    : 'inProgress',
              },
            },
          });
          t.reply.complete({
            'turn': {'id': 'accepted-turn'},
          });
          expect(await sending, isTrue, reason: d.error);
          for (var i = 0; i < 8; i++) {
            await Future<void>.delayed(Duration.zero);
          }
          expect(
            t.calls.where(
              (call) =>
                  call['method'] == 'workspace/checkpointCopy' &&
                  (call['params'] as Map)['targetTurnId'] == 'unrelated-turn',
            ),
            isEmpty,
          );
        } finally {
          read.complete({'thread': historyPage([])});
          await Future<void>.delayed(Duration.zero);
        }
      },
    );
  }
  for (final newer in [false, true]) {
    test(
      'an ID-less ACK cannot confirm ${newer ? 'a newer unrelated turn' : 'an unidentified turn'}',
      () async {
        final t = HistorySendTransport();
        final d = await historyDesktop(t, []);
        addTearDown(d.dispose);
        d.model = 'qa';
        final sending = d.send('Unidentified input');
        await t.sending.future.timeout(const Duration(seconds: 5));
        if (newer) {
          t.events.add({
            'method': 'turn/started',
            'params': {
              'threadId': 'thread',
              'turn': {'id': 'unrelated-turn'},
            },
          });
        }
        t.reply.complete({});
        expect(await sending, isTrue, reason: d.error);
        final own = d.timeline.singleWhere(
          (row) => historyText(row) == 'Unidentified input',
        );
        expect(own['delivery'], 'pending');
        expect(own['turnId'], isNull);
        if (newer) expect(d.turnId, 'unrelated-turn');
      },
    );
  }
  for (final newer in [false, true]) {
    test(
      'held start ACK preserves ${newer ? 'a newer live turn' : 'its own live turn'}',
      () async {
        final t = HistorySendTransport();
        final d = await historyDesktop(t, []);
        addTearDown(d.dispose);
        d.model = 'qa';
        final sending = d.send('Owned pending input');
        await t.sending.future.timeout(const Duration(seconds: 5));
        final live = newer ? 'newer-turn' : 'accepted-turn';
        t.events.add({
          'method': 'turn/started',
          'params': {
            'threadId': 'thread',
            'turn': {'id': live},
          },
        });
        final before = d.turnId;
        t.reply.complete({
          'turn': {'id': 'accepted-turn'},
        });
        expect(await sending, isTrue, reason: d.error);
        expect(before, live);
        expect(d.turnId, live);
        expect(d.selectedResponseFooter.latestTurn, live);
        expect(d.selectedResponseFooter.pending, isFalse);
        final own = d.timeline.singleWhere(
          (row) => historyText(row) == 'Owned pending input',
        );
        expect(own['delivery'], 'confirmed');
        expect(own['turnId'], 'accepted-turn');
      },
    );
  }

  test(
    'an owned fast terminal before start ACK settles pending without reopening',
    () async {
      final t = HistorySendTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      d.model = 'qa';
      final sending = d.send('Fast owned input');
      await t.sending.future.timeout(const Duration(seconds: 5));
      final read = Completer<RemoteJson>();
      t.readGate = read;
      try {
        t.events.add({
          'method': 'turn/completed',
          'params': {
            'threadId': 'thread',
            'turn': {'id': 'fast-turn', 'status': 'completed'},
          },
        });
        t.reply.complete({
          'turn': {'id': 'fast-turn'},
        });
        expect(await sending, isTrue, reason: d.error);
        expect(d.turnId, isNull);
        expect(d.selectedResponseFooter.pending, isFalse);
        expect(d.selectedResponseFooter.suppressesLatest, isFalse);
        expect(
          d.selectedResponseFooter.outcome('fast-turn'),
          DesktopResponseOutcome.completed,
        );
        final own = d.timeline.singleWhere(
          (row) => historyText(row) == 'Fast owned input',
        );
        expect(own['delivery'], 'confirmed');
        expect(own['turnId'], 'fast-turn');
      } finally {
        read.complete({'thread': historyPage([])});
        await Future<void>.delayed(Duration.zero);
      }
    },
  );
}
