import 'dart:async';
import 'package:flutter/foundation.dart';
import '../../../../app/paired_login_callback.dart';
import '../../desktop/data/remote_transport.dart';
import '../../pairing/data/pairing_repository.dart';
import '../data/paired_login_store.dart';
import '../domain/paired_login.dart';
import 'host_controller.dart';

/// Paired-computer ChatGPT recovery. This never reads or changes DJL Cloud auth.
class PairedLoginController extends ChangeNotifier {
  PairedLoginController(this.host, this.store, {DateTime Function()? now})
    : now = now ?? DateTime.now {
    _connection = host.connectionRevision;
    _readingStatus = host.loading;
    if (_readingStatus) _statusReadsStarted = 1;
    host.addListener(_hostChanged);
  }
  final HostController host;
  final PairedLoginStore store;
  final DateTime Function() now;
  LoginIdentity? identity;
  PendingLogin? pending;
  int _statusReadsStarted = 0, _statusReadSettled = 0, _flowReadBarrier = 0;
  bool _readingStatus = false;
  LoginCallback? callback;
  bool busy = false, loaded = false, allowed = true;
  bool uncertainStart = false, remoteUnconfirmed = false;
  bool _callbackAttempted = false, _dirty = false, _disposed = false;
  String? error, storageError;
  int _epoch = 0, _connection = 0, _saveRevision = 0;
  Future<void>? _load;
  Timer? _timer;
  final _completed = <String>{};
  int get operationRevision => _epoch;
  bool get live => host.live && host.trusted && host.device == identity?.device;
  bool get canOpen =>
      allowed &&
      live &&
      host.fresh &&
      host.snapshot?.advertised?.hostBrowserLogin == true &&
      loaded &&
      storageError == null &&
      !_dirty &&
      !busy &&
      !uncertainStart &&
      !remoteUnconfirmed;
  bool get hasCallback => callback != null;
  bool get polling => _timer != null;
  LoginRecord get _record => LoginRecord(
    pending: pending,
    callback: callback,
    uncertainStart: uncertainStart,
    remoteUnconfirmed: remoteUnconfirmed,
    callbackAttempted: _callbackAttempted,
  );
  bool _current(int epoch, LoginIdentity? target) =>
      !_disposed && epoch == _epoch && target == identity;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void bind(LoginIdentity? target) {
    if (_disposed || identity == target) return;
    _epoch++;
    identity = target;
    pending = null;
    _flowReadBarrier = _statusReadsStarted;
    callback = null;
    busy = false;
    loaded = false;
    uncertainStart = false;
    remoteUnconfirmed = false;
    _callbackAttempted = false;
    _dirty = false;
    error = null;
    storageError = null;
    _load = null;
    _completed.clear();
    _timer?.cancel();
    _timer = null;
    if (target != null) unawaited(load());
    _notify();
  }

  Future<void> load() {
    if (_load != null) return _load!;
    final target = identity, epoch = _epoch;
    if (target == null || _dirty) return Future.value();
    final work = () async {
      try {
        final record = await store.read(target);
        if (!_current(epoch, target)) return;
        pending = record.pending;
        _flowReadBarrier = _statusReadsStarted;
        callback = record.callback;
        uncertainStart = record.uncertainStart;
        remoteUnconfirmed = record.remoteUnconfirmed;
        _callbackAttempted = record.callbackAttempted;
        storageError = null;
        loaded = true;
        _reconcile();
      } catch (_) {
        if (_current(epoch, target)) {
          storageError =
              'Could not read secure sign-in recovery. Unlock your phone and retry.';
        }
      } finally {
        if (_current(epoch, target)) {
          _load = null;
          _syncPolling();
          _notify();
        }
      }
    }();
    _load = work;
    return work;
  }

  Future<bool> _save() async {
    final target = identity, epoch = _epoch, record = _record;
    final revision = ++_saveRevision;
    if (target == null) return false;
    _dirty = true;
    try {
      await store.write(target, record);
      if (!_current(epoch, target)) return false;
      if (revision == _saveRevision) {
        _dirty = false;
        storageError = null;
      }
      return true;
    } catch (_) {
      if (_current(epoch, target)) {
        storageError =
            'Could not save secure sign-in recovery. Retry secure storage before continuing.';
      }
      return false;
    } finally {
      _notify();
    }
  }

  Future<void> retryStorage() async {
    if (_dirty) {
      await _save();
    } else {
      await load();
    }
    _syncPolling();
  }

  void setAllowed(bool value) {
    if (allowed == value || _disposed) return;
    allowed = value;
    if (!value) {
      _epoch++;
      busy = false;
      _load = null;
      if (_dirty) {
        storageError = 'Secure sign-in recovery needs a storage retry.';
      }
    }
    _syncPolling();
    _notify();
    if (value && identity != null && !loaded && !_dirty && _load == null) {
      // Privacy invalidates the old read, but clean restoration is safe to
      // resume. Restoring pending state does not replay any auth mutation.
      unawaited(load());
    }
    if (value && callback != null && !_callbackAttempted) {
      unawaited(retryCallback());
    }
  }

  void _hostChanged() {
    if (_disposed) return;
    if (_connection != host.connectionRevision) {
      _connection = host.connectionRevision;
      _epoch++;
      busy = false;
      _load = null;
      if (_dirty) {
        storageError = 'Secure sign-in recovery needs a storage retry.';
      }
      if (identity != null && !loaded && !_dirty) unawaited(load());
    }
    // HostController notifies loading only when it starts a new safe read;
    // coalesced refresh callers share that read and do not advance this order.
    if (host.loading && !_readingStatus) _statusReadsStarted++;
    if (!host.loading && _readingStatus && host.fresh) {
      _statusReadSettled = _statusReadsStarted;
    }
    _readingStatus = host.loading;
    _reconcile();
    _syncPolling();
    _notify();
  }

  void _reconcile() {
    final freshAccount =
        live &&
        host.fresh &&
        !host.loading &&
        _statusReadSettled > _flowReadBarrier;
    if (pending?.expired(now()) == true ||
        (freshAccount && host.snapshot?.status == 'expired') ||
        (freshAccount &&
            host.snapshot?.authenticated == true &&
            host.snapshot?.tokenReady == true)) {
      final expired =
          pending?.expired(now()) == true || host.snapshot?.status == 'expired';
      if (pending != null || callback != null) {
        pending = null;
        callback = null;
        _callbackAttempted = false;
        if (expired) error = 'ChatGPT sign-in expired. Start a new sign-in.';
        unawaited(_save());
      }
    } else if (callback?.expired(now()) == true) {
      callback = null;
      _callbackAttempted = false;
      error =
          'The sign-in return expired. Finish sign-in on your paired device.';
      unawaited(_save());
    }
  }

  void _syncPolling() {
    final shouldPoll =
        !_disposed &&
        allowed &&
        live &&
        loaded &&
        pending != null &&
        !pending!.expired(now()) &&
        !remoteUnconfirmed;
    if (!shouldPoll) {
      _timer?.cancel();
      _timer = null;
    } else {
      _timer ??= Timer.periodic(
        const Duration(seconds: 3),
        (_) => unawaited(poll()),
      );
    }
  }

  Future<void> poll() async {
    _reconcile();
    if (_disposed ||
        !allowed ||
        !live ||
        pending == null ||
        pending!.expired(now())) {
      _syncPolling();
      return;
    }
    await host.refresh();
    _reconcile();
    _syncPolling();
  }

  Future<void> checkStatus() async {
    if (!allowed || !live || busy) return;
    final target = identity, epoch = _epoch, readBarrier = _statusReadsStarted;
    await host.refresh();
    if (!_current(epoch, target) ||
        !host.fresh ||
        _statusReadSettled <= readBarrier) {
      return;
    }
    if (uncertainStart && host.snapshot?.toJson()['loginInFlight'] == false) {
      uncertainStart = false;
      await _save();
    }
    if (remoteUnconfirmed &&
        host.snapshot?.toJson()['loginInFlight'] == false &&
        {
          'not_logged_in',
          'authenticated',
          'expired',
        }.contains(host.snapshot?.status)) {
      remoteUnconfirmed = false;
      error = host.snapshot?.authenticated == true
          ? 'Fresh paired status still shows ChatGPT signed in. Confirm sign-out again if needed.'
          : 'Fresh paired status confirms ChatGPT is signed out.';
      await _save();
    }
    _reconcile();
    _notify();
  }

  bool _ack(RemoteJson result) => result['success'] != false;
  String _safeError(Object failure, {bool completion = false}) {
    if (failure is RemoteRpcException &&
        (failure.code == -32601 ||
            (failure.data is Map &&
                ((failure.data as Map)['errorCode']?.toString().startsWith(
                          'unsupported_',
                        ) ==
                        true ||
                    (failure.data as Map)['errorCode'] == 'unknown_method')))) {
      return completion
          ? 'This runtime cannot accept the sign-in return. Finish sign-in on your paired device.'
          : 'This paired host does not support this sign-in action.';
    }
    return completion
        ? 'The sign-in result is unknown. Check paired status before explicitly retrying the return.'
        : 'The sign-in result is unknown. Check your paired device before trying again.';
  }

  Future<bool> openOnHost() async {
    _reconcile();
    if (!canOpen) return false;
    final target = identity, epoch = ++_epoch;
    _load = null;
    busy = true;
    error = null;
    _notify();
    try {
      if (pending == null) {
        // A persisted intent prevents a lost start acknowledgement from creating
        // another flow after a cold restart.
        uncertainStart = true;
        if (!await _save() || !_current(epoch, target)) return false;
        final raw = await host.transport.request('account/login/start', {
          'type': 'chatgpt',
        });
        if (!_current(epoch, target) || !allowed || !live) return false;
        _flowReadBarrier = _statusReadsStarted;
        pending = PendingLogin.decode(
          raw,
          now: now(),
          allowLocal: store.allowLocal,
        );
        uncertainStart = false;
        if (!await _save() || !_current(epoch, target)) return false;
      }
      if (pending!.expired(now())) {
        _reconcile();
        return false;
      }
      safeLoginUrl(pending!.authUrl, allowLocal: store.allowLocal);
      final response = await host.transport.request('account/login/openOnMac', {
        'authUrl': pending!.authUrl,
      });
      if (!_current(epoch, target)) return false;
      if (!_ack(response)) {
        throw const FormatException('Unconfirmed sign-in action');
      }
      return true;
    } catch (failure) {
      if (_current(epoch, target)) {
        if (uncertainStart) _flowReadBarrier = _statusReadsStarted;
        error = _safeError(failure);
        await _save();
      }
      return false;
    } finally {
      if (_current(epoch, target)) {
        busy = false;
        _syncPolling();
        _notify();
      }
    }
  }

  Future<bool> receiveCallback(
    Uri uri, {
    required LoginIdentity identity,
    DateTime? receivedAt,
  }) async {
    if (pairedLoginCallback(uri) == null ||
        this.identity != identity ||
        _disposed) {
      return false;
    }
    final epoch = _epoch;
    if (!loaded) await load();
    if (!_current(epoch, identity) || !loaded || storageError != null) {
      return false;
    }
    _reconcile();
    final active = pending;
    if (active == null) return false;
    final supplied = [
      ...?uri.queryParametersAll['loginId'],
      ...?uri.queryParametersAll['login_id'],
    ];
    if (supplied.any((id) => id != active.loginId)) return false;
    // Keep the first return for this flow. Duplicate OS deliveries must never
    // reset the attempt marker and replay an uncertain completion.
    if (callback != null) return callback!.loginId == active.loginId;
    if (_callbackAttempted) return false;
    final incoming = LoginCallback(
      active.loginId,
      uri.toString(),
      receivedAt ?? now(),
    );
    if (incoming.expired(now())) return false;
    callback = incoming;
    _callbackAttempted = false;
    if (!await _save() || !_current(epoch, identity)) return false;
    if (allowed && live) await retryCallback();
    _notify();
    return true;
  }

  Future<bool> retryCallback() async {
    _reconcile();
    if (!allowed ||
        !live ||
        busy ||
        !loaded ||
        storageError != null ||
        callback == null ||
        pending == null) {
      return false;
    }
    final target = identity, epoch = _epoch, id = pending!.loginId;
    final readBarrier = _statusReadsStarted;
    busy = true;
    error = null;
    _notify();
    try {
      // The safe status has no remote login ID. The unchanged secure local ID
      // plus loginInFlight permits this explicit retry; runtime validates ID/state.
      await host.refresh();
      if (!_current(epoch, target)) return false;
      _reconcile();
      if (!allowed ||
          !host.fresh ||
          _statusReadSettled <= readBarrier ||
          pending?.loginId != id ||
          callback?.loginId != id ||
          host.snapshot?.loginInFlight != true) {
        if (pending != null) {
          error =
              'Check sign-in on your paired device before retrying this return.';
        }
        return false;
      }
      _callbackAttempted = true;
      if (!await _save() || !_current(epoch, target)) return false;
      final response = await host.transport.request('account/login/complete', {
        'loginId': id,
        'callbackUrl': callback!.url,
      });
      if (!_current(epoch, target)) return false;
      if (!_ack(response)) {
        throw const FormatException('Unconfirmed sign-in return');
      }
      callback = null;
      // Keep the consumed marker until this pending flow ends, including across
      // cold restore, so duplicate OS returns cannot complete it twice.
      await _save();
      return true;
    } catch (failure) {
      if (_current(epoch, target)) {
        error = _safeError(failure, completion: true);
      }
      return false;
    } finally {
      if (_current(epoch, target)) {
        busy = false;
        _syncPolling();
        _notify();
      }
    }
  }

  Future<void> handleEvent(
    String method,
    RemoteJson params, {
    bool refreshStatus = true,
  }) async {
    if (!allowed || !live || !loaded) return;
    if (method == 'account/updated') {
      await host.refresh();
      return;
    }
    final id = params['loginId'] ?? params['login_id'];
    if (method != 'account/login/completed' ||
        id is! String ||
        id != pending?.loginId ||
        !_completed.add(id)) {
      return;
    }
    _epoch++;
    busy = false;
    callback = null;
    _callbackAttempted = params['success'] == true;
    if (params['success'] != true) {
      pending = null;
      error = 'ChatGPT sign-in did not complete. Try signing in again.';
    } else {
      error = null;
    }
    await _save();
    _syncPolling();
    if (params['success'] == true && refreshStatus) await host.refresh();
    _notify();
  }

  Future<void> cancel() async {
    if (busy || identity == null || !loaded) return;
    final target = identity, id = pending?.loginId, epoch = ++_epoch;
    pending = null;
    callback = null;
    _callbackAttempted = false;
    _syncPolling();
    error = null;
    // An unknown start has no login ID to cancel. Keep its guard until a fresh
    // safe status explicitly reports no login in flight.
    await _save();
    if (!_current(epoch, target)) return;
    if (live && allowed && id != null) {
      busy = true;
      _notify();
      try {
        final result = await host.transport.request('account/login/cancel', {
          'loginId': id,
        });
        if (!_ack(result)) {
          throw const FormatException('Unconfirmed cancellation');
        }
      } catch (failure) {
        if (_current(epoch, target)) error = _safeError(failure);
      } finally {
        if (_current(epoch, target)) busy = false;
      }
    }
    _notify();
  }

  Future<bool> logout() async {
    if (busy || identity == null || !loaded || remoteUnconfirmed) return false;
    final target = identity, epoch = ++_epoch;
    pending = null;
    callback = null;
    uncertainStart = false;
    _callbackAttempted = false;
    remoteUnconfirmed = true;
    error = 'ChatGPT sign-out is not confirmed on the paired device.';
    busy = true;
    _syncPolling();
    _notify();
    try {
      if (!await _save() || !_current(epoch, target) || !live || !allowed) {
        return false;
      }
      final response = await host.transport.request('account/logout', {});
      if (!_current(epoch, target)) return false;
      if (!_ack(response)) return false;
      remoteUnconfirmed = false;
      error = 'The paired host acknowledged ChatGPT sign-out.';
      await _save();
      return true;
    } catch (_) {
      return false;
    } finally {
      if (_current(epoch, target)) {
        busy = false;
        _notify();
      }
    }
  }

  Future<void> forget(LoginIdentity target) async {
    if (identity == target) bind(null);
    await store.forget(target);
  }

  @override
  void dispose() {
    _disposed = true;
    _epoch++;
    _timer?.cancel();
    host.removeListener(_hostChanged);
    super.dispose();
  }
}
