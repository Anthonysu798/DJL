import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/network/client_configuration.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'cloud_composer_draft_page_test.dart' show DraftPageFixture;
import 'cloud_composer_draft_store_test.dart' show DraftCredentials;
import 'voice_controller_test.dart' show TestVoice;

void main() {
  for (final enabled in [false, true]) {
    testWidgets(
      'attachment menu retains configured image creation=$enabled without an implicit send',
      (tester) async {
        final fixture = DraftPageFixture(DraftCredentials());
        final chat = ChatController(fixture.repository, accountScope: 'u:o');
        await tester.pumpWidget(
          MaterialApp(
            home: ChatPage(controller: chat, voiceDriver: TestVoice()),
          ),
        );
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox.shrink());
          fixture.client.close();
        });
        await tester.pumpAndSettle();
        chat.configuration = ClientConfiguration(imageGeneration: enabled);
        await tester.tap(find.byTooltip('Task mode'));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Attach file or image'));
        await tester.pumpAndSettle();
        expect(find.text('Choose file'), findsOneWidget);
        expect(find.text('Photo library'), findsOneWidget);
        expect(find.text('Camera'), findsOneWidget);
        expect(
          find.text('Create image'),
          enabled ? findsOneWidget : findsNothing,
        );
        if (enabled) {
          await tester.tap(find.text('Create image'));
          await tester.pumpAndSettle();
          expect(find.text('Make something yours.'), findsOneWidget);
          await tester.tap(find.widgetWithText(TextButton, 'Close'));
          await tester.pumpAndSettle();
        }
        expect(fixture.sends, 0);
        expect(fixture.creates, 0);
      },
    );
  }
  for (final dark in [false, true]) {
    for (final compact in [false, true]) {
      testWidgets(
        'source Cloud composer stays reachable dark=$dark compactKeyboard=$compact',
        (tester) async {
          final size = compact ? const Size(360, 640) : const Size(411, 923);
          tester.view.devicePixelRatio = 1;
          tester.view.physicalSize = size;
          tester.view.viewInsets = FakeViewPadding(bottom: compact ? 260 : 0);
          tester.platformDispatcher.textScaleFactorTestValue = compact
              ? 1.7
              : 1;
          addTearDown(tester.view.reset);
          addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
          final fixture = DraftPageFixture(DraftCredentials());
          final chat = ChatController(fixture.repository, accountScope: 'u:o');
          await tester.pumpWidget(
            MaterialApp(
              theme: djlTheme(dark ? Brightness.dark : Brightness.light),
              home: ChatPage(
                controller: chat,
                voiceDriver: TestVoice()..allowed = false,
              ),
            ),
          );
          addTearDown(() async {
            await tester.pumpWidget(const SizedBox.shrink());
            fixture.client.close();
          });
          await tester.pumpAndSettle();
          final input = find.byKey(const Key('composer'));
          final task = find.byTooltip('Task mode');
          expect(task, findsOneWidget);
          expect(find.text('Task'), findsOneWidget);
          expect(find.text('How can I help?'), findsOneWidget);
          expect(find.byIcon(Icons.auto_awesome_outlined), findsNothing);
          expect(
            find.byWidgetPredicate(
              (w) =>
                  w is Image &&
                  w.image is AssetImage &&
                  (w.image as AssetImage).assetName == 'assets/djl-logo.png',
            ),
            findsOneWidget,
          );
          expect(
            tester.getRect(find.byKey(const Key('cloud.model-picker'))).bottom,
            lessThan(tester.getRect(input).top),
          );
          expect(
            tester.getRect(input).bottom,
            lessThan(tester.getRect(task).top),
          );
          expect(
            tester
                .getRect(task)
                .overlaps(tester.getRect(find.byTooltip('Start dictation'))),
            false,
          );
          expect(
            tester.getRect(find.byTooltip('Send message')).bottom,
            lessThanOrEqualTo(size.height - (compact ? 260 : 0)),
          );
          expect(
            tester
                .widget<IconButton>(
                  find.byWidgetPredicate(
                    (w) => w is IconButton && w.tooltip == 'Send message',
                  ),
                )
                .onPressed,
            isNull,
          );
          await tester.tap(task);
          await tester.pumpAndSettle();
          expect(chat.mode, 'task');
          expect(find.text('What should DJL work on?'), findsOneWidget);
          await tester.enterText(input, 'Review before sending');
          await tester.pumpAndSettle();
          expect(
            tester
                .widget<IconButton>(
                  find.byWidgetPredicate(
                    (w) => w is IconButton && w.tooltip == 'Send message',
                  ),
                )
                .onPressed,
            isNotNull,
          );
          expect(fixture.sends, 0);
          await tester.tap(task);
          await tester.pumpAndSettle();
          expect(chat.mode, 'chat');
          expect(
            tester.widget<TextField>(input).controller!.text,
            'Review before sending',
          );
          await tester.tap(find.byTooltip('Start dictation'));
          await tester.pumpAndSettle();
          expect(find.textContaining('Allow microphone'), findsOneWidget);
          expect(
            tester.widget<TextField>(input).controller!.text,
            'Review before sending',
          );
          expect(
            tester.getRect(find.byTooltip('Send message')).bottom,
            lessThanOrEqualTo(size.height - (compact ? 260 : 0)),
          );
          expect(fixture.sends, 0);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
}
