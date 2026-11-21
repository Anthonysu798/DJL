import 'package:flutter/material.dart';
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/reasoning/domain/desktop_reasoning.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_conversation_view.dart';
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
    'repeated file snapshots stay off the phone without changing Undo history',
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
        expect(find.byType(DesktopConversationMessage), findsOneWidget);
        expect(find.text('Done'), findsOneWidget);
        expect(find.textContaining('a.dart'), findsNothing);
        expect(find.textContaining('b.dart'), findsNothing);
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

  testWidgets('file snapshots stay hidden while active and after the turn', (
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
      expect(find.textContaining('live.dart'), findsNothing);
      reasoningEvent(
        transport,
        'turn/completed',
        turn: 'live',
        extra: {
          'turn': {'id': 'live', 'status': 'completed'},
        },
      );
      await tester.pumpAndSettle();
      expect(desktop.turnId, isNull);
      expect(
        desktop.activity.items.values.where((a) => a.kind == 'fileChange'),
        hasLength(1),
      );
      expect(find.textContaining('live.dart'), findsNothing);
      expect(find.byType(DesktopConversationMessage), findsNothing);
    } finally {
      await finishDraft(tester, desktop);
    }
  });

  testWidgets(
    'completed turn shows only the prompt, the final reply and its Copy',
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
        expect(find.textContaining('previous message'), findsNothing);
        expect(find.textContaining('GROUP_0'), findsNothing);
        expect(find.textContaining('App.swift'), findsNothing);
        expect(find.textContaining('Prior visible trace'), findsNothing);
        expect(find.byType(DesktopConversationMessage), findsNWidgets(2));
        expect(find.text('Inspect the timeline'), findsOneWidget);
        expect(find.text('Final result'), findsOneWidget);
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
    'a raw link to a hidden late command lands on the final answer of its turn',
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
        expect(find.textContaining('previous message'), findsNothing);
        expect(find.textContaining('command'), findsNothing);
        expect(find.textContaining('GROUP_'), findsNothing);
        final target = find.text('Final answer');
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

  testWidgets('actual Page hides command and trace and keeps one Copy', (
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
      expect(find.textContaining('command'), findsNothing);
      expect(find.textContaining('GROUP_0'), findsNothing);
      expect(find.textContaining('Visible trace'), findsNothing);
      expect(find.byType(DesktopConversationMessage), findsOneWidget);
      expect(find.byTooltip('Copy response'), findsOneWidget);
      await tester.ensureVisible(find.byTooltip('Copy response'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Copy response'));
      await tester.pump();
      expect(clipboard, ['  Raw answer  ']);
    } finally {
      await finishDraft(tester, desktop);
    }
  });

  testWidgets('actual Page hides five tools and keeps one Copy', (
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
      expect(find.textContaining('tool call'), findsNothing);
      expect(find.textContaining('Tool '), findsNothing);
      expect(find.byType(DesktopConversationMessage), findsOneWidget);
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

  testWidgets('hidden reasoning focus reveals its preceding visible host', (
    tester,
  ) async {
    final desktop = await reasoningDesktop(
      groupTransport([
        for (var i = 0; i < 40; i++)
          {'id': 'note-$i', 'type': 'agentMessage', 'text': 'Note $i'},
        commandItem(0),
      ]),
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
      expect(find.textContaining('GROUP_0'), findsNothing);
      expect(find.textContaining('Private hidden trace'), findsNothing);
      final target = find.text('Note 39');
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
  });
}
