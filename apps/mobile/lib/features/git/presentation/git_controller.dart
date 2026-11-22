import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../../pairing/data/pairing_repository.dart';
import '../data/git_repository.dart';
import '../domain/git_models.dart';
import '../../../l10n/l10n.dart';

class GitController extends ChangeNotifier {
  GitController(this.repository) {
    _events = repository.transport.messages.listen(_progress);
  }
  final GitRepository repository;
  StreamSubscription<RemoteJson>? _events;
  GitStatus? status;
  RemoteJson branches = {};
  String? error, notice, patch, phase, _progressId;
  bool loading = false, busy = false, _disposed = false;
  RemoteJson? result;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> refresh() async {
    if (loading) return;
    loading = true;
    error = null;
    _notify();
    try {
      final current = await repository.status();
      if (_disposed) return;
      status = current;
      branches = current.isRepo ? await repository.branches() : {};
    } catch (e) {
      if (!_disposed) error = e.toString();
    } finally {
      if (!_disposed) {
        loading = false;
        _notify();
      }
    }
  }

  Future<void> loadDiff() async {
    loading = true;
    error = null;
    patch = null;
    _notify();
    try {
      final value = await repository.diff();
      if (!_disposed) patch = value;
    } catch (e) {
      if (!_disposed) error = e.toString();
    } finally {
      if (!_disposed) {
        loading = false;
        _notify();
      }
    }
  }

  Future<RemoteJson?> perform(Future<RemoteJson> Function() operation) async {
    if (busy) return null;
    busy = true;
    error = null;
    notice = null;
    phase = null;
    _notify();
    try {
      final value = await operation();
      if (_disposed) return null;
      result = value;
      notice =
          value['summary'] as String? ??
          value['message'] as String? ??
          appStrings.gitActionCompleted;
      await refresh();
      return value;
    } catch (e) {
      if (!_disposed) {
        error = appStrings.gitActionFailed('$e');
      }
      return null;
    } finally {
      if (!_disposed) {
        busy = false;
        _notify();
      }
    }
  }

  Future<RemoteJson?> stacked(
    String action, {
    String? message,
    String? model,
    String? base,
    bool featureBranch = false,
  }) async {
    _progressId = const Uuid().v4();
    try {
      return await perform(
        () => repository.stackedAction(
          action,
          message: message,
          model: model,
          base: base,
          featureBranch: featureBranch,
          progressId: _progressId,
        ),
      );
    } finally {
      _progressId = null;
    }
  }

  void _progress(RemoteJson rpc) {
    if (rpc['method'] != 'git/stackedAction/progress' || _disposed) return;
    final p = rpc['params'];
    if (p is Map && p['progressId'] == _progressId) {
      phase = '${p['phase'] ?? ''} · ${p['status'] ?? ''}';
      _notify();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    unawaited(_events?.cancel());
    super.dispose();
  }
}
