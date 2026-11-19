import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/settings/presentation/about_djl_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

double glyphHeight(WidgetTester tester, String text) => tester
    .renderObject<RenderParagraph>(find.text(text))
    .getBoxesForSelection(const TextSelection(baseOffset: 0, extentOffset: 1))
    .single
    .toRect()
    .height;

void main() {
  for (final brightness in Brightness.values) {
    testWidgets('About callouts render smaller than prose in $brightness', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(theme: djlTheme(brightness), home: const AboutDjlPage()),
      );
      await tester.pumpAndSettle();
      final prose = glyphHeight(tester, 'Control Codex from your phone.');
      final callout = glyphHeight(
        tester,
        'The Codex runtime stays on your paired device. '
        'Your phone is a secure remote control connected through a relay.',
      );
      // The Swift guide uses caption text for callouts and subheadline for prose.
      expect(callout, lessThan(prose * .9));
      expect(tester.takeException(), isNull);
    });
    testWidgets(
      'About headings do not restyle following prose in $brightness',
      (tester) async {
        await tester.pumpWidget(
          MaterialApp(theme: djlTheme(brightness), home: const AboutDjlPage()),
        );
        await tester.pumpAndSettle();
        expect(
          glyphHeight(tester, 'Control Codex from your phone.'),
          closeTo(
            glyphHeight(tester, 'You send a prompt from your phone.'),
            .1,
          ),
        );
        expect(tester.takeException(), isNull);
      },
    );
  }
}
