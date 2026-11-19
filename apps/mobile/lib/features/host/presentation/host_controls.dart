import 'package:flutter/material.dart';
import 'host_controller.dart';
import 'paired_login_controller.dart';
import 'paired_login_controls.dart';

class HostPage extends StatelessWidget {
  const HostPage({super.key, required this.controller, this.login});
  final HostController controller;
  final PairedLoginController? login;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Paired host')),
    body: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [HostControls(controller: controller, login: login)],
      ),
    ),
  );
}

class HostControls extends StatelessWidget {
  const HostControls({super.key, required this.controller, this.login});
  final HostController controller;
  final PairedLoginController? login;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final host = controller, snapshot = host.snapshot;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            host.connected
                ? (host.stale ? 'Connected · stale status' : 'Connected')
                : 'Offline · last known status',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          if (host.loading ||
              host.actionBusy ||
              host.waking ||
              host.preferenceSyncing)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: LinearProgressIndicator(),
            ),
          if (host.waking)
            const Text(
              'Connecting to the saved verified host before display wake…',
            ),
          const SizedBox(height: 12),
          Text(
            'Paired ChatGPT: ${snapshot?.status.replaceAll('_', ' ') ?? 'Unknown'}',
          ),
          if (snapshot?.email != null) Text(snapshot!.email!),
          if (snapshot?.planType != null) Text('Plan: ${snapshot!.planType}'),
          Text(
            'ChatGPT voice token: ${snapshot?.voiceReady == true ? 'Ready' : 'Not ready'}',
          ),
          const Text(
            'This is the paired host account. DJL Cloud sign-in is separate.',
          ),
          if (login != null) PairedLoginControls(controller: login!),
          const SizedBox(height: 12),
          Text('Installed bridge: ${snapshot?.bridgeVersion ?? 'Unknown'}'),
          Text(
            'Latest reported by host: ${snapshot?.bridgeLatestVersion ?? 'Unknown'}',
          ),
          if (host.statusError != null) Text(host.statusError!),
          if (host.stale)
            const Text(
              'Showing previously read host data. Refresh to check current status.',
            ),
          TextButton.icon(
            onPressed: host.live && !host.loading ? host.refresh : null,
            icon: const Icon(Icons.refresh),
            label: const Text('Refresh host status'),
          ),
          const Divider(height: 28),
          OutlinedButton.icon(
            onPressed: host.canWake ? host.wakeDisplay : null,
            icon: const Icon(Icons.wb_sunny_outlined),
            label: const Text('Wake display'),
          ),
          const Text(
            'Display wake requires a reachable bridge. It cannot wake a powered-off or unreachable computer (Wake-on-LAN).',
          ),
          if (!host.capabilities.displayWake)
            const Text('Display wake is not advertised by this host.'),
          const SizedBox(height: 12),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Keep device reachable'),
            subtitle: const Text(
              'Keeps the device awake while the bridge runs. Best while charging.',
            ),
            value: host.keepAwake,
            onChanged: host.preferenceLoaded && host.capabilities.keepAwake
                ? host.setKeepAwake
                : null,
          ),
          Text(
            host.preferenceSynced
                ? 'Saved on this phone · confirmed by host'
                : 'Preference not confirmed by host; syncs when a capable bridge reconnects.',
          ),
          if (!host.capabilities.keepAwake)
            const Text('Keep-awake control is not advertised by this host.'),
          if (host.preferenceError != null) ...[
            Text(host.preferenceError!),
            TextButton(
              onPressed: host.canRetryPreference ? host.retryPreference : null,
              child: const Text('Retry preference'),
            ),
          ],
          if (!host.preferenceSynced &&
              host.live &&
              host.capabilities.keepAwake)
            TextButton(
              onPressed: host.canSyncPreference ? host.syncPreference : null,
              child: const Text('Sync preference'),
            ),
          const Divider(height: 28),
          OutlinedButton.icon(
            onPressed: host.canUpdate
                ? () => confirmHostBridgeUpdate(context, host)
                : null,
            icon: const Icon(Icons.system_update_alt),
            label: const Text('Update bridge'),
          ),
          if (!host.capabilities.bridgeUpdate)
            const Text('Bridge update is not advertised by this host.'),
          if (!host.connected)
            const Text('Connect to the paired host to update.'),
          if (host.updateState == HostUpdateState.reconnecting)
            const Text(
              'Waiting for bridge reconnect. The installed version has not been verified.',
            ),
          if (host.updateState == HostUpdateState.checking)
            const Text(
              'Checking the installed bridge version after reconnect…',
            ),
          if (host.updateState == HostUpdateState.verified)
            Text(
              'Fresh host status reports bridge ${snapshot?.bridgeVersion} after reconnect.',
            ),
          if (host.updateState == HostUpdateState.unchanged)
            const Text(
              'Reconnected; the host still reports the same bridge version.',
            ),
          if (host.actionError != null)
            Text(
              host.actionError!.message,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          if (host.actionMessage != null) Text(host.actionMessage!),
        ],
      );
    },
  );
}

Future<void> confirmHostBridgeUpdate(
  BuildContext context,
  HostController host,
) async {
  final device = host.device,
      session = host.session,
      revision = host.connectionRevision;
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      scrollable: true,
      title: const Text('Update paired bridge?'),
      content: SingleChildScrollView(
        child: Text(
          'Current: ${host.snapshot?.bridgeVersion ?? 'Unknown'}\n'
          'Latest reported: ${host.snapshot?.bridgeLatestVersion ?? 'Unknown'}\n\n'
          'The host bridge will restart. Expect a disconnect and reconnect. '
          'The installed version will be checked after reconnect.',
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('Update and restart'),
        ),
      ],
    ),
  );
  if (confirmed == true &&
      host.device == device &&
      host.session == session &&
      host.connectionRevision == revision) {
    await host.updateBridge();
  }
}

class HostContinueAction extends StatelessWidget {
  const HostContinueAction({
    super.key,
    required this.controller,
    required this.threadId,
  });
  final HostController controller;
  final String? threadId;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) => IconButton(
      tooltip: 'Continue on desktop',
      icon: const Icon(Icons.open_in_new),
      onPressed: controller.canHandoff && threadId?.trim().isNotEmpty == true
          ? () => confirmHostContinue(context, controller, threadId!)
          : null,
    ),
  );
}

Future<void> confirmHostContinue(
  BuildContext context,
  HostController controller,
  String threadId, {
  bool Function()? isCurrent,
}) async {
  if (!context.mounted ||
      !controller.canHandoff ||
      threadId.trim().isEmpty ||
      isCurrent?.call() == false) {
    return;
  }
  final device = controller.device,
      session = controller.session,
      revision = controller.connectionRevision,
      id = threadId;
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      scrollable: true,
      title: const Text('Continue on desktop?'),
      content: const Text(
        'Open this chat in the desktop app on your paired host.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('Continue'),
        ),
      ],
    ),
  );
  if (confirmed != true ||
      isCurrent?.call() == false ||
      controller.device != device ||
      controller.session != session ||
      controller.connectionRevision != revision) {
    return;
  }
  await controller.continueOnDesktop(id);
  if (context.mounted &&
      isCurrent?.call() != false &&
      controller.device == device &&
      controller.session == session &&
      controller.connectionRevision == revision) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          controller.actionError?.message ??
              controller.actionMessage ??
              'Host action finished.',
        ),
      ),
    );
  }
}
