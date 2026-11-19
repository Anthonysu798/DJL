import 'dart:async';
import 'desktop_plan_widgets_test.dart' show PlanActionTransport;
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:flutter_test/flutter_test.dart';
import 'desktop_reasoning_controller_test.dart' show ReasoningTransport;
import 'desktop_history_reconciliation_test.dart'
    show historyDesktop, historyPage, refreshHistory;

void main() {
  for (final late in ['item/started', 'item/plan/delta']) {
    test('a final plan body is not reopened by late $late', () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      final scope = {'threadId': 'thread', 'turnId': 'live'};
      t.events.add({'method': 'turn/started', 'params': scope});
      t.events.add({
        'method': 'item/completed',
        'params': {
          ...scope,
          'item': {'id': 'result', 'type': 'plan', 'text': 'Final proposal'},
        },
      });
      t.events.add({
        'method': late,
        'params': {
          ...scope,
          'itemId': 'result',
          'delta': ' stale tail',
          'item': {
            'id': 'result',
            'type': 'plan',
            'text': 'Older started body',
          },
        },
      });
      expect(d.timeline.single['text'], 'Final proposal');
      expect(d.timeline.single['planPresentation'], 'resultCompletedItem');
      expect(d.timeline.single['isStreaming'], isFalse);
    });
  }

  test(
    'plan detection leaves an unknown non-string item type on its existing path',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      t.events.add({
        'method': 'item/started',
        'params': {
          'threadId': 'thread',
          'turnId': 'live',
          'item': {'id': 'unknown', 'type': 17, 'text': 'Unknown item'},
        },
      });
      await Future<void>.delayed(Duration.zero);
      expect(d.timeline.single['id'], 'unknown');
      expect(d.timeline.single['type'], 17);
    },
  );

  for (final heldAck in [false, true]) {
    test(
      'a new local run after handoff cannot inherit the old progress row heldAck=$heldAck',
      () async {
        final t = PlanActionTransport();
        final d = await historyDesktop(t, [
          {
            'id': 'old-plan',
            'type': 'todoList',
            'turnId': 'ipc-turn-0',
            'plan': [
              {'step': 'Old step', 'status': 'completed'},
            ],
          },
        ]);
        addTearDown(d.dispose);
        d.model = 'qa';
        final read = Completer<Map<String, dynamic>>();
        t.readGate = read;
        final reply = Completer<Map<String, dynamic>>();
        t.actionGate = reply;
        try {
          t.events.add({
            'method': 'thread/replaced',
            'params': {'threadId': 'thread'},
          });
          final sending = d.send('New request');
          await t.actionRequested.future;
          if (!heldAck) {
            reply.complete({
              'turn': {'id': 'ipc-turn-0'},
            });
            expect(await sending, isTrue, reason: d.error);
          }
          t.events.add({
            'method': 'turn/plan/updated',
            'params': {
              'threadId': 'thread',
              'turnId': 'ipc-turn-0',
              'djlDesktopMirror': true,
              'plan': [
                {'step': 'New step', 'status': 'inProgress'},
              ],
            },
          });
          expect(
            d.timeline.where((row) => row['type'] == 'plan'),
            hasLength(2),
          );
          if (heldAck) {
            reply.complete({
              'turn': {'id': 'ipc-turn-0'},
            });
            expect(await sending, isTrue, reason: d.error);
          }
          t.events.add({
            'method': 'turn/started',
            'params': {
              'threadId': 'thread',
              'turnId': 'real-new',
              'djlDesktopMirror': true,
              'djlTurnIdentityContinuity': true,
            },
          });
          final old = d.timeline.singleWhere((row) => row['id'] == 'old-plan');
          expect(old['turnId'], 'ipc-turn-0');
          expect(old['plan'], [
            {'step': 'Old step', 'status': 'completed'},
          ]);
          final current = d.timeline.singleWhere(
            (row) => row['type'] == 'plan' && row['id'] != 'old-plan',
          );
          expect(current['turnId'], 'real-new');
          expect(current['plan'], [
            {'step': 'New step', 'status': 'in_progress'},
          ]);
        } finally {
          if (!reply.isCompleted) {
            reply.complete({
              'turn': {'id': 'ipc-turn-0'},
            });
          }
          read.complete({'thread': historyPage([])});
          await Future<void>.delayed(Duration.zero);
        }
      },
    );
  }

  test(
    'late progress for a completed turn cannot restore incomplete steps',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        {
          'id': 'todo-list-done',
          'type': 'todoList',
          'turnId': 'ended',
          'plan': [
            {'step': 'Inspect', 'status': 'completed'},
          ],
        },
      ]);
      addTearDown(d.dispose);
      t.events.add({
        'method': 'turn/plan/updated',
        'params': {
          'threadId': 'thread',
          'turnId': 'ended',
          'plan': [
            {'step': 'Inspect', 'status': 'in_progress'},
          ],
        },
      });
      expect(d.timeline.single['plan'], [
        {'step': 'Inspect', 'status': 'completed'},
      ]);
      expect(d.timeline.single['isStreaming'], isFalse);
      expect(d.turnId, isNull);
    },
  );

  test(
    'requested native planning suppresses assistant duplicates until an explicit default-mode action',
    () async {
      final t = PlanActionTransport();
      final d = await historyDesktop(t, [
        {
          'id': 'assistant',
          'type': 'agentMessage',
          'turnId': 'ended',
          'text': '<proposed_plan>Assistant proposal</proposed_plan>',
        },
        {
          'id': 'native-result',
          'type': 'plan',
          'turnId': 'ended',
          'text': 'Native proposal',
        },
      ]);
      addTearDown(d.dispose);
      d.models = [
        {'id': 'qa', 'model': 'provider-model'},
      ];
      d.model = 'qa';
      d.plan = true;
      final assistant = d.timeline.firstWhere(
        (row) => row['id'] == 'assistant',
      );
      expect(d.responsePlanProposal(assistant)?.presentation, 'resultReady');
      expect(await d.send('Plan this'), isTrue, reason: d.error);
      expect(d.responsePlanProposal(assistant), isNull);
      expect(
        await d.implementPlan('native-result', body: 'Native proposal'),
        isTrue,
        reason: d.error,
      );
      expect(d.responsePlanProposal(assistant)?.presentation, 'resultReady');
      expect(d.plan, isFalse);
    },
  );

  for (final other in [false, true]) {
    test(
      'native question tracking is scoped and survives request resolution other=$other',
      () async {
        final t = PlanActionTransport();
        final d = await historyDesktop(t, [
          {
            'id': 'assistant',
            'type': 'agentMessage',
            'turnId': 'ended',
            'text': '<proposed_plan>Assistant proposal</proposed_plan>',
          },
        ]);
        addTearDown(d.dispose);
        final row = d.timeline.single;
        expect(d.responsePlanProposal(row), isNotNull);
        if (other) d.threadList.data.upsert({'id': 'other', 'cwd': '/qa'});
        t.events.add({
          'id': 17,
          'method': 'item/tool/requestUserInput',
          'params': {
            'threadId': other ? 'other' : 'thread',
            'questions': [
              {
                'id': 'q',
                'header': 'Next',
                'question': 'Choose next step',
                'options': [
                  {'label': 'Continue', 'description': 'Continue planning'},
                ],
              },
            ],
          },
        });
        expect(d.responsePlanProposal(row), other ? isNotNull : isNull);
        t.events.add({
          'method': 'serverRequest/resolved',
          'params': {'requestId': 17},
        });
        expect(d.responsePlanProposal(row), other ? isNotNull : isNull);
      },
    );
  }

  for (final change in ['body', 'selection']) {
    test(
      'Implement cancels before dispatch if its reviewed $change changes during active lookup',
      () async {
        final t = PlanActionTransport();
        final d = await historyDesktop(t, [
          {
            'id': 'result',
            'type': 'plan',
            'turnId': 'ended',
            'text': 'Reviewed plan',
          },
        ]);
        addTearDown(d.dispose);
        d.models = [
          {'id': 'qa', 'model': 'provider-model'},
        ];
        d.model = 'qa';
        d.plan = true;
        final read = Completer<Map<String, dynamic>>();
        t.activeReadGate = read;
        final attempt = d.implementPlan('result', body: 'Reviewed plan');
        await t.activeReadRequested.future;
        if (change == 'body') {
          d.timeline.single['text'] = 'Replacement plan';
        } else {
          d.thread = {'id': 'other', 'cwd': '/qa'};
        }
        read.complete({'data': [], 'thread': historyPage([])});
        expect(await attempt, isFalse);
        expect(
          t.calls.where(
            (call) =>
                call['method'] == 'turn/start' ||
                call['method'] == 'turn/steer',
          ),
          isEmpty,
        );
        expect(d.plan, isTrue);
        expect(d.error, isNull);
      },
    );
  }

  test(
    'a lost Implement reply is not retried and preserves plan mode and an unrelated draft',
    () async {
      final t = PlanActionTransport();
      final d = await historyDesktop(t, [
        {
          'id': 'result',
          'type': 'plan',
          'turnId': 'ended',
          'text': 'Reviewed plan',
        },
      ]);
      addTearDown(d.dispose);
      d.models = [
        {'id': 'qa', 'model': 'provider-model'},
      ];
      d.model = 'qa';
      d.plan = true;
      d.threadList.data.setComposerDraft(
        'thread',
        DesktopComposerDraft(text: 'Unsent work'),
      );
      final reply = Completer<Map<String, dynamic>>();
      t.actionGate = reply;
      final attempt = d.implementPlan('result', body: 'Reviewed plan');
      final duplicate = d.implementPlan('result', body: 'Reviewed plan');
      await t.actionRequested.future;
      reply.completeError(TimeoutException('Lost implementation reply'));
      expect(await attempt, isFalse);
      expect(await duplicate, isFalse);
      expect(
        t.calls.where(
          (call) =>
              call['method'] == 'turn/start' || call['method'] == 'turn/steer',
        ),
        hasLength(1),
      );
      expect(d.threadList.data.composerDraft('thread').text, 'Unsent work');
      expect(d.plan, isTrue);
      expect(d.error, contains('Lost implementation reply'));
    },
  );

  test(
    'result deltas preserve standalone Markdown whitespace chunks',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      final scope = {
        'threadId': 'thread',
        'turnId': 'live',
        'itemId': 'result',
      };
      t.events.add({'method': 'turn/started', 'params': scope});
      for (final delta in ['# Plan', '\n\n', '- Step', '  ', 'next']) {
        t.events.add({
          'method': 'item/plan/delta',
          'params': {...scope, 'delta': delta},
        });
      }
      expect(d.timeline.single['text'], '# Plan\n\n- Step  next');
    },
  );

  for (final oldType in ['plan', 'agentMessage']) {
    test(
      'a reused plan item ID cannot replace an earlier $oldType row',
      () async {
        final t = ReasoningTransport();
        final d = await historyDesktop(t, [
          {
            'id': 'shared-item',
            'type': oldType,
            'turnId': 'old-turn',
            'text': 'Earlier saved content',
          },
        ]);
        addTearDown(d.dispose);
        final scope = {
          'threadId': 'thread',
          'turnId': 'new-turn',
          'itemId': 'shared-item',
        };
        t.events.add({'method': 'turn/started', 'params': scope});
        for (final delta in ['New ', 'proposal']) {
          t.events.add({
            'method': 'item/plan/delta',
            'params': {...scope, 'delta': delta},
          });
        }
        expect(d.timeline, hasLength(2));
        expect(
          d.timeline.singleWhere((row) => row['turnId'] == 'old-turn')['text'],
          'Earlier saved content',
        );
        final result = d.timeline.singleWhere(
          (row) => row['turnId'] == 'new-turn',
        );
        expect(result['text'], 'New proposal');
        expect(result['sourceItemId'], 'shared-item');
        expect(result['id'], isNot('shared-item'));
      },
    );
  }

  test('replayed snapshots cannot roll back a newer progress row', () async {
    final t = ReasoningTransport();
    final d = await historyDesktop(t, []);
    addTearDown(d.dispose);
    final scope = {'threadId': 'thread', 'turnId': 'live'};
    t.events.add({'method': 'turn/started', 'params': scope});
    t.events.add({
      'method': 'turn/plan/updated',
      'params': {
        ...scope,
        'plan': [
          {'step': 'Inspect', 'status': 'completed'},
        ],
      },
    });
    t.events.add({
      'method': 'turn/plan/updated',
      'params': {
        ...scope,
        'djlReplayedEvent': true,
        'plan': [
          {'step': 'Inspect', 'status': 'pending'},
        ],
      },
    });
    expect(d.timeline.single['plan'], [
      {'step': 'Inspect', 'status': 'completed'},
    ]);
  });

  test(
    'a replayed completed result does not acquire live implementation readiness',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, [
        {
          'id': 'answer',
          'type': 'agentMessage',
          'turnId': 'ended',
          'text': 'Done',
        },
      ]);
      addTearDown(d.dispose);
      t.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread',
          'turnId': 'ended',
          'djlReplayedEvent': true,
          'item': {'id': 'result', 'type': 'plan', 'text': 'Replayed proposal'},
        },
      });
      final result = d.timeline.singleWhere((row) => row['type'] == 'plan');
      expect(result['planPresentation'], 'resultClosed');
      expect(result['isStreaming'], isFalse);
      expect(d.turnId, isNull);
    },
  );

  for (final running in [false, true]) {
    test(
      'canonical todo history restores progress and finalizes only completed turns running=$running',
      () async {
        final t = ReasoningTransport();
        final d = await historyDesktop(t, [
          {
            'id': 'todo-list-saved',
            'type': 'todoList',
            'turnId': 'live',
            'plan': [
              {'step': 'Inspect', 'status': 'inProgress'},
            ],
          },
          {
            'id': 'proposal',
            'type': 'plan',
            'turnId': 'live',
            'text': 'Final proposal',
          },
        ], running: running);
        addTearDown(d.dispose);
        final progress = d.timeline.singleWhere(
          (row) => row['planPresentation'] == 'progress',
        );
        expect(progress['type'], 'plan');
        expect(progress['isStreaming'], isFalse);
        expect(
          (progress['plan'] as List).single['status'],
          running ? 'in_progress' : 'completed',
        );
        expect(
          d.timeline.singleWhere(
            (row) => row['id'] == 'proposal',
          )['planPresentation'],
          running ? 'resultClosed' : 'resultReady',
        );
      },
    );
  }

  test('empty canonical plan items do not restore placeholder cards', () async {
    final t = ReasoningTransport();
    final d = await historyDesktop(t, [
      {
        'id': 'empty-result',
        'type': 'plan',
        'turnId': 'ended',
        'content': [],
        'plan': [],
      },
      {'id': 'empty-todo', 'type': 'todoList', 'turnId': 'ended', 'plan': []},
    ]);
    addTearDown(d.dispose);
    expect(d.timeline, isEmpty);
  });

  test(
    'canonical progress identity and turn snapshots share one row without downgrade',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      final scope = {'threadId': 'thread', 'turnId': 'live'};
      t.events.add({'method': 'turn/started', 'params': scope});
      t.events.add({
        'method': 'turn/plan/updated',
        'params': {
          ...scope,
          'plan': [
            {'step': 'Inspect', 'status': 'pending'},
          ],
        },
      });
      final display = d.timeline.single['id'];
      await refreshHistory(t, d, [
        {
          'id': 'todo-list-real',
          'type': 'todoList',
          'turnId': 'live',
          'plan': [
            {'step': 'Inspect', 'status': 'inProgress'},
          ],
        },
      ], running: true);
      expect(d.timeline, hasLength(1));
      expect(d.timeline.single['id'], display);
      expect(d.timeline.single['sourceItemId'], 'todo-list-real');
      t.events.add({
        'method': 'turn/plan/updated',
        'params': {
          ...scope,
          'plan': [
            {'step': 'Inspect', 'status': 'completed'},
          ],
        },
      });
      expect(d.timeline, hasLength(1));
      expect(d.timeline.single['sourceItemId'], 'todo-list-real');
    },
  );

  for (final threadless in [false, true]) {
    test(
      'held terminal history cannot erase a newer plan snapshot threadless=$threadless',
      () async {
        final t = ReasoningTransport();
        final saved = {
          'id': 'todo-list-real',
          'type': 'plan',
          'djlProgressPlan': true,
          'turnId': 'live',
          'plan': [
            {'step': 'Old step', 'status': 'pending'},
          ],
        };
        final d = await historyDesktop(t, [saved], running: true);
        addTearDown(d.dispose);
        final read = Completer<Map<String, dynamic>>();
        t.readGate = read;
        final loading = d.openThread({
          'id': 'thread',
          'cwd': '/qa',
        }, readOnlyNavigation: true);
        await Future<void>.delayed(Duration.zero);
        t.events.add({
          'method': 'turn/plan/updated',
          'params': {
            if (!threadless) 'threadId': 'thread',
            'turnId': 'live',
            'plan': [
              {'step': 'New live step', 'status': 'inProgress'},
            ],
          },
        });
        read.complete({
          'thread': historyPage([saved]),
        });
        await loading;
        final progress = d.timeline.singleWhere(
          (row) => row['planPresentation'] == 'progress',
        );
        expect(progress['plan'], [
          {'step': 'New live step', 'status': 'in_progress'},
        ]);
        expect(d.turnId, 'live');
      },
    );
  }

  for (final status in ['completed', 'failed', 'interrupted']) {
    test(
      'terminal $status closes progress and only a completed result becomes ready',
      () async {
        final t = ReasoningTransport();
        final d = await historyDesktop(t, []);
        addTearDown(d.dispose);
        final scope = {'threadId': 'thread', 'turnId': 'live'};
        t.events.add({'method': 'turn/started', 'params': scope});
        t.events.add({
          'method': 'turn/plan/updated',
          'params': {
            ...scope,
            'plan': [
              {'step': 'Inspect', 'status': 'inProgress'},
            ],
          },
        });
        t.events.add({
          'method': 'item/completed',
          'params': {
            ...scope,
            'item': {
              'id': 'ready-result',
              'type': 'plan',
              'text': 'Reviewed result',
            },
          },
        });
        t.events.add({
          'method': 'item/plan/delta',
          'params': {
            ...scope,
            'itemId': 'unfinished-result',
            'delta': 'Unfinished proposal',
          },
        });
        final read = Completer<Map<String, dynamic>>();
        t.readGate = read;
        try {
          t.events.add({
            'method': 'turn/completed',
            'params': {
              ...scope,
              'turn': {'id': 'live', 'status': status},
            },
          });
          final progress = d.timeline.singleWhere(
            (row) => row['planPresentation'] == 'progress',
          );
          expect(progress['isStreaming'], isFalse);
          expect(
            (progress['plan'] as List).single['status'],
            status == 'completed' ? 'completed' : 'in_progress',
          );
          final result = d.timeline.singleWhere(
            (row) => row['id'] == 'ready-result',
          );
          expect(
            result['planPresentation'],
            status == 'completed' ? 'resultReady' : 'resultClosed',
          );
          final unfinished = d.timeline.singleWhere(
            (row) => row['id'] == 'unfinished-result',
          );
          expect(unfinished['planPresentation'], 'resultClosed');
          expect(unfinished['isStreaming'], isFalse);
        } finally {
          read.complete({
            'thread': {'id': 'thread', 'turns': []},
          });
          await Future<void>.delayed(Duration.zero);
        }
      },
    );
  }

  for (final ambiguous in [false, true]) {
    test(
      'threadless plan recovers only a unique known turn ambiguous=$ambiguous',
      () async {
        final t = ReasoningTransport();
        final d = await historyDesktop(t, []);
        addTearDown(d.dispose);
        t.events.add({
          'method': 'turn/started',
          'params': {'threadId': 'thread', 'turnId': 'shared'},
        });
        if (ambiguous) {
          d.threadList.data.upsert({'id': 'other', 'cwd': '/qa'});
          t.events.add({
            'method': 'turn/started',
            'params': {'threadId': 'other', 'turnId': 'shared'},
          });
        }
        t.calls.clear();
        t.events.add({
          'method': 'turn/plan/updated',
          'params': {'turnId': 'shared', 'explanation': 'Mapped plan'},
        });
        expect(
          d.timeline.where((row) => row['type'] == 'plan'),
          hasLength(ambiguous ? 0 : 1),
        );
        expect(t.calls, isEmpty);
      },
    );
  }

  test('mirrored empty plan noise cannot infer a missing run', () async {
    final t = ReasoningTransport();
    final d = await historyDesktop(t, []);
    addTearDown(d.dispose);
    final scope = {
      'threadId': 'thread',
      'turnId': 'noise',
      'djlDesktopMirror': true,
    };
    t.events.add({
      'method': 'turn/plan/updated',
      'params': {...scope, 'plan': []},
    });
    t.events.add({
      'method': 'item/plan/delta',
      'params': {...scope, 'itemId': 'empty', 'delta': ''},
    });
    t.events.add({
      'method': 'item/started',
      'params': {
        ...scope,
        'item': {'id': 'empty', 'type': 'todoList', 'content': []},
      },
    });
    expect(d.turnId, isNull);
    expect(d.selectedResponseFooter.outcomes, isEmpty);
    expect(d.timeline, isEmpty);
  });

  test(
    'meaningful progress snapshots update one owned row and ignore empty noise',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      final scope = {'threadId': 'thread', 'turnId': 'live'};
      t.events.add({'method': 'turn/started', 'params': scope});
      t.calls.clear();
      t.events.add({
        'method': 'turn/plan/updated',
        'params': {
          ...scope,
          'explanation': 'Inspect then fix',
          'plan': [
            {'step': 'Inspect', 'status': 'inProgress'},
            {'step': 'Fix', 'status': 'pending'},
            {'step': '', 'status': 'pending'},
            {'step': 'Invalid status', 'status': 'unknown'},
          ],
        },
      });
      var row = d.timeline.singleWhere((row) => row['type'] == 'plan');
      final display = row['id'];
      expect(row['planPresentation'], 'progress');
      expect(row['explanation'], 'Inspect then fix');
      expect(row['plan'], [
        {'step': 'Inspect', 'status': 'in_progress'},
        {'step': 'Fix', 'status': 'pending'},
      ]);
      t.events.add({
        'method': 'turn/plan/updated',
        'params': {
          ...scope,
          'plan': [
            {'step': 'Inspect', 'status': 'completed'},
            {'step': 'Fix', 'status': 'in_progress'},
          ],
        },
      });
      t.events.add({
        'method': 'turn/plan/updated',
        'params': {...scope, 'explanation': ' ', 'plan': []},
      });
      row = d.timeline.singleWhere((row) => row['type'] == 'plan');
      expect(row['id'], display);
      expect((row['plan'] as List).last, {
        'step': 'Fix',
        'status': 'in_progress',
      });
      expect(row['explanation'], 'Inspect then fix');
      expect(t.calls, isEmpty);
    },
  );

  test(
    'streamed result stays separate from progress and completed body is authoritative',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      final scope = {'threadId': 'thread', 'turnId': 'live'};
      t.events.add({'method': 'turn/started', 'params': scope});
      t.events.add({
        'method': 'turn/plan/updated',
        'params': {
          ...scope,
          'plan': [
            {'step': 'Inspect', 'status': 'inProgress'},
          ],
        },
      });
      for (final delta in ['Draft ', 'proposal']) {
        t.events.add({
          'method': 'item/plan/delta',
          'params': {...scope, 'itemId': 'result', 'delta': delta},
        });
      }
      var results = d.timeline.where((row) => row['type'] == 'plan').toList();
      expect(results, hasLength(2));
      expect(
        results.singleWhere(
          (row) => row['planPresentation'] == 'resultStreaming',
        )['text'],
        'Draft proposal',
      );
      t.events.add({
        'method': 'item/completed',
        'params': {
          ...scope,
          'item': {'id': 'result', 'type': 'plan', 'text': 'Final proposal'},
        },
      });
      t.events.add({
        'method': 'item/completed',
        'params': {
          ...scope,
          'item': {'id': 'result', 'type': 'plan', 'content': []},
        },
      });
      results = d.timeline.where((row) => row['type'] == 'plan').toList();
      expect(results, hasLength(2));
      final result = results.singleWhere(
        (row) => row['planPresentation'] == 'resultCompletedItem',
      );
      expect(result['text'], 'Final proposal');
      expect(result['isStreaming'], isFalse);
    },
  );

  test(
    'empty plan lifecycle and delta notifications do not create placeholders',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      final scope = {'threadId': 'thread', 'turnId': 'live'};
      t.events.add({
        'method': 'turn/plan/updated',
        'params': {...scope, 'plan': []},
      });
      t.events.add({
        'method': 'item/plan/delta',
        'params': {...scope, 'itemId': 'result', 'delta': ''},
      });
      for (final method in ['item/started', 'item/completed']) {
        t.events.add({
          'method': method,
          'params': {
            ...scope,
            'item': {
              'id': 'empty',
              'type': 'todoList',
              'content': [],
              'plan': [],
            },
          },
        });
      }
      expect(d.timeline, isEmpty);
    },
  );

  test(
    'background plan snapshot stays in its unopened chat without hydration',
    () async {
      final t = ReasoningTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      d.threadList.data.upsert({'id': 'other', 'cwd': '/qa'});
      t.events.add({
        'method': 'turn/started',
        'params': {'threadId': 'other', 'turnId': 'other-turn'},
      });
      t.calls.clear();
      t.events.add({
        'method': 'turn/plan/updated',
        'params': {
          'threadId': 'other',
          'turnId': 'other-turn',
          'explanation': 'Background work',
        },
      });
      expect(d.timeline, isEmpty);
      expect(d.thread?['id'], 'thread');
      expect(
        d.threadList.data.timelines['other']?.single['explanation'],
        'Background work',
      );
      expect(t.calls, isEmpty);
    },
  );
}
