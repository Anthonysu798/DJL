import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/support/cloud_signout_preview.dart' as fixture;

void main() {
  testWidgets(
    'Cloud sign-out preview uses the actual account page without live IO',
    (tester) async {
      fixture.main();
      await tester.pumpAndSettle();
      expect(find.text('Memory sign-outs: 0'), findsOneWidget);
      await tester.tap(find.text('Open Cloud Account fixture'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Sign out'),
        250,
        scrollable: find.byType(Scrollable).last,
      );
      await tester.tap(find.text('Sign out'));
      await tester.pumpAndSettle();
      expect(find.text('Sign out of DJL Cloud?'), findsOneWidget);
      await tester.tapAt(const Offset(4, 500));
      await tester.pumpAndSettle();
      expect(find.text('Sign out of DJL Cloud?'), findsNothing);
      await tester.tap(find.text('Sign out'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Sign out'));
      await tester.pumpAndSettle();
      expect(find.text('Memory sign-outs: 1'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
