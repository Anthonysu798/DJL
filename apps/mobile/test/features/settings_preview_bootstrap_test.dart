import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/support/settings_preview.dart' as preview;

void main() {
  testWidgets(
    'isolated Settings preview enters real production controls without app authentication',
    (tester) async {
      preview.main();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open settings fixture'));
      await tester.pumpAndSettle();
      expect(find.text('Appearance'), findsOneWidget);
      expect(find.text('Font'), findsOneWidget);
      expect(find.text('Theme'), findsOneWidget);
      expect(find.text('App Lock'), findsNothing);
      expect(find.text('Security'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
