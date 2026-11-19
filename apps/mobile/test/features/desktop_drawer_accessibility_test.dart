import 'dart:ui' show SemanticsAction, Tristate;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'desktop_drawer_pin_menu_test.dart' show mountPinMenu;
import 'desktop_new_chat_draft_test.dart' show finishDraft;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    for (final brightness in Brightness.values) {
      testWidgets(
        'New chat exposes one accessible button and guards its owner on $platform $brightness',
        (tester) async {
          final semantics = tester.ensureSemantics();
          try {
            var current = true;
            var presses = 0;
            final f = await mountPinMenu(
              tester,
              platform: platform,
              brightness: brightness,
              current: () => current,
              onNewChat: () => presses++,
            );
            final button = find.bySemanticsLabel('New chat');
            expect(button, findsOneWidget);
            var node = tester.getSemantics(button);
            expect(node.flagsCollection.isButton, isTrue);
            expect(node.flagsCollection.isEnabled, Tristate.isTrue);
            expect(
              node.getSemanticsData().hasAction(SemanticsAction.tap),
              isTrue,
            );
            expect(find.text('Chat'), findsOneWidget);
            await tester.tap(button);
            await tester.pump();
            expect(presses, 1);
            current = false;
            await tester.tap(button);
            await tester.pump();
            expect(
              presses,
              1,
              reason: 'A stale owner must never create a chat.',
            );
            f.desktop.state = 'disconnected';
            f.desktop.notifyListeners();
            await tester.pumpAndSettle();
            node = tester.getSemantics(button);
            expect(node.flagsCollection.isEnabled, Tristate.isFalse);
            expect(
              node.getSemanticsData().hasAction(SemanticsAction.tap),
              isFalse,
            );
            await tester.tap(button);
            await tester.pump();
            expect(presses, 1);
            await finishDraft(tester, f.desktop);
          } finally {
            semantics.dispose();
          }
        },
        variant: TargetPlatformVariant.only(platform),
      );
    }
  }
}
