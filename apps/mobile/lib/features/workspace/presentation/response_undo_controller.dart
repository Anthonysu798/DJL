import 'dart:async';
import 'package:flutter/foundation.dart';
import '../data/workspace_repository.dart';
import '../domain/response_change_set.dart';

/// A sheet owns one frozen patch and one connection. No mutation is retried here.
class ResponseUndoController extends ChangeNotifier {
  ResponseUndoController(
    this.repository,
    this.entry, {
    required this.isCurrent,
    required this.blocked,
    required this.onChanged,
    required this.onSuccess,
    this.verifyRepository,
  }) : _reviewRevision = entry.reviewRevision,
       _hash = entry.hash,
       _batch = entry.aggregate == null,
       _patches = List.unmodifiable(entry.patches);
  final WorkspaceRepository repository;
  final ResponseChangeSet entry;
  final bool Function() isCurrent;
  final String? Function() blocked;
  final FutureOr<void> Function() onChanged;
  final Future<bool> Function()? verifyRepository;
  final Future<void> Function() onSuccess;
  final String _hash;
  int _reviewRevision;
  final bool _batch;
  final List<ResponsePatch> _patches;
  bool loading = false, applying = false, _disposed = false;
  String? error;
  ResponseUndoPreview? preview;
  bool get current =>
      !_disposed &&
      isCurrent() &&
      entry.hash == _hash &&
      entry.reviewRevision == _reviewRevision &&
      entry.ready;
  bool get canApply =>
      current &&
      blocked() == null &&
      preview?.allowed == true &&
      !loading &&
      !applying &&
      !entry.applying;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  Future<void> refresh() async {
    if (loading || applying) return;
    preview = null;
    error = null;
    if (!current || blocked() != null) {
      error =
          blocked() ??
          'The response or connection changed. Reopen this review.';
      _notify();
      return;
    }
    loading = true;
    _notify();
    try {
      final result = _batch
          ? await repository.revertPatchBatchPreview(_patches)
          : await repository.revertPatchPreview(_patches.single.forwardPatch);
      if (current && blocked() == null) {
        preview = result;
      } else {
        error = 'The response or connection changed. Reopen this review.';
      }
    } catch (_) {
      if (!_disposed) {
        error =
            'Could not preview the exact patch. Refresh the review before trying again.';
      }
    } finally {
      loading = false;
      _notify();
    }
  }

  Future<void> apply() async {
    if (!canApply) return;
    applying = true;
    entry.applying = true;
    _reviewRevision = ++entry.reviewRevision;
    error = null;
    // Persist uncertainty before sending: process death must not imply no mutation.
    entry.uncertain = true;
    _notify();
    try {
      await onChanged();
      if (!current ||
          blocked() != null ||
          verifyRepository != null && !await verifyRepository!()) {
        error = 'The response or repository changed. Reopen this review.';
        return;
      }
      if (!current || blocked() != null) {
        error = 'The response or connection changed. Reopen this review.';
        return;
      }

      final result = _batch
          ? await repository.revertPatchBatchApply(_patches)
          : await repository.revertPatchApply(_patches.single.forwardPatch);
      if (!current || blocked() != null) {
        error =
            'The connection or response changed. The undo result is unknown; refresh and review it.';
        return;
      }
      if (result.success) {
        entry.reverted = true;
        entry.uncertain = false;
        entry.lastError = null;
        await onChanged();
        await onSuccess();
      } else {
        entry.uncertain = !result.definite;
        error = result.definite
            ? 'The desktop did not undo the response. Review the current conflicts and staged files.'
            : 'The undo result is unknown. Refresh and review the exact patch before another attempt.';
        final details = result.details;
        if (details.staged.isNotEmpty ||
            details.conflicts.isNotEmpty ||
            details.reasons.isNotEmpty) {
          error =
              '$error ${[...details.staged, ...details.conflicts, ...details.reasons].join('; ')}';
        }
      }
    } catch (_) {
      error = entry.reverted
          ? 'Undo succeeded, but saving or refreshing its local result failed. Reconnect to verify the files.'
          : 'The undo result is unknown. Refresh and review the exact patch before another attempt.';
    } finally {
      preview = null;
      applying = false;
      entry.applying = false;
      if (!entry.reverted) {
        entry.lastError = error;
        try {
          await onChanged();
        } catch (_) {
          error =
              'Could not save the undo result. Reconnect and review the current files.';
        }
      }
      _notify();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
