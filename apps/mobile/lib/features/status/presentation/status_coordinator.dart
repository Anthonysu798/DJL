import 'dart:async';
import 'dart:convert';
import 'package:uuid/uuid.dart';
import '../data/status_surface.dart';
import '../domain/run_status.dart';

/// Serializes native writes; host/privacy changes insert an end barrier before
/// any replacement. Epochs and random instance IDs carry no private identity.
class StatusCoordinator {
  StatusCoordinator(this.projector, this.surface) {
    projector.addListener(_changed);
    _changed();
  }
  final RunStatusProjector projector;
  final StatusSurface surface;
  StatusAvailability availability = StatusAvailability.unknown;
  bool _settingsReady = false, _lockEnabled = true, _disposed = false;
  bool _detailed = false, _mustEnd = true;
  bool _mayHavePublished = false;
  String? _scope, _lastPayload;
  String _instance = const Uuid().v4();
  int _epoch = 0;
  Timer? _debounce, _deadline;
  Future<void> _tail = Future.value();
  Future<void> get done => _tail;

  void configure({required bool settingsReady, required bool lockEnabled}) {
    _settingsReady = settingsReady;
    _lockEnabled = lockEnabled;
    _changed();
  }

  void _changed() {
    if (_disposed) return;
    final detail = _settingsReady && !_lockEnabled;
    final boundary = detail != _detailed || _scope != projector.scope;
    if (boundary) {
      _deadline?.cancel();
      _epoch++;
      _scope = projector.scope;
      _detailed = detail;
      _instance = const Uuid().v4();
      _mustEnd = true;
      _lastPayload = null;
    }
    _debounce?.cancel();
    if (boundary || _mustEnd) {
      unawaited(flush());
    } else {
      _debounce = Timer(
        const Duration(milliseconds: 350),
        () => unawaited(flush()),
      );
    }
  }

  /// Only an explicit permission action or return from its system settings calls
  /// this. Project at execution time using the latest host/privacy context.
  Future<void> retryAvailability() {
    if (_disposed) return Future.value();
    _epoch++;
    _instance = const Uuid().v4();
    _mustEnd = true;
    _lastPayload = null;
    availability = StatusAvailability.unknown;
    return flush();
  }

  Future<void> flush() {
    _debounce?.cancel();
    final epoch = _epoch;
    return _tail = _tail.then((_) async {
      if (epoch != _epoch ||
          _disposed ||
          availability == StatusAvailability.unavailable &&
              !(_mustEnd && _mayHavePublished)) {
        return;
      }
      final identity = <String, Object?>{
        'schemaVersion': 1,
        'epoch': epoch,
        'instance': _instance,
      };
      try {
        if (_mustEnd) {
          final available = await surface.end(identity);
          _mayHavePublished = false;
          if (epoch != _epoch || _disposed) return;
          _mustEnd = false;
          availability = available
              ? StatusAvailability.available
              : StatusAvailability.unavailable;
          if (!available) return;
        }
        final snapshot = projector.project();
        _deadline?.cancel();
        final deadline = snapshot.nextDeadline;
        if (deadline != null) {
          final delay = deadline.difference(projector.now());
          _deadline = Timer(
            delay.isNegative ? Duration.zero : delay,
            () => unawaited(flush()),
          );
        }
        final payload = {
          ...identity,
          ...snapshot.toPayload(detailed: _detailed),
        };
        final encoded = jsonEncode(payload);
        if (encoded == _lastPayload) return;
        if (snapshot.rows.isEmpty) {
          final available = await surface.end(identity);
          _mayHavePublished = false;
          if (epoch == _epoch && !_disposed) {
            availability = available
                ? StatusAvailability.available
                : StatusAvailability.unavailable;
            _lastPayload = encoded;
          }
        } else {
          _mayHavePublished = true;
          final available = await surface.update(payload);
          if (epoch == _epoch && !_disposed) {
            availability = available
                ? StatusAvailability.available
                : StatusAvailability.unavailable;
            _lastPayload = encoded;
          }
        }
      } catch (_) {
        // A local OS surface never changes chat/task success or retries the socket.
        if (epoch == _epoch && !_disposed) {
          availability = StatusAvailability.unavailable;
        }
      }
    });
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _epoch++;
    _debounce?.cancel();
    _deadline?.cancel();
    projector.removeListener(_changed);
    final payload = <String, Object?>{
      'schemaVersion': 1,
      'epoch': _epoch,
      'instance': _instance,
    };
    _tail = _tail.then((_) async {
      if (availability == StatusAvailability.unavailable &&
          !_mayHavePublished) {
        return;
      }
      try {
        await surface.end(payload);
      } catch (_) {
        /* Best effort removal. */
      }
    });
  }
}
