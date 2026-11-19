import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/support/cloud_usage_preview.dart' as preview;

void main() {
  for (final choice in [
    'Light pending send fixture',
    'Dark blocked run fixture',
  ]) {
    testWidgets('$choice uses the real recovery flow and volatile receipts', (
      tester,
    ) async {
      preview.main();
      await tester.pumpAndSettle();
      await tester.tap(find.text(choice));
      await tester.pumpAndSettle();
      final f = preview.lastUsageFixture!;
      expect(find.text("You've reached your usage limit"), findsOneWidget);
      expect(f.redemptions, isEmpty);
      await tester.tap(find.text('Use a banked reset (2 left)'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Use reset'));
      await tester.pumpAndSettle();
      expect(f.redemptions.length, 1);
      expect(f.chat.reducer!.status, 'succeeded');
      expect(
        find.text(
          'Memory resets: 1; message attempts: ${choice.contains('pending') ? 2 : 0}',
        ),
        findsOneWidget,
      );
      expect(find.text("You've reached your usage limit"), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
}
