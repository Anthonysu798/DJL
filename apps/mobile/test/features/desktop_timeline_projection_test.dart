import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/activity/domain/desktop_activity.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_timeline_projection.dart';
import 'package:djl_mobile/features/reasoning/domain/desktop_reasoning.dart';

Map<String, dynamic> activityRow(
  int id, {
  String kind = 'tool',
  String status = 'completed',
  String turn = 'turn',
}) => DesktopActivity(
  mac: 'mac',
  thread: 'thread',
  turn: turn,
  item: '$id',
  kind: kind,
  status: status,
  command: 'echo $id',
  name: 'Tool $id',
).toRow();

Map<String, dynamic> traceRow(
  int id, {
  String turn = 'turn',
  String? content,
}) => (DesktopReasoning('mac', 'pin', (
  thread: 'thread',
  turn: turn,
  item: '$id',
))..content = content ?? 'Trace $id').toRow();

Map<String, dynamic> messageRow(
  int id, {
  bool user = false,
  String turn = 'turn',
}) => {
  'id': '$id',
  'turnId': turn,
  'type': user ? 'userMessage' : 'agentMessage',
  'text': 'Message $id',
};

void main() {
  test(
    'unlinked desktop prompts keep completed trace disclosures with their own turn',
    () {
      final rows = [
        messageRow(0, turn: 'older'),
        messageRow(1, user: true, turn: 'djl-history-prompt'),
        traceRow(2, turn: 'actual-turn'),
        messageRow(3, turn: 'actual-turn'),
      ];
      final before = jsonEncode(rows);
      final p = projectDesktopTimeline(rows, completedTurns: {'actual-turn'});
      expect(p.items.map((item) => item.indices), [
        [0],
        [1],
        [2],
        [3],
      ]);
      expect(p.items[2].kind, DesktopTimelineKind.previous);
      expect(jsonEncode(rows), before);
    },
  );

  Map<String, dynamic> file(
    int id,
    String path,
    String diff, {
    String turn = 'turn',
    String mac = 'mac',
    String thread = 'thread',
    String kind = 'update',
    int? additions,
    int? deletions,
  }) => DesktopActivity(
    mac: mac,
    thread: thread,
    turn: turn,
    item: '$id',
    kind: 'fileChange',
    status: 'completed',
    files: [
      ActivityFileChange(
        path,
        kind,
        diff,
        additions: additions,
        deletions: deletions,
      ),
    ],
  ).toRow();

  test(
    'file tables combine source path identities and map old focus forward',
    () {
      const diff = '@@ -1 +1 @@\n-old\n+new';
      final rows = [
        file(0, 'src/a.dart', diff),
        messageRow(1),
        file(2, 'src/b.dart', diff),
        file(3, '/repo/src/a.dart', diff),
      ];
      final before = jsonEncode(rows), p = projectDesktopTimeline(rows);
      expect(p.hiddenRows, {0, 2});
      expect(p.activityOverrides.keys, [3]);
      expect(p.activityOverrides[3]!.files.map((f) => f.path), [
        'src/a.dart',
        'src/b.dart',
      ]);
      expect(p.activityOverrides[3]!.files.first.additions, 1);
      expect(p.renderIndexFor(0), p.renderIndexFor(3));
      expect(p.focusRawFor(0), 3);
      expect(jsonEncode(rows), before);
    },
  );

  test(
    'file presentation keeps same-named directories and basename references distinct',
    () {
      final p = projectDesktopTimeline([
        file(0, 'one/x.dart', '+one'),
        file(1, 'two/x.dart', '+two'),
        file(2, 'x.dart', '+base'),
        file(3, '/repo/x.dart', '+absolute'),
      ]);
      expect(p.activityOverrides[3]!.files.map((f) => f.path), [
        'one/x.dart',
        'two/x.dart',
        'x.dart',
        '/repo/x.dart',
      ]);
    },
  );

  test(
    'file action precedence and explicit per-source totals match the source table',
    () {
      final p = projectDesktopTimeline([
        file(
          0,
          'src/a.dart',
          '@@\n-old\n+new',
          kind: 'add',
          additions: 5,
          deletions: 2,
        ),
        file(1, 'src/a.dart', '@@\n+second\n+third', kind: 'delete'),
      ]);
      final merged = p.activityOverrides[1]!.files.single;
      expect(merged.kind, 'add');
      expect(merged.additions, 7);
      expect(merged.deletions, 2);
      expect(merged.diff, '@@\n-old\n+new\n\n@@\n+second\n+third');
    },
  );

  test(
    'file tables never combine different stable turns, owners or turnless user blocks',
    () {
      for (final rows in [
        [
          file(0, 'src/a', '+a', turn: 'one'),
          file(1, 'src/a', '+b', turn: 'two'),
        ],
        [file(0, 'src/a', '+a'), file(1, 'src/a', '+b', mac: 'other')],
        [file(0, 'src/a', '+a'), file(1, 'src/a', '+b', thread: 'other')],
        [
          file(0, 'src/a', '+a', turn: ''),
          messageRow(1, user: true),
          file(2, 'src/a', '+b', turn: ''),
        ],
      ]) {
        expect(projectDesktopTimeline(rows).activityOverrides, isEmpty);
      }
    },
  );

  test(
    'large UTF8 file tables preserve individual rows without eager merging',
    () {
      for (final diff in ['x' * 96001, '界' * 32000]) {
        final p = projectDesktopTimeline([
          file(0, 'src/a', diff),
          file(1, 'src/b', '+b'),
        ]);
        expect(p.activityOverrides, isEmpty);
        expect(p.hiddenRows, isEmpty);
      }
    },
  );

  test(
    'active file snapshots hide and rehome focus within their own block',
    () {
      final p = projectDesktopTimeline(
        [messageRow(0, user: true), messageRow(1), file(2, 'src/live', '+a')],
        activeTurn: 'turn',
        isThreadRunning: true,
      );
      expect(p.hiddenRows, {2});
      expect(p.renderIndexFor(2), p.renderIndexFor(1));
      expect(p.focusRawFor(2), 1);
      expect(p.activityOverrides, isEmpty);
    },
  );

  test(
    'completed previous rows preserve priority artifacts and the raw model',
    () {
      final rows = [
        messageRow(0, user: true),
        activityRow(1, kind: 'command'),
        traceRow(2),
        activityRow(3, kind: 'fileChange'),
        {...messageRow(4), 'type': 'automaticApprovalReview'},
        {...messageRow(5), 'type': 'subagentAction'},
        {...messageRow(6), 'type': 'userInputPrompt'},
        {...messageRow(7), 'type': 'plan'},
        {...messageRow(8), 'phase': 'final_answer'},
      ];
      final before = jsonEncode(rows);
      final p = projectDesktopTimeline(rows, completedTurns: {'turn'});
      expect(p.items.map((item) => item.indices), [
        [0],
        [1, 2],
        [3],
        [4],
        [5],
        [6],
        [7],
        [8],
      ]);
      expect(p.items[1].kind, DesktopTimelineKind.previous);
      expect(p.items[1].finalIndex, 8);
      expect(p.items[1].collapsedIndices, isEmpty);
      expect(p.hiddenRows, {1, 2});
      expect(jsonEncode(rows), before);
    },
  );

  test(
    'late rows and skipped reasoning retain explicit previous focus mapping',
    () {
      final p = projectDesktopTimeline(
        [
          messageRow(0, user: true),
          {...messageRow(1), 'phase': 'final_answer'},
          activityRow(2, kind: 'command'),
          activityRow(3),
          traceRow(4, content: ''),
        ],
        completedTurns: {'turn'},
      );
      expect(p.items.map((item) => item.indices), [
        [0],
        [2, 3],
        [1],
      ]);
      expect(p.renderIndexFor(2), 1);
      expect(p.renderIndexFor(3), 1);
      expect(p.renderIndexFor(4), 1);
      expect(p.renderIndexFor(1), 2);
    },
  );

  test(
    'cold final evidence protects the active or unidentified newest turn',
    () {
      final rows = [
        messageRow(0, user: true, turn: 'old'),
        activityRow(1, turn: 'old'),
        {...messageRow(2, turn: 'old'), 'phase': 'final_answer'},
        messageRow(3, user: true, turn: 'new'),
        activityRow(4, turn: 'new'),
        {...messageRow(5, turn: 'new'), 'phase': 'final_answer'},
      ];
      for (final active in ['new', null]) {
        final p = projectDesktopTimeline(
          rows,
          activeTurn: active,
          isThreadRunning: true,
        );
        final previous = p.items
            .where((i) => i.kind == DesktopTimelineKind.previous)
            .toList();
        expect(previous, hasLength(1));
        expect(previous.single.indices, [1]);
        expect(p.hiddenRows.contains(4), isFalse);
      }
    },
  );

  test(
    'unsettled, streaming, anonymous and commentary-only turns stay visible',
    () {
      for (final phase in ['commentary', 'analysis']) {
        final p = projectDesktopTimeline(
          [
            activityRow(0),
            {...messageRow(1), 'phase': phase},
          ],
          completedTurns: {'turn'},
        );
        expect(
          p.items.any((i) => i.kind == DesktopTimelineKind.previous),
          isFalse,
        );
      }
      for (final tail in [
        messageRow(1),
        {...messageRow(1), 'phase': 'final_answer', 'isStreaming': true},
        {...messageRow(1), 'turnId': '', 'phase': 'final_answer'},
      ]) {
        final p = projectDesktopTimeline([activityRow(0), tail]);
        expect(
          p.items.any((i) => i.kind == DesktopTimelineKind.previous),
          isFalse,
        );
      }
    },
  );

  test('the last same-turn user prompt bounds previous history', () {
    final p = projectDesktopTimeline([
      messageRow(0, user: true),
      messageRow(1),
      messageRow(2, user: true),
      activityRow(3),
      {...messageRow(4), 'phase': 'final_answer'},
    ]);
    expect(p.items.map((item) => item.indices), [
      [0],
      [1],
      [2],
      [3],
      [4],
    ]);
    expect(p.items[3].kind, DesktopTimelineKind.previous);
    expect(p.hiddenRows, {3});
  });

  test(
    'artifact-only rows stay visible until a supported promotion replaces them',
    () {
      final p = projectDesktopTimeline([
        messageRow(0, user: true),
        activityRow(1),
        {...messageRow(2), 'text': '![](/tmp/generated/image.png)'},
        {...messageRow(3), 'text': '::code-comment[title="Finding"]'},
        {...messageRow(4), 'phase': 'final_answer'},
      ]);
      expect(p.hiddenRows, {1});
      expect(p.items.map((item) => item.indices), [
        [0],
        [1],
        [2],
        [3],
        [4],
      ]);
    },
  );

  test('legacy non-list content does not crash a completed text row', () {
    final p = projectDesktopTimeline([
      activityRow(0),
      {...messageRow(1), 'content': 'legacy content'},
      {...messageRow(2), 'phase': 'final_answer'},
    ]);
    expect(p.items.first.kind, DesktopTimelineKind.previous);
    expect(p.items.first.indices, [0, 1]);
  });

  test('empty thinking does not confirm a trailing file-change bridge', () {
    for (final content in ['', 'Thinking', 'Thinking...', ' \n ']) {
      final p = projectDesktopTimeline([
        activityRow(0, kind: 'command'),
        activityRow(1, kind: 'fileChange'),
        traceRow(2, content: content),
      ]);
      expect(p.items.map((i) => i.indices), [
        [0],
        [1],
      ]);
      expect(p.items.first.accessoryHost, 0);
      expect(p.renderIndexFor(2), 1);
    }
  });

  test('large UTF8 thinking placeholders preserve the bounded Swift scan', () {
    final p = projectDesktopTimeline([
      activityRow(0, kind: 'command'),
      activityRow(1, kind: 'fileChange'),
      traceRow(2, content: 'Thinking...${'　' * 168}'),
    ]);
    expect(p.items.single.indices, [0, 1, 2]);
    expect(p.items.single.accessoryHost, 2);
  });

  test(
    'explicit stopped command status survives live and history decoding',
    () {
      for (final completed in [false, true]) {
        for (final status in ['stopped', 'Stopped', ' stopped ']) {
          final activity = DesktopActivity.fromItem(
            {
              'id': 'cmd',
              'type': 'commandExecution',
              'status': status,
              'command': 'echo stopped',
            },
            mac: 'mac',
            thread: 'thread',
            turn: 'turn',
            completed: completed,
          )!;
          expect(activity.status, 'stopped');
          final p = projectDesktopTimeline([activity.toRow()]);
          expect(p.items.single.stoppedCommandCount, 1);
        }
      }
    },
  );

  test('ordinary messages keep raw order and exact focus targets', () {
    final p = projectDesktopTimeline([messageRow(0), messageRow(1)]);
    expect(p.items.map((i) => i.indices), [
      [0],
      [1],
    ]);
    expect(p.renderIndexFor(0), 0);
    expect(p.renderIndexFor(1), 1);
    expect(p.renderIndexFor(null), isNull);
    expect(p.renderIndexFor(2), isNull);
  });

  test('four tool calls remain separate while a fifth collapses to latest', () {
    final four = projectDesktopTimeline([
      for (var i = 0; i < 4; i++) activityRow(i),
    ]);
    expect(four.items.map((i) => i.collapsedIndices), [
      [0],
      [1],
      [2],
      [3],
    ]);
    final five = projectDesktopTimeline([
      for (var i = 0; i < 5; i++) activityRow(i),
    ]);
    expect(five.items, hasLength(1));
    expect(five.items.single.kind, DesktopTimelineKind.toolBurst);
    expect(five.items.single.indices, [0, 1, 2, 3, 4]);
    expect(five.items.single.collapsedIndices, [4]);
    expect(five.items.single.accessoryHost, 4);
    expect(five.renderIndexFor(0), 0);
    expect(five.renderIndexFor(4), 0);
  });

  test('running commands share a tool burst without being called finished', () {
    final p = projectDesktopTimeline([
      for (var i = 0; i < 7; i++)
        activityRow(i, kind: i.isEven ? 'command' : 'tool', status: 'running'),
    ]);
    expect(p.items, hasLength(1));
    expect(p.items.single.kind, DesktopTimelineKind.toolBurst);
    expect(p.items.single.collapsedIndices, [6]);
    expect(p.items.single.commandIndices, isEmpty);
  });

  test('a real user message prevents collapsing calls across prompts', () {
    final p = projectDesktopTimeline([
      for (var i = 0; i < 3; i++) activityRow(i),
      messageRow(3, user: true),
      for (var i = 4; i < 7; i++) activityRow(i),
    ]);
    expect(p.items, hasLength(7));
    expect(
      p.items.map((i) => i.kind),
      everyElement(DesktopTimelineKind.message),
    );
  });

  test(
    'assistant commentary splits bursts and preserves their original order',
    () {
      final p = projectDesktopTimeline([
        for (var i = 0; i < 5; i++) activityRow(i),
        messageRow(5),
        for (var i = 6; i < 11; i++) activityRow(i),
      ]);
      expect(p.items.map((i) => i.indices), [
        [0, 1, 2, 3, 4],
        [5],
        [6, 7, 8, 9, 10],
      ]);
      expect(p.renderIndexFor(8), 2);
    },
  );

  test(
    'command disclosure retains ordered bridging file changes and trace',
    () {
      final p = projectDesktopTimeline([
        activityRow(0, kind: 'command'),
        activityRow(1, kind: 'fileChange'),
        traceRow(2),
        activityRow(3, kind: 'command', status: 'failed'),
        activityRow(4, kind: 'fileChange'),
      ]);
      expect(p.items.map((i) => i.indices), [
        [0, 1, 2, 3],
        [4],
      ]);
      final group = p.items.first;
      expect(group.kind, DesktopTimelineKind.commands);
      expect(group.commandIndices, [0, 3]);
      expect(group.collapsedIndices, [1, 2]);
      expect(group.accessoryHost, 3);
      expect(group.failedCommandCount, 1);
      expect(group.stoppedCommandCount, 0);
      expect(p.renderIndexFor(1), 0);
      expect(p.renderIndexFor(4), 1);
    },
  );

  test(
    'ordered trace tail owns command-group accessories even when collapsed',
    () {
      final p = projectDesktopTimeline([
        activityRow(0, kind: 'command'),
        traceRow(1),
      ]);
      expect(p.items, hasLength(1));
      expect(p.items.single.indices, [0, 1]);
      expect(p.items.single.collapsedIndices, [1]);
      expect(p.items.single.accessoryHost, 1);
    },
  );

  test('unconfirmed trailing file changes flush outside the command group', () {
    final p = projectDesktopTimeline([
      activityRow(0, kind: 'command'),
      activityRow(1, kind: 'fileChange'),
      messageRow(2),
    ]);
    expect(p.items.map((i) => i.indices), [
      [0],
      [1],
      [2],
    ]);
    expect(p.items.first.kind, DesktopTimelineKind.commands);
    expect(p.items.first.collapsedIndices, isEmpty);
  });

  test('a trace from another stable turn cannot bridge command details', () {
    final p = projectDesktopTimeline([
      activityRow(0, kind: 'command', turn: 'a'),
      activityRow(1, kind: 'fileChange', turn: 'a'),
      traceRow(2, turn: 'b'),
      activityRow(3, kind: 'command', turn: 'b'),
    ]);
    expect(p.items.map((i) => i.indices), [
      [0],
      [1],
      [2],
      [3],
    ]);
  });

  test(
    'failed and stopped commands count without hiding unsuccessful status',
    () {
      final p = projectDesktopTimeline([
        activityRow(0, kind: 'command'),
        activityRow(1, kind: 'command', status: 'failed'),
        activityRow(2, kind: 'command', status: 'stopped'),
        activityRow(3, kind: 'command', status: 'unknown'),
      ]);
      expect(p.items.map((i) => i.indices), [
        [0, 1, 2],
        [3],
      ]);
      expect(p.items.first.failedCommandCount, 1);
      expect(p.items.first.stoppedCommandCount, 1);
      expect(p.items.last.kind, DesktopTimelineKind.message);
    },
  );

  test(
    'live activity completion updates grouping without rewriting saved rows',
    () {
      final row = activityRow(0, kind: 'command', status: 'running');
      final live = DesktopActivity.fromRow(row)!..status = 'completed';
      final p = projectDesktopTimeline([row], activities: {live.id: live});
      expect(p.items.single.kind, DesktopTimelineKind.commands);
      expect(p.items.single.commandIndices, [0]);
      expect(DesktopActivity.fromRow(row)!.status, 'running');
    },
  );

  test('distinct adjacent stable turns split tool bursts', () {
    final p = projectDesktopTimeline([
      for (var i = 0; i < 5; i++) activityRow(i, turn: 'a'),
      for (var i = 5; i < 10; i++) activityRow(i, turn: 'b'),
    ]);
    expect(p.items.map((i) => i.indices), [
      [0, 1, 2, 3, 4],
      [5, 6, 7, 8, 9],
    ]);
  });

  test(
    'missing and whitespace turn IDs preserve compatible adjacent calls',
    () {
      final p = projectDesktopTimeline([
        activityRow(0, turn: ' a '),
        activityRow(1, turn: 'a'),
        activityRow(2, turn: ''),
        activityRow(3, turn: '  '),
        activityRow(4, turn: 'a'),
      ]);
      expect(p.items.single.indices, [0, 1, 2, 3, 4]);
    },
  );

  test('hidden reasoning focus rehomes to a visible host within its block', () {
    final p = projectDesktopTimeline(
      [
        messageRow(0, user: true),
        messageRow(1),
        traceRow(2),
        for (var i = 3; i < 8; i++) activityRow(i),
      ],
      hiddenRows: {2},
    );
    expect(p.items.map((i) => i.indices), [
      [0],
      [1],
      [3, 4, 5, 6, 7],
    ]);
    expect(p.renderIndexFor(2), 1);
    expect(p.renderIndexFor(3), 2);
    expect(p.renderIndexFor(7), 2);
  });

  test('hidden focus cannot cross a real user or distinct stable turn', () {
    final user = projectDesktopTimeline(
      [messageRow(0, user: true), traceRow(1)],
      hiddenRows: {1},
    );
    final turn = projectDesktopTimeline(
      [messageRow(0, turn: 'a'), traceRow(1, turn: 'b')],
      hiddenRows: {1},
    );
    expect(user.renderIndexFor(1), isNull);
    expect(turn.renderIndexFor(1), isNull);
  });

  test('reasoning without an open command disclosure splits tool bursts', () {
    final p = projectDesktopTimeline([
      for (var i = 0; i < 5; i++) activityRow(i),
      traceRow(5),
      for (var i = 6; i < 11; i++) activityRow(i),
    ]);
    expect(p.items.map((i) => i.indices), [
      [0, 1, 2, 3, 4],
      [5],
      [6, 7, 8, 9, 10],
    ]);
  });
}
