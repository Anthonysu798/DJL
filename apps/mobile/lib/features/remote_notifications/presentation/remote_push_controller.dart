import 'dart:async';
import 'package:flutter/foundation.dart';
import '../../../core/network/cloud_client.dart';
import '../data/remote_push_native.dart';
import '../data/remote_push_store.dart';
import '../domain/remote_notification.dart';
import '../../../l10n/l10n.dart';

typedef PairedPushRequest =
    Future<Object?> Function(String method, Map<String, dynamic> params);

class PairedPushOwner {
  const PairedPushOwner(this.identity, this.request);

  /// Includes the verified Mac key, secure session, and connection revision.
  final String identity;
  final PairedPushRequest request;
}

class RemotePushController extends ChangeNotifier {
  RemotePushController(this.client, this.native, this.store);
  final CloudClient client;
  final RemotePushNative native;
  final RemotePushStore store;
  bool enabled = false, loaded = false, busy = false;
  RemotePushState state = const RemotePushState();
  String cloudStatus = 'Not enrolled', pairedStatus = 'Not enrolled';
  String? error;
  String? _cloudOwner, _cloudAttempt, _pairAttempt;
  PairedPushOwner? _pair;
  bool _allowed = false, _disposed = false;
  int _epoch = 0, _nativeRevision = 0, _tapRevision = 0;
  int? _cloudRevision;
  bool _cloudBusy = false, _pairBusy = false, _acquiring = false;
  StreamSubscription<Object?>? _subscription;
  final _accepted = <String, DateTime>{};
  bool Function(RemoteNotificationTap)? onTap;

  Future<void> initialize() async {
    _subscription = native.events.listen((event) {
      if (_disposed) return;
      if (event is Map && event['eventId'] != null) {
        _tap(event);
      } else {
        _nativeRevision++;
        state = RemotePushState.from(event);
        if (!enabled) state = const RemotePushState();
        _sync();
        _notify();
      }
    });
    // Live intake is installed before the initial drain. Both share event IDs.
    final tapRevision = _tapRevision;
    final initial = native.initialTap();
    try {
      final value = await store.read();
      if (_disposed) return;
      enabled = value;
    } catch (_) {
      error = appStrings.pushReadFailed;
    }
    if (_disposed) return;
    loaded = true;
    final pending = await initial;
    if (tapRevision == _tapRevision) _tap(pending);
    await refresh();
  }

  void _tap(Object? raw) {
    if (_disposed) return;
    final tap = RemoteNotificationTap.parse(raw);
    if (tap == null) return;
    _tapRevision++;
    final now = DateTime.now();
    _accepted.removeWhere(
      (_, time) => now.difference(time) > const Duration(seconds: 300),
    );
    if (_accepted.containsKey(tap.eventId)) return;
    if (onTap?.call(tap) != true) return;
    _accepted[tap.eventId] = tap.receivedAt;
    while (_accepted.length > 32) {
      _accepted.remove(_accepted.keys.first);
    }
    unawaited(native.acknowledge(tap.eventId));
  }

  void updateContext({
    required bool allowed,
    String? cloudOwner,
    PairedPushOwner? paired,
  }) {
    final owner = cloudOwner == null ? null : '${client.revision}:$cloudOwner';
    if (_allowed == allowed &&
        _cloudOwner == owner &&
        _pair?.identity == paired?.identity) {
      return;
    }
    _epoch++;
    if (_cloudOwner != null && owner == null && paired == null) {
      _nativeRevision++;
      state = RemotePushState(
        availability: state.availability,
        permission: state.permission,
        environment: state.environment,
        provider: state.provider,
      );
      unawaited(native.clearToken());
    }
    _allowed = allowed;
    if (_cloudOwner != owner) {
      _cloudAttempt = null;
      cloudStatus = 'Not enrolled';
    }
    if (_pair?.identity != paired?.identity) {
      _pairAttempt = null;
      pairedStatus = 'Not enrolled';
    }
    _cloudOwner = owner;
    _cloudRevision = owner == null ? null : client.revision;
    _pair = paired;
    _sync();
    if (enabled && loaded && _allowed && !state.hasToken && !_acquiring) {
      unawaited(_acquire());
    }
    _notify();
  }

  Future<void> refresh() async {
    final revision = ++_nativeRevision;
    final value = await native.status();
    if (_disposed || revision != _nativeRevision) return;
    state = value;
    _sync();
    if (enabled && _allowed && !state.hasToken) await _acquire();
    _notify();
  }

  Future<void> setEnabled(bool value) async {
    if (busy || !loaded || _disposed) return;
    busy = true;
    error = null;
    // Disable fences pending writes immediately, before asynchronous persistence.
    if (!value) {
      enabled = false;
      _epoch++;
      _cloudAttempt = _pairAttempt = null;
    }
    _notify();
    try {
      if (!value) {
        _nativeRevision++;
        state = const RemotePushState();
        cloudStatus = pairedStatus =
            'Local sync off; server revocation unavailable';
        await native.clearToken(disable: true);
      }
      await store.write(value);
      if (_disposed) return;
      enabled = value;
      if (value) {
        final revision = ++_nativeRevision;
        final result = await native.enable();
        if (_disposed || revision != _nativeRevision || !enabled) return;
        state = result;
        _cloudAttempt = _pairAttempt = null;
        _sync();
      }
    } catch (_) {
      error = appStrings.pushUpdateFailed;
    } finally {
      busy = false;
      _notify();
    }
  }

  Future<void> _acquire({bool retry = false}) async {
    if (_acquiring ||
        !enabled ||
        !_allowed ||
        (_cloudOwner == null && _pair == null) ||
        !(state.available || retry && state.availability == 'failed') ||
        !state.alerts) {
      return;
    }
    _acquiring = true;
    final epoch = _epoch, revision = ++_nativeRevision;
    try {
      final value = await native.register();
      if (!_disposed &&
          enabled &&
          epoch == _epoch &&
          revision == _nativeRevision) {
        state = value;
        _sync();
      }
    } finally {
      _acquiring = false;
      if (!_disposed && epoch != _epoch && !state.hasToken) {
        unawaited(_acquire());
      }
      _notify();
    }
  }

  Future<void> retryCloud() => _retry(cloud: true, paired: false);
  Future<void> retryPaired() => _retry(cloud: false, paired: true);
  Future<void> retry() => _retry(cloud: true, paired: true);

  Future<void> _retry({required bool cloud, required bool paired}) async {
    if (cloud) _cloudAttempt = null;
    if (paired) _pairAttempt = null;
    if (!loaded) {
      await initialize();
      return;
    }
    await refresh();
    if (state.availability == 'failed') await _acquire(retry: true);
  }

  void _sync() {
    if (_disposed ||
        !loaded ||
        !enabled ||
        !_allowed ||
        !state.available ||
        !state.hasToken) {
      return;
    }
    if (_cloudOwner != null &&
        _cloudRevision == client.revision &&
        state.alerts &&
        !_cloudBusy) {
      unawaited(_syncCloud());
    }
    if (_pair != null && !_pairBusy) unawaited(_syncPair());
  }

  String _signature(String owner) =>
      '$owner:${state.provider}:${state.token}:${state.environment}:${state.permission}';
  Future<void> _syncCloud() async {
    final owner = _cloudOwner!;
    final signature = _signature(owner);
    if (_cloudAttempt == signature) return;
    _cloudAttempt = signature;
    _cloudBusy = true;
    final epoch = _epoch, revision = client.revision, captured = state;
    bool current() =>
        !_disposed &&
        enabled &&
        _allowed &&
        _epoch == epoch &&
        _cloudOwner == owner &&
        _signature(owner) == signature &&
        client.revision == revision;
    cloudStatus = 'Checking Cloud configuration';
    _notify();
    try {
      // Only an eligible current signed-in owner reaches this lazy capability read.
      final config = await client.request(
        'GET',
        'v1/client-config',
        authenticated: false,
      );
      if (!current()) return;
      if (captured.provider == 'fcm'
          ? config['pushProviders'] is! List ||
                !(config['pushProviders'] as List).contains('fcm')
          : config['pushConfigured'] != true) {
        cloudStatus = captured.provider == 'fcm'
            ? 'Android remote notifications are unavailable on this Cloud service'
            : 'Cloud APNs sender is not configured';
        return;
      }
      await client.registerPushToken(
        token: captured.token!,
        provider: captured.provider,
        environment: captured.cloudEnvironment,
        expectedRevision: revision,
        isCurrent: current,
      );
      if (current()) {
        cloudStatus = 'Registration acknowledged; delivery unverified';
      }
    } catch (_) {
      if (current()) cloudStatus = 'Cloud registration failed. Retry.';
    } finally {
      _cloudBusy = false;
      if (!current() && _cloudAttempt == signature) _cloudAttempt = null;
      _notify();
      _sync();
    }
  }

  Future<void> _syncPair() async {
    final owner = _pair!;
    final signature = _signature(owner.identity);
    if (_pairAttempt == signature) return;
    _pairAttempt = signature;
    _pairBusy = true;
    final epoch = _epoch, captured = state;
    bool current() =>
        !_disposed &&
        enabled &&
        _allowed &&
        _epoch == epoch &&
        _pair?.identity == owner.identity &&
        _signature(owner.identity) == signature;
    pairedStatus = 'Registering with current trusted Mac';
    _notify();
    try {
      if (!current()) return;
      if (captured.provider == 'fcm') {
        final capabilities = await owner.request(
          'notifications/push/capabilities',
          {},
        );
        if (!current()) return;
        if (capabilities is! Map ||
            capabilities['providers'] is! List ||
            !(capabilities['providers'] as List).contains('fcm')) {
          pairedStatus =
              'Android remote notifications are unavailable on this Mac service';
          return;
        }
      }
      final result = await owner.request('notifications/push/register', {
        if (captured.provider == 'fcm') 'provider': 'fcm',
        'deviceToken': captured.token!,
        'alertsEnabled': captured.alerts,
        'authorizationStatus': captured.permission,
        'appEnvironment': captured.environment,
      });
      if (current()) {
        pairedStatus = result is Map && result['ok'] == true
            ? (captured.alerts
                  ? 'Bridge acknowledged; delivery unverified'
                  : 'Bridge acknowledged alerts disabled')
            : 'Bridge skipped or refused registration. Retry.';
      }
    } catch (_) {
      if (current()) pairedStatus = 'Mac registration failed. Retry.';
    } finally {
      _pairBusy = false;
      if (!current() && _pairAttempt == signature) _pairAttempt = null;
      _notify();
      _sync();
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _epoch++;
    _nativeRevision++;
    state = const RemotePushState();
    _accepted.clear();
    unawaited(_subscription?.cancel());
    native.dispose();
    super.dispose();
  }
}
