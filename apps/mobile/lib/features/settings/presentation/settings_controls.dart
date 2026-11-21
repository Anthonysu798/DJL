import 'dart:async';
import 'package:flutter/material.dart';
import '../../../core/presentation/djl_glass.dart';
import '../domain/appearance.dart';
import 'settings_controller.dart';
import 'settings_group.dart';
import '../../../l10n/l10n.dart';

class SettingsControls extends StatefulWidget {
  const SettingsControls({
    super.key,
    required this.controller,
    this.taskStatus,
    this.cloudPreferences = false,
  });
  final SettingsController controller;
  final Widget? taskStatus;
  final bool cloudPreferences;
  @override
  State<SettingsControls> createState() => _SettingsControlsState();
}

class _SettingsControlsState extends State<SettingsControls> {
  SettingsController get controller => widget.controller;
  bool _glassSupported = false;

  @override
  void initState() {
    super.initState();
    unawaited(_loadGlassSupport());
  }

  Future<void> _loadGlassSupport() async {
    final supported = await supportsLiquidGlass();
    if (mounted) setState(() => _glassSupported = supported);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final enabled = controller.ready && !controller.saving;
      final scheme = Theme.of(context).colorScheme;
      final l10n = context.l10n;
      String themeTitle(ThemeMode value) => switch (value) {
        ThemeMode.system => l10n.settingsThemeSystem,
        ThemeMode.light => l10n.settingsThemeLight,
        ThemeMode.dark => l10n.settingsThemeDark,
      };
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SettingsGroup(
              title: l10n.settingsAppearance,
              children: [
                SettingsMenuRow<AppFontStyle>(
                  key: const Key('font-setting'),
                  label: l10n.settingsFont,
                  valueLabel: controller.font.label(l10n),
                  value: controller.font,
                  options: {
                    for (final value in AppFontStyle.values)
                      value: value.label(l10n),
                  },
                  onChanged: enabled ? controller.setFont : null,
                ),
                if (_glassSupported)
                  SwitchListTile.adaptive(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                    title: Text(
                      l10n.settingsLiquidGlass,
                      style: const TextStyle(fontSize: 15),
                    ),
                    activeTrackColor: scheme.primary,
                    activeThumbColor: scheme.onPrimary,
                    value: controller.liquidGlass,
                    onChanged: enabled ? controller.setLiquidGlass : null,
                  ),
                SettingsMenuRow<ThemeMode>(
                  key: const Key('theme-setting'),
                  label: l10n.settingsTheme,
                  valueLabel: themeTitle(controller.theme),
                  value: controller.theme,
                  options: {
                    for (final value in ThemeMode.values)
                      value: themeTitle(value),
                  },
                  onChanged: enabled ? controller.setTheme : null,
                ),
              ],
            ),
            ?widget.taskStatus,
            if (widget.cloudPreferences) ...[
              SettingsGroup(
                title: l10n.settingsNotifications,
                footer: l10n.settingsInAppAlertsFooter,
                children: [
                  SwitchListTile.adaptive(
                    title: Text(
                      l10n.settingsInAppAlerts,
                      style: const TextStyle(fontSize: 15),
                    ),
                    activeTrackColor: scheme.primary,
                    activeThumbColor: scheme.onPrimary,
                    value: controller.inAppAlerts,
                    onChanged: enabled ? controller.setInAppAlerts : null,
                  ),
                ],
              ),
              SettingsGroup(
                title: l10n.settingsVoice,
                footer: l10n.settingsVoiceFooter,
                children: [
                  SwitchListTile.adaptive(
                    title: Text(
                      l10n.settingsSpeakReplies,
                      style: const TextStyle(fontSize: 15),
                    ),
                    activeTrackColor: scheme.primary,
                    activeThumbColor: scheme.onPrimary,
                    value: controller.spokenReplies,
                    onChanged: enabled ? controller.setSpokenReplies : null,
                  ),
                ],
              ),
            ],
            if (controller.error != null)
              Padding(
                padding: const EdgeInsets.symmetric(
                  vertical: 8,
                  horizontal: 16,
                ),
                child: Semantics(
                  liveRegion: true,
                  child: Text(
                    controller.error!,
                    style: TextStyle(color: scheme.error),
                  ),
                ),
              ),
            if (!controller.ready && controller.error != null)
              TextButton(
                onPressed: controller.saving ? null : controller.load,
                child: Text(l10n.settingsRetryReading),
              ),
            if (controller.saving) const LinearProgressIndicator(),
          ],
        ),
      );
    },
  );
}
