import 'dart:io';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:http/http.dart' as http;
import 'package:djl_mobile/main.dart' as application;
import 'package:djl_mobile/features/settings/data/settings_store.dart';
import 'support/native_acceptance.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controls.dart';
import 'package:djl_mobile/features/settings/presentation/privacy_shield.dart';
import 'cloud_test.dart' show waitFor, nativeSettings;
import 'threads_test.dart' show reveal;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  const restore = bool.fromEnvironment('DJL_QA_SETTINGS_RESTORE_ONLY');
  Future<void> host(WidgetTester tester, String field) async {
    var ready = false;
    final deadline = DateTime.now().add(const Duration(seconds: 45));
    while (!ready && DateTime.now().isBefore(deadline)) {
      final status =
          jsonDecode((await http.get(Uri.parse('http://127.0.0.1:8855/'))).body)
              as Map;
      ready = status[field] == true;
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(
      ready,
      isTrue,
      reason: 'The host must attach and capture the actual native frame.',
    );
  }

  testWidgets(
    restore
        ? 'native cold-process appearance restore'
        : 'native appearance controls and persistence',
    (tester) async {
      application.main();
      await tester.pump();
      if (Platform.isAndroid) await binding.convertFlutterSurfaceToImage();
      await host(tester, 'driverConnected');
      await waitFor(tester, () {
        final shields = find.byType(PrivacyShield).evaluate();
        return shields.isNotEmpty &&
            !(shields.single.widget as PrivacyShield).controller.shielded;
      });
      await nativeSettings(tester);
      final controls = tester.widget<SettingsControls>(
        find.byType(SettingsControls),
      );
      final settings = controls.controller;
      expect(settings.ready, isTrue);
      expect(settings.error, isNull);
      Future<void> saved(bool Function() selected) async {
        await waitFor(tester, () => !settings.saving);
        expect(settings.ready, isTrue);
        expect(settings.error, isNull);
        expect(selected(), isTrue);
      }

      if (restore) {
        expect(settings.theme, ThemeMode.dark);
        expect(settings.font, AppFontStyle.geistMono);
        expect(find.text('App lock'), findsNothing);
      } else {
        // Establish opposite persisted values before exercising real controls.
        // Write only these two appearance keys, never runtime defaults.
        await establishNativeSettingsBaseline(SharedSettingsStore());
        await settings.load();
        expect(settings.ready, isTrue);
        expect(settings.error, isNull);
        expect(settings.theme, ThemeMode.light);
        expect(settings.font, AppFontStyle.system);
        expect(find.text('App lock'), findsNothing);
        await reveal(tester, find.byKey(const Key('theme-setting')));
        await tester.tap(find.byKey(const Key('theme-setting')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Dark').last);
        await saved(() => settings.theme == ThemeMode.dark);
        await tester.tap(find.byKey(const Key('font-setting')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Geist Mono').last);
        await saved(() => settings.font == AppFontStyle.geistMono);
        expect(find.text('App lock'), findsNothing);
      }
      expect(settings.ready, isTrue);
      expect(settings.error, isNull);
      await verifyNativeSettings(SharedSettingsStore(), nativeSettingsTarget);
      expect(
        Theme.of(tester.element(find.byType(SettingsControls))).brightness,
        Brightness.dark,
      );
      expect(
        DjlAppearance.of(tester.element(find.byType(SettingsControls))).font,
        AppFontStyle.geistMono,
      );
      await reveal(tester, find.byKey(const Key('font-setting')));
      await binding.takeScreenshot(
        restore ? 'settings-cold-restored' : 'settings-appearance',
      );
      debugPrint(
        restore
            ? 'DJL_SETTINGS_RESTORE_FRAME_READY'
            : 'DJL_SETTINGS_FRAME_READY',
      );
      await host(tester, 'captured');
      expect(tester.takeException(), isNull);
      debugPrint(
        restore ? 'DJL_SETTINGS_RESTORE_FINISHED' : 'DJL_SETTINGS_FINISHED',
      );
    },
    timeout: const Timeout(Duration(minutes: 3)),
  );
}
