import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controls.dart';
import 'settings_controller_test.dart' show MemorySettingsStore;

Future<SettingsController> showControls(
  WidgetTester tester,
  MemorySettingsStore store, {
  bool supported = true,
}) async {
  const channel = MethodChannel('djl.mobile/app-info');
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
    call,
  ) async {
    if (call.method == 'supportsLiquidGlass') return supported;
    return null;
  });
  addTearDown(
    () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      channel,
      null,
    ),
  );
  final settings = SettingsController(store);
  await settings.load();
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    settings.dispose();
  });
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(Brightness.light),
      home: Scaffold(
        body: SingleChildScrollView(
          child: SettingsControls(controller: settings),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return settings;
}

final glassRow = find.widgetWithText(SwitchListTile, 'Liquid Glass');

void main() {
  testWidgets(
    'Supported appearance defaults Liquid Glass on and saves only the source preference',
    (tester) async {
      final store = MemorySettingsStore();
      await showControls(tester, store);
      expect(glassRow, findsOneWidget);
      expect(tester.widget<SwitchListTile>(glassRow).value, isTrue);
      await tester.tap(glassRow);
      await tester.pumpAndSettle();
      expect(tester.widget<SwitchListTile>(glassRow).value, isFalse);
      expect(store.values, {'codex.useLiquidGlass': false});
      expect(tester.takeException(), isNull);
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );

  testWidgets(
    'Stored glass choice survives a new controller and settings page',
    (tester) async {
      final store = MemorySettingsStore()
        ..values['codex.useLiquidGlass'] = false;
      await showControls(tester, store);
      expect(glassRow, findsOneWidget);
      expect(tester.widget<SwitchListTile>(glassRow).value, isFalse);
      await tester.tap(glassRow);
      await tester.pumpAndSettle();
      expect(store.values['codex.useLiquidGlass'], isTrue);
      await tester.pumpWidget(const SizedBox.shrink());
      await showControls(tester, store);
      expect(tester.widget<SwitchListTile>(glassRow).value, isTrue);
      expect(tester.takeException(), isNull);
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );

  testWidgets(
    'Failed glass save preserves the current choice and supports a later retry',
    (tester) async {
      final store = MemorySettingsStore()..failWrite = true;
      await showControls(tester, store);
      expect(glassRow, findsOneWidget);
      await tester.tap(glassRow);
      await tester.pumpAndSettle();
      expect(tester.widget<SwitchListTile>(glassRow).value, isTrue);
      expect(store.values, isEmpty);
      store.failWrite = false;
      await tester.tap(glassRow);
      await tester.pumpAndSettle();
      expect(store.values, {'codex.useLiquidGlass': false});
      expect(tester.widget<SwitchListTile>(glassRow).value, isFalse);
      expect(tester.takeException(), isNull);
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );

  testWidgets(
    'Unsupported native material leaves the saved preference intact and hides its toggle',
    (tester) async {
      final store = MemorySettingsStore()
        ..values['codex.useLiquidGlass'] = true;
      await showControls(tester, store, supported: false);
      expect(glassRow, findsNothing);
      expect(store.values, {'codex.useLiquidGlass': true});
      expect(tester.takeException(), isNull);
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );
}
