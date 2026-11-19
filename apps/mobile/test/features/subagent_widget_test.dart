import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/subagents/domain/subagent_action.dart';
import 'package:djl_mobile/features/subagents/presentation/subagent_card.dart';
import 'desktop_subagents_test.dart';

void main() {
  testWidgets(
    'actual card opens editable child and parent/back restores typed unsent draft and runtime',
    (tester) async {
      final t = SubagentTransport();
      final d = subagentDesktop(t);
      await d.threadList.attach('mac-a');
      d.models = [
        {'id': 'p', 'model': 'parent-model', 'djlProvider': 'codex'},
        {'id': 'c', 'model': 'child-model', 'djlProvider': 'claudeAgent'},
      ];
      d.model = 'p';
      d.access = 'full-access';
      d.plan = true;
      d.serviceTier = 'fast';
      t.histories['child'] = {
        'id': 'child',
        'title': 'Child',
        'model': 'child-model',
        'modelProvider': 'claudeAgent',
        'runtimeMode': 'approval-required',
        'turns': [
          {
            'id': 'ct',
            'status': 'completed',
            'items': [
              {'id': 'answer', 'type': 'agentMessage', 'text': 'Child answer'},
            ],
          },
        ],
      };
      emitSubagent(t, known: true);
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: d)),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Parent draft typed',
      );
      await tester.tap(find.text('Open child chat'));
      await tester.pumpAndSettle();
      expect(d.thread!['id'], 'child');
      expect(find.text('Child answer'), findsOneWidget);
      expect(find.text('Parent draft typed'), findsNothing);
      expect(d.model, 'c');
      expect(d.access, 'on-request');
      expect(d.plan, false);
      expect(d.serviceTier, 'default');
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Child unsent',
      );
      await tester.tap(find.byTooltip('Return to parent chat'));
      await tester.pumpAndSettle();
      expect(d.thread!['id'], 'parent');
      expect(find.text('Parent draft typed'), findsOneWidget);
      expect(find.text('Spawn agent'), findsOneWidget);
      expect(d.model, 'p');
      expect(d.access, 'full-access');
      expect(d.plan, true);
      expect(d.serviceTier, 'fast');
      await tester.tap(find.text('Open child chat'));
      await tester.pumpAndSettle();
      expect(find.text('Child unsent'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(d.thread!['id'], 'parent');
      expect(find.text('Parent draft typed'), findsOneWidget);
      expect(
        t.calls.where(
          (c) => !{'thread/read', 'thread/resume'}.contains(c['method']),
        ),
        isEmpty,
      );
      await tester.pumpWidget(const SizedBox());
      d.dispose();
    },
  );
  testWidgets(
    'unknown card hydration loading then safe error keeps open-child control usable',
    (tester) async {
      final t = SubagentTransport()..gates['child'] = Completer();
      final d = subagentDesktop(t);
      emitSubagent(t);
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: d)),
      );
      await tester.pump();
      expect(find.text('Subagent'), findsOneWidget);
      expect(find.text('Loading agent details'), findsOneWidget);
      t.gates['child']!.completeError(StateError('private backend error'));
      await tester.pumpAndSettle();
      expect(find.text('Could not load agent details'), findsOneWidget);
      expect(find.text('Open child chat'), findsOneWidget);
      expect(t.calls, hasLength(1));
      await tester.tap(find.text('Agent details'));
      await tester.pumpAndSettle();
      expect(find.textContaining('private backend'), findsNothing);
      expect(find.text('Thread: child'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      d.dispose();
    },
  );
  testWidgets(
    'details remain scroll-safe at large text with long instructions and update',
    (tester) async {
      tester.view.physicalSize = const Size(360, 360);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final t = SubagentTransport();
      final d = subagentDesktop(t);
      final a = SubagentAction.decode(
        {
          'id': 'a',
          'type': 'collabToolCall',
          'tool': 'sendInput',
          'prompt': List.filled(30, 'Long task instructions').join('\n'),
          'receiverAgents': [
            {
              'threadId': 'child',
              'nickname': 'Ada',
              'agentRole': 'worker',
              'model': 'gpt',
            },
          ],
          'statuses': {
            'child': {'status': 'running', 'message': 'Latest useful update'},
          },
        },
        mac: 'mac-a',
        thread: 'parent',
        turn: 'turn',
      )!;
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(2.2)),
            child: child!,
          ),
          home: Scaffold(
            body: SingleChildScrollView(
              child: SubagentActionCard(
                action: a,
                changes: d,
                resolve: d.resolvedSubagent,
                metadataState: d.subagentMetadataState,
                hydrate: () async {},
                onOpen: (_) async {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Agent details'));
      await tester.tap(find.text('Agent details'));
      await tester.pumpAndSettle();
      final scrollable = find
          .descendant(
            of: find.byType(ListView).last,
            matching: find.byType(Scrollable),
          )
          .first;
      await tester.scrollUntilVisible(
        find.text('Latest useful update'),
        200,
        scrollable: scrollable,
        maxScrolls: 100,
      );
      expect(find.text('Latest useful update'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('Open child chat').last,
        150,
        scrollable: scrollable,
      );
      expect(tester.takeException(), isNull);
      expect(t.calls, isEmpty);
      await tester.pumpWidget(const SizedBox());
      d.dispose();
    },
  );
}
