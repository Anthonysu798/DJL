import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> openCloudFromDesktop(WidgetTester tester) async {
  final cloud = find.widgetWithText(TextButton, 'DJL Cloud');
  if (cloud.evaluate().isNotEmpty) {
    await tester.ensureVisible(cloud);
    await tester.pumpAndSettle();
    await tester.tap(cloud);
  } else {
    await tester.tap(find.byTooltip('Open navigation'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cloud chat').hitTestable());
  }
  await tester.pumpAndSettle();
}
