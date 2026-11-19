import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/support/paired_voice_fixture.dart';

void main() {
  void resume(WidgetTester tester) {
    final binding = tester.binding;
    if (binding.lifecycleState == AppLifecycleState.paused) {
      binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    }
    if (binding.lifecycleState == AppLifecycleState.hidden) {
      binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    }
    binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  }

  for (final phase in [AppLifecycleState.inactive, AppLifecycleState.paused]) {
    testWidgets(
      'paired voice grant after $phase cannot start or alter the draft',
      (tester) async {
        resume(tester);
        final f = await pairedVoiceFixture();
        try {
          await tester.pumpWidget(
            MaterialApp(
              home: DesktopChatPage(
                controller: f.desktop,
                voiceDriver: f.voice,
              ),
            ),
          );
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 200));
          final composer = find.byKey(const Key('desktop_composer'));
          await tester.enterText(composer, 'Keep the paired QA draft');
          await tester.tap(find.byTooltip('Start dictation'));
          await tester.pump();
          expect(f.voice.initializations, 1);
          tester.binding.handleAppLifecycleStateChanged(
            AppLifecycleState.inactive,
          );
          if (phase == AppLifecycleState.paused) {
            tester.binding.handleAppLifecycleStateChanged(
              AppLifecycleState.hidden,
            );
            tester.binding.handleAppLifecycleStateChanged(
              AppLifecycleState.paused,
            );
          }
          await tester.pump();
          f.voice.permission.complete(true);
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 200));
          expect(
            f.voice.starts,
            0,
            reason:
                'A permission result must not begin capture outside the active scene.',
          );
          resume(tester);
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 200));
          expect(
            f.voice.starts,
            0,
            reason: 'An abandoned preflight must not restart on resume.',
          );
          expect(
            tester.widget<TextField>(composer).controller!.text,
            'Keep the paired QA draft',
          );
          await tester.tap(find.byTooltip('Start dictation'));
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 200));
          expect(f.voice.initializations, 2);
          expect(
            f.voice.starts,
            1,
            reason: 'Only a fresh foreground action may start capture.',
          );
          f.voice.transcript!('public QA words');
          await tester.pump();
          expect(
            tester.widget<TextField>(composer).controller!.text,
            'Keep the paired QA draft public QA words',
          );
          tester.binding.handleAppLifecycleStateChanged(
            AppLifecycleState.inactive,
          );
          await tester.pump();
          f.voice.transcript!('late words');
          await tester.pump();
          expect(
            tester.widget<TextField>(composer).controller!.text,
            'Keep the paired QA draft public QA words',
          );
          resume(tester);
          await tester.pump();

          expect(
            f.transport.requests.where(
              (m) => ['turn/start', 'turn/steer', 'thread/start'].contains(m),
            ),
            isEmpty,
          );
        } finally {
          resume(tester);
          await tester.pumpWidget(const SizedBox.shrink());
          f.desktop.dispose();
          f.voice.dispose();
        }
      },
    );
  }
  testWidgets(
    'paired page mounted inactive waits for an explicit foreground action',
    (tester) async {
      resume(tester);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      final f = await pairedVoiceFixture();
      f.voice.permission.complete(true);
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: DesktopChatPage(controller: f.desktop, voiceDriver: f.voice),
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 200));
        await tester.tap(find.byTooltip('Start dictation'));
        await tester.pump();
        expect(f.voice.initializations, 0);
        expect(f.voice.starts, 0);
        resume(tester);
        await tester.pump();
        await tester.tap(find.byTooltip('Start dictation'));
        await tester.pump();
        expect(f.voice.initializations, 1);
        expect(f.voice.starts, 1);
        expect(f.voice.offscreenStarts, 0);
      } finally {
        resume(tester);
        await tester.pumpWidget(const SizedBox.shrink());
        f.desktop.dispose();
        f.voice.dispose();
      }
    },
  );
}
