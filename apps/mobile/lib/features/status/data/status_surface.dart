import 'package:flutter/services.dart';

enum StatusAvailability { unknown, available, unavailable }

abstract interface class StatusSurface {
  Future<bool> update(Map<String, Object?> payload);
  Future<bool> end(Map<String, Object?> payload);
}

/// Local-only protocol v1.
/// Native rejects older epochs within an instance; startup end adopts a fresh
/// random instance and removes preexisting surfaces. Buckets contain at most
/// three entries each; native renders (running+failed+ready).take(3), deriving
/// bounded counts from unexpired entries and honoring staleAt/expiresAt without
/// Dart execution. No permission prompt is requested by this protocol.
/// Only an explicit available:true response confirms capability, never OS pixels.
enum StatusPermissionState { allowed, denied, unsupported }

class StatusPermission {
  const StatusPermission(
    this.state, {
    this.canRequest = false,
    this.canOpenSettings = false,
  });
  final StatusPermissionState state;
  final bool canRequest, canOpenSettings;
}

/// Optional: existing end/update-only surfaces need no permission implementation.
abstract interface class StatusPermissionBackend {
  Future<StatusPermission> availability();
  Future<StatusPermission> requestPermission();
  Future<bool> openSettings();
}

class MethodChannelStatusSurface
    implements StatusSurface, StatusPermissionBackend {
  const MethodChannelStatusSurface();
  static const _channel = MethodChannel('app.djl/local_run_status');
  Future<bool> _call(String method, Map<String, Object?> payload) async {
    try {
      final result = await _channel.invokeMapMethod<String, Object?>(
        method,
        payload,
      );
      return result?['available'] == true;
    } on MissingPluginException {
      return false;
    } on PlatformException {
      return false;
    }
  }

  Future<StatusPermission> _permission(String method) async {
    try {
      final result = await _channel.invokeMapMethod<String, Object?>(method);
      final state = switch (result?['state']) {
        'allowed' => StatusPermissionState.allowed,
        'denied' => StatusPermissionState.denied,
        _ => StatusPermissionState.unsupported,
      };
      return StatusPermission(
        state,
        canRequest:
            state == StatusPermissionState.denied &&
            result?['canRequest'] == true,
        canOpenSettings:
            state != StatusPermissionState.unsupported &&
            result?['canOpenSettings'] == true,
      );
    } on MissingPluginException {
      return const StatusPermission(StatusPermissionState.unsupported);
    } on PlatformException {
      return const StatusPermission(StatusPermissionState.unsupported);
    } on TypeError {
      return const StatusPermission(StatusPermissionState.unsupported);
    }
  }

  @override
  Future<StatusPermission> availability() => _permission('availability');
  @override
  Future<StatusPermission> requestPermission() =>
      _permission('requestPermission');
  @override
  Future<bool> openSettings() async {
    try {
      return await _channel.invokeMethod<bool>('openSettings') == true;
    } on MissingPluginException {
      return false;
    } on PlatformException {
      return false;
    } on TypeError {
      return false;
    }
  }

  @override
  Future<bool> update(Map<String, Object?> payload) => _call('update', payload);
  @override
  Future<bool> end(Map<String, Object?> payload) => _call('end', payload);
}
