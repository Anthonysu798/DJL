import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_conversation_view.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';

void main() {
  setUpAll(() async {
    final loader = FontLoader('Geist')
      ..addFont(rootBundle.load('assets/fonts/Geist-Regular.ttf'));
    await loader.load();
  });
  for (final scale in [1.0, 2.2]) {
    for (final repeated in [false, true]) {
      testWidgets(
        'ordered marker stays on one line at $scale repeated=$repeated',
        (tester) async {
          tester.view.physicalSize = const Size(402, 874);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final text = List.generate(
            100,
            (i) => '${repeated ? 1 : i + 1}. Tip ${i + 1}.',
          ).join('\n');
          await tester.pumpWidget(
            MaterialApp(
              theme: djlTheme(Brightness.light, font: AppFontStyle.geist),
              home: Builder(
                builder: (context) => MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(textScaler: TextScaler.linear(scale)),
                  child: Scaffold(
                    body: SingleChildScrollView(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: DesktopConversationMessage(
                          item: const {'id': 'answer', 'type': 'agentMessage'},
                          text: text,
                          user: false,
                          onTapLink: (_, _, _) {},
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          final marker = find.descendant(
            of: find.text('100.'),
            matching: find.byType(RichText),
          );
          expect(marker, findsOneWidget);
          final paragraph = tester.renderObject<RenderParagraph>(marker);
          expect(
            paragraph.getBoxesForSelection(
              const TextSelection(baseOffset: 0, extentOffset: 4),
            ),
            hasLength(1),
          );
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
}
