import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/support/bridge_preview.dart' as preview;

void main() {
  testWidgets(
    'Bridge preview uses real confirmation and stale recovery with in-memory boundaries',
    (tester) async {
      preview.main();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open bridge fixture'));
      await tester.pumpAndSettle();
      expect(find.text('Update available'), findsOneWidget);
      await tester.tap(find.text('Update DJL on your Mac'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Your Mac has DJL 1.9'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Go offline'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Last known version'), findsOneWidget);
      await tester.tap(find.text('Go online'));
      await tester.pumpAndSettle();
      expect(find.text('Update available'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
