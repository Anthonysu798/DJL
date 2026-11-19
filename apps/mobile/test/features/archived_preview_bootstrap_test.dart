import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/support/archived_preview.dart' as preview;
import 'settings/archived_chats_page_test.dart' show dismissArchiveRemoval;

void main() {
  testWidgets(
    'isolated archive fixture reaches production page, subtree Unarchive and local Remove Cancel',
    (tester) async {
      preview.main();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open archived fixture'));
      await tester.pumpAndSettle();
      expect(find.text('3 saved locally'), findsOneWidget);
      await tester.ensureVisible(find.text('Archived Chats'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Archived Chats'));
      await tester.pumpAndSettle();
      await tester.longPress(find.text('Newest archived chat'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Unarchive'));
      await tester.pumpAndSettle();
      expect(find.text('Newest archived chat'), findsNothing);
      expect(find.text('Child archived chat'), findsNothing);
      await tester.longPress(find.text('Earlier archived chat'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Remove from Phone'));
      await tester.pumpAndSettle();
      await dismissArchiveRemoval(tester);
      expect(find.text('Earlier archived chat'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
