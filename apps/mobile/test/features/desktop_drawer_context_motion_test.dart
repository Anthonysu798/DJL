import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_navigation_menu.dart';
import 'desktop_drawer_pin_menu_test.dart' show mountPinMenu;
import 'desktop_new_chat_draft_test.dart' show finishDraft;

const row = Key('navigation.thread.pin-owned');
const preview = Key('navigation.context-preview');

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    testWidgets(
      'dimming returns gradually while the preview exits on $platform',
      (tester) async {
        final f = await mountPinMenu(tester, platform: platform);
        final boundaryKey = GlobalKey();
        final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
        await tester.pumpWidget(RepaintBoundary(key: boundaryKey, child: app));
        await tester.pumpAndSettle();
        Future<int> background() async {
          final boundary =
              boundaryKey.currentContext!.findRenderObject()!
                  as RenderRepaintBoundary;
          return (await tester.runAsync(() async {
            final image = await boundary.toImage(pixelRatio: 1);
            try {
              final bytes = (await image.toByteData(
                format: ui.ImageByteFormat.rawRgba,
              ))!;
              return bytes.getUint8((400 * image.width + 380) * 4);
            } finally {
              image.dispose();
            }
          }))!;
        }

        final baseline = await background();
        await tester.longPress(find.byKey(row));
        await tester.pumpAndSettle();
        final dimmed = await background();
        expect(dimmed, lessThan(baseline));
        await tester.binding.handlePopRoute();
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 60));
        expect(find.byKey(preview), findsOneWidget);
        expect(
          tester
              .widget<Opacity>(
                find.byKey(const Key('navigation.thread-paint.pin-owned')),
              )
              .opacity,
          0,
        );
        expect(await background(), inExclusiveRange(dimmed, baseline));
        await tester.pumpAndSettle();
        expect(await background(), baseline);
        expect(find.byKey(preview), findsNothing);
        expect(f.desktop.threadList.data.isPinned('pin-owned'), isFalse);
        await finishDraft(tester, f.desktop);
      },
      variant: TargetPlatformVariant.only(platform),
    );
    testWidgets(
      'empty drawer disposes without creating a ticker on $platform',
      (tester) async {
        final f = await mountPinMenu(tester, platform: platform);
        f.desktop.threadList.data.snapshots.clear();
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: DesktopNavigationMenu(
                key: UniqueKey(),
                controller: f.desktop,
                onThread: (_) {},
                onNewChat: () {},
                onRemote: () {},
                isCurrent: () => true,
              ),
            ),
          ),
        );
        await finishDraft(tester, f.desktop);
        expect(tester.takeException(), isNull);
      },
      variant: TargetPlatformVariant.only(platform),
    );
    testWidgets(
      'held row anticipates the lift on $platform',
      (tester) async {
        final f = await mountPinMenu(tester, platform: platform);
        final baseline = tester.getRect(find.byKey(row));
        final calls = f.remote.calls.length;
        final gesture = await tester.startGesture(baseline.center);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        final held = tester.getRect(find.byKey(row));
        expect(held.width / baseline.width, inExclusiveRange(1.03, 1.06));
        expect(held.center.dx, closeTo(baseline.center.dx, .01));
        expect(find.byKey(preview), findsNothing);
        await gesture.cancel();
        await tester.pumpAndSettle();
        expect(tester.getRect(find.byKey(row)), baseline);
        expect(find.text('Pin chat'), findsNothing);
        expect(f.remote.calls.length, calls);
        expect(f.desktop.threadList.data.isPinned('pin-owned'), isFalse);
        await finishDraft(tester, f.desktop);
      },
      variant: TargetPlatformVariant.only(platform),
    );

    testWidgets(
      'menu continues the held row into its lifted position on $platform',
      (tester) async {
        final f = await mountPinMenu(tester, platform: platform);
        final baseline = tester.getRect(find.byKey(row));
        final gesture = await tester.startGesture(baseline.center);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        final held = tester.getRect(find.byKey(row));
        await tester.pump(const Duration(milliseconds: 100));
        await tester.pump();
        final first = tester.getRect(find.byKey(preview));
        expect(
          find.ancestor(
            of: find.byKey(preview),
            matching: find.byType(FadeTransition),
          ),
          findsNothing,
          reason: 'The lifted row must remain painted while the backdrop dims.',
        );
        expect(first.width, closeTo(held.width, .5));
        expect(first.center.dx, closeTo(baseline.center.dx, .5));
        await tester.pump(const Duration(milliseconds: 100));
        final moving = tester.getRect(find.byKey(preview));
        expect(moving.width, greaterThan(first.width));
        expect(moving.width, lessThan(baseline.width * 1.1));
        await tester.pumpAndSettle();
        final lifted = tester.getRect(find.byKey(preview));
        expect(lifted.width, closeTo(baseline.width * 1.1, .01));
        expect(lifted.left, closeTo(18, .01));
        await gesture.up();
        await tester.tapAt(const Offset(390, 400));
        await tester.pumpAndSettle();
        expect(tester.getRect(find.byKey(row)), baseline);
        expect(f.desktop.threadList.data.isPinned('pin-owned'), isFalse);
        await finishDraft(tester, f.desktop);
      },
      variant: TargetPlatformVariant.only(platform),
    );
    testWidgets(
      'interrupted lift returns continuously without pinning on $platform',
      (tester) async {
        final f = await mountPinMenu(tester, platform: platform);
        final baseline = tester.getRect(find.byKey(row));
        final calls = f.remote.calls.length;
        await tester.longPress(find.byKey(row));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 60));
        final before = tester.getRect(find.byKey(preview));
        await tester.binding.handlePopRoute();
        await tester.pump();
        expect(tester.getRect(find.byKey(preview)), before);
        await tester.pumpAndSettle();
        expect(find.byKey(preview), findsNothing);
        expect(tester.getRect(find.byKey(row)), baseline);
        expect(f.desktop.threadList.data.isPinned('pin-owned'), isFalse);
        expect(f.remote.calls.length, calls);
        await finishDraft(tester, f.desktop);
      },
      variant: TargetPlatformVariant.only(platform),
    );
    testWidgets(
      'reduced motion keeps the held row still on $platform',
      (tester) async {
        tester.binding.platformDispatcher.accessibilityFeaturesTestValue =
            const FakeAccessibilityFeatures(disableAnimations: true);
        addTearDown(
          tester.binding.platformDispatcher.clearAccessibilityFeaturesTestValue,
        );
        final f = await mountPinMenu(tester, platform: platform);
        final baseline = tester.getRect(find.byKey(row));
        final gesture = await tester.startGesture(baseline.center);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(tester.getRect(find.byKey(row)), baseline);
        await gesture.cancel();
        await tester.pumpAndSettle();
        await finishDraft(tester, f.desktop);
      },
      variant: TargetPlatformVariant.only(platform),
    );
  }
}
