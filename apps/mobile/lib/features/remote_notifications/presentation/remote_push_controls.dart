import 'package:flutter/material.dart';
import 'remote_push_controller.dart';
import '../../../core/design/djl_icons.dart';
import '../../../core/presentation/djl_frosted.dart';
import '../../../l10n/l10n.dart';
import '../../settings/presentation/settings_group.dart';

class RemotePushControls extends StatelessWidget {
  const RemotePushControls({
    super.key,
    required this.controller,
    this.onCloudEntry,
  });
  final RemotePushController controller;
  final VoidCallback? onCloudEntry;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final l10n = context.l10n;
      final state = controller.state;
      if (controller.loaded &&
          (state.availability == 'unsupported' ||
              state.provider == 'fcm' &&
                  {'unconfigured', 'disabled'}.contains(state.availability)) &&
          !controller.enabled &&
          controller.error == null) {
        return SettingsPermissionRow(
          icon: DjlIcons.bell,
          title: l10n.pushTitle,
          subtitle: l10n.pushUnsupported,
        );
      }
      final availability = switch (state.availability) {
        'ready' when state.permission == 'denied' => l10n.pushDenied,
        'ready' => l10n.pushReady,
        'simulator' => l10n.pushSimulator,
        'disabled' || 'unconfigured' => l10n.pushUnavailableVersion,
        'failed' => l10n.pushFailed,
        _ => l10n.pushUnavailableNow,
      };
      final failed =
          controller.enabled &&
          (state.availability == 'failed' ||
              controller.cloudStatus.endsWith('Retry.') ||
              controller.pairedStatus.endsWith('Retry.'));
      final ValueChanged<bool>? onChanged =
          !controller.loaded ||
              controller.busy ||
              !state.available && !controller.enabled
          ? null
          : (enabled) {
              if (enabled) onCloudEntry?.call();
              controller.setEnabled(enabled);
            };
      final scheme = Theme.of(context).colorScheme;
      return SettingsPermissionRow(
        icon: DjlIcons.bell,
        title: l10n.pushTitle,
        subtitle: controller.error ?? availability,
        subtitleIsError: controller.error != null,
        onTap: onChanged == null ? null : () => onChanged(!controller.enabled),
        trailing: Switch.adaptive(
          activeTrackColor: scheme.primary,
          activeThumbColor: scheme.onPrimary,
          value: controller.enabled,
          onChanged: onChanged,
        ),
        actions: [
          if (controller.error != null || failed)
            DjlGlassPillButton(
              label: l10n.commonTryAgain,
              compact: true,
              onPressed: controller.busy
                  ? null
                  : () {
                      onCloudEntry?.call();
                      controller.retry();
                    },
            ),
        ],
      );
    },
  );
}
