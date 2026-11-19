import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'pairing_presentation_test.dart' show more, ObservedPairingTransport;
import 'trusted_device_preferences_widget_test.dart' show fixture;

void main() {
  for (final brightness in Brightness.values) {
    testWidgets(
      'iOS removal review uses native glass and cancellation preserves trust in $brightness',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        final messenger = tester.binding.defaultBinaryMessenger;
        const info = MethodChannel('djl.mobile/app-info');
        const views = MethodChannel('flutter/platform_views');
        messenger.setMockMethodCallHandler(info, (_) async => true);
        messenger.setMockMethodCallHandler(views, (_) async => null);
        final f = await fixture();
        try {
          await tester.pumpWidget(
            MaterialApp(
              theme: djlTheme(brightness),
              home: PairingPage(controller: f.desktop),
            ),
          );
          await more(tester, 'Connections');
          final before = Map<String, String>.from(f.store.values);
          final active = f.desktop.active;
          await tester.drag(
            find.byKey(const ValueKey('device_row_other')),
            const Offset(-220, 0),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.byTooltip('Forget desktop'));
          await tester.pumpAndSettle();
          expect(find.byType(UiKitView), findsOneWidget);
          final material = tester.widget<Material>(
            find.byKey(const Key('forget_device_review')),
          );
          expect(material.color, Colors.transparent);
          expect(
            (material.shape as RoundedRectangleBorder).side,
            BorderSide.none,
          );
          await tester.tapAt(const Offset(8, 8));
          await tester.pumpAndSettle();
          expect(find.text('Forget this device?'), findsOneWidget);
          expect(f.store.values, before);
          await tester.tap(find.text('Cancel'));
          await tester.pumpAndSettle();
          expect(find.text('Forget this device?'), findsNothing);
          expect(find.byType(UiKitView), findsNothing);
          expect(f.store.values, before);
          expect(f.desktop.active, active);
          expect(f.desktop.trusted, hasLength(2));
          expect((f.desktop.transport as ObservedPairingTransport).attempts, 0);
          expect(tester.takeException(), isNull);
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          f.desktop.dispose();
          f.settings.dispose();
          messenger.setMockMethodCallHandler(info, null);
          messenger.setMockMethodCallHandler(views, null);
        }
      },
      variant: TargetPlatformVariant.only(TargetPlatform.iOS),
    );
  }

  testWidgets(
    'iOS device menu exposes native material and cancels without changing trust',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final messenger = tester.binding.defaultBinaryMessenger;
      const info = MethodChannel('djl.mobile/app-info');
      const views = MethodChannel('flutter/platform_views');
      messenger.setMockMethodCallHandler(info, (_) async => true);
      messenger.setMockMethodCallHandler(views, (_) async => null);
      final f = await fixture();
      try {
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(Brightness.light),
            home: PairingPage(controller: f.desktop),
          ),
        );
        await more(tester, 'Connections');
        final writes = f.store.writes;
        final active = f.desktop.active;
        await tester.tap(find.byKey(const Key('device_menu')));
        await tester.pumpAndSettle();
        expect(find.byType(UiKitView), findsOneWidget);
        final material = tester.widget<Material>(
          find.byKey(const Key('device_switch_menu')),
        );
        expect(material.color, Colors.transparent);
        expect(
          (material.shape as RoundedRectangleBorder).side,
          BorderSide.none,
        );
        expect(find.text('Switch to'), findsOneWidget);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.text('Connections'), findsOneWidget);
        expect(find.text('Switch to'), findsNothing);
        expect(find.byType(UiKitView), findsNothing);
        expect(f.desktop.active, active);
        expect(f.store.writes, writes);
        expect((f.desktop.transport as ObservedPairingTransport).attempts, 0);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        f.desktop.dispose();
        f.settings.dispose();
        messenger.setMockMethodCallHandler(info, null);
        messenger.setMockMethodCallHandler(views, null);
      }
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );
}
