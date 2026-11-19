import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'desktop_drawer_pin_menu_test.dart' show mountPinMenu;
import 'desktop_new_chat_draft_test.dart' show finishDraft;

const previewKey = Key('navigation.context-preview');
const paintKey = Key('navigation.thread-paint.pin-owned');
const rowKey = Key('navigation.thread.pin-owned');

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    for (final brightness in Brightness.values) {
      testWidgets(
        'lifted row is enlarged once and dismisses without selecting on $platform $brightness',
        (tester) async {
          final f = await mountPinMenu(
            tester,
            platform: platform,
            brightness: brightness,
          );
          final original = tester.getRect(find.byKey(rowKey));
          final calls = f.remote.calls.length;
          await tester.longPress(find.byKey(rowKey));
          await tester.pumpAndSettle();
          expect(find.byKey(previewKey), findsOneWidget);
          final lifted = tester.getRect(find.byKey(previewKey));
          expect(lifted.width, closeTo(original.width * 1.1, .01));
          expect(lifted.height, closeTo(original.height * 1.1, .01));
          expect(lifted.center.dy, closeTo(original.center.dy, .01));
          expect(tester.widget<Opacity>(find.byKey(paintKey)).opacity, 0);
          expect(find.text('Pin chat').hitTestable(), findsOneWidget);
          await tester.tapAt(lifted.center);
          await tester.pumpAndSettle();
          expect(find.byKey(previewKey), findsNothing);
          expect(tester.widget<Opacity>(find.byKey(paintKey)).opacity, 1);
          expect(f.desktop.threadList.data.isPinned('pin-owned'), isFalse);
          expect(f.remote.calls.length, calls);
          await finishDraft(tester, f.desktop);
        },
        variant: TargetPlatformVariant.only(platform),
      );
    }
  }
  testWidgets(
    'original paint returns after menu exit completes and one pin is applied',
    (tester) async {
      final f = await mountPinMenu(tester);
      await tester.longPress(find.byKey(rowKey));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Pin chat'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 75));
      expect(find.byKey(previewKey), findsOneWidget);
      expect(tester.widget<Opacity>(find.byKey(paintKey)).opacity, 0);
      expect(f.desktop.threadList.data.isPinned('pin-owned'), isFalse);
      await tester.pumpAndSettle();
      expect(find.byKey(previewKey), findsNothing);
      expect(tester.widget<Opacity>(find.byKey(paintKey)).opacity, 1);
      expect(
        f.desktop.threadList.data.pinned.where((id) => id == 'pin-owned'),
        hasLength(1),
      );
      await finishDraft(tester, f.desktop);
    },
  );
  testWidgets('replaced menu owner restores paint without pinning', (
    tester,
  ) async {
    var current = true;
    final f = await mountPinMenu(tester, current: () => current);
    await tester.longPress(find.byKey(rowKey));
    await tester.pumpAndSettle();
    current = false;
    await tester.tap(find.text('Pin chat'));
    await tester.pumpAndSettle();
    expect(find.byKey(previewKey), findsNothing);
    expect(tester.widget<Opacity>(find.byKey(paintKey)).opacity, 1);
    expect(f.desktop.threadList.data.isPinned('pin-owned'), isFalse);
    await finishDraft(tester, f.desktop);
  });
  testWidgets(
    'reduced motion shows and removes the preview without a timed transition',
    (tester) async {
      tester.binding.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(
        tester.binding.platformDispatcher.clearAccessibilityFeaturesTestValue,
      );
      final f = await mountPinMenu(tester);
      await tester.longPress(find.byKey(rowKey));
      await tester.pump();
      expect(find.byKey(previewKey), findsOneWidget);
      await tester.tap(find.text('Pin chat'));
      await tester.pump();
      await tester.pump();
      expect(find.byKey(previewKey), findsNothing);
      expect(tester.widget<Opacity>(find.byKey(paintKey)).opacity, 1);
      expect(f.desktop.threadList.data.isPinned('pin-owned'), isTrue);
      await finishDraft(tester, f.desktop);
    },
  );
  for (final brightness in Brightness.values) {
    testWidgets(
      'context dimming matches measured source colors in $brightness',
      (tester) async {
        final f = await mountPinMenu(tester, brightness: brightness);
        final capture = GlobalKey();
        final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
        await tester.pumpWidget(RepaintBoundary(key: capture, child: app));
        await tester.pumpAndSettle();
        await tester.longPress(find.byKey(rowKey));
        await tester.pumpAndSettle();
        final boundary =
            capture.currentContext!.findRenderObject()!
                as RenderRepaintBoundary;
        final pixel = await tester.runAsync(() async {
          final image = await boundary.toImage(pixelRatio: 1);
          try {
            final data = (await image.toByteData(
              format: ui.ImageByteFormat.rawRgba,
            ))!;
            final index = (400 * image.width + 380) * 4;
            return [for (var i = 0; i < 3; i++) data.getUint8(index + i)];
          } finally {
            image.dispose();
          }
        });
        expect(
          pixel,
          brightness == Brightness.light ? [206, 206, 210] : [5, 4, 9],
        );
        await tester.tapAt(const Offset(390, 400));
        await tester.pumpAndSettle();
        await finishDraft(tester, f.desktop);
      },
    );
  }
  testWidgets('large-text lifted row and action fit the keyboard viewport', (
    tester,
  ) async {
    final f = await mountPinMenu(
      tester,
      size: const Size(320, 700),
      scale: 3,
      insets: const EdgeInsets.only(bottom: 240),
    );
    final row = find.byKey(rowKey);
    final list = tester.getRect(find.byKey(const Key('navigation.list')));
    for (var i = 0; i < 50 && row.hitTestable().evaluate().isEmpty; i++) {
      await tester.dragFrom(
        Offset(list.center.dx, list.bottom - 100),
        const Offset(0, -200),
      );
      await tester.pumpAndSettle();
    }
    await tester.longPress(row);
    await tester.pumpAndSettle();
    final lifted = tester.getRect(find.byKey(previewKey));
    final menu = tester.getRect(find.byKey(const Key('navigation.pin-menu')));
    for (final box in [lifted, menu]) {
      expect(box.left, greaterThanOrEqualTo(18));
      expect(box.right, lessThanOrEqualTo(302));
      expect(box.top, greaterThanOrEqualTo(42));
      expect(box.bottom, lessThanOrEqualTo(450));
    }
    expect(lifted.overlaps(menu), isFalse);
    expect(tester.takeException(), isNull);
    await tester.tapAt(const Offset(310, 500));
    await tester.pumpAndSettle();
    expect(tester.widget<Opacity>(find.byKey(paintKey)).opacity, 1);
    await finishDraft(tester, f.desktop);
  });
}
