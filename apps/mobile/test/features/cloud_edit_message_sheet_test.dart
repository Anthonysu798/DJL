import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'cloud_composer_draft_page_test.dart' show DraftPageFixture;
import 'cloud_composer_draft_store_test.dart' show DraftCredentials;
import 'voice_controller_test.dart' show TestVoice;

Future<DraftPageFixture> openEditor(WidgetTester tester) async {
  final fixture = DraftPageFixture(DraftCredentials());
  final chat = ChatController(fixture.repository, accountScope: 'u:o');
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    fixture.client.close();
  });
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(Brightness.light),
      home: ChatPage(controller: chat, voiceDriver: TestVoice()),
    ),
  );
  await tester.pumpAndSettle();
  chat.messages = [
    ChatMessage(
      id: 'original',
      role: 'user',
      parts: const [
        {'type': 'text', 'text': '**Owned original**'},
      ],
    ),
  ];
  chat.notifyListeners();
  await tester.pumpAndSettle();
  await tester.longPress(find.text('**Owned original**'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Edit'));
  await tester.pumpAndSettle();
  return fixture;
}

Finder get editor => find.byWidgetPredicate(
  (widget) =>
      widget is TextField && widget.controller?.text == '**Owned original**',
);

void main() {
  testWidgets(
    'Edit opens an expandable sheet with readable prose and toolbar actions',
    (tester) async {
      final fixture = await openEditor(tester);
      expect(find.text('Edit message'), findsOneWidget);
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.byType(DraggableScrollableSheet), findsOneWidget);
      final field = tester.widget<TextField>(editor);
      expect(field.style?.fontSize, 15);
      expect(field.maxLines, isNull);
      expect(
        tester.getCenter(find.text('Cancel')).dy,
        closeTo(tester.getCenter(find.text('Send')).dy, 1),
      );
      expect(
        tester.getCenter(find.text('Edit message')).dy,
        closeTo(tester.getCenter(find.text('Send')).dy, 1),
      );
      final mediumHeight = tester
          .getSize(find.byType(DraggableScrollableSheet))
          .height;
      await tester.drag(find.text('Edit message'), const Offset(0, -260));
      await tester.pumpAndSettle();
      expect(
        tester.getSize(find.byType(DraggableScrollableSheet)).height,
        greaterThan(mediumHeight + 100),
      );
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(find.text('Edit message'), findsNothing);
      expect(fixture.posts, 0);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Whitespace disables Send and Cancel does not mutate the conversation',
    (tester) async {
      final fixture = await openEditor(tester);
      await tester.enterText(editor, ' \n\t ');
      await tester.pumpAndSettle();
      final send = tester.widget<ButtonStyleButton>(
        find.ancestor(
          of: find.text('Send'),
          matching: find.byWidgetPredicate(
            (widget) => widget is ButtonStyleButton,
          ),
        ),
      );
      expect(send.onPressed, isNull);
      expect(fixture.posts, 0);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(find.text('**Owned original**'), findsOneWidget);
      expect(fixture.posts, 0);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'One explicit Send preserves multiline content and source whitespace normalization',
    (tester) async {
      final fixture = await openEditor(tester);
      await tester.enterText(editor, '  Edited **literal**\nsecond line  ');
      await tester.pumpAndSettle();
      expect(fixture.posts, 0);
      await tester.tap(find.text('Send'));
      await tester.pumpAndSettle();
      expect(fixture.sentText, 'Edited **literal**\nsecond line');
      expect(fixture.sends, 1);
      expect(find.text('Edit message'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('Phone keyboard leaves sheet actions reachable with large text', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final fixture = await openEditor(tester);
    tester.view.viewInsets = const FakeViewPadding(bottom: 320);
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.view.resetViewInsets);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(tester.getBottomLeft(find.text('Send')).dy, lessThan(524));
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(fixture.posts, 0);
    expect(tester.takeException(), isNull);
  });
}
