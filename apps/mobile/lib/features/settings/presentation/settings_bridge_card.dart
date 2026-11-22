import 'dart:async';
import 'package:flutter/material.dart';
import '../../host/presentation/host_controller.dart';
import '../../host/presentation/host_controls.dart';
import '../domain/appearance.dart';
import 'settings_group.dart';
import '../../../l10n/l10n.dart';

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
      final l10n = context.l10n;
      final installed = host.snapshot?.bridgeVersion;
      final latest = host.snapshot?.bridgeLatestVersion;
      final newer =
          installed != null &&
          latest != null &&
          _numericCompare(installed, latest) < 0;
      final status = installed == null
          ? l10n.settingsBridgeUnknown
          : latest == null
          ? l10n.settingsBridgeInstalled
          : installed == latest
          ? l10n.settingsBridgeUpToDate
          : newer
          ? l10n.settingsBridgeUpdateAvailable
          : l10n.settingsBridgeDifferentBuild;
      final stale = installed != null && (!host.live || !host.fresh);
      final guidance = installed == null
          ? l10n.settingsBridgeConnectHint
          : stale
          ? l10n.settingsBridgeStaleHint
          : latest == null
          ? null
          : installed == latest
          ? l10n.settingsBridgeMatches
          : newer
          ? l10n.settingsBridgeNewer
          : l10n.settingsBridgeDifferent;
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
                          ? colors.onSurface
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
        title: l10n.hostDjlOnYourMac,
        footer: guidance,
        children: [
          value(
            l10n.settingsBridgeStatus,
            stale ? l10n.settingsBridgeLastKnown(status) : status,
            warning: newer && !stale,
          ),
          value(
            l10n.settingsVersion,
            installed ?? l10n.settingsBridgeUnknown,
            mono: true,
            warning: newer && !stale,
          ),
          if (latest != null)
            value(l10n.settingsBridgeLatest, latest, mono: true),
          if (host.capabilities.bridgeUpdate)
            TextButton(
              onPressed: host.canUpdate
                  ? () => confirmHostBridgeUpdate(context, host)
                  : null,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 7),
                child: Text(
                  newer ? l10n.settingsBridgeUpdate : l10n.settingsBridgeCheck,
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
              child: Text(l10n.commonTryAgain),
            ),
          ],
          if (host.updateState == HostUpdateState.reconnecting)
            message(l10n.hostUpdating),
          if (host.updateState == HostUpdateState.checking)
            message(l10n.hostCheckingVersion),
          if (host.updateState == HostUpdateState.verified)
            message(l10n.hostNowVersion('$installed')),
          if (host.updateState == HostUpdateState.unchanged)
            message(l10n.hostStillVersion('$installed')),
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
