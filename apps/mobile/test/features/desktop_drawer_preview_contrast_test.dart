import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'desktop_drawer_pin_menu_test.dart' show mountPinMenu;
import 'desktop_new_chat_draft_test.dart' show finishDraft;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    for (final brightness in Brightness.values) {
      testWidgets(
        'lifted selection retains source contrast on $platform $brightness',
        (tester) async {
          Future<List<int>> sample(bool selected) async {
            final f = await mountPinMenu(
              tester,
              platform: platform,
              brightness: brightness,
              selectedThreadId: selected ? 'pin-owned' : null,
            );
            final key = GlobalKey();
            final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
            await tester.pumpWidget(RepaintBoundary(key: key, child: app));
            await tester.pumpAndSettle();
            await tester.longPress(
              find.byKey(const Key('navigation.thread.pin-owned')),
            );
            await tester.pumpAndSettle();
            final rect = tester.getRect(
              find.byKey(const Key('navigation.context-preview')),
            );
            final point = Offset(rect.left + rect.width * .6, rect.top + 6);
            final boundary =
                key.currentContext!.findRenderObject()!
                    as RenderRepaintBoundary;
            final pixel = (await tester.runAsync(() async {
              final image = await boundary.toImage(pixelRatio: 1);
              try {
                final bytes = (await image.toByteData(
                  format: ui.ImageByteFormat.rawRgba,
                ))!;
                final index =
                    (point.dy.floor() * image.width + point.dx.floor()) * 4;
                return [for (var i = 0; i < 3; i++) bytes.getUint8(index + i)];
              } finally {
                image.dispose();
              }
            }))!;
            await tester.binding.handlePopRoute();
            await tester.pumpAndSettle();
            expect(f.desktop.threadList.data.isPinned('pin-owned'), isFalse);
            await finishDraft(tester, f.desktop);
            return pixel;
          }

          final plain = await sample(false);
          final selected = await sample(true);
          for (var channel = 0; channel < 3; channel++) {
            final contrast = brightness == Brightness.light
                ? plain[channel] - selected[channel]
                : selected[channel] - plain[channel];
            expect(
              contrast,
              closeTo(17, 1),
              reason:
                  'Same-row native Light/Dark captures retain the original 0.065 selection contrast after dimming.',
            );
          }
        },
        variant: TargetPlatformVariant.only(platform),
      );
    }
  }
}
