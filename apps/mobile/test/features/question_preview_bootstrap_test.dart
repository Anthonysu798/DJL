import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_composer_panel.dart';
import '../../integration_test/support/question_preview.dart' as preview;

void main() {
  testWidgets(
    'isolated native fixture exercises pending, failed and accepted cancellation',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      preview.main();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open question fixture'));
      await tester.pumpAndSettle();
      expect(find.text('Retained local QA draft'), findsOneWidget);
      await tester.tap(find.text('Ask question'));
      await tester.pumpAndSettle();
      expect(find.byType(DesktopComposerPanel), findsNothing);
      await tester.tap(find.text('Only local QA'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('ESC'));
      await tester.pump();
      expect(find.text('Closing...'), findsOneWidget);
      await tester.tap(find.text('Reject cancellation'));
      await tester.pumpAndSettle();
      expect(find.text('ESC'), findsOneWidget);
      expect(find.byType(DesktopComposerPanel), findsNothing);
      await tester.tap(find.text('Reset fixture'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ask question'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('ESC'));
      await tester.pump();
      await tester.tap(find.text('Release cancellation'));
      await tester.pumpAndSettle();
      expect(find.text('Retained local QA draft'), findsOneWidget);
      expect(find.byType(DesktopComposerPanel), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
