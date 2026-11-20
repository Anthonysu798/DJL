import 'dart:async';
import 'package:flutter/foundation.dart';
import '../../desktop/data/remote_transport.dart';
import '../../pairing/data/pairing_repository.dart';
import '../../settings/data/settings_store.dart';
import '../domain/host_snapshot.dart';

enum HostErrorKind { unsupported, disconnected, refused, uncertain }

enum HostUpdateState { idle, reconnecting, checking, verified, unchanged }

class HostActionError {
  const HostActionError(
    this.kind,
    this.message, {
    this.rpcCode,
    this.errorCode,
  });
  final HostErrorKind kind;
  final String message;
  final Object? rpcCode;
  final String? errorCode;
  factory HostActionError.from(Object error) {
    if (error is RemoteRpcException) {
      final raw = error.data;
      final code = raw is Map && raw['errorCode'] is String
          ? raw['errorCode'] as String
          : null;
      final unsupported =
          error.code == -32601 ||
          code?.startsWith('unsupported_') == true ||
          code == 'unknown_method';
      return HostActionError(
        unsupported ? HostErrorKind.unsupported : HostErrorKind.refused,
        unsupported
            ? 'DJL on your Mac can\'t do this yet. Update DJL on your Mac.'
            : 'Your Mac turned this down. Check DJL on your Mac and try again.',
        rpcCode: error.code,
        errorCode: code,
      );
    }
    return const HostActionError(
      HostErrorKind.uncertain,
      'We could not tell whether this worked. Check your Mac before trying again.',
    );
  }
}

class HostController extends ChangeNotifier {
  HostController(this.transport, {SettingsStore? store})
    : store = store ?? SharedSettingsStore();
  static const keepAwakeKey = 'codex.keepMacAwakeWhileBridgeRuns';
  final RemoteTransport transport;
  final SettingsStore store;
  Future<void> Function(String device)? connectSaved;
  String? device, session;
  bool connected = false, trusted = false, loading = false, stale = false;
  bool _disposed = false, actionBusy = false, _waking = false;
  int _epoch = 0, _generation = 0, _selection = 0;
  bool get waking => _waking;
  int get connectionRevision => _epoch;
  HostSnapshot? snapshot;
  String? statusError, actionMessage, preferenceError;
  HostActionError? actionError;
  HostUpdateState updateState = HostUpdateState.idle;
  String? _updateVersion;
  int? _updateEpoch;
  Future<void>? _refresh;
  bool keepAwake = false, preferenceLoaded = false, preferenceSaving = false;
  bool preferenceSyncing = false;
  bool? _syncedChoice, _preferenceRetry;
  bool _persistedChoice = false;
  int _preferenceRevision = 0;
  int? _preferenceAttemptEpoch;
  Future<void> _writes = Future.value();
  Future<void>? _sync;
  bool get preferenceSynced =>
      connected &&
      _syncedChoice == keepAwake &&
      !preferenceSaving &&
      !preferenceSyncing &&
      preferenceError == null;
  HostCapabilities get capabilities =>
      snapshot?.capabilities(trusted: trusted) ?? const HostCapabilities();
  bool get live => connected && device != null && session != null;
  bool get fresh => snapshot != null && !stale && statusError == null;
  bool get canSyncPreference =>
      !_disposed &&
      live &&
      fresh &&
      capabilities.keepAwake &&
      preferenceLoaded &&
      !preferenceSaving &&
      !preferenceSyncing &&
      !actionBusy &&
      !_waking;
  bool get canRetryPreference =>
      !preferenceSaving &&
      (_preferenceRetry != null || !preferenceLoaded || canSyncPreference);
  bool get canHandoff =>
      live &&
      fresh &&
      capabilities.desktopHandoff &&
      !actionBusy &&
      !_waking &&
      !preferenceSyncing;
  bool get canWake =>
      !actionBusy &&
      !preferenceSyncing &&
      !_waking &&
      capabilities.displayWake &&
      (live && fresh || !live && trusted && connectSaved != null);
  bool get canUpdate =>
      live &&
      fresh &&
      !preferenceSyncing &&
      !_waking &&
      capabilities.bridgeUpdate &&
      !actionBusy &&
      updateState != HostUpdateState.reconnecting &&
      updateState != HostUpdateState.checking;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  bool _current(int epoch) => !_disposed && epoch == _epoch && live;

  void bind({
    required String? device,
    required String? session,
    required bool connected,
    required bool trusted,
    int generation = 0,
  }) {
    if (this.device == device &&
        this.session == session &&
        this.connected == connected &&
        this.trusted == trusted &&
        _generation == generation) {
      return;
    }
    final changedDevice = this.device != device;
    if (changedDevice) _selection++;
    final changedConnection =
        changedDevice ||
        this.session != session ||
        this.connected != connected ||
        _generation != generation;
    this.trusted = trusted;
    if (!changedConnection) {
      _notify();
      return;
    }
    this.device = device;
    this.session = session;
    this.connected = connected;
    this.trusted = trusted;
    _generation = generation;
    _epoch++;
    _refresh = null;
    _sync = null;
    loading = false;
    actionBusy = false;
    preferenceSyncing = false;
    _syncedChoice = null;
    actionError = null;
    actionMessage = null;
    statusError = null;
    stale = snapshot != null;
    if (changedDevice) {
      snapshot = null;
      stale = false;
      updateState = HostUpdateState.idle;
      _updateEpoch = null;
      _updateVersion = null;
    } else if (live && _updateEpoch != null && _epoch != _updateEpoch) {
      updateState = HostUpdateState.checking;
    }
    _notify();
  }

  Future<void> refresh() {
    if (!live || _disposed) return Future.value();
    if (_refresh != null) return _refresh!;
    final epoch = _epoch;
    loading = true;
    statusError = null;
    _notify();
    final work = () async {
      try {
        RemoteJson response;
        try {
          response = await transport.request('account/status/read', {});
        } on RemoteRpcException catch (e) {
          if (!_unsupportedStatus(e)) rethrow;
          if (!_current(epoch)) return;
          response = await transport.request('getAuthStatus', {});
        }
        if (!_current(epoch)) return;
        if (!response.keys.any(
          const {
            'status',
            'bridgeVersion',
            'hostPlatform',
            'hostCapabilities',
            'authMethod',
            'tokenReady',
          }.contains,
        )) {
          throw const FormatException('Invalid host snapshot');
        }
        snapshot = HostSnapshot.decode(response);
        stale = false;
        if (updateState == HostUpdateState.checking &&
            _updateEpoch != epoch &&
            snapshot!.bridgeVersion != null) {
          updateState = snapshot!.bridgeVersion != _updateVersion
              ? HostUpdateState.verified
              : HostUpdateState.unchanged;
          _updateEpoch = null;
        }
      } catch (_) {
        if (_current(epoch)) {
          stale = snapshot != null;
          statusError = 'Could not check your Mac. Try again.';
        }
      } finally {
        if (_current(epoch)) {
          loading = false;
          _refresh = null;
          _notify();
        }
      }
    }();
    _refresh = work;
    return work;
  }

  bool _unsupportedStatus(RemoteRpcException e) {
    if (e.code == -32601) return true;
    final message = e.message.toLowerCase();
    return (message.contains('account/status/read') ||
            message.contains('account status read')) &&
        [
          'method not found',
          'unknown method',
          'not implemented',
          'does not support',
        ].any(message.contains);
  }

  Future<bool> _action(
    String method,
    RemoteJson params, {
    required bool supported,
    String? message,
  }) async {
    if (actionBusy || _waking || preferenceSyncing || _disposed) return false;
    if (!live || !supported || !fresh) {
      actionError = HostActionError(
        !live ? HostErrorKind.disconnected : HostErrorKind.unsupported,
        live && !fresh
            ? 'Checking your Mac first. Try again in a moment.'
            : !live
            ? 'Connect to your Mac first.'
            : 'DJL on your Mac can\'t do this yet. Update DJL on your Mac.',
      );
      _notify();
      return false;
    }
    final epoch = _epoch;
    actionBusy = true;
    actionError = null;
    actionMessage = null;
    _notify();
    try {
      final result = await transport.request(method, params);
      if (!_current(epoch)) return false;
      if (result['success'] != true) {
        actionError = HostActionError(
          result['success'] == false
              ? HostErrorKind.refused
              : HostErrorKind.uncertain,
          'Your Mac did not confirm this. Check it before trying again.',
        );
        return false;
      }
      actionMessage = message;
      return true;
    } catch (e) {
      if (_current(epoch)) actionError = HostActionError.from(e);
      return false;
    } finally {
      if (_current(epoch)) {
        actionBusy = false;
        _notify();
      }
    }
  }

  Future<bool> continueOnDesktop(String threadId) async {
    if (threadId.trim().isEmpty) return false;
    return _action(
      'desktop/continueOnDesktop',
      {'threadId': threadId.trim()},
      supported: capabilities.desktopHandoff,
      message: 'Opened in DJL on your Mac.',
    );
  }

  Future<bool> wakeDisplay() async {
    if (_waking || actionBusy) return false;
    if (!live) {
      if (!trusted ||
          !capabilities.displayWake ||
          connectSaved == null ||
          device == null) {
        actionError = const HostActionError(
          HostErrorKind.disconnected,
          'Reconnect to your Mac first.',
        );
        _notify();
        return false;
      }
      final target = device!, selection = _selection;
      _waking = true;
      _notify();
      try {
        await connectSaved!(target);
        if (_disposed || device != target || selection != _selection) {
          return false;
        }
        if (!live || !trusted) {
          actionError = const HostActionError(
            HostErrorKind.disconnected,
            'Could not reach DJL on your Mac. Check that it is open, then try again.',
          );
          return false;
        }
        await refresh();
        if (_disposed ||
            device != target ||
            selection != _selection ||
            !live ||
            stale ||
            statusError != null) {
          return false;
        }
      } catch (e) {
        if (!_disposed && device == target && selection == _selection) {
          actionError = HostActionError.from(e);
        }
        return false;
      } finally {
        _waking = false;
        _notify();
      }
    }
    return _action(
      'desktop/wakeDisplay',
      {},
      supported: capabilities.displayWake,
      message: 'Your Mac\'s screen is waking up.',
    );
  }

  Future<bool> updateBridge() async {
    if (!canUpdate) return false;
    final epoch = _epoch, version = snapshot?.bridgeVersion;
    // Set before sending: uncertain delivery must not automatically replay the mutation.
    updateState = HostUpdateState.reconnecting;
    _updateVersion = version;
    _updateEpoch = epoch;
    final success = await _action(
      'desktop/bridge/updateAndRestart',
      {},
      supported: capabilities.bridgeUpdate,
    );
    if (_current(epoch)) {
      if (!success &&
          {
            HostErrorKind.refused,
            HostErrorKind.unsupported,
          }.contains(actionError?.kind)) {
        updateState = HostUpdateState.idle;
        _updateEpoch = null;
        _updateVersion = null;
      }
      _notify();
    }
    return success;
  }

  Future<void> loadPreference() async {
    final revision = _preferenceRevision;
    try {
      final values = await store.read();
      if (_disposed || revision != _preferenceRevision) return;
      keepAwake = values[keepAwakeKey] == true;
      _persistedChoice = keepAwake;
      preferenceLoaded = true;
      preferenceError = null;
    } catch (_) {
      if (!_disposed) {
        preferenceError = 'Could not read the saved preference. Retry.';
      }
    }
    _notify();
  }

  Future<void> retryPreference() async {
    final retry = _preferenceRetry;
    if (retry != null) {
      await setKeepAwake(retry);
    } else if (!preferenceLoaded) {
      await loadPreference();
    } else {
      await syncPreference();
    }
  }

  Future<bool> setKeepAwake(bool value) {
    final revision = ++_preferenceRevision, epoch = _epoch;
    keepAwake = value;
    preferenceSaving = true;
    preferenceError = null;
    _notify();
    final result = Completer<bool>();
    _writes = _writes.then((_) async {
      try {
        await store.write(keepAwakeKey, value);
        if (_disposed) {
          result.complete(false);
          return;
        }
        preferenceLoaded = true;
        _persistedChoice = value;
        if (revision == _preferenceRevision) {
          preferenceSaving = false;
          _preferenceRetry = null;
          if (_epoch == epoch) unawaited(syncPreference());
        }
        result.complete(true);
      } catch (_) {
        if (!_disposed && revision == _preferenceRevision) {
          keepAwake = _persistedChoice;
          _preferenceRetry = value;
          preferenceError =
              'Could not save this preference. Your previous choice is unchanged. Try again.';
          preferenceSaving = false;
        }
        result.complete(false);
      }
      _notify();
    });
    return result.future;
  }

  Future<void> syncPreference({bool automatic = false}) {
    if (_sync != null) return _sync!;
    // Account/foreground reads may attempt initial sync once per secure
    // connection. Uncertain writes require an explicit retry or reconnect.
    if (automatic && _preferenceAttemptEpoch == _epoch) return Future.value();
    if (!canSyncPreference ||
        _syncedChoice == keepAwake && preferenceError == null) {
      return Future.value();
    }
    final epoch = _epoch;
    preferenceSyncing = true;
    preferenceError = null;
    _notify();
    final work = () async {
      try {
        while (_current(epoch) && !preferenceSaving) {
          final choice = keepAwake, revision = _preferenceRevision;
          _preferenceAttemptEpoch = epoch;
          final result = await transport.request('desktop/preferences/update', {
            'keepMacAwake': choice,
          });
          if (!_current(epoch)) return;
          if (result['success'] != true) {
            throw const FormatException('Unconfirmed preference');
          }
          if (revision == _preferenceRevision) {
            _syncedChoice = choice;
            break;
          }
          // Only a newer persisted choice follows a confirmed earlier write.
          // Timeout/refusal exits below and requires explicit retry or reconnect.
        }
      } catch (_) {
        if (_current(epoch)) {
          preferenceError =
              'Saved on this phone, but your Mac has not confirmed it yet.';
        }
      } finally {
        if (_current(epoch)) {
          preferenceSyncing = false;
          _sync = null;
          _notify();
        }
      }
    }();
    _sync = work;
    return work;
  }

  @override
  void dispose() {
    _disposed = true;
    _epoch++;
    super.dispose();
  }
}
