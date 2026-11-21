part of 'desktop_controller.dart';

/// Switching between saved Macs, including stopping runs on the old one.
extension DesktopMacSwitch on DesktopController {
  bool get automaticConnectionAllowed =>
      !_automaticConnectionPaused && switchingDevice == null;

  bool get canEnterManualPairing =>
      switchingDevice == null &&
      !cancellingSwitch &&
      !_pairingSubmission &&
      (!busy || _connectingRecovery) &&
      !approvals.any((r) => r['_submitting'] == true) &&
      !userInputs.any((r) => r['_submitting'] == true) &&
      !threadList.data.responseChanges.entries.values.any((e) => e.applying);

  bool get _liveSwitchScope =>
      connected &&
      !_hostConnecting &&
      !_suspended &&
      transport.macDeviceId == active?.macDeviceId &&
      _switchRunScope?.mac == active?.macDeviceId &&
      _switchRunScope?.pin == active?.publicKey &&
      _switchRunScope?.session == transport.sessionId &&
      _switchRunScope?.generation == _connectGeneration;

  String? _realTurnId(Object? value) {
    if (value is! String) return null;
    final id = value.trim();
    if (id.isEmpty ||
        id.startsWith('turn-line-') ||
        id.startsWith('rollout-') ||
        id.startsWith('djl-history-compacted-')) {
      return null;
    }
    return id;
  }

  bool _runningStatus(Object? value) {
    final status = value is Map
        ? value['type'] ?? value['statusType'] ?? value['status_type']
        : value;
    return status is String &&
        {
          'inprogress',
          'running',
          'active',
          'starting',
          'started',
          'pending',
          'processing',
        }.contains(status.toLowerCase().replaceAll(RegExp(r'[_-]'), ''));
  }

  Set<String> get _knownSwitchThreads => {
    ..._liveSwitchRuns.keys,
    ..._switchRunCaution,
    ...threadList.data.responseChanges.running.keys,
    if (thread?['id'] is String && turnId != null) thread!['id'] as String,
    for (final row in threadList.data.snapshots)
      if (row['id'] is String &&
          (_runningStatus(row['status']) ||
              _runningStatus(row['subagentStatus']) ||
              (row['turns'] as List? ?? []).whereType<Map>().any(
                (t) => _runningStatus(t['status']),
              )))
        row['id'] as String,
  };

  bool get switchNeedsConfirmation => _knownSwitchThreads.isNotEmpty;

  void _observeSwitchRuns(String method, RemoteJson params, RemoteJson rpc) {
    if (!_liveSwitchScope || !requestMatchesConnection(rpc)) return;
    final id = params['threadId'] ?? params['thread_id'];
    if (id is! String || id.isEmpty) return;
    final observedTurn = desktopResponseIdentity(params)?.turn;
    if (_responseCurrent &&
        observedTurn != null &&
        _responseLifecycle!.isTurnTerminal(id, observedTurn) &&
        method != 'turn/completed' &&
        method != 'turn/failed') {
      return;
    }
    final raw = params['turn'];
    final turn = raw is Map ? raw : const <String, dynamic>{};
    final turnId = _realTurnId(turn['id'] ?? params['turnId']);
    if (method == 'thread/status/changed') {
      if (_runningStatus(params['status'])) _switchRunCaution.add(id);
      return;
    }
    if (method == 'turn/started' ||
        method == 'item/started' ||
        method == 'item/agentMessage/delta') {
      _switchRunCaution.add(id);
      if (rpc['djlReplayedEvent'] != true &&
          params['djlReplayedEvent'] != true &&
          turnId != null) {
        (_liveSwitchRuns[id] ??= {}).add(turnId);
      }
    } else if ((method == 'turn/completed' || method == 'turn/failed') &&
        rpc['djlReplayedEvent'] != true &&
        params['djlReplayedEvent'] != true) {
      if (turnId != null) _liveSwitchRuns[id]?.remove(turnId);
      if (_liveSwitchRuns[id]?.isEmpty == true) _liveSwitchRuns.remove(id);
      _switchRunCaution.remove(id);
    }
  }

  void _observeSwitchHistory(RemoteJson value) {
    if (!_liveSwitchScope || value['id'] is! String) return;
    final id = value['id'] as String;
    if (_responseCurrent) {
      final facts = _responseLifecycle!.facts(id);
      final running = facts.latestOutcome == DesktopResponseOutcome.running;
      final active = running ? _realTurnId(facts.latestTurn) : null;
      if (active != null) {
        _liveSwitchRuns[id] = {active};
      } else {
        _liveSwitchRuns.remove(id);
      }
      if (running || facts.pending) {
        _switchRunCaution.add(id);
      } else {
        _switchRunCaution.remove(id);
      }
      return;
    }
    final running = (value['turns'] as List? ?? []).whereType<Map>().where(
      (turn) => _runningStatus(turn['status']),
    );
    final ids = running
        .map((turn) => _realTurnId(turn['id']))
        .whereType<String>()
        .toSet();
    if (ids.isEmpty) {
      _liveSwitchRuns.remove(id);
    } else {
      _liveSwitchRuns[id] = ids;
    }
    if (running.isNotEmpty) {
      _switchRunCaution.add(id);
    } else {
      _switchRunCaution.remove(id);
    }
  }

  DesktopSwitchIntent? prepareSavedSwitch(Pairing pair) {
    if (navigationNeedsHost &&
        navigationTarget?.qualified == true &&
        !navigationTarget!.matchesHost(pair.macDeviceId, pair.publicKey)) {
      navigationError =
          'Choose the saved Mac matching this link. Its verified identity must match.';
      _notify();
      return null;
    }
    final source = active, target = devicePreferences(pair);
    if (!connected ||
        busy ||
        !_routingAllowed ||
        _suspended ||
        source == null ||
        target == null ||
        isActiveDevice(pair) ||
        approvals.any((r) => r['_submitting'] == true) ||
        userInputs.any((r) => r['_submitting'] == true) ||
        threadList.data.responseChanges.entries.values.any((e) => e.applying)) {
      return null;
    }
    return DesktopSwitchIntent(
      target,
      source,
      transport.sessionId,
      _connectGeneration,
      navigationRevision,
      selectionRevision,
      thread?['id'],
      newChatDraft,
      navigationTarget,
      navigationNeedsHost &&
          navigationTarget?.matchesHost(pair.macDeviceId, pair.publicKey) ==
              true,
    );
  }

  bool _switchSourceCurrent(DesktopSwitchIntent intent) =>
      !_disposed &&
      _routingAllowed &&
      !_suspended &&
      connected &&
      _connectGeneration == intent.generation &&
      navigationRevision == intent.navigationRevision &&
      selectionRevision == intent.selectionRevision &&
      thread?['id'] == intent.selectedThread &&
      identical(newChatDraft, intent.draft) &&
      active?.macDeviceId == intent.source.macDeviceId &&
      active?.publicKey == intent.source.publicKey &&
      transport.macDeviceId == intent.source.macDeviceId &&
      transport.sessionId == intent.session;

  Future<void> _verifySwitchTarget(TrustedDeviceEntry target) async {
    final entries = await pairings.trustedEntries();
    if (!entries.any(
      (entry) =>
          entry.matches(target.pairing) && entry.trustId == target.trustId,
    )) {
      throw const RemoteSecurityException(
        'This saved device changed. Choose it again.',
      );
    }
  }

  Future<bool> _interruptSwitchRuns(bool Function() current) async {
    var open = true, certain = true;
    final attempted = <(String, String)>{}, visited = <String>{};
    Future<void> stopKnown() async {
      while (open && current()) {
        final pending =
            _knownSwitchThreads
                .where(
                  (id) =>
                      !visited.contains(id) ||
                      (_liveSwitchRuns[id] ?? {}).any(
                        (turn) => !attempted.contains((id, turn)),
                      ),
                )
                .toList()
              ..sort();
        if (pending.isEmpty) return;
        final id = pending.first;
        visited.add(id);
        var turns = Set<String>.of(_liveSwitchRuns[id] ?? {});
        try {
          if (turns.isEmpty) {
            final read = await transport.request('thread/read', {
              'threadId': id,
              'includeTurns': true,
            });
            if (!open || !current()) return;
            final value = read['thread'];
            if (value is! Map || value['id'] != id) {
              certain = false;
              continue;
            }
            final running = (value['turns'] as List? ?? [])
                .whereType<Map>()
                .where((turn) => _runningStatus(turn['status']));
            turns = running
                .map((turn) => _realTurnId(turn['id']))
                .whereType<String>()
                .toSet();
            if ((running.isNotEmpty || _runningStatus(value['status'])) &&
                turns.isEmpty) {
              certain = false;
            }
          }
          final sorted = turns.toList()..sort();
          for (final turn in sorted) {
            if (!open || !current()) return;
            if (!attempted.add((id, turn))) continue;
            await transport.request('turn/interrupt', {
              'threadId': id,
              'turnId': turn,
            });
            if (!open || !current()) return;
          }
        } catch (_) {
          certain = false;
        }
      }
    }

    try {
      await stopKnown().timeout(const Duration(milliseconds: 1500));
    } catch (_) {
      certain = false;
    } finally {
      open = false;
    }
    return certain;
  }

  Future<void> switchSaved(
    DesktopSwitchIntent intent, {
    bool confirmed = false,
  }) async {
    if (busy ||
        !_switchSourceCurrent(intent) ||
        (switchNeedsConfirmation && !confirmed)) {
      return;
    }
    final revision = ++_switchRevision;
    final source = intent.source, target = intent.target;
    switchingDevice = target;
    _switchOwnedNavigationRevision = navigationRevision;
    switchNotice = null;
    busy = true;
    _automaticConnectionPaused = true;
    _intent = false;
    _retry?.cancel();
    var tornDown = false;
    bool owned() =>
        !_disposed && revision == _switchRevision && switchingDevice != null;
    bool sourceCurrent() => owned() && _switchSourceCurrent(intent);
    _notify();
    try {
      await _verifySwitchTarget(target);
      if (!sourceCurrent()) return;
      final resolved = await pairings.resolveTrusted(target.pairing);
      if (!sourceCurrent()) return;
      if (!target.matches(resolved)) {
        throw const RemoteSecurityException(
          'The selected Mac identity did not match.',
        );
      }
      await _verifySwitchTarget(target);
      if (!sourceCurrent()) return;
      final certain = await _interruptSwitchRuns(sourceCurrent);
      if (!sourceCurrent()) return;
      if (!certain) {
        switchNotice =
            'Stopping runs could not be confirmed; they may still be running on the other Mac.';
      }
      _rememberCurrent();
      await threadList.saveNow();
      if (!sourceCurrent()) return;
      if (threadList.localError != null) {
        throw StateError(threadList.localError!);
      }
      await _verifySwitchTarget(target);
      if (!sourceCurrent()) return;
      previousDevice = source;
      tornDown = true;
      ++_connectGeneration;
      ++selectionRevision;
      if (intent.preserveNavigation &&
          navigationTarget == intent.navigation &&
          navigationRevision == intent.navigationRevision) {
        _navigationHost = (mac: resolved.macDeviceId, pin: resolved.publicKey);
        _navigationAttempt = null;
        navigationError = null;
      } else {
        cancelNavigation();
      }
      _switchOwnedNavigationRevision = navigationRevision;
      _clearGuardianAuthority();
      _clearReasoningAuthority();
      _clearSwitchPresentation();
      active = resolved;
      // Establish B's empty/cache owner before any teardown or pointer await.
      await Future.wait<void>([
        transport.disconnect(),
        threadList.stageSwitch(resolved.macDeviceId),
      ]);
      if (!owned()) return;
      await pairings.selectTrustedActive(target, isCurrent: owned);
      if (!owned()) return;
      guardian.bind(resolved.macDeviceId, null);
      _bindActivityDevice(resolved.macDeviceId);
      await _connect(resolved, resolve: false, switchTarget: target);
      if (!owned()) return;
      if (state == 'connected' && connected) {
        previousDevice = null;
        _automaticConnectionPaused = false;
        _intent = true;
        switchingDevice = null;
        busy = false;
        _notify();
        await threadList.commitSwitch();
      } else {
        threadList.discardSwitch();
        _clearSwitchPresentation();
      }
    } catch (failure) {
      if (!owned()) return;
      if (tornDown) {
        await transport.disconnect();
        if (!owned()) return;
        threadList.discardSwitch();
        _clearSwitchPresentation();
        state = 'disconnected';
        error = failure.toString();
      } else {
        switchNotice = failure.toString();
      }
    } finally {
      if (owned()) {
        switchingDevice = null;
        busy = false;
        _hostConnecting = false;
        if (!tornDown) {
          _automaticConnectionPaused = false;
          _intent = connected;
        }
        _notify();
      }
    }
  }

  void _clearSwitchPresentation() {
    thread = null;
    timeline = [];
    models = [];
    model = null;
    effort = null;
    access = 'on-request';
    plan = false;
    serviceTier = 'default';
    turnId = null;
    approvals.clear();
    userInputs.clear();
    _requestsSuspended = true;
    _checkpointsByTurn.clear();
    _unverifiedCheckpointOwners.clear();
    _liveTimelineRevisions.clear();
    _historyReplacements.clear();
    _sourceContinuity.clear();
    _checkpointEnds.clear();
    _finishedTurns.clear();
    _liveSwitchRuns.clear();
    _switchRunCaution.clear();
    _switchRunScope = null;
  }

  void pauseForManualPairing() {
    if (!canEnterManualPairing) return;
    _automaticConnectionPaused = true;
    _intent = false;
    _retry?.cancel();
    if (_connectingRecovery || connected) {
      _statusTransportLost = true;
      selectionRevision++;
      cancelNavigation();
      _rememberCurrent();
      approvals.clear();
      _resetSubmittedQuestions();
      userInputs.clear();
      _requestsSuspended = true;
      unawaited(threadList.saveNow());
      ++_connectGeneration;
      _connectingRecovery = false;
      _hostConnecting = false;
      busy = false;
      _clearGuardianAuthority();
      _clearReasoningAuthority();
      unawaited(transport.disconnect());
    }
    state = 'disconnected';
    _notify();
  }
}
