import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'package:djl_mobile/features/chat/presentation/cloud_usage_reset_confirmation.dart';
import 'package:djl_mobile/features/chat/presentation/cloud_usage_banner.dart';
import '../fixtures/cloud_usage_fixture.dart';
import 'voice_controller_test.dart' show TestVoice;

void main() {
  for (final scale in [1.0, 3.0]) {
    testWidgets(
      'Reset review stays in the visible keyboard viewport at $scale text',
      (tester) async {
        tester.view.physicalSize = const Size(393, 852);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        bool? confirmed;
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(Brightness.dark),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: TextScaler.linear(scale),
                viewInsets: const EdgeInsets.only(bottom: 280),
              ),
              child: child!,
            ),
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () async {
                    confirmed = await showCloudUsageResetConfirmation(
                      context,
                      const Rect.fromLTWH(12, 440, 369, 100),
                    );
                  },
                  child: const Text('Review'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Review'));
        await tester.pumpAndSettle();
        final popup = tester.getRect(
          find.byKey(const ValueKey('cloud-usage-reset-confirmation')),
        );
        expect(popup.width, 240);
        expect(popup.top, greaterThanOrEqualTo(10));
        expect(popup.bottom, lessThanOrEqualTo(562));
        final action = tester.getRect(
          find.widgetWithText(TextButton, 'Use reset'),
        );
        expect(action.bottom, lessThanOrEqualTo(562));
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(confirmed, false);
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets('A review returning after the page is hidden cannot redeem', (
    tester,
  ) async {
    final f = CloudUsageFixture();
    addTearDown(f.dispose);
    await f.chat.initialize();
    await f.chat.send('pending');
    await f.chat.refreshUsage();
    var allowed = true;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Align(
            alignment: Alignment.bottomCenter,
            child: CloudUsageBanner(controller: f.chat, canAct: () => allowed),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Use a banked reset (2 left)'));
    await tester.pumpAndSettle();
    allowed = false;
    await tester.tap(find.text('Use reset'));
    await tester.pumpAndSettle();
    expect(f.redemptions, isEmpty);
    expect(f.messages.length, 1);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'Usage recovery review cancels without consuming a reset or reposting the pending message',
    (tester) async {
      final f = CloudUsageFixture();
      addTearDown(f.client.close);
      await tester.pumpWidget(
        MaterialApp(
          theme: djlTheme(Brightness.light),
          home: ChatPage(controller: f.chat, voiceDriver: TestVoice()),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'owned pending');
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Send message'));
      await tester.pumpAndSettle();
      expect(
        f.messages.length,
        1,
        reason: 'The actual Send endpoint must have rejected one attempt.',
      );
      expect(find.text("You've reached your usage limit"), findsOneWidget);
      expect(find.text('Use a banked reset (2 left)'), findsOneWidget);
      expect(f.redemptions, isEmpty);
      expect(f.messages.length, 1);
      await tester.tap(find.text('Use a banked reset (2 left)'));
      await tester.pumpAndSettle();
      expect(find.text('Use a banked reset?'), findsOneWidget);
      expect(
        find.text(
          'Both your 5-hour and weekly limits start over now, and your week restarts today.',
        ),
        findsOneWidget,
      );
      expect(find.text('Cancel'), findsNothing);
      await tester.tapAt(const Offset(4, 100));
      await tester.pumpAndSettle();
      expect(find.text('Use a banked reset?'), findsNothing);
      expect(f.redemptions, isEmpty);
      expect(f.messages.length, 1);
      expect(f.chat.composerDraft, 'owned pending');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
