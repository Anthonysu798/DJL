import 'dart:async';
import 'package:flutter/material.dart';
import '../../../core/presentation/djl_glass.dart';
import '../domain/appearance.dart';
import 'settings_controller.dart';
import 'settings_group.dart';

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
      Widget swatch(UserBubbleColor value) => Container(
        width: 14,
        height: 14,
        decoration: BoxDecoration(
          color: value.swatch(scheme),
          shape: BoxShape.circle,
        ),
      );
      String themeTitle(ThemeMode value) => switch (value) {
        ThemeMode.system => 'System',
        ThemeMode.light => 'Light',
        ThemeMode.dark => 'Dark',
      };
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SettingsGroup(
              title: 'Appearance',
              children: [
                SettingsMenuRow<AppFontStyle>(
                  key: const Key('font-setting'),
                  label: 'Font',
                  nativePickerStyle: true,
                  valueLabel: controller.font.title,
                  value: controller.font,
                  options: {
                    for (final value in AppFontStyle.values) value: value.title,
                  },
                  onChanged: enabled ? controller.setFont : null,
                ),
                SettingsMenuRow<UserBubbleColor>(
                  key: const Key('bubble-setting'),
                  label: 'Message Bubble',
                  valueLabel: controller.bubble.title,
                  value: controller.bubble,
                  valueIcon: swatch(controller.bubble),
                  options: {
                    for (final value in UserBubbleColor.values)
                      value: value.title,
                  },
                  optionIcon: (value) => Container(
                    width: 20,
                    height: 20,
                    padding: const EdgeInsets.all(2),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: value == controller.bubble
                          ? Border.all(color: scheme.onSurface)
                          : null,
                    ),
                    child: swatch(value),
                  ),
                  optionKey: (value) => Key('bubble-${value.storedValue}'),
                  optionLabel: (value) => '${value.title} bubble color',
                  onChanged: enabled ? controller.setBubble : null,
                ),
                if (_glassSupported)
                  SwitchListTile.adaptive(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                    title: const Text(
                      'Liquid Glass',
                      style: TextStyle(fontSize: 15),
                    ),
                    activeTrackColor: scheme.primary,
                    activeThumbColor: scheme.onPrimary,
                    value: controller.liquidGlass,
                    onChanged: enabled ? controller.setLiquidGlass : null,
                  ),
                SettingsMenuRow<ThemeMode>(
                  key: const Key('theme-setting'),
                  label: 'Theme',
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
                title: 'Notifications',
                footer:
                    'Show a banner when another conversation’s task finishes.',
                children: [
                  SwitchListTile.adaptive(
                    title: const Text(
                      'In-app alerts',
                      style: TextStyle(fontSize: 15),
                    ),
                    activeTrackColor: scheme.primary,
                    activeThumbColor: scheme.onPrimary,
                    value: controller.inAppAlerts,
                    onChanged: enabled ? controller.setInAppAlerts : null,
                  ),
                ],
              ),
              SettingsGroup(
                title: 'Voice',
                footer:
                    'Review dictation before sending. Replies use your device’s voice.',
                children: [
                  SwitchListTile.adaptive(
                    title: const Text(
                      'Speak new replies',
                      style: TextStyle(fontSize: 15),
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
                child: const Text('Retry reading settings'),
              ),
            if (controller.saving) const LinearProgressIndicator(),
          ],
        ),
      );
    },
  );
}
