import 'package:flutter/foundation.dart';
import '../data/workspace_repository.dart';
import '../domain/workspace_models.dart';
import '../../../l10n/l10n.dart';

class CheckpointController extends ChangeNotifier {
  CheckpointController(this.repository);
  final WorkspaceRepository repository;
  bool loading = false, _disposed = false;
  String? error, diff, status;
  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  Future<void> loadDiff(String turnId) async {
    if (loading) {
      return;
    }
    loading = true;
    error = null;
    diff = null;
    status = null;
    _notify();
    try {
      diff = await repository.checkpointDiff(turnId);
    } catch (e) {
      error = e.toString();
    } finally {
      loading = false;
      _notify();
    }
  }

  Future<CheckpointPreview?> preview(String turnId) async {
    if (loading) {
      return null;
    }
    loading = true;
    error = null;
    status = null;
    _notify();
    try {
      return await repository.previewRestore(turnId);
    } catch (e) {
      error = e.toString();
      return null;
    } finally {
      loading = false;
      _notify();
    }
  }

  Future<void> restore(CheckpointConfirmation confirmation) async {
    if (loading) {
      return;
    }
    loading = true;
    error = null;
    status = null;
    _notify();
    try {
      final result = await repository.restore(confirmation);
      if (result['success'] != true) {
        throw StateError(appStrings.workspaceRestoreFailed);
      }
      final count = (result['restoredFiles'] as List? ?? []).length;
      status =
          '${appStrings.workspaceRestoredFiles(count)}${result['backupCheckpointRef'] != null ? appStrings.workspaceBackupSaved : ''}';
    } catch (e) {
      error = e.toString();
    } finally {
      loading = false;
      _notify();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
