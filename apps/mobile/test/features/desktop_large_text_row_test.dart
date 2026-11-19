import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'desktop_drawer_pin_menu_test.dart' show mountPinMenu;
import 'desktop_new_chat_draft_test.dart' show finishDraft;

void main() {
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    for (final maximum in [false, true]) {
      testWidgets(
        'chat row retains source height bound at ${maximum ? 53 : 17}pt on $platform',
        (tester) async {
          final semantics = tester.ensureSemantics();
          final f = await mountPinMenu(
            tester,
            platform: platform,
            scale: maximum ? 53 / 17 : 1,
          );
          try {
            final row = find.byKey(const Key('navigation.thread.pin-owned'));
            await tester.scrollUntilVisible(
              row,
              200,
              scrollable: find.descendant(
                of: find.byKey(const Key('navigation.list')),
                matching: find.byType(Scrollable),
              ),
            );
            await tester.pumpAndSettle();
            final height = tester.getSize(row).height;
            expect(tester.getSemantics(row).rect.height, closeTo(height, .5));
            expect(height, greaterThanOrEqualTo(50));
            // Native source measures50pt at default and63.333pt at maximum.
            // The test font may be smaller;it must not add source-absent spacing.
            expect(height, lessThanOrEqualTo(maximum ? 64.333 : 50.5));
          } finally {
            await finishDraft(tester, f.desktop);
            semantics.dispose();
          }
        },
        variant: TargetPlatformVariant.only(platform),
      );
    }
  }
}
