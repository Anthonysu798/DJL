import 'package:flutter/material.dart';
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/activity/presentation/command_timeline_row.dart';
import 'package:djl_mobile/features/activity/presentation/activity_card.dart';
import 'package:djl_mobile/features/reasoning/domain/desktop_reasoning.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'desktop_conversation_fidelity_test.dart' show showConversation;
import 'desktop_new_chat_draft_test.dart' show finishDraft;
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop, reasoningEvent;

ReasoningTransport groupTransport(List<Map<String, dynamic>> items) =>
    ReasoningTransport()
      ..history = {
        'id': 'thread',
        'turns': [
          {
            'id': 'turn', 'status': 'completed',
            // Explicit progress phases keep the independent command/tool
            // disclosure fixtures separate from completed-final collapse.
            'items': [
              for (final item in items)
                item['type'] == 'agentMessage' && item['phase'] == null
                    ? {...item, 'phase': 'commentary'}
                    : item,
            ],
          },
        ],
      };

Map<String, dynamic> commandItem(int index) => {
  'id': 'cmd-$index',
  'type': 'commandExecution',
  'command': 'echo GROUP_$index',
  'status': 'completed',
  'aggregatedOutput': 'output $index',
};

void main() {
  final clipboard = <String>[];
  setUp(() {
    clipboard.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
          if (call.method == 'Clipboard.setData') {
            clipboard.add((call.arguments as Map)['text'] as String);
          }
          return null;
        });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });

  testWidgets(
    'repeated file snapshots present one table without changing Undo history',
    (tester) async {
      const patch = '@@ -1 +1 @@\n-old\n+new';
      final desktop = await reasoningDesktop(
        groupTransport([
          for (final entry in [
            ('one', 'src/a.dart'),
            ('two', 'src/b.dart'),
            ('three', '/repo/src/a.dart'),
          ])
            {
              'id': entry.$1,
              'type': 'fileChange',
              'status': 'completed',
              'changes': [
                {
                  'path': entry.$2,
                  'kind': {'type': 'update'},
                  'diff': patch,
                },
              ],
            },
          {
            'id': 'final',
            'type': 'agentMessage',
            'phase': 'final_answer',
            'text': 'Done',
          },
        ]),
      );
      final before = jsonEncode(desktop.timeline);
      try {
        await showConversation(tester, desktop);
        final cards = tester
            .widgetList<ActivityCard>(find.byType(ActivityCard))
            .toList();
        expect(cards, hasLength(1));
        expect(cards.single.activity.files.map((f) => f.path), [
          'src/a.dart',
          'src/b.dart',
        ]);
        expect(cards.single.activity.files.first.diff, patch);
        expect(cards.single.activity.files.first.additions, 1);
        expect(cards.single.activity.files.first.deletions, 1);
        expect(jsonEncode(desktop.timeline), before);
        expect(
          desktop.activity.items.values.where((a) => a.kind == 'fileChange'),
          hasLength(3),
        );
      } finally {
        await finishDraft(tester, desktop);
      }
    },
  );

  testWidgets('active file snapshots stay hidden until the turn settles', (
    tester,
  ) async {
    final transport = groupTransport([]);
    final desktop = await reasoningDesktop(transport);
    try {
      reasoningEvent(
        transport,
        'turn/started',
        turn: 'live',
        extra: {
          'turn': {'id': 'live'},
        },
      );
      reasoningEvent(
        transport,
        'item/completed',
        turn: 'live',
        item: 'live-file',
        snapshot: {
          'type': 'fileChange',
          'changes': [
            {
              'path': 'src/live.dart',
              'kind': {'type': 'update'},
              'diff': '@@ -1 +1 @@\n-old\n+new',
            },
          ],
        },
      );
      await tester.pump();
      await showConversation(tester, desktop);
      expect(desktop.turnId, 'live');
      expect(find.byType(ActivityCard), findsNothing);
      reasoningEvent(
        transport,
        'turn/completed',
        turn: 'live',
        extra: {
          'turn': {'id': 'live', 'status': 'completed'},
        },
      );
      await tester.pumpAndSettle();
      expect(find.byType(ActivityCard), findsOneWidget);
    } finally {
      await finishDraft(tester, desktop);
    }
  });

  testWidgets(
    'completed turn keeps final and file change beside previous rows',
    (tester) async {
      final desktop = await reasoningDesktop(
        groupTransport([
          {
            'id': 'user',
            'type': 'userMessage',
            'content': [
              {'type': 'input_text', 'text': 'Inspect the timeline'},
            ],
          },
          commandItem(0),
          {
            'id': 'file',
            'type': 'fileChange',
            'status': 'completed',
            'changes': [
              {
                'path': 'src/App.swift',
                'kind': {'type': 'update'},
                'diff': '@@ -1 +1 @@\n-old\n+new',
              },
            ],
          },
          {
            'id': 'trace',
            'type': 'reasoning',
            'summary': ['Prior visible trace'],
          },
          {
            'id': 'final',
            'type': 'agentMessage',
            'phase': 'final_answer',
            'text': '  Final result  ',
          },
        ]),
      );
      try {
        await showConversation(tester, desktop);
        expect(find.text('2 previous messages'), findsOneWidget);
        expect(find.text('Ran echo GROUP_0'), findsNothing);
        expect(find.textContaining('Prior visible trace'), findsNothing);
        expect(find.text('Final result'), findsOneWidget);
        expect(find.byType(ActivityCard), findsOneWidget);
        expect(find.byTooltip('Copy response'), findsOneWidget);
        await tester.tap(find.text('2 previous messages'));
        await tester.pumpAndSettle();
        expect(find.text('Ran echo GROUP_0'), findsOneWidget);
        expect(find.textContaining('Prior visible trace'), findsWidgets);
        expect(find.text('Ran 1 command'), findsNothing);
        expect(find.byTooltip('Copy response'), findsOneWidget);
        await tester.ensureVisible(find.byTooltip('Copy response'));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Copy response'));
        await tester.pump();
        expect(clipboard, ['  Final result  ']);
      } finally {
        await finishDraft(tester, desktop);
      }
    },
  );

  testWidgets(
    'late completed commands move behind previous disclosure and raw focus reveals one',
    (tester) async {
      final desktop = await reasoningDesktop(
        groupTransport([
          {
            'id': 'user',
            'type': 'userMessage',
            'content': [
              {'type': 'input_text', 'text': 'Inspect'},
            ],
          },
          {
            'id': 'final',
            'type': 'agentMessage',
            'phase': 'final_answer',
            'text': 'Final answer',
          },
          for (var i = 0; i < 40; i++) commandItem(i),
        ]),
      );
      try {
        await showConversation(
          tester,
          desktop,
          focus: const DesktopLinkTarget('thread', item: 'cmd-30'),
        );
        expect(find.text('40 previous messages'), findsOneWidget);
        expect(find.text('Ran 40 commands'), findsNothing);
        final target = find.text('Ran echo GROUP_30');
        expect(target, findsOneWidget);
        final viewport = tester.getRect(find.byType(Scrollable).first);
        expect(viewport.contains(tester.getCenter(target)), isTrue);
        expect(
          find.textContaining('Linked position is not available'),
          findsNothing,
        );
      } finally {
        await finishDraft(tester, desktop);
      }
    },
  );

  testWidgets(
    'command accessibility targets only its rendered row in a group',
    (tester) async {
      final semantics = tester.ensureSemantics();
      final desktop = await reasoningDesktop(groupTransport([commandItem(0)]));
      try {
        await showConversation(tester, desktop);
        await tester.tap(find.text('Ran 1 command'));
        await tester.pumpAndSettle();
        final row = find.byType(CommandTimelineRow);
        expect(row, findsOneWidget);
        expect(tester.getSemantics(row).rect.size, tester.getSize(row));
        await tester.tap(row);
        await tester.pumpAndSettle();
        expect(find.text('Command details'), findsOneWidget);
        expect(find.text('output 0'), findsOneWidget);
      } finally {
        await finishDraft(tester, desktop);
        semantics.dispose();
      }
    },
  );

  for (final brightness in Brightness.values) {
    for (final scale in [1.0, 2.2]) {
      testWidgets(
        'narrow grouped commands stay usable $brightness scale=$scale',
        (tester) async {
          tester.view.physicalSize = const Size(320, 700);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final semantics = tester.ensureSemantics();
          final desktop = await reasoningDesktop(
            groupTransport([
              for (var i = 0; i < 8; i++)
                {
                  ...commandItem(i),
                  'status': i < 3
                      ? 'failed'
                      : i < 6
                      ? 'stopped'
                      : 'completed',
                },
            ]),
          );
          try {
            await showConversation(
              tester,
              desktop,
              brightness: brightness,
              scale: scale,
            );
            final disclosure = find.bySemanticsLabel(
              RegExp(r'^Ran 8 commands · 3 failed · 3 stopped$'),
            );
            expect(disclosure, findsOneWidget);
            expect(tester.getSize(disclosure).height, greaterThanOrEqualTo(44));
            await tester.ensureVisible(disclosure);
            await tester.pumpAndSettle();
            await tester.tap(disclosure);
            await tester.pumpAndSettle();
            expect(find.text('Ran echo GROUP_0'), findsOneWidget);
            expect(find.text('Ran echo GROUP_7'), findsOneWidget);
            expect(tester.takeException(), isNull);
          } finally {
            await finishDraft(tester, desktop);
            semantics.dispose();
          }
        },
      );
    }
  }

  testWidgets('actual Page puts command trace and one Copy in the disclosure', (
    tester,
  ) async {
    final desktop = await reasoningDesktop(
      groupTransport([
        {'id': 'answer', 'type': 'agentMessage', 'text': '  Raw answer  '},
        commandItem(0),
        {
          'id': 'trace',
          'type': 'reasoning',
          'summary': ['Visible trace'],
        },
      ]),
    );
    try {
      await showConversation(tester, desktop);
      expect(find.text('Ran 1 command'), findsOneWidget);
      expect(find.text('Ran echo GROUP_0'), findsNothing);
      expect(find.textContaining('Visible trace'), findsWidgets);
      expect(find.byTooltip('Copy response'), findsOneWidget);
      await tester.tap(find.text('Ran 1 command'));
      await tester.pumpAndSettle();
      expect(find.text('Ran echo GROUP_0'), findsOneWidget);
      expect(find.byTooltip('Copy response'), findsOneWidget);
      await tester.ensureVisible(find.byTooltip('Copy response'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Copy response'));
      await tester.pump();
      expect(clipboard, ['Raw answer']);
    } finally {
      await finishDraft(tester, desktop);
    }
  });

  testWidgets('actual Page collapses five tools and keeps one group Copy', (
    tester,
  ) async {
    final desktop = await reasoningDesktop(
      groupTransport([
        {'id': 'answer', 'type': 'agentMessage', 'text': 'Answer'},
        for (var i = 0; i < 5; i++)
          {
            'id': 'tool-$i',
            'type': 'mcpToolCall',
            'name': 'Tool $i',
            'status': 'completed',
          },
      ]),
    );
    try {
      await showConversation(tester, desktop);
      expect(find.text('+4 tool calls'), findsOneWidget);
      expect(find.text('Tool 0'), findsNothing);
      expect(find.text('Tool 4'), findsOneWidget);
      expect(find.byTooltip('Copy response'), findsOneWidget);
      await tester.tap(find.text('+4 tool calls'));
      await tester.pumpAndSettle();
      for (var i = 0; i < 5; i++) {
        expect(find.text('Tool $i'), findsOneWidget);
      }
      expect(find.byTooltip('Copy response'), findsOneWidget);
      await tester.ensureVisible(find.byTooltip('Copy response'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Copy response'));
      await tester.pump();
      expect(clipboard, ['Answer']);
    } finally {
      await finishDraft(tester, desktop);
    }
  });

  testWidgets(
    'a raw deep link expands and reaches a command inside its group',
    (tester) async {
      final desktop = await reasoningDesktop(
        groupTransport([for (var i = 0; i < 40; i++) commandItem(i)]),
      );
      try {
        await showConversation(
          tester,
          desktop,
          focus: const DesktopLinkTarget('thread', item: 'cmd-30'),
        );
        expect(find.text('Ran 40 commands'), findsOneWidget);
        final target = find.text('Ran echo GROUP_30');
        expect(target, findsOneWidget);
        final viewport = tester.getRect(find.byType(Scrollable).first);
        expect(viewport.contains(tester.getCenter(target)), isTrue);
        expect(
          find.textContaining('Linked position is not available'),
          findsNothing,
        );
      } finally {
        await finishDraft(tester, desktop);
      }
    },
  );

  testWidgets('hidden reasoning focus reveals its preceding grouped host', (
    tester,
  ) async {
    final desktop = await reasoningDesktop(
      groupTransport([for (var i = 0; i < 40; i++) commandItem(i)]),
    );
    final hidden = DesktopReasoning('mac-a', 'different-pin', (
      thread: 'thread',
      turn: 'turn',
      item: 'hidden',
    ))..content = 'Private hidden trace';
    desktop.timeline.add(hidden.toRow());
    try {
      await showConversation(
        tester,
        desktop,
        focus: DesktopLinkTarget('thread', message: hidden.id),
      );
      expect(find.text('Ran 40 commands'), findsOneWidget);
      expect(find.textContaining('Private hidden trace'), findsNothing);
      final target = find.text('Ran echo GROUP_39');
      expect(target, findsOneWidget);
      final viewport = tester.getRect(find.byType(Scrollable).first);
      expect(viewport.contains(tester.getCenter(target)), isTrue);
    } finally {
      await finishDraft(tester, desktop);
    }
  });

  testWidgets(
    'a new link reaches a command after the user collapses its group',
    (tester) async {
      final desktop = await reasoningDesktop(
        groupTransport([for (var i = 0; i < 40; i++) commandItem(i)]),
      );
      final focus = ValueNotifier(
        const DesktopLinkTarget('thread', item: 'cmd-0'),
      );
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: ValueListenableBuilder(
              valueListenable: focus,
              builder: (_, value, _) =>
                  DesktopChatPage(controller: desktop, focusTarget: value),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final disclosure = find.text('Ran 40 commands');
        await tester.ensureVisible(disclosure);
        await tester.pumpAndSettle();
        await tester.tap(disclosure);
        await tester.pumpAndSettle();
        expect(find.text('Ran echo GROUP_30'), findsNothing);
        focus.value = const DesktopLinkTarget('thread', item: 'cmd-30');
        await tester.pumpAndSettle();
        final target = find.text('Ran echo GROUP_30');
        expect(target, findsOneWidget);
        final viewport = tester.getRect(find.byType(Scrollable).first);
        expect(viewport.contains(tester.getCenter(target)), isTrue);
      } finally {
        await finishDraft(tester, desktop);
        focus.dispose();
      }
    },
  );
}
