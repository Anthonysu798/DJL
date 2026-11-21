import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'package:djl_mobile/features/chat/presentation/message_view.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'package:djl_mobile/core/design/djl_icons.dart';
import 'package:djl_mobile/core/design/djl_tokens.dart';
import 'cloud_composer_draft_page_test.dart' show DraftPageFixture;
import 'cloud_composer_draft_store_test.dart' show DraftCredentials;
import 'voice_controller_test.dart' show TestVoice;

ChatMessage message(
  String id,
  String role,
  String text, {
  String? parent,
  String? run,
  String? model,
}) => ChatMessage(
  id: id,
  role: role,
  parts: [
    {'type': 'text', 'text': text},
  ],
  parentId: parent,
  runId: run,
  model: model,
);

void main() {
  for (final dark in [false, true]) {
    testWidgets(
      'Cloud user text is literal, compact and uses the ink bubble dark=$dark',
      (tester) async {
        final f = DraftPageFixture(DraftCredentials());
        try {
          await tester.pumpWidget(
            MaterialApp(
              theme: djlTheme(dark ? Brightness.dark : Brightness.light),
              home: Scaffold(
                body: SizedBox(
                  width: 320,
                  child: MessageView(
                    message: message('u', 'user', '**literal**'),
                    repository: f.repository,
                    onEdit: () {},
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(find.text('You'), findsNothing);
          expect(find.text('DJL'), findsNothing);
          expect(find.byType(MarkdownBody), findsNothing);
          final text = find.byWidgetPredicate(
            (w) => w is SelectableText && w.data == '**literal**',
          );
          expect(text, findsOneWidget);
          expect(tester.widget<SelectableText>(text).style!.fontSize, 15);
          expect(find.byTooltip('Copy message'), findsNothing);
          expect(find.byTooltip('Edit message'), findsNothing);
          final bubble = find.byWidgetPredicate(
            (w) =>
                w is Container &&
                w.decoration is BoxDecoration &&
                (w.decoration as BoxDecoration).borderRadius ==
                    BorderRadius.circular(DjlRadius.lg),
          );
          expect(bubble, findsOneWidget);
          expect(tester.getSize(bubble).height, closeTo(38, 1));
          expect(tester.getSize(bubble).width, lessThan(200));
          expect(
            (tester.widget<Container>(bubble).decoration as BoxDecoration)
                .color,
            (dark ? DjlColors.dark : DjlColors.light).ink,
          );
          expect(tester.getRect(bubble).left, greaterThanOrEqualTo(48));
          expect(f.posts, 0);
          expect(tester.takeException(), isNull);
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          f.client.close();
        }
      },
    );
  }

  testWidgets(
    'User copy and edit are selection context actions without an implicit request',
    (tester) async {
      final f = DraftPageFixture(DraftCredentials());
      var edits = 0;
      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            copied = (call.arguments as Map)['text'] as String;
          }
          if (call.method == 'Clipboard.getData') return {'text': copied ?? ''};
          if (call.method == 'Clipboard.hasStrings') {
            return {'value': copied != null};
          }
          return null;
        },
      );
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: MessageView(
                message: message('u', 'user', 'Owned prompt'),
                repository: f.repository,
                onEdit: () => edits++,
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byTooltip('Edit message'), findsNothing);
        await tester.longPress(find.text('Owned prompt'));
        await tester.pumpAndSettle();
        expect(find.text('Copy'), findsOneWidget);
        expect(find.text('Edit'), findsOneWidget);
        await tester.tap(find.text('Copy'));
        await tester.pumpAndSettle();
        expect(copied, 'Owned prompt');
        expect(edits, 0);
        await tester.longPress(find.text('Owned prompt'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Edit'));
        await tester.pumpAndSettle();
        expect(edits, 1);
        expect(f.posts, 0);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        );
        f.client.close();
      }
    },
  );

  testWidgets(
    'Assistant actions follow source order and expose model metadata',
    (tester) async {
      final f = DraftPageFixture(DraftCredentials());
      var regenerated = 0, spoken = 0;
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: MessageView(
                message: message('a', 'assistant', 'Reply', model: 'model-id'),
                repository: f.repository,
                onRegenerate: () => regenerated++,
                onSpeak: () => spoken++,
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('DJL'), findsNothing);
        expect(find.text('You'), findsNothing);
        expect(find.text('model-id'), findsOneWidget);
        expect(tester.widget<Text>(find.text('model-id')).style!.fontSize, 11);
        expect(
          tester.getTopLeft(find.byTooltip('Copy message')).dx,
          lessThan(tester.getTopLeft(find.byTooltip('Regenerate reply')).dx),
        );
        expect(
          tester.getTopLeft(find.byTooltip('Regenerate reply')).dx,
          lessThan(tester.getTopLeft(find.byTooltip('Read aloud')).dx),
        );
        await tester.tap(find.byTooltip('Regenerate reply'));
        await tester.tap(find.byTooltip('Read aloud'));
        expect(regenerated, 1);
        expect(spoken, 1);
        expect(f.posts, 0);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        f.client.close();
      }
    },
  );

  testWidgets(
    'Recreated message identity selects correct branch and never wraps at bounds',
    (tester) async {
      final f = DraftPageFixture(DraftCredentials());
      final siblings = [
        message('a', 'assistant', 'First'),
        message('b', 'assistant', 'Second'),
      ];
      final chosen = <String>[];
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: MessageView(
                message: message('a', 'assistant', 'First'),
                repository: f.repository,
                siblings: siblings,
                onSibling: (m) => chosen.add(m.id),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('1 / 2'), findsOneWidget);
        final previous = tester.widget<IconButton>(
          find.widgetWithIcon(IconButton, DjlIcons.chevronLeft),
        );
        expect(previous.onPressed, isNull);
        await tester.tap(find.byTooltip('Next branch'));
        expect(chosen, ['b']);
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: MessageView(
                message: message('b', 'assistant', 'Second'),
                repository: f.repository,
                siblings: siblings,
                onSibling: (m) => chosen.add(m.id),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('2 / 2'), findsOneWidget);
        expect(
          tester
              .widget<IconButton>(
                find.widgetWithIcon(IconButton, DjlIcons.chevronRight),
              )
              .onPressed,
          isNull,
        );
        expect(f.posts, 0);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        f.client.close();
      }
    },
  );

  testWidgets(
    'Current streaming assistant has no copy, regenerate or speech footer',
    (tester) async {
      final f = DraftPageFixture(DraftCredentials());
      final chat = ChatController(f.repository, accountScope: 'u:o');
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: ChatPage(controller: chat, voiceDriver: TestVoice()),
          ),
        );
        await tester.pumpAndSettle();
        chat.messages = [
          message('u', 'user', 'Question'),
          message(
            'a',
            'assistant',
            'Partial reply',
            parent: 'u',
            run: 'running',
          ),
        ];
        chat.reducer = RunReducer(runId: 'running', messages: chat.messages);
        chat.notifyListeners();
        await tester.pumpAndSettle();
        expect(find.byTooltip('Copy message'), findsNothing);
        expect(find.byTooltip('Regenerate reply'), findsNothing);
        expect(find.byTooltip('Read aloud'), findsNothing);
        expect(f.sends, 0);
        expect(f.creates, 0);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        f.client.close();
      }
    },
  );
  testWidgets(
    'Narrow Cloud rows preserve full text and actions at three-times text size',
    (tester) async {
      final f = DraftPageFixture(DraftCredentials());
      final a = message(
        'a',
        'assistant',
        'A readable reply with several words.',
        model: 'provider/a-long-model-identifier',
      );
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: MediaQuery(
                data: const MediaQueryData(textScaler: TextScaler.linear(3)),
                child: SizedBox(
                  width: 320,
                  child: ListView(
                    children: [
                      MessageView(
                        message: message(
                          'u',
                          'user',
                          'A long literal prompt with several words that must wrap.',
                        ),
                        repository: f.repository,
                      ),
                      MessageView(
                        message: a,
                        repository: f.repository,
                        onRegenerate: () {},
                        onSpeak: () {},
                        siblings: [a, message('b', 'assistant', 'Other')],
                        onSibling: (_) {},
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          find.text('A long literal prompt with several words that must wrap.'),
          findsOneWidget,
        );
        await tester.scrollUntilVisible(
          find.byTooltip('Copy message'),
          250,
          scrollable: find.byType(Scrollable).first,
        );
        expect(find.byTooltip('Copy message'), findsOneWidget);
        expect(find.text('1 / 2'), findsOneWidget);
        expect(f.posts, 0);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        f.client.close();
      }
    },
  );

  testWidgets(
    'Historical assistant keeps actions while only the current run is streaming',
    (tester) async {
      final f = DraftPageFixture(DraftCredentials());
      final chat = ChatController(f.repository, accountScope: 'u:o');
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: ChatPage(controller: chat, voiceDriver: TestVoice()),
          ),
        );
        await tester.pumpAndSettle();
        chat.messages = [
          message('u1', 'user', 'First'),
          message(
            'a1',
            'assistant',
            'Historical reply',
            parent: 'u1',
            run: 'old',
          ),
          message('u2', 'user', 'Next', parent: 'a1'),
          message(
            'a2',
            'assistant',
            'Partial reply',
            parent: 'u2',
            run: 'current',
          ),
        ];
        chat.reducer = RunReducer(runId: 'current', messages: chat.messages);
        chat.notifyListeners();
        await tester.pumpAndSettle();
        expect(find.byTooltip('Copy message'), findsOneWidget);
        expect(find.byTooltip('Read aloud'), findsOneWidget);
        expect(f.sends, 0);
        expect(f.creates, 0);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        f.client.close();
      }
    },
  );
}
