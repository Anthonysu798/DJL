part of 'desktop_controller.dart';

/// Per-Mac names and menu visibility saved on the phone.
extension DesktopDevicePreferences on DesktopController {
  TrustedDeviceEntry? devicePreferences(Pairing pair) =>
      _devicePreferences.where((entry) => entry.matches(pair)).firstOrNull;

  String deviceName(Pairing pair) {
    final nickname = devicePreferences(pair)?.nickname.trim() ?? '';
    final system = pair.displayName.trim();
    return nickname.isNotEmpty
        ? nickname
        : system.isNotEmpty
        ? system
        : appStrings.desktopDeviceFallbackName;
  }

  String? get selectedDeviceName => active == null ? null : deviceName(active!);

  List<Pairing> get managedDevices => [
    ...trusted.where(isActiveDevice),
    ...trusted.where((pair) => !isActiveDevice(pair)),
  ];

  List<Pairing> get menuDevices => devicePreferencesReady
      ? managedDevices
            .where(
              (pair) =>
                  isActiveDevice(pair) ||
                  devicePreferences(pair)?.visibleInMenu == true,
            )
            .toList()
      : [];

  Future<bool> setDeviceNickname(TrustedDeviceEntry target, String nickname) =>
      _saveDevicePreferences(target, nickname: nickname);

  Future<bool> setDeviceMenuVisibility(
    TrustedDeviceEntry target,
    bool visible,
  ) {
    if (isActiveDevice(target.pairing)) return Future.value(false);
    return _saveDevicePreferences(target, visibleInMenu: visible);
  }

  Future<bool> _saveDevicePreferences(
    TrustedDeviceEntry target, {
    String? nickname,
    bool? visibleInMenu,
  }) async {
    if (_disposed ||
        !devicePreferencesReady ||
        devicePreferencesLoading ||
        devicePreferencesSaving) {
      return false;
    }
    devicePreferencesSaving = true;
    devicePreferencesError = null;
    ++_devicePreferencesRevision;
    _notify();
    try {
      await pairings.updateDevicePreferences(
        target,
        nickname: nickname,
        visibleInMenu: visibleInMenu,
      );
      final entries = await pairings.trustedEntries();
      if (_disposed) return false;
      _devicePreferences = entries;
      final saved = entries
          .where(
            (e) => e.matches(target.pairing) && e.trustId == target.trustId,
          )
          .firstOrNull;
      if (saved == null ||
          (nickname != null && saved.nickname != nickname.trim()) ||
          (visibleInMenu != null && saved.visibleInMenu != visibleInMenu)) {
        throw StateError('The saved device changed.');
      }
      return true;
    } catch (_) {
      // A native write can persist before throwing. Never claim success from
      // the attempted write; reread and retain the editor's draft and error.
      try {
        final entries = await pairings.trustedEntries();
        if (_disposed) return false;
        _devicePreferences = entries;
        devicePreferencesReady = true;
      } catch (_) {
        if (_disposed) return false;
        devicePreferencesReady = false;
      }
      if (_disposed) return false;
      devicePreferencesError = devicePreferencesReady
          ? appStrings.desktopDeviceChangeUnconfirmed
          : appStrings.desktopPreferencesReloadFailed;
      return false;
    } finally {
      if (!_disposed) {
        devicePreferencesSaving = false;
        _notify();
      }
    }
  }
}
