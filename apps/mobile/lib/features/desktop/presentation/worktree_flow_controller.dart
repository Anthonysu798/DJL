import 'dart:async';
import 'package:flutter/foundation.dart';
import '../../git/data/git_repository.dart';
import '../../git/domain/git_creation_review.dart';
import '../../git/domain/git_models.dart';
import '../../pairing/data/pairing_repository.dart';
import '../data/remote_transport.dart';
import '../domain/desktop_overview.dart';
import '../domain/desktop_worktree_routing.dart';
import 'desktop_controller.dart';
import '../../../l10n/l10n.dart';

enum WorktreeFlowMode { handoff, fork }

class WorktreeFlowController extends ChangeNotifier {
  WorktreeFlowController(
    this.desktop, {
    required this.mode,
    bool Function()? isCurrent,
  }) : _callerCurrent = isCurrent {
    final thread = desktop.thread;
    final path = desktopConversationPath(thread?['cwd']);
    if (thread?['id'] is! String || path == null) {
      throw StateError('A saved project chat is required.');
    }
    _sourceId = thread!['id'] as String;
    _sourcePath = path;
    _mac = desktop.active?.macDeviceId;
    _pin = desktop.active?.publicKey;
    _session = desktop.transport.sessionId;
    _connection = desktop.transport.connectionRevision;
    _cache = desktop.threadList.data;
    _navigation = desktop.navigationRevision;
    _selection = desktop.selectionRevision;
    _repository = GitRepository(
      desktop.transport,
      cwd: path,
      isCurrent: () => this.isCurrent,
    );
    desktop.addListener(_desktopChanged);
  }

  final DesktopController desktop;
  final WorktreeFlowMode mode;
  final bool Function()? _callerCurrent;
  late final String _sourceId, _sourcePath;
  late final String? _mac, _pin, _session;
  late final int _connection, _navigation, _selection;
  late final Object _cache;
  late final GitRepository _repository;
  bool _disposed = false,
      _invalidated = false,
      _resuming = false,
      _forking = false;
  String? _target;
  bool loading = false, submitting = false, completed = false;
  bool missingAssociatedWorktree = false;
  bool _mayHaveCreatedWorktree = false;
  Completer<void>? _settled;
  Object? _operationOwner;
  Future<void> get settled => _settled?.future ?? Future<void>.value();
  String? error, errorTitle, createdPath;
  GitStatus? status;
  RemoteJson branches = {};

  String get preferredBase => status?.branch?.trim().isNotEmpty == true
      ? status!.branch!.trim()
      : branches['default'] as String? ?? '';

  bool get isCurrent {
    final thread = desktop.thread;
    final selected =
        thread?['id'] == _sourceId &&
        (comparableWorktreePath(thread?['cwd']) ==
                comparableWorktreePath(_sourcePath) ||
            _resuming &&
                comparableWorktreePath(thread?['cwd']) ==
                    comparableWorktreePath(_target));
    final ownFork =
        _forking &&
        thread?['forkedFromThreadId'] == _sourceId &&
        comparableWorktreePath(thread?['cwd']) ==
            comparableWorktreePath(_target);
    return !_disposed &&
        !_invalidated &&
        !completed &&
        _callerCurrent?.call() != false &&
        desktop.connected &&
        desktop.state == 'connected' &&
        _mac != null &&
        _pin?.isNotEmpty == true &&
        desktop.active?.macDeviceId == _mac &&
        desktop.active?.publicKey == _pin &&
        desktop.trusted.any(
          (p) => p.macDeviceId == _mac && p.publicKey == _pin,
        ) &&
        desktop.transport.macDeviceId == _mac &&
        desktop.transport.sessionId == _session &&
        desktop.transport.connectionRevision == _connection &&
        desktop.threadList.macDeviceId == _mac &&
        identical(desktop.threadList.data, _cache) &&
        desktop.navigationRevision == _navigation &&
        desktop.selectionRevision == _selection &&
        desktop.turnId == null &&
        (!desktop.busy || _resuming || _forking) &&
        (selected || ownFork);
  }

  void _desktopChanged() {
    if (_disposed || completed) return;
    if (!isCurrent) _invalidated = true;
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _check() {
    if (!isCurrent) {
      throw StateError(appStrings.desktopWorktreeStale);
    }
  }

  void _beginSubmission() {
    _settled = Completer<void>();
    submitting = true;
    error = errorTitle = createdPath = null;
    missingAssociatedWorktree = _mayHaveCreatedWorktree = false;
    _notify();
  }

  void _endSubmission() {
    submitting = false;
    _resuming = _forking = false;
    final owner = _operationOwner;
    _operationOwner = null;
    if (owner != null) desktop.releaseProjectMove(owner);
    _notify();
    _settled?.complete();
  }

  void _reserve() {
    _check();
    _operationOwner ??= desktop.reserveProjectMove();
  }

  Future<void> _metadata() async {
    _check();
    final fresh = await _repository.status();
    if (!fresh.isRepo) {
      throw StateError(appStrings.desktopNotGitRepository);
    }
    final targets = await _repository.branches();
    _check();
    status = fresh;
    branches = targets;
  }

  Future<void> prepare() async {
    if (loading || submitting || completed) return;
    loading = true;
    error = null;
    _notify();
    try {
      await _metadata();
    } catch (e) {
      error = e.toString();
    } finally {
      loading = false;
      _notify();
    }
  }

  Future<bool> submit({
    required String name,
    required String base,
    required Future<bool> Function(GitCreationReview) review,
  }) async {
    if (submitting || loading || completed) return false;
    final branch = normalizedGitCreatedBranchName(name), baseName = base.trim();
    if (branch.isEmpty || branch == 'djl/' || baseName.isEmpty) return false;
    _beginSubmission();
    try {
      await _metadata();
      final preflight = gitWorktreeCreationReview(
        status!,
        defaultBranch: branches['default'] as String? ?? '',
        name: branch,
        base: baseName,
        transfer: 'none',
      );
      if (preflight != null) {
        final accepted = await review(preflight);
        if (!accepted || preflight.acceptLabel == null) return false;
      }
      _check();
      _reserve();
      _mayHaveCreatedWorktree = true;
      final result = await _repository.createWorktree(branch, baseName, 'none');
      final target = desktopConversationPath(result['worktreePath']);
      if (result['alreadyExisted'] != true) createdPath = target;
      _check();
      if (result['alreadyExisted'] == true) {
        _mayHaveCreatedWorktree = false;
        errorTitle = appStrings.desktopBranchAlreadyExists;
        throw StateError(
          appStrings.desktopWorktreeExists('${result['branch'] ?? branch}'),
        );
      }
      if (target == null ||
          comparableWorktreePath(target) ==
              comparableWorktreePath(_sourcePath)) {
        throw StateError(appStrings.desktopWorktreeUnidentified);
      }
      _target = target;
      if (mode == WorktreeFlowMode.handoff) {
        await _handoff(target);
      } else {
        _forking = true;
        if (!await desktop.forkThread(
          cwd: target,
          operationOwner: _operationOwner,
          isCurrent: () => isCurrent,
        )) {
          throw StateError(desktop.error ?? appStrings.desktopForkUnverified);
        }
        _check();
      }
      completed = true;
      return true;
    } catch (e) {
      _recordFailure(e);
      return false;
    } finally {
      _endSubmission();
    }
  }

  Future<void> _handoff(String target) async {
    _reserve();
    _target = target;
    final transfer = await _repository.transfer(target);
    _check();
    if (transfer['success'] != true ||
        transfer['targetPath'] != null &&
            comparableWorktreePath(transfer['targetPath']) !=
                comparableWorktreePath(target)) {
      throw StateError(appStrings.desktopHandoffUnverified);
    }
    final transferred = transfer['transferredChanges'] == true;
    _resuming = true;
    try {
      await desktop.moveThreadToProjectPath(
        target,
        isCurrent: () => isCurrent,
        operationOwner: _operationOwner,
      );
      _check();
    } catch (e) {
      _resuming = false;
      // A transport/invalid reply may have already rebound the runtime. Keep the
      // files in place; only an explicit rejection can safely reverse the move.
      if (e is RemoteRpcException && transferred && isCurrent) {
        try {
          await GitRepository(
            desktop.transport,
            cwd: target,
            isCurrent: () => isCurrent,
          ).transfer(_sourcePath);
        } catch (rollback) {
          throw StateError(
            '$e\n\n${appStrings.desktopRollbackFailed(rollback.toString())}',
          );
        }
      }
      rethrow;
    }
  }

  Future<bool> handoffAssociated(String path) async {
    if (submitting || loading || completed) return false;
    _beginSubmission();
    try {
      _check();
      final target = desktopConversationPath(path);
      if (target == null) {
        throw StateError(appStrings.desktopWorktreePathUnavailable);
      }
      await _handoff(target);
      completed = true;
      return true;
    } catch (e) {
      if (isCurrent &&
          e is RemoteRpcException &&
          e.data is Map &&
          (e.data as Map)['errorCode'] == 'missing_handoff_target' &&
          comparableWorktreePath(
                desktop.threadList.data.associatedWorktreePaths[_sourceId],
              ) ==
              comparableWorktreePath(path)) {
        desktop.threadList.data.associatedWorktreePaths.remove(_sourceId);
        desktop.threadList.scheduleSave();
        missingAssociatedWorktree = true;
      }
      _recordFailure(e);
      return false;
    } finally {
      _endSubmission();
    }
  }

  Future<bool> handoffToLocal() async {
    if (submitting || loading || completed) return false;
    _beginSubmission();
    try {
      await _metadata();
      final local = desktopConversationPath(branches['localCheckoutPath']);
      if (local == null) {
        throw StateError(appStrings.desktopLocalCheckoutUnresolved);
      }
      await _handoff(local);
      completed = true;
      return true;
    } catch (e) {
      _recordFailure(e);
      return false;
    } finally {
      _endSubmission();
    }
  }

  void _recordFailure(Object failure) {
    errorTitle ??= mode == WorktreeFlowMode.handoff
        ? appStrings.desktopWorktreeHandoffFailed
        : appStrings.desktopWorktreeForkFailed;
    final detail = createdPath != null
        ? '\n\n${appStrings.desktopWorktreeKeptAt(createdPath!)}'
        : _mayHaveCreatedWorktree
        ? '\n\n${appStrings.desktopWorktreeMayExist}'
        : '';
    error = '$failure$detail';
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    desktop.removeListener(_desktopChanged);
    super.dispose();
  }
}
