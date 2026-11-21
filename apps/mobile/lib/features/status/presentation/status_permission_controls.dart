import 'package:flutter/material.dart';
import '../data/status_surface.dart';

import '../../../core/design/djl_icons.dart';
import '../../../core/presentation/djl_frosted.dart';
import '../../../l10n/l10n.dart';

/// Permission reads never prompt. Only these explicit actions can request access
/// or retry the local surface; they have no chat/controller mutation dependency.
class StatusPermissionControls extends StatefulWidget {
  const StatusPermissionControls({
    super.key,
    required this.backend,
    required this.onRetry,
  });
  final StatusPermissionBackend? backend;
  final Future<void> Function() onRetry;
  @override
  State<StatusPermissionControls> createState() =>
      _StatusPermissionControlsState();
}

class _StatusPermissionControlsState extends State<StatusPermissionControls>
    with WidgetsBindingObserver {
  StatusPermission? _permission;
  bool _busy = false, _returnFromSettings = false;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _read();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _returnFromSettings && !_busy) {
      _returnFromSettings = false;
      _read(retry: true);
    }
  }

  Future<void> _read({bool retry = false}) async {
    setState(() => _busy = true);
    try {
      final value =
          await widget.backend?.availability() ??
          const StatusPermission(StatusPermissionState.unsupported);
      if (!mounted) return;
      setState(() => _permission = value);
      // Returning after revocation also inserts an end barrier, so a prior
      // surface is retracted even when publishing is now unavailable.
      if (retry) {
        await widget.onRetry();
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _permission = const StatusPermission(
            StatusPermissionState.unsupported,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _enable() async {
    setState(() => _busy = true);
    // iOS has no separate Live Activity permission prompt; its explicit request
    // opens this app's settings when access is disabled.
    _returnFromSettings = true;
    try {
      final value = await widget.backend!.requestPermission();
      if (!mounted) return;
      setState(() => _permission = value);
      if (value.state == StatusPermissionState.allowed) {
        _returnFromSettings = false;
        await widget.onRetry();
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _permission = const StatusPermission(
            StatusPermissionState.unsupported,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _settings() async {
    _returnFromSettings = true;
    if (await widget.backend!.openSettings() != true) {
      _returnFromSettings = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final permission = _permission;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ListTile(
          leading: const Icon(DjlIcons.timer),
          title: Text(context.l10n.statusTaskStatus),
          subtitle: Text(switch (permission?.state) {
            StatusPermissionState.allowed => context.l10n.statusAllowed,
            StatusPermissionState.denied => context.l10n.statusDenied,
            StatusPermissionState.unsupported => context.l10n.statusUnsupported,
            null => context.l10n.statusChecking,
          }),
        ),
        if (permission != null &&
            permission.state != StatusPermissionState.unsupported)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 2, 16, 14),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (permission.canRequest)
                  DjlGlassPillButton(
                    label: context.l10n.statusEnable,
                    prominent: true,
                    onPressed: _busy ? null : _enable,
                  ),
                if (permission.state == StatusPermissionState.allowed)
                  DjlGlassPillButton(
                    label: context.l10n.statusRefresh,
                    onPressed: _busy ? null : () => _read(retry: true),
                  ),
                if (permission.canOpenSettings)
                  DjlGlassPillButton(
                    label: context.l10n.statusSystemSettings,
                    onPressed: _busy ? null : _settings,
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
