import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import '../../../core/design/djl_icons.dart';
import '../../../core/presentation/djl_frosted.dart';
import '../../settings/presentation/settings_group.dart';
import 'host_controller.dart';
import '../../../l10n/l10n.dart';

/// The paired Mac: whether DJL on it is reachable, and the few things the
/// phone can ask it to do. Chats always travel through DJL on the Mac.
class HostPage extends StatelessWidget {
  const HostPage({super.key, required this.controller});
  final HostController controller;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final background = scheme.brightness == Brightness.dark
        ? Colors.black
        : scheme.surfaceContainerLow;
    final top = MediaQuery.paddingOf(context).top;
    return Scaffold(
      backgroundColor: background,
      body: Stack(
        children: [
          ListenableBuilder(
            listenable: controller,
            builder: (context, _) => ListView(
              padding: EdgeInsets.fromLTRB(
                16,
                top + 68,
                16,
                MediaQuery.paddingOf(context).bottom + 24,
              ),
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 0, 4, 12),
                  child: Semantics(
                    header: true,
                    child: Text(
                      context.l10n.hostYourMac,
                      style: settingsTextStyle(
                        context,
                        34,
                        weight: FontWeight.w700,
                        color: scheme.onSurface,
                      ),
                    ),
                  ),
                ),
                ..._sections(context, controller),
              ],
            ),
          ),
          // Content fades out under the status bar instead of a solid bar.
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: top + 24,
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [background, background.withValues(alpha: 0)],
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            top: top + 8,
            left: 16,
            child: const DjlGlassBackButton(key: Key('host.back')),
          ),
        ],
      ),
    );
  }
}

List<Widget> _sections(BuildContext context, HostController host) {
  final scheme = Theme.of(context).colorScheme;
  final l10n = context.l10n;
  final caps = host.capabilities, version = host.snapshot?.bridgeVersion;
  final busy =
      host.loading || host.actionBusy || host.waking || host.preferenceSyncing;
  Widget note(String text, {bool error = false}) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
    child: Text(
      text,
      style: settingsTextStyle(
        context,
        12,
        color: error ? scheme.error : scheme.onSurfaceVariant,
      ),
    ),
  );
  final update = switch (host.updateState) {
    HostUpdateState.reconnecting => l10n.hostUpdating,
    HostUpdateState.checking => l10n.hostCheckingVersion,
    HostUpdateState.verified => l10n.hostNowVersion('$version'),
    HostUpdateState.unchanged => l10n.hostStillVersion('$version'),
    HostUpdateState.idle => null,
  };
  return [
    SettingsGroup(
      footer: host.connected
          ? l10n.hostConnectedFooter
          : l10n.hostReconnectFooter,
      children: [
        _StatusRow(host: host),
        if (version != null)
          _ValueRow(title: l10n.hostDjlVersion, value: version),
        if (busy)
          const Padding(
            padding: EdgeInsets.all(16),
            child: LinearProgressIndicator(minHeight: 2),
          ),
        if (host.statusError != null)
          _ActionRow(
            icon: DjlIcons.refresh,
            title: l10n.commonTryAgain,
            subtitle: l10n.hostCheckFailedNow,
            onTap: host.live && !host.loading ? host.refresh : null,
          ),
      ],
    ),
    if (caps.displayWake || caps.keepAwake)
      SettingsGroup(
        title: 'Mac',
        children: [
          if (caps.displayWake)
            _ActionRow(
              icon: DjlIcons.sun,
              title: host.waking ? l10n.hostReconnecting : l10n.hostWakeScreen,
              subtitle: l10n.hostWakeScreenDetail,
              onTap: host.canWake ? host.wakeDisplay : null,
            ),
          if (caps.keepAwake)
            SwitchListTile.adaptive(
              key: const Key('host.keepAwake'),
              contentPadding: const EdgeInsets.fromLTRB(16, 4, 12, 4),
              title: Text(l10n.hostKeepAwake),
              subtitle: Text(l10n.hostKeepAwakeDetail),
              value: host.keepAwake,
              onChanged: host.preferenceLoaded ? host.setKeepAwake : null,
            ),
        ],
      ),
    if (host.preferenceError != null) ...[
      note(host.preferenceError!, error: true),
      Align(
        alignment: Alignment.centerLeft,
        child: Padding(
          padding: const EdgeInsets.only(left: 8, bottom: 12),
          child: DjlGlassPillButton(
            label: l10n.commonTryAgain,
            onPressed: host.canRetryPreference ? host.retryPreference : null,
          ),
        ),
      ),
    ],
    if (caps.bridgeUpdate)
      SettingsGroup(
        title: l10n.hostUpdates,
        children: [
          _ActionRow(
            icon: DjlIcons.update,
            title: l10n.hostUpdateDjl,
            subtitle: l10n.hostUpdateDjlDetail,
            onTap: host.canUpdate
                ? () => confirmHostBridgeUpdate(context, host)
                : null,
          ),
        ],
      ),
    if (update != null) note(update),
    if (host.actionError != null) note(host.actionError!.message, error: true),
    if (host.actionMessage != null) note(host.actionMessage!),
  ];
}

class _StatusRow extends StatelessWidget {
  const _StatusRow({required this.host});
  final HostController host;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final l10n = context.l10n;
    final title = !host.connected
        ? l10n.hostNotConnected
        : host.stale
        ? l10n.hostConnectedChecking
        : l10n.hostConnected;
    return Semantics(
      label: l10n.hostStatusLabel(title),
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
        child: Row(
          children: [
            Icon(DjlIcons.laptop, size: 22, color: scheme.onSurface),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    l10n.hostDjlOnYourMac,
                    style: settingsTextStyle(
                      context,
                      15,
                      color: scheme.onSurface,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      Icon(
                        host.connected ? DjlIcons.circleFill : DjlIcons.circle,
                        size: 8,
                        color: host.connected
                            ? scheme.onSurface
                            : scheme.outline,
                      ),
                      const SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          title,
                          style: settingsTextStyle(
                            context,
                            13,
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ValueRow extends StatelessWidget {
  const _ValueRow({required this.title, required this.value});
  final String title, value;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      child: Row(
        children: [
          Expanded(
            child: Text(
              title,
              style: settingsTextStyle(context, 15, color: scheme.onSurface),
            ),
          ),
          Text(
            value,
            style: settingsTextStyle(
              context,
              14,
              color: scheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

/// A settings row that does something when tapped; dimmed while unavailable.
class _ActionRow extends StatelessWidget {
  const _ActionRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });
  final IconData icon;
  final String title, subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final ink = onTap == null
        ? scheme.onSurface.withValues(alpha: .38)
        : scheme.onSurface;
    return Semantics(
      button: true,
      enabled: onTap != null,
      child: CupertinoButton(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        onPressed: onTap,
        child: Row(
          children: [
            Icon(icon, size: 20, color: ink),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: settingsTextStyle(context, 15, color: ink),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: settingsTextStyle(
                      context,
                      12,
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> confirmHostBridgeUpdate(
  BuildContext context,
  HostController host,
) async {
  final device = host.device,
      session = host.session,
      revision = host.connectionRevision;
  final version = host.snapshot?.bridgeVersion;
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      scrollable: true,
      title: Text(context.l10n.hostUpdateTitle),
      content: Text(
        '${version == null ? '' : '${context.l10n.hostUpdateCurrent(version)}\n\n'}'
        '${context.l10n.hostUpdateBody}',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: Text(context.l10n.commonCancel),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: Text(context.l10n.hostUpdate),
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
      tooltip: context.l10n.hostContinueOnDesktop,
      icon: const Icon(DjlIcons.openExternal),
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
      title: Text(context.l10n.hostContinueTitle),
      content: Text(context.l10n.hostContinueBody),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: Text(context.l10n.commonCancel),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: Text(context.l10n.hostContinue),
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
              context.l10n.hostActionFinished,
        ),
      ),
    );
  }
}
