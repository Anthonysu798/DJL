part of 'desktop_controller.dart';

/// Undoing the file changes of one answer.
extension DesktopResponseUndo on DesktopController {
  void _noteTimelineLive(String thread, RemoteJson row) {
    if (row['id'] is String) {
      _liveTimelineRevisions[(thread, row['id'] as String)] =
          ++_timelineRevision;
    }
  }

  ResponseChangeSet? responseChangesFor(String assistant) => threadList
      .data
      .responseChanges
      .forAssistant(thread?['id'] as String? ?? '', assistant);

  bool _insideRepo(String path, String root) =>
      path == root ||
      path.startsWith('${root.replaceFirst(RegExp(r'/+$'), '')}/');

  String? responseUndoBlocked(ResponseChangeSet entry, {String? repoRoot}) {
    if (!connected ||
        active?.macDeviceId != transport.macDeviceId ||
        _requestsSuspended) {
      return 'Reconnect to your desktop before reviewing undo.';
    }
    if (!identical(threadList.data.responseChanges.entries[entry.id], entry)) {
      return 'Reopen this chat to verify the response before undoing changes.';
    }
    if (entry.unavailable != null) return entry.unavailable;
    final root = repoRoot ?? entry.repoRoot ?? entry.cwd;
    for (final row in threadList.data.snapshots) {
      final id = row['id'] as String?, cwd = row['cwd'] as String?;
      if (id == null || threadList.data.deleted.contains(id)) continue;
      final running =
          threadList.data.responseChanges.running.containsKey(id) ||
          (id == thread?['id'] && (turnId != null || busy)) ||
          {'inProgress', 'running', 'active'}.contains(row['status']) ||
          row['subagentStatus'] == 'running';
      if (running &&
          (cwd == null || _insideRepo(cwd, root) || _insideRepo(root, cwd))) {
        return 'A chat in this repository is running. Wait before undoing a response.';
      }
    }
    if ((turnId != null || busy) && thread?['id'] == entry.thread) {
      return 'Wait for the active response before undoing changes.';
    }
    return null;
  }

  bool responseUndoOverlap(ResponseChangeSet entry) =>
      threadList.data.responseChanges.entries.values.any(
        (other) =>
            other.id != entry.id &&
            !other.reverted &&
            (_insideRepo(other.cwd, entry.repoRoot ?? entry.cwd) ||
                _insideRepo(entry.cwd, other.repoRoot ?? other.cwd)) &&
            other.files.intersection(entry.files).isNotEmpty,
      );

  Future<ResponseUndoController?> responseUndo(String assistant) async {
    final entry = responseChangesFor(assistant);
    if (entry == null || responseUndoBlocked(entry) != null) return null;
    final data = threadList.data,
        generation = _connectGeneration,
        revision = _responseRunRevision;
    final device = active?.macDeviceId,
        pin = active?.publicKey,
        session = transport.sessionId;
    final selected = thread?['id'], cwd = thread?['cwd'];
    var hash = entry.hash;
    bool current() =>
        !_disposed &&
        identical(data, threadList.data) &&
        generation == _connectGeneration &&
        revision == _responseRunRevision &&
        device == active?.macDeviceId &&
        device == transport.macDeviceId &&
        pin == active?.publicKey &&
        session == transport.sessionId &&
        connected &&
        selected == thread?['id'] &&
        cwd == thread?['cwd'] &&
        entry.hash == hash &&
        identical(data.responseChanges.entries[entry.id], entry) &&
        !data.deleted.contains(entry.thread);
    try {
      final status = await transport.request('git/status', {'cwd': entry.cwd});
      final root = status['repoRoot'];
      if (!current() ||
          status['isRepo'] != true ||
          root is! String ||
          !root.startsWith('/') ||
          !_insideRepo(entry.cwd, root) ||
          responseUndoBlocked(entry, repoRoot: root) != null) {
        return null;
      }
      responseUndoGitStatus = status;
      entry.repoRoot = root;
      hash = entry.hash;
      Future<void> changed() async {
        if (identical(data, threadList.data)) {
          await threadList.saveNow();
          _notify();
          if (threadList.localError != null) {
            throw StateError('Could not persist the undo result.');
          }
        }
      }

      return ResponseUndoController(
        WorkspaceRepository(transport, cwd: entry.cwd, threadId: entry.thread),
        entry,
        isCurrent: current,
        blocked: () => responseUndoBlocked(entry, repoRoot: root),
        onChanged: changed,
        verifyRepository: () async {
          final fresh = await transport.request('git/status', {
            'cwd': entry.cwd,
          });
          return current() &&
              fresh['isRepo'] == true &&
              fresh['repoRoot'] == root &&
              responseUndoBlocked(entry, repoRoot: root) == null;
        },
        onSuccess: () async {
          // The success tombstone changes the ledger hash, so use the original connection scope here.
          if (identical(data, threadList.data) &&
              generation == _connectGeneration &&
              device == transport.macDeviceId &&
              session == transport.sessionId) {
            try {
              final fresh = await transport.request('git/status', {
                'cwd': entry.cwd,
              });
              if (identical(data, threadList.data) &&
                  generation == _connectGeneration &&
                  device == transport.macDeviceId &&
                  session == transport.sessionId) {
                responseUndoGitStatus = fresh;
              }
            } catch (_) {
              /* Undo succeeded even if metadata refresh failed. */
            }
            await changed();
          }
        },
      );
    } catch (_) {
      if (current()) {
        error =
            'Could not verify the response repository. Reconnect and review it again.';
        _notify();
      }
      return null;
    }
  }

  void _captureResponseChanges(
    String method,
    RemoteJson params,
    RemoteJson rpc,
  ) {
    if (!connected ||
        active?.macDeviceId != transport.macDeviceId ||
        !requestMatchesConnection(rpc) ||
        threadList.macDeviceId != null &&
            threadList.macDeviceId != active?.macDeviceId) {
      return;
    }
    final known = {
      ..._knownActivityThreads,
      if (thread?['id'] is String) thread!['id'] as String,
    }..removeAll(threadList.data.deleted);
    final ledger = threadList.data.responseChanges;
    final before = Map<String, String>.from(ledger.running);
    if (ledger.ingest(
      method,
      params,
      knownThreads: known,
      cwdFor: (id) =>
          (id == thread?['id'] ? thread : threadList.data.find(id))?['cwd']
              as String?,
    )) {
      if (!mapEquals(before, ledger.running) &&
          ledger.running.entries.any((e) => before[e.key] != e.value)) {
        _responseRunRevision++;
      }
      threadList.scheduleSave();
      _notify();
    }
  }

  void _bindCheckpoints(String id, TurnCheckpoints checkpoints) {
    if (!checkpoints.repository.isCurrent) return;
    _checkpointsByTurn[_checkpointKey(checkpoints.repository, id)] =
        checkpoints;
    unawaited(checkpoints.started(id));
  }
}
