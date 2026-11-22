part of 'desktop_controller.dart';

/// Sub-agents an agent started: loading them and moving between parent and child.
extension DesktopSubagents on DesktopController {
  void _bindSubagents() {
    final mac = active?.macDeviceId;
    final data = threadList.data;
    if (_subagentMac != mac || !identical(_subagentCache, data)) {
      subagents.items.clear();
      _subagentFinishedTurns.clear();
      _subagentLoads.clear();
      _subagentLoadStates.clear();
      _subagentCache = data;
      _subagentMac = mac;
      for (final entry in data.timelines.entries) {
        if (data.deleted.contains(entry.key)) continue;
        for (final row in entry.value) {
          final action = SubagentAction.decode(
            row,
            mac: mac ?? '',
            thread: entry.key,
            turn: subagentString(row['turnId']) ?? '',
          );
          if (action != null) {
            subagents.merge(action);
          }
        }
      }
    }
    if (_subagentSession != transport.sessionId) {
      _subagentSession = transport.sessionId;
      _subagentLoads.clear();
      _subagentLoadStates.clear();
    }
  }

  void _registerSubagents(SubagentAction action) {
    for (final child in action.children) {
      if (child.thread == action.thread ||
          threadList.data.deleted.contains(child.thread)) {
        continue;
      }
      final prior = threadList.data.find(child.thread);
      threadList.data.upsert({
        'id': child.thread,
        'isSubagent': true,
        if (child.agentId != null && prior?['agentId'] == null)
          'agentId': child.agentId,
        if (child.nickname != null && prior?['agentNickname'] == null)
          'agentNickname': child.nickname,
        if (child.role != null && prior?['agentRole'] == null)
          'agentRole': child.role,
        // A wait/update reference is not evidence of parentage or inherited runtime.
        if (action.tool == 'spawnagent' &&
            prior?['parentThreadId'] == null &&
            prior?['forkedFromThreadId'] == null)
          'parentThreadId': action.thread,
      });
    }
  }

  void _syncSubagentRows() {
    for (final action in subagents.items.values) {
      if (action.mac != active?.macDeviceId ||
          threadList.macDeviceId != null &&
              threadList.macDeviceId != action.mac ||
          threadList.data.deleted.contains(action.thread)) {
        continue;
      }
      final rows = thread?['id'] == action.thread
          ? timeline
          : threadList.data.timelines.putIfAbsent(action.thread, () => []);
      final index = rows.indexWhere(
        (row) =>
            row['id'] == action.id ||
            SubagentAction.decode(
                  row,
                  mac: action.mac,
                  thread: action.thread,
                  turn: subagentString(row['turnId']) ?? '',
                )?.id ==
                action.id,
      );
      if (index < 0) {
        rows.add(action.toRow());
      } else {
        rows[index] = action.toRow();
      }
      threadList.data.timelines[action.thread] = List.of(rows);
      _registerSubagents(action);
    }
    threadList.scheduleSave();
  }

  String? subagentMetadataState(String id) => !connected
      ? appStrings.desktopSubagentOfflineCached
      : _subagentLoadStates[id];

  SubagentChild resolvedSubagent(SubagentChild child) {
    final metadata = threadList.data.find(child.thread);
    final resolved = SubagentChild.decode(
      child.thread,
      child.toJson(),
      requested: child.requestedModel,
      cached: true,
    );
    if (metadata != null) {
      resolved.merge(SubagentChild.fromThread(child.thread, metadata));
      final status = subagentString(metadata['subagentStatus']);
      if (status != null) resolved.status = status;
    }
    return resolved;
  }

  Future<void> hydrateSubagents(SubagentAction action) async {
    if (action.mac.isNotEmpty && action.mac != active?.macDeviceId) return;
    _bindSubagents();
    await Future.wait(
      action.children
          .where((child) => !resolvedSubagent(child).hasIdentity)
          .map((child) => _loadSubagent(child.thread)),
    );
  }

  Future<void> _loadSubagent(String id) {
    if (!connected ||
        transport.macDeviceId != active?.macDeviceId ||
        threadList.macDeviceId != null &&
            threadList.macDeviceId != active?.macDeviceId ||
        threadList.data.deleted.contains(id)) {
      return Future.value();
    }
    final pending = _subagentLoads[id];
    if (pending != null) return pending;
    // Loading state is presentation only. A later reference/open can retry an
    // unmaterialized child; only concurrent reads are coalesced above.
    final data = threadList.data,
        mac = active!.macDeviceId,
        session = transport.sessionId,
        generation = _connectGeneration,
        pin = active?.data['macIdentityPublicKey'],
        connectionRevision = transport.connectionRevision,
        originalBinding = data.projectBindings[id],
        originalCwd = data.find(id)?['cwd'];
    bool sameFolder() =>
        data.projectBindings[id] == originalBinding &&
        data.find(id)?['cwd'] == originalCwd;
    bool current() =>
        !_disposed &&
        connected &&
        generation == _connectGeneration &&
        transport.macDeviceId == mac &&
        active?.macDeviceId == mac &&
        active?.data['macIdentityPublicKey'] == pin &&
        transport.connectionRevision == connectionRevision &&
        transport.sessionId == session &&
        identical(data, threadList.data) &&
        !data.deleted.contains(id);
    _subagentLoadStates[id] = appStrings.desktopSubagentLoading;
    final future = () async {
      final timelineWatermark = _timelineRevision;
      try {
        final reasoningHistory = _captureReasoningHistory();
        final responseHistory = _captureResponseHistory();
        // Display-only hydration must never resume or install any runtime settings.
        final response = await transport.request('thread/read', {
          'threadId': id,
          'includeTurns': true,
        });
        if (!current()) return;
        if (!sameFolder()) {
          _subagentLoadStates.remove(id);
          return;
        }
        final raw = activityObject(response['thread']);
        if (raw == null || raw['id'] != id) {
          throw StateError('Mismatched child metadata');
        }
        _observeSwitchHistory(raw);
        _acceptResponseHistory(raw, responseHistory, selected: false);
        final metadata = normalizeThread(
          subagentThreadMetadata(normalizeThread(raw), id),
        );
        final turns = raw['turns'] is List ? raw['turns'] as List : const [];
        if (turns.isNotEmpty && turns.last is Map) {
          final last = turns.last as Map;
          final prior = data.find(id);
          final priorTurn = prior?['subagentTurnId'];
          final status = subagentStatus(last['status']);
          if (priorTurn == null ||
              priorTurn == last['id'] &&
                  !{
                    'completed',
                    'failed',
                    'stopped',
                  }.contains(prior?['subagentStatus'])) {
            metadata['subagentStatus'] = status;
            metadata['subagentTurnId'] = last['id'];
          }
        }
        data.upsert(metadata, fromServer: true);
        // Cache read-only history without touching the selected timeline, composer or runtime.
        data.timelines[id] = _reconcileOwnedHistory(
          raw,
          List<RemoteJson>.of(data.timelines[id] ?? []),
          reasoningHistory: reasoningHistory,
          timelineWatermark: timelineWatermark,
        );
        _syncReasoningRows();
        _subagentLoadStates[id] =
            SubagentChild.fromThread(id, metadata).hasIdentity
            ? appStrings.desktopSubagentLoaded
            : appStrings.desktopSubagentIdentityUnknown;
        threadList.scheduleSave();
      } catch (_) {
        if (current()) {
          _subagentLoadStates[id] = appStrings.desktopSubagentLoadFailed;
        }
      } finally {
        if (current()) {
          _subagentLoads.remove(id);
          if ((_historyReplacements[id] ?? 0) > timelineWatermark) {
            unawaited(_loadSubagent(id));
          }
          _notify();
        }
      }
    }();
    _subagentLoads[id] = future;
    return future;
  }

  RemoteJson? get subagentParent {
    final route = _subagentReturn;
    if (route != null &&
        route.mac == active?.macDeviceId &&
        route.child == thread?['id']) {
      return threadList.data.deleted.contains(route.parent['id'])
          ? null
          : threadList.data.find(route.parent['id'] as String) ?? route.parent;
    }
    final id = subagentString(thread?['parentThreadId']);
    return id == null ? null : threadList.data.find(id);
  }

  Future<void> openSubagent(SubagentAction action, SubagentChild child) async {
    if (thread?['id'] != action.thread ||
        action.mac.isNotEmpty && action.mac != active?.macDeviceId ||
        threadList.data.deleted.contains(child.thread) ||
        child.thread == action.thread) {
      return;
    }
    final parent = Map<String, dynamic>.from(thread!),
        mac = active?.macDeviceId,
        connectionMac = transport.macDeviceId,
        session = transport.sessionId,
        generation = _connectGeneration,
        data = threadList.data,
        wasConnected = connected,
        intent = ++_subagentNavigationIntent;
    // Explicit selection can use normal chat resume, after loading the child's policy read-only.
    _bindSubagents();
    if (connected && threadList.data.runtimes[child.thread] == null) {
      await _loadSubagent(child.thread);
    }
    if (_disposed ||
        intent != _subagentNavigationIntent ||
        generation != _connectGeneration ||
        session != transport.sessionId ||
        connectionMac != transport.macDeviceId ||
        !identical(data, threadList.data) ||
        connected != wasConnected ||
        thread?['id'] != parent['id'] ||
        active?.macDeviceId != mac) {
      return;
    }
    _subagentReturn = (mac: mac ?? '', child: child.thread, parent: parent);
    await openThread(
      threadList.data.find(child.thread) ?? {'id': child.thread},
      subagentSelection: true,
    );
  }
}
