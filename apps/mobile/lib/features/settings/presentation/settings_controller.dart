import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import '../data/settings_store.dart';
import '../domain/appearance.dart';
import '../domain/runtime_defaults.dart';
import '../../desktop/domain/desktop_contract.dart';
import '../../pairing/data/pairing_repository.dart';
import '../../../l10n/l10n.dart';

class SettingsController extends ChangeNotifier {
  SettingsController(this.store);
  final SettingsStore store;
  static const themeKey = 'djl.appearance.mode',
      fontKey = 'codex.appFontStyle',
      glassKey = 'codex.useLiquidGlass',
      lockKey = 'djl.security.biometricLockEnabled',
      inAppAlertsKey = 'djl.notifications.inApp',
      spokenRepliesKey = 'djl.voice.spokenReplies';
  ThemeMode theme = ThemeMode.system;
  AppFontStyle font = AppFontStyle.system;
  bool lockEnabled = true, ready = false, saving = false, _disposed = false;
  bool inAppAlerts = true, spokenReplies = false;
  bool liquidGlass = true;
  String? error;
  RuntimeDefaults _runtimeDefaults = const RuntimeDefaults();
  RuntimeDefaults? _runtimeRetry;
  List<RemoteJson> runtimeCatalog = [];
  RuntimeDefaults get runtimeDefaults => _runtimeDefaults;
  DesktopRuntime get resolvedRuntime =>
      _runtimeDefaults.resolve(runtimeCatalog);
  RemoteJson? get gitWriterModel =>
      _runtimeDefaults.resolveGitWriter(runtimeCatalog);
  bool get canRetryRuntimeSave => _runtimeRetry != null;

  Future<bool> setRuntimeCatalog(List<RemoteJson> models) async {
    if (_disposed) return false;
    runtimeCatalog = [for (final model in models) Map.of(model)];
    notifyListeners();
    if (!ready || saving || models.isEmpty) return false;
    final normalized = _runtimeDefaults.normalize(runtimeCatalog);
    if (mapEquals(normalized.preferences, _runtimeDefaults.preferences)) {
      return true;
    }
    return _saveRuntime(normalized);
  }

  Future<bool> _saveRuntime(RuntimeDefaults candidate) async {
    if (!ready || saving || _disposed) return false;
    saving = true;
    error = null;
    notifyListeners();
    var requested = candidate.normalize(runtimeCatalog);
    try {
      // SharedPreferences has no multi-key transaction. Reload after any partial failure.
      while (true) {
        for (final entry in requested.preferences.entries) {
          await store.write(entry.key, entry.value);
        }
        if (_disposed) return false;
        final normalized = requested.normalize(runtimeCatalog);
        if (mapEquals(normalized.preferences, requested.preferences)) break;
        requested = normalized;
      }
      _runtimeDefaults = requested;
      _runtimeRetry = null;
      return true;
    } catch (_) {
      if (_disposed) return false;
      _runtimeRetry = requested;
      await load();
      if (!_disposed) {
        error = ready
            ? appStrings.settingsErrorPartialSave
            : appStrings.settingsErrorPartialReload;
      }
      return false;
    } finally {
      if (!_disposed) {
        saving = false;
        notifyListeners();
      }
    }
  }

  Future<bool> retryRuntimeSave() async =>
      _runtimeRetry == null ? true : _saveRuntime(_runtimeRetry!);
  Future<bool> setRuntimeModel(String? value) => _saveRuntime(
    RuntimeDefaults(
      modelId: value?.trim().isNotEmpty == true ? value!.trim() : 'gpt-5.5',
      effort: value?.trim().isNotEmpty == true
          ? _runtimeDefaults.effort
          : 'medium',
      gitWriterId: _runtimeDefaults.gitWriterId,
      access: _runtimeDefaults.access,
      serviceTier: _runtimeDefaults.serviceTier,
    ),
  );
  Future<bool> setRuntimeEffort(String? value) => _saveRuntime(
    RuntimeDefaults(
      modelId: _runtimeDefaults.modelId,
      effort: value?.trim(),
      gitWriterId: _runtimeDefaults.gitWriterId,
      access: _runtimeDefaults.access,
      serviceTier: _runtimeDefaults.serviceTier,
    ),
  );
  Future<bool> setRuntimeTier(String value) => _saveRuntime(
    RuntimeDefaults(
      modelId: _runtimeDefaults.modelId,
      effort: _runtimeDefaults.effort,
      gitWriterId: _runtimeDefaults.gitWriterId,
      access: _runtimeDefaults.access,
      serviceTier: value == 'fast' ? 'fast' : 'default',
    ),
  );
  Future<bool> setRuntimeAccess(String value) => _saveRuntime(
    RuntimeDefaults(
      modelId: _runtimeDefaults.modelId,
      effort: _runtimeDefaults.effort,
      gitWriterId: _runtimeDefaults.gitWriterId,
      access: runtimeAccessModes.contains(value) ? value : 'on-request',
      serviceTier: _runtimeDefaults.serviceTier,
    ),
  );
  Future<bool> setGitWriterModel(String? value) => _saveRuntime(
    RuntimeDefaults(
      modelId: _runtimeDefaults.modelId,
      effort: _runtimeDefaults.effort,
      gitWriterId: value?.trim(),
      access: _runtimeDefaults.access,
      serviceTier: _runtimeDefaults.serviceTier,
    ),
  );
  Future<void> load() async {
    try {
      final values = await store.read();
      if (_disposed) return;
      theme =
          ThemeMode.values
              .where((v) => v.name == values[themeKey])
              .firstOrNull ??
          ThemeMode.system;
      font =
          AppFontStyle.values
              .where((v) => v.name == values[fontKey])
              .firstOrNull ??
          (values.containsKey('codex.useJetBrainsMono')
              ? AppFontStyle.jetBrainsMono
              : AppFontStyle.system);
      liquidGlass = values[glassKey] is bool ? values[glassKey] as bool : true;
      _runtimeDefaults = RuntimeDefaults.fromPreferences(values);
      lockEnabled = values[lockKey] is bool ? values[lockKey] as bool : true;
      inAppAlerts = values[inAppAlertsKey] is bool
          ? values[inAppAlertsKey] as bool
          : true;
      spokenReplies = values[spokenRepliesKey] is bool
          ? values[spokenRepliesKey] as bool
          : false;
      ready = true;
      error = null;
    } catch (_) {
      if (_disposed) return;
      ready = false;
      error = appStrings.settingsErrorRead;
    }
    notifyListeners();
  }

  Future<bool> _save(String key, Object value, VoidCallback apply) async {
    if (!ready || saving || _disposed) return false;
    saving = true;
    error = null;
    notifyListeners();
    var success = false;
    try {
      await store.write(key, value);
      if (!_disposed) {
        apply();
        success = true;
      }
    } catch (_) {
      if (!_disposed) {
        error = appStrings.settingsErrorSave;
      }
    } finally {
      if (!_disposed) {
        saving = false;
        notifyListeners();
      }
    }
    if (success && runtimeCatalog.isNotEmpty) {
      await setRuntimeCatalog(runtimeCatalog);
    }
    return success;
  }

  Future<bool> setTheme(ThemeMode value) =>
      _save(themeKey, value.name, () => theme = value);
  Future<bool> setFont(AppFontStyle value) =>
      _save(fontKey, value.name, () => font = value);
  Future<bool> setLiquidGlass(bool value) =>
      _save(glassKey, value, () => liquidGlass = value);
  Future<bool> setLockEnabled(bool value) =>
      _save(lockKey, value, () => lockEnabled = value);
  Future<bool> setInAppAlerts(bool value) =>
      _save(inAppAlertsKey, value, () => inAppAlerts = value);
  Future<bool> setSpokenReplies(bool value) =>
      _save(spokenRepliesKey, value, () => spokenReplies = value);
  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
