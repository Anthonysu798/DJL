import 'dart:async';
import 'package:flutter/foundation.dart';
import '../../desktop/data/remote_transport.dart' show RemoteRpcException;
import '../domain/paired_usage.dart';
import '../../../l10n/l10n.dart';

class PairedUsageController extends ChangeNotifier {
  PairedUsageController(this._read);
  final Future<Map<String, dynamic>> Function(Map<String, dynamic>?) _read;
  ({String mac, String pin})? _identity;
  ({String mac, String pin, String session, int generation})? _lease;
  final List<PairedUsageBucket> _buckets = [];
  Future<void>? _refresh;
  bool _disposed = false;
  int _updates = 0;
  int bindingRevision = 0;
  bool loading = false, resolved = false, stale = false;
  String? error;
  bool get canRead => !_disposed && _lease != null;
  List<PairedUsageBucket> get buckets => List.unmodifiable(_buckets);
  List<PairedUsageRow> get rows => PairedUsageBucket.visibleRows(_buckets);

  void bind({
    required String? mac,
    required String? pin,
    required String? session,
    required bool connected,
    int generation = 0,
  }) {
    if (_disposed) return;
    final identity =
        mac != null && mac.isNotEmpty && pin != null && pin.isNotEmpty
        ? (mac: mac, pin: pin)
        : null;
    final lease =
        connected && identity != null && session != null && session.isNotEmpty
        ? (
            mac: identity.mac,
            pin: identity.pin,
            session: session,
            generation: generation,
          )
        : null;
    if (_identity == identity && _lease == lease) return;
    if (_identity != identity) _buckets.clear();
    _identity = identity;
    _lease = lease;
    _resetRead();
    stale = _buckets.isNotEmpty;
    _notify();
  }

  void _resetRead() {
    bindingRevision++;
    _updates = 0;
    _refresh = null;
    loading = false;
    resolved = false;
    error = null;
  }

  void accountChanged() {
    if (_disposed) return;
    _buckets.clear();
    _resetRead();
    stale = false;
    _notify();
  }

  bool _current(int revision) => canRead && revision == bindingRevision;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> refreshIfNeeded() =>
      resolved || loading ? Future.value() : refresh();
  Future<void> refresh() {
    if (!canRead) return Future.value();
    if (_refresh != null) return _refresh!;
    final revision = bindingRevision, updates = _updates;
    final done = Completer<void>();
    final future = _refresh = done.future;
    loading = true;
    error = null;
    _notify();
    unawaited(() async {
      try {
        if (!_current(revision)) return;
        Map<String, dynamic> response;
        try {
          response = await _read(null);
        } on RemoteRpcException catch (e) {
          if (!_current(revision) || updates != _updates) return;
          if (!_retryWithObject(e)) rethrow;
          response = await _read({});
        }
        if (!_current(revision) || updates != _updates) return;
        if (response.length == 1 && response.containsKey('value')) {
          throw const FormatException('Missing usage payload');
        }
        _buckets
          ..clear()
          ..addAll(decodePairedUsage(response));
        resolved = true;
        stale = false;
        error = null;
      } catch (e) {
        if (_current(revision) && updates == _updates) {
          _buckets.clear();
          resolved = false;
          stale = false;
          error = e is RemoteRpcException && e.code == -32601
              ? appStrings.settingsUsageRuntimeUnavailable
              : appStrings.settingsUsageLoadFailed;
        }
      } finally {
        if (_current(revision)) {
          _refresh = null;
          loading = false;
          _notify();
        }
        done.complete();
      }
    }());
    return future;
  }

  void applyUpdate(Map<String, dynamic> payload) {
    if (!canRead) return;
    final merged = mergePairedUsage(_buckets, decodePairedUsage(payload));
    _buckets
      ..clear()
      ..addAll(merged);
    _updates++;
    resolved = true;
    stale = false;
    error = null;
    _notify();
  }

  bool _retryWithObject(RemoteRpcException e) {
    if (e.code != -32602 && e.code != -32600) return false;
    final message = e.message.toLowerCase();
    return [
      'invalid params',
      'invalid param',
      'failed to parse',
      'expected',
      'missing field `params`',
      'missing field params',
    ].any(message.contains);
  }

  @override
  void dispose() {
    _disposed = true;
    bindingRevision++;
    _identity = null;
    _lease = null;
    _buckets.clear();
    _refresh = null;
    super.dispose();
  }
}
