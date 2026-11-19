import 'dart:async';
import 'package:flutter/material.dart';
import '../../host/presentation/host_controller.dart';
import '../../host/presentation/host_controls.dart';
import '../domain/appearance.dart';
import 'settings_group.dart';

class SettingsBridgeCard extends StatefulWidget {
  const SettingsBridgeCard({super.key, required this.controller});
  final HostController controller;
  @override
  State<SettingsBridgeCard> createState() => _SettingsBridgeCardState();
}

class _SettingsBridgeCardState extends State<SettingsBridgeCard>
    with WidgetsBindingObserver {
  late int _revision;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.controller.addListener(_changed);
    _revision = widget.controller.connectionRevision;
    _refresh();
  }

  void _refresh() {
    final host = widget.controller;
    scheduleMicrotask(() {
      if (mounted && identical(host, widget.controller)) {
        unawaited(host.refresh());
      }
    });
  }

  void _changed() {
    if (_revision == widget.controller.connectionRevision) return;
    _revision = widget.controller.connectionRevision;
    _refresh();
  }

  @override
  void didUpdateWidget(SettingsBridgeCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_changed);
      widget.controller.addListener(_changed);
      _revision = widget.controller.connectionRevision;
      _refresh();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.controller.removeListener(_changed);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) {
      final host = widget.controller;
      final installed = host.snapshot?.bridgeVersion;
      final latest = host.snapshot?.bridgeLatestVersion;
      final newer =
          installed != null &&
          latest != null &&
          _numericCompare(installed, latest) < 0;
      final status = installed == null
          ? 'Unknown'
          : latest == null
          ? 'Installed'
          : installed == latest
          ? 'Up to date'
          : newer
          ? 'Update available'
          : 'Different build';
      final stale = installed != null && (!host.live || !host.fresh);
      final guidance = installed == null
          ? 'Connect to your paired device to read the installed bridge version.'
          : stale
          ? 'Last known bridge status. Reconnect or refresh to update.'
          : latest == null
          ? null
          : installed == latest
          ? 'DJL on your Mac matches the latest release.'
          : newer
          ? 'A newer DJL release is available. Update DJL on your Mac.'
          : 'Your Mac is running a different build than the latest release.';
      final colors = Theme.of(context).colorScheme;
      Widget value(
        String title,
        String text, {
        bool mono = false,
        bool warning = false,
      }) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            Flexible(
              child: Text(
                title,
                style: settingsTextStyle(context, 15, color: colors.onSurface),
              ),
            ),
            const SizedBox(width: 20),
            Expanded(
              child: Text(
                text,
                textAlign: TextAlign.right,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style:
                    settingsTextStyle(
                      context,
                      14,
                      color: warning
                          ? Colors.orange
                          : mono
                          ? colors.onSurface
                          : colors.onSurfaceVariant,
                    ).copyWith(
                      fontFamily: mono
                          ? DjlAppearance.of(context).font.codeFamily
                          : null,
                    ),
              ),
            ),
          ],
        ),
      );
      Widget message(String text, {bool error = false}) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Text(
          text,
          style: settingsTextStyle(
            context,
            12,
            color: error ? colors.error : colors.onSurfaceVariant,
          ),
        ),
      );
      return SettingsGroup(
        title: 'Bridge',
        footer: guidance,
        children: [
          value(
            'Status',
            stale ? 'Last known · $status' : status,
            warning: newer && !stale,
          ),
          value(
            'Installed',
            installed ?? 'Unknown',
            mono: true,
            warning: newer && !stale,
          ),
          value('Latest', latest ?? 'Unknown', mono: true),
          if (host.capabilities.bridgeUpdate)
            TextButton(
              onPressed: host.canUpdate
                  ? () => confirmHostBridgeUpdate(context, host)
                  : null,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 7),
                child: Text(
                  newer
                      ? 'Update Bridge on Device'
                      : 'Reinstall Bridge on Device',
                  textAlign: TextAlign.center,
                  style: settingsTextStyle(context, 15),
                ),
              ),
            ),
          if (host.loading)
            const Padding(
              padding: EdgeInsets.all(16),
              child: LinearProgressIndicator(),
            ),
          if (host.statusError != null) ...[
            message(host.statusError!, error: true),
            TextButton(
              onPressed: host.live && !host.loading ? host.refresh : null,
              child: const Text('Refresh bridge status'),
            ),
          ],
          if (host.updateState == HostUpdateState.reconnecting)
            message(
              'Waiting for bridge reconnect. The installed version has not been verified.',
            ),
          if (host.updateState == HostUpdateState.checking)
            message('Checking the installed bridge version after reconnect…'),
          if (host.updateState == HostUpdateState.verified)
            message(
              'Fresh host status reports bridge $installed after reconnect.',
            ),
          if (host.updateState == HostUpdateState.unchanged)
            message(
              'Reconnected; the host still reports the same bridge version.',
            ),
          if (host.actionError != null)
            message(host.actionError!.message, error: true),
        ],
      );
    },
  );
}

// Match the source's numeric ordering: 1.10 follows 1.9, including build labels.
int _numericCompare(String a, String b) {
  final tokens = RegExp(r'\d+|\D+');
  final left = tokens.allMatches(a).map((m) => m.group(0)!).toList();
  final right = tokens.allMatches(b).map((m) => m.group(0)!).toList();
  for (var i = 0; i < left.length && i < right.length; i++) {
    final l = BigInt.tryParse(left[i]), r = BigInt.tryParse(right[i]);
    final order = l != null && r != null
        ? l.compareTo(r)
        : left[i].compareTo(right[i]);
    if (order != 0) return order;
  }
  return left.length.compareTo(right.length);
}
