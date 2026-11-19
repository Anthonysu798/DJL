import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/support/cloud_chat_actions_preview.dart'
    as preview;

void main() {
  for (final appearance in ['Light', 'Dark']) {
    testWidgets(
      '$appearance Cloud actions native fixture uses real Root with memory-only deletion',
      (tester) async {
        preview.main();
        await tester.pumpAndSettle();
        await tester.tap(find.text('$appearance Cloud actions fixture'));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Open navigation'));
        await tester.pumpAndSettle();
        await tester.longPress(find.text('Owned Cloud Delete QA89'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Delete'));
        await tester.pumpAndSettle();
        expect(preview.lastFixture!.deletes, 0);
        await tester.tapAt(const Offset(790, 100));
        await tester.pumpAndSettle();
        expect(preview.lastFixture!.deletes, 0);
        await tester.longPress(find.text('Owned Cloud Delete QA89'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Delete'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Delete'));
        await tester.pumpAndSettle();
        expect(preview.lastFixture!.deletes, 1);
        expect(find.byTooltip('Open navigation'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }
}
