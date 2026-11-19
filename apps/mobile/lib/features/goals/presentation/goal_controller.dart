import 'dart:async';
import 'package:flutter/foundation.dart';
import '../../pairing/data/pairing_repository.dart';
import '../data/goal_repository.dart';
import '../domain/thread_goal.dart';

class GoalController extends ChangeNotifier {
  GoalController(
    this.repository, {
    this.goal,
    this.onChange,
    this.onUnsupported,
    bool Function()? isRunning,
    bool Function()? isReady,
  }) : _mac = repository.macDeviceId,
       _isReady = isReady {
    _events = repository.transport.messages.listen(_incoming);
    if (isRunning != null) {
      _timer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (isRunning() && goal?.status == GoalStatus.active) {
          _notify();
        }
      });
    }
  }
  final GoalRepository repository;
  final String? _mac;
  final bool Function()? _isReady;
  bool _wasReady = false;
  final ValueChanged<ThreadGoal?>? onChange;
  final VoidCallback? onUnsupported;
  late final StreamSubscription<RemoteJson> _events;
  Timer? _timer;
  ThreadGoal? goal;
  bool busy = false, supported = true, _disposed = false;
  String? error;
  int _revision = 0;
  DateTime _observedAt = DateTime.now();
  bool get connected =>
      repository.transport.connected &&
      repository.transport.macDeviceId == _mac &&
      (_isReady?.call() ?? true);
  void connectionChanged() {
    final ready = connected;
    if (ready && !_wasReady) {
      _wasReady = true;
      unawaited(refresh());
    } else {
      _wasReady = ready;
    }
    _notify();
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  String elapsed({required bool running}) => ThreadGoal.formatElapsed(
    (goal?.timeUsedSeconds ?? 0) +
        (running && goal?.status == GoalStatus.active
            ? DateTime.now().difference(_observedAt).inSeconds
            : 0),
  );
  void _apply(ThreadGoal? value, {bool report = true}) {
    if (value != null && goal != null && value.updatedAt < goal!.updatedAt) {
      return;
    }
    goal = value;
    _observedAt = DateTime.now();
    if (report) {
      onChange?.call(value);
    }
    _notify();
  }

  Future<bool> _operation(Future<ThreadGoal?> Function() action) async {
    if (busy || _disposed) {
      return false;
    }
    if (!connected) {
      error = 'Reconnect to your desktop to manage this goal.';
      _notify();
      return false;
    }
    final revision = ++_revision;
    busy = true;
    error = null;
    _notify();
    try {
      final result = await action();
      if (_disposed || !connected) {
        return false;
      }
      supported = true;
      if (revision == _revision) {
        _apply(result);
      }
      return true;
    } catch (e) {
      if (!_disposed && connected) {
        error = e.toString();
        if (e is GoalsUnsupported) {
          supported = false;
          onUnsupported?.call();
        }
      }
      return false;
    } finally {
      busy = false;
      _notify();
    }
  }

  Future<bool> refresh() => _operation(repository.get);
  Future<bool> save(
    String objective, {
    required bool startNew,
    GoalBudgetUpdate budget = const GoalBudgetUpdate.keep(),
  }) {
    final text = objective.trim();
    if (text.isEmpty) {
      error = 'Describe the goal first.';
      _notify();
      return Future.value(false);
    }
    return _operation(
      () => repository.set(
        objective: text,
        status: startNew ? GoalStatus.active : null,
        budget: budget,
      ),
    );
  }

  Future<bool> pause() => goal?.status == GoalStatus.active
      ? _operation(() => repository.set(status: GoalStatus.paused))
      : Future.value(false);
  Future<bool> resume() => goal?.status.isResumable == true
      ? _operation(() => repository.set(status: GoalStatus.active))
      : Future.value(false);
  Future<bool> clear() => _operation(() async {
    await repository.clear();
    return null;
  });
  void _incoming(RemoteJson rpc) {
    if (!connected || rpc['params'] is! Map) {
      return;
    }
    final p = rpc['params'] as Map;
    if (rpc['method'] == 'thread/goal/updated' && p['goal'] is Map) {
      try {
        final next = ThreadGoal.fromJson(
          Map<String, dynamic>.from(p['goal'] as Map),
        );
        if (next.threadId == repository.threadId) {
          _revision++;
          _apply(next, report: false);
        }
      } catch (_) {}
    } else if (rpc['method'] == 'thread/goal/cleared' &&
        (p['threadId'] ?? p['thread_id']) == repository.threadId) {
      _revision++;
      _apply(null, report: false);
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _revision++;
    _timer?.cancel();
    unawaited(_events.cancel());
    super.dispose();
  }
}
