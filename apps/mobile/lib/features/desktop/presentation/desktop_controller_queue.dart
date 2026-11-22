part of 'desktop_controller.dart';

/// Messages queued while an agent is busy, and steering them in.
extension DesktopQueuedDrafts on DesktopController {
  void _bindQueuedOwner() {
    final owner = (
      mac: active?.macDeviceId,
      pin: active?.data['macIdentityPublicKey'],
    );
    if (_queuedOwner != owner) {
      _queuedByThread.clear();
      _queuePausedByThread.clear();
      _queuedDelivery = null;
      _queuedSteering = null;
      _queuedOwnerEpoch++;
      _queuedOwner = owner;
    }
  }

  List<DesktopQueuedDraft> get queuedDrafts {
    _bindQueuedOwner();
    return List.unmodifiable(_queuedByThread[thread?['id']] ?? []);
  }

  String? get queuePauseMessage {
    _bindQueuedOwner();
    return _queuePausedByThread[thread?['id']];
  }

  String? get steeringQueuedDraftId {
    _bindQueuedOwner();
    return _queuedSteering?.thread == thread?['id']
        ? _queuedSteering?.id
        : null;
  }

  bool get queuedActionInProgress => _queuedDelivery != null;

  bool get canSteerQueuedDrafts =>
      _queuedCommandReady && _selectedRunBusy && turnId != null;

  bool get _queuedCommandReady =>
      !_disposed &&
      !_suspended &&
      connected &&
      state == 'connected' &&
      _responseCurrent &&
      !busy &&
      !projectMoveBusy &&
      switchingDevice == null &&
      _queuedDelivery == null &&
      _routingAllowed &&
      thread?['id'] is String;

  bool get _selectedRunBusy =>
      thread?['id'] is String &&
      (turnId != null ||
          selectedResponseFooter.suppressesLatest ||
          _runningStatus(thread?['status']));

  Future<void> resumeQueuedDrafts() => _resumeQueuedDrafts();

  Future<void> _resumeQueuedDrafts({bool waitForIdle = false}) async {
    _bindQueuedOwner();
    final id = thread?['id'];
    if (id is! String ||
        _disposed ||
        _suspended ||
        !_routingAllowed ||
        _queuedDelivery != null ||
        busy) {
      return;
    }
    if (!_queuePausedByThread.containsKey(id) || !connected) {
      _queuePausedByThread.remove(id);
      if (error?.startsWith(appStrings.desktopQueuePaused('')) == true) {
        error = null;
      }
      await flushQueuedDrafts();
      _notify();
      return;
    }
    if (!_queuedCommandReady) return;
    final request = _captureResponseHistory();
    if (request == null) return;
    final epoch = _queuedOwnerEpoch,
        owner = _queuedOwner,
        cache = threadList.data;
    final generation = _connectGeneration,
        mac = transport.macDeviceId,
        session = transport.sessionId,
        cwd = thread?['cwd'];
    bool current() =>
        !_disposed &&
        !_suspended &&
        epoch == _queuedOwnerEpoch &&
        owner == _queuedOwner &&
        owner?.mac == active?.macDeviceId &&
        owner?.pin == active?.data['macIdentityPublicKey'] &&
        generation == _connectGeneration &&
        mac == transport.macDeviceId &&
        session == transport.sessionId &&
        identical(cache, threadList.data) &&
        thread?['id'] == id &&
        thread?['cwd'] == cwd;
    final token = Object();
    _queuedDelivery = token;
    var refreshed = false;
    try {
      final response = await transport.request('thread/read', {
        'threadId': id,
        'includeTurns': true,
      });
      if (!current()) return;
      final value = response['thread'];
      if (value is! Map ||
          value['id'] != id ||
          (value.containsKey('cwd') && value['cwd'] != cwd) ||
          value['turns'] is! List ||
          (value['turns'] as List).any((row) => row is! Map)) {
        throw StateError(appStrings.desktopRuntimeNoTurnState);
      }
      final turns = (value['turns'] as List).cast<Map>().where(
        (row) => !('${row['id'] ?? row['turnId'] ?? row['turn_id'] ?? ''}')
            .startsWith('djl-history-compacted-'),
      );
      final latest = turns.lastOrNull;
      final outcome = latest == null
          ? DesktopResponseOutcome.completed
          : desktopResponseHistoryOutcome({
              ...Map<String, dynamic>.from(latest),
              'status':
                  latest['status'] ??
                  latest['turnStatus'] ??
                  latest['turn_status'],
            });
      if (outcome == DesktopResponseOutcome.unknown) return;
      final idle = outcome != DesktopResponseOutcome.running;
      _acceptResponseHistory(
        Map<String, dynamic>.from(value),
        request,
        confirmedIdle: idle,
      );
      final facts = selectedResponseFooter;
      if (idle && !facts.suppressesLatest) {
        turnId = null;
      } else if (!idle && latest != null) {
        final live = _realTurnId(
          latest['id'] ?? latest['turnId'] ?? latest['turn_id'],
        );
        if (live != null &&
            facts.latestTurn == live &&
            facts.outcome(live) == DesktopResponseOutcome.running &&
            !_finishedTurns.contains((id, live))) {
          _responseLifecycle!.starting(id, live);
          turnId = live;
        }
      }
      if (waitForIdle && _selectedRunBusy) return;
      _queuePausedByThread.remove(id);
      if (error?.startsWith(appStrings.desktopQueuePaused('')) == true) {
        error = null;
      }
      refreshed = true;
    } catch (e) {
      if (current()) {
        _queuePausedByThread[id] = e.toString();
        error = appStrings.desktopQueuePaused(e.toString());
      }
    } finally {
      if (identical(_queuedDelivery, token)) _queuedDelivery = null;
      _notify();
    }
    if (refreshed && current()) await flushQueuedDrafts();
  }

  Future<bool> steerQueuedDraft(String id) async {
    final draft = queuedDrafts.where((row) => row.id == id).firstOrNull;
    if (draft == null ||
        !_queuedCommandReady ||
        !_selectedRunBusy ||
        turnId == null) {
      return false;
    }
    return _deliverQueuedDraft(draft, steer: true);
  }

  bool removeQueuedDraft(String id) {
    _bindQueuedOwner();
    if (_disposed || steeringQueuedDraftId == id) return false;
    final drafts = _queuedByThread[thread?['id']];
    if (drafts == null || !drafts.any((row) => row.id == id)) return false;
    drafts.removeWhere((row) => row.id == id);
    _notify();
    return true;
  }

  bool restoreQueuedDraft(
    String id,
    bool Function(DesktopQueuedDraft) restore,
  ) {
    final draft = queuedDrafts.where((row) => row.id == id).firstOrNull;
    if (_disposed || busy || _queuedDelivery != null || draft == null) {
      return false;
    }
    final epoch = _queuedOwnerEpoch, selected = thread?['id'];
    if (!restore(draft) ||
        epoch != _queuedOwnerEpoch ||
        selected != thread?['id']) {
      return false;
    }
    return removeQueuedDraft(id);
  }

  Future<bool> _deliverQueuedDraft(
    DesktopQueuedDraft draft, {
    required bool steer,
  }) async {
    final id = thread!['id'] as String, cwd = thread?['cwd'];
    final epoch = _queuedOwnerEpoch, owner = _queuedOwner;
    final generation = _connectGeneration,
        mac = transport.macDeviceId,
        session = transport.sessionId;
    final token = _QueuedAttempt(steer: steer);
    _queuedDelivery = token;
    _queuedSteering = steer ? (thread: id, id: draft.id) : null;
    if (!steer) _queuedByThread[id]!.removeWhere((row) => row.id == draft.id);
    bool ownsNamespace() =>
        !_disposed &&
        epoch == _queuedOwnerEpoch &&
        owner == _queuedOwner &&
        owner?.mac == active?.macDeviceId &&
        owner?.pin == active?.data['macIdentityPublicKey'];
    bool ownsSelection() =>
        ownsNamespace() &&
        generation == _connectGeneration &&
        mac == transport.macDeviceId &&
        session == transport.sessionId &&
        thread?['id'] == id &&
        thread?['cwd'] == cwd &&
        !_suspended;
    final currentRuntime = runtime;
    final snapshot = DesktopRuntime(
      model: currentRuntime.model,
      effort: currentRuntime.effort,
      access: currentRuntime.access,
      plan: draft.plan,
      serviceTier: currentRuntime.serviceTier,
    );
    _notify();
    try {
      final sent = await _sendDraft(
        draft.draft,
        queuedAttempt: token,
        runtimeSnapshot: snapshot,
        canContinue: () => ownsSelection() && (steer || turnId == null),
      );
      final accepted = sent || token.received;
      if (ownsNamespace()) {
        if (accepted && steer) {
          _queuedByThread[id]?.removeWhere((row) => row.id == draft.id);
        }
        if (!sent) {
          if (!accepted && !steer) {
            (_queuedByThread[id] ??= []).insert(0, draft);
          }
          if (!steer || !token.explicitlyRejected || token.received) {
            final message = token.received
                ? appStrings.desktopQueueMessageArrived
                : ownsSelection() && error != null
                ? error!
                : appStrings.desktopQueueDeliveryUnconfirmed;
            _queuePausedByThread[id] = message;
            if (thread?['id'] == id) {
              error = appStrings.desktopQueuePaused(message);
            }
          }
        }
      }
      return accepted;
    } finally {
      if (identical(_queuedDelivery, token)) {
        _queuedDelivery = null;
        _queuedSteering = null;
      }
      _notify();
    }
  }

  bool get shouldQueueComposer => _selectedRunBusy || queuePauseMessage != null;
}
