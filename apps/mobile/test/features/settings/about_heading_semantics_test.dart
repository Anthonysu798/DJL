import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/settings/presentation/about_djl_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final brightness in Brightness.values) {
    testWidgets('About guide exposes section headings in $brightness', (
      tester,
    ) async {
      final semantics = tester.ensureSemantics();
      try {
        await tester.pumpWidget(
          MaterialApp(theme: djlTheme(brightness), home: const AboutDjlPage()),
        );
        await tester.pumpAndSettle();
        final heading = find.bySemanticsLabel('How It Works');
        expect(heading, findsOneWidget);
        final node = tester.getSemantics(heading);
        expect(node.label, 'How It Works');
        expect(node.flagsCollection.isHeader, isTrue);
        expect(tester.takeException(), isNull);
      } finally {
        semantics.dispose();
      }
    });
  }
}
