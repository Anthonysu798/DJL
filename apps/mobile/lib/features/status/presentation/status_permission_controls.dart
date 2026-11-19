import 'package:flutter/material.dart';
import '../data/status_surface.dart';

import '../../../core/design/djl_icons.dart';

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
          title: const Text('Task status'),
          subtitle: Text(switch (permission?.state) {
            StatusPermissionState.allowed =>
              'Task status is allowed on this device.',
            StatusPermissionState.denied =>
              'Allow local task status in your device settings. Chat works without it.',
            StatusPermissionState.unsupported =>
              'Task status is unavailable on this device.',
            null => 'Checking device permission…',
          }),
        ),
        if (permission != null &&
            permission.state != StatusPermissionState.unsupported)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Wrap(
              spacing: 8,
              children: [
                if (permission.canRequest)
                  TextButton(
                    onPressed: _busy ? null : _enable,
                    child: const Text('Enable task status'),
                  ),
                if (permission.state == StatusPermissionState.allowed)
                  TextButton(
                    onPressed: _busy ? null : () => _read(retry: true),
                    child: const Text('Refresh task status'),
                  ),
                if (permission.canOpenSettings)
                  TextButton(
                    onPressed: _busy ? null : _settings,
                    child: const Text('System settings'),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
