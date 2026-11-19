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
          title: Text('Remote notifications'),
          subtitle: Text(
            'Remote notifications aren’t available on this device yet. You can still use the Cloud inbox and local task status.',
          ),
        );
      }
      final availability = switch (state.availability) {
        'ready' =>
          'Permission: ${state.permission}. Receive an alert when a task finishes.',
        'simulator' =>
          'APNs token registration is unsupported on Simulator. Notification taps remain supported.',
        'disabled' => 'Remote push is disabled in this build.',
        'unconfigured' =>
          'Remote notifications aren’t available in this build.',
        'failed' => 'Notification registration failed. Retry when connected.',
        _ =>
          'Remote notifications are unavailable. Cloud inbox and local task status remain available.',
      };
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SwitchListTile(
            title: const Text('Remote notifications'),
            subtitle: Text(
              '$availability\nEnable enrolls the current signed-in DJL Cloud account and connected trusted Mac, plus future eligible current sessions on this device. Turning off stops local sync; it cannot revoke Cloud registrations on the server.',
            ),
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
          ListTile(
            title: const Text('DJL Cloud push'),
            subtitle: Text(controller.cloudStatus),
            trailing: TextButton(
              onPressed: controller.enabled && !controller.busy
                  ? () {
                      onCloudEntry?.call();
                      controller.retryCloud();
                    }
                  : null,
              child: const Text("Retry Cloud"),
            ),
          ),
          ListTile(
            title: const Text('Current Mac push'),
            subtitle: Text(controller.pairedStatus),
            trailing: TextButton(
              onPressed: controller.enabled && !controller.busy
                  ? controller.retryPaired
                  : null,
              child: const Text("Retry Mac"),
            ),
          ),
          if (controller.error != null)
            ListTile(title: Text(controller.error!)),
          TextButton(
            onPressed: controller.busy
                ? null
                : () {
                    onCloudEntry?.call();
                    controller.retry();
                  },
            child: const Text('Retry remote notifications'),
          ),
        ],
      );
    },
  );
}
