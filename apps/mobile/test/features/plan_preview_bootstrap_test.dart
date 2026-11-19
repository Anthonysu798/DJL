import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../integration_test/support/plan_preview.dart' as preview;

void main() {
  testWidgets('render fixture enters the plan page after explicit navigation', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    preview.main();
    await tester.pumpAndSettle();
    expect(find.text('Open plan fixture'), findsOneWidget);
    await tester.tap(find.text('Open plan fixture'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Render fixture'), findsOneWidget);
    expect(find.byTooltip('Open active plan'), findsOneWidget);
    await tester.tap(find.text('Legacy questions'));
    await tester.pumpAndSettle();
    expect(find.text('Next'), findsOneWidget);
    expect(find.text('1 of 2'), findsOneWidget);
    expect(find.text('ESC'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
