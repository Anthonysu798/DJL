import 'package:flutter/material.dart';
import 'remote_push_controller.dart';

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
        return const ListTile(
          title: Text('Push notifications'),
          subtitle: Text(
            "This phone can't get push notifications from DJL yet. Open DJL to see when an agent is done.",
          ),
        );
      }
      final availability = switch (state.availability) {
        'ready' when state.permission == 'denied' =>
          "Notifications are off for DJL in your phone's Settings.",
        'ready' =>
          'Get a notification when an agent finishes or needs your answer.',
        'simulator' => "This simulator can't receive push notifications.",
        'disabled' || 'unconfigured' =>
          "Push notifications aren't available in this version.",
        'failed' =>
          "Couldn't turn on notifications. Try again when you're online.",
        _ => "Push notifications aren't available right now.",
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
            title: const Text('Push notifications'),
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
              child: const Text('Try again'),
            ),
        ],
      );
    },
  );
}
