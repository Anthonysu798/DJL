import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/settings/data/settings_store.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';

class MemorySettingsStore implements SettingsStore {
  final values = <String, Object>{};
  bool failRead = false, failWrite = false;
  @override
  Future<Map<String, Object>> read() async {
    if (failRead) throw StateError('unavailable');
    return Map.of(values);
  }

  @override
  Future<void> write(String key, Object? value) async {
    if (failWrite) throw StateError('full');
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'Cloud alert and spoken-reply preferences persist with source defaults',
    () async {
      final store = MemorySettingsStore();
      final settings = SettingsController(store);
      await settings.load();
      expect(settings.inAppAlerts, true);
      expect(settings.spokenReplies, false);
      expect(await settings.setInAppAlerts(false), true);
      expect(await settings.setSpokenReplies(true), true);
      expect(store.values['djl.notifications.inApp'], false);
      expect(store.values['djl.voice.spokenReplies'], true);
      final restored = SettingsController(store);
      await restored.load();
      expect(restored.inAppAlerts, false);
      expect(restored.spokenReplies, true);
      store.failWrite = true;
      expect(await restored.setSpokenReplies(false), false);
      expect(restored.spokenReplies, true);
      expect(store.values['djl.voice.spokenReplies'], true);
      store.failWrite = false;
      expect(await restored.setSpokenReplies(false), true);
      expect(restored.spokenReplies, false);
      expect(store.values['djl.voice.spokenReplies'], false);
    },
  );
  test(
    'shared preferences adapter persists logical source keys across recreation',
    () async {
      SharedPreferences.setMockInitialValues({'djl.appearance.mode': 'dark'});
      final first = SettingsController(SharedSettingsStore());
      await first.load();
      expect(first.theme, ThemeMode.dark);
      await first.setFont(AppFontStyle.jetBrainsMono);
      await first.setLockEnabled(false);
      final second = SettingsController(SharedSettingsStore());
      await second.load();
      expect(second.theme, ThemeMode.dark);
      expect(second.font, AppFontStyle.jetBrainsMono);
      expect(second.lockEnabled, false);
    },
  );
  test(
    'source defaults and valid selections survive controller recreation',
    () async {
      final store = MemorySettingsStore();
      final settings = SettingsController(store);
      expect(settings.ready, false);
      await settings.load();
      expect(settings.theme, ThemeMode.system);
      expect(settings.font, AppFontStyle.system);
      expect(settings.lockEnabled, true);
      await settings.setTheme(ThemeMode.dark);
      await settings.setFont(AppFontStyle.geistMono);
      await settings.setLockEnabled(false);
      final restored = SettingsController(store);
      await restored.load();
      expect(restored.theme, ThemeMode.dark);
      expect(restored.font, AppFontStyle.geistMono);
      expect(restored.lockEnabled, false);
      expect(store.values, {
        'djl.appearance.mode': 'dark',
        'codex.appFontStyle': 'geistMono',
        'djl.security.biometricLockEnabled': false,
      });
    },
  );
  test(
    'corrupt values fall back without overwriting original values',
    () async {
      final store = MemorySettingsStore()
        ..values.addAll({
          'djl.appearance.mode': 4,
          'codex.appFontStyle': 'invalid',
          'codex.userBubbleColor': 'invalid',
          'djl.security.biometricLockEnabled': 'false',
        });
      final original = Map.of(store.values),
          settings = SettingsController(store);
      await settings.load();
      expect(settings.theme, ThemeMode.system);
      expect(settings.font, AppFontStyle.system);
      expect(settings.lockEnabled, true);
      expect(store.values, original);
      store.values['codex.useJetBrainsMono'] = false;
      await settings.load();
      expect(settings.font, AppFontStyle.jetBrainsMono);
      store.values['codex.appFontStyle'] = 'geist';
      await settings.load();
      expect(settings.font, AppFontStyle.geist);
    },
  );
  test(
    'read failures remain unready and cannot overwrite saved preferences',
    () async {
      final store = MemorySettingsStore()
        ..values['djl.appearance.mode'] = 'dark'
        ..failRead = true;
      final settings = SettingsController(store);
      await settings.load();
      expect(settings.ready, false);
      expect(settings.error, isNotNull);
      expect(await settings.setTheme(ThemeMode.light), false);
      expect(store.values['djl.appearance.mode'], 'dark');
      store.failRead = false;
      await settings.load();
      expect(settings.ready, true);
      expect(settings.theme, ThemeMode.dark);
    },
  );
  test(
    'write failure preserves in-memory and saved choice with retry',
    () async {
      final store = MemorySettingsStore(), settings = SettingsController(store);
      await settings.load();
      store.failWrite = true;
      expect(await settings.setFont(AppFontStyle.geist), false);
      expect(settings.font, AppFontStyle.system);
      expect(store.values, isEmpty);
      expect(settings.error, isNotNull);
      store.failWrite = false;
      expect(await settings.setFont(AppFontStyle.geist), true);
      expect(settings.font, AppFontStyle.geist);
      expect(settings.error, isNull);
    },
  );
}
