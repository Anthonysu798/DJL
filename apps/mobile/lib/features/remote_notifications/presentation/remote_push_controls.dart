import 'package:flutter/material.dart';
import 'remote_push_controller.dart';
import '../../../l10n/l10n.dart';

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
      final state = controller.state;
      if (controller.loaded &&
          (state.availability == 'unsupported' ||
              state.provider == 'fcm' &&
                  {'unconfigured', 'disabled'}.contains(state.availability)) &&
          !controller.enabled &&
          controller.error == null) {
        return ListTile(
          title: Text(context.l10n.pushTitle),
          subtitle: Text(context.l10n.pushUnsupported),
        );
      }
      final l10n = context.l10n;
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
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SwitchListTile(
            title: Text(l10n.pushTitle),
            subtitle: Text(availability),
            value: controller.enabled,
            onChanged:
                !controller.loaded ||
                    controller.busy ||
                    !state.available && !controller.enabled
                ? null
                : (enabled) {
                    if (enabled) onCloudEntry?.call();
                    controller.setEnabled(enabled);
                  },
          ),
          if (controller.error != null)
            ListTile(title: Text(controller.error!)),
          if (controller.error != null || failed)
            TextButton(
              onPressed: controller.busy
                  ? null
                  : () {
                      onCloudEntry?.call();
                      controller.retry();
                    },
              child: Text(l10n.commonTryAgain),
            ),
        ],
      );
    },
  );
}
