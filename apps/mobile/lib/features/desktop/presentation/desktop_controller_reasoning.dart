part of 'desktop_controller.dart';

/// Reasoning rows: which reasoning belongs to the open chat and how it is shown.
extension DesktopReasoningRows on DesktopController {
  void _clearReasoningAuthority() {
    _attentionUnread.clear();
    _attentionTerminals.clear();
    _responseConnection = null;
    _responseLifecycle = null;
    _responseAttempt = null;
    _reasoningConnection = null;
    _reasoningAttempt = null;
    _reasoning = null;
  }

  void _beginReasoningConnection(Pairing pair, int generation) {
    _reasoningConnection = (
      mac: pair.macDeviceId,
      pin: pair.publicKey,
      session: pair.sessionId,
      generation: generation,
      cache: threadList.data,
    );
    _responseConnection = _reasoningConnection;
    _responseAttempt = generation;
    _responseLifecycle = DesktopResponseLifecycle(now: _runClock);
    _reasoningAttempt = generation;
    _reasoning = ReasoningReducer(pair.macDeviceId, pair.publicKey);
    for (final rows in threadList.data.timelines.values) {
      for (final row in rows) {
        _reasoning!.restore(row);
      }
    }
  }

  bool _reasoningCurrent() {
    final binding = _reasoningConnection;
    return binding != null &&
        !_disposed &&
        !_suspended &&
        connected &&
        binding.generation == _connectGeneration &&
        binding.pin.isNotEmpty &&
        active?.macDeviceId == binding.mac &&
        active?.publicKey == binding.pin &&
        transport.macDeviceId == binding.mac &&
        transport.sessionId == binding.session &&
        threadList.macDeviceId == binding.mac &&
        identical(threadList.data, binding.cache) &&
        // RemoteTransport starts decrypted reads only after trust(pair) succeeds.
        // The exact captured attempt bridges early replay until the normal trust refresh.
        (_reasoningAttempt == binding.generation ||
            trusted.any(
              (p) => p.macDeviceId == binding.mac && p.publicKey == binding.pin,
            ));
  }

  bool reasoningRowMatchesHost(RemoteJson row) =>
      _reasoningRowMatchesThread(row, thread?['id'] as String?);

  bool _reasoningRowMatchesThread(RemoteJson row, String? threadId) {
    final value = DesktopReasoning.fromRow(row);
    return value != null &&
        value.mac == active?.macDeviceId &&
        value.pin == active?.publicKey &&
        value.thread == threadId &&
        !threadList.data.deleted.contains(value.thread);
  }

  _ReasoningHistory? _captureReasoningHistory() => !_reasoningCurrent()
      ? null
      : (
          connection: _reasoningConnection!,
          watermark: _reasoning!.revision,
          selected: thread?['id'],
          selectionRevision: selectionRevision,
        );

  bool _reasoningHistoryCurrent(
    _ReasoningHistory? request, {
    bool selection = true,
  }) =>
      request == null ||
      _reasoningCurrent() &&
          request.connection == _reasoningConnection &&
          (!selection ||
              request.selected == thread?['id'] &&
                  request.selectionRevision == selectionRevision);

  void _syncReasoningRows() {
    if (!_reasoningCurrent()) return;
    for (final item in _reasoning!.items.values) {
      if (threadList.data.deleted.contains(item.thread)) continue;
      final rows = thread?['id'] == item.thread
          ? timeline
          : threadList.data.timelines.putIfAbsent(item.thread, () => []);
      final index = rows.indexWhere((row) => row['id'] == item.id);
      if (index < 0) {
        rows.add(item.toRow());
      } else {
        rows[index] = item.toRow();
      }
      threadList.data.timelines[item.thread] = List.of(rows);
    }
    threadList.scheduleSave();
  }

  bool _reversibleClosure(String thread, String turn, RemoteJson params) =>
      _responseCurrent &&
      (_responseLifecycle!.facts(thread).outcome(turn) ==
              DesktopResponseOutcome.stopped ||
          turn.startsWith('ipc-turn-') &&
              (params['djlDesktopMirror'] == true ||
                  params['djlRolloutLiveMirror'] == true));

  bool _captureReasoning(String method, RemoteJson params, RemoteJson rpc) {
    final reasoning = isReasoningNotification(method, params);
    if (!reasoning && method != 'turn/started' && method != 'turn/completed') {
      return false;
    }
    if (!_reasoningCurrent() || !requestMatchesConnection(rpc)) {
      return reasoning;
    }
    final identity = reasoningTurn(params);
    if (identity == null || threadList.data.deleted.contains(identity.thread)) {
      return reasoning;
    }
    final replay =
        rpc['djlReplayedEvent'] == true || params['djlReplayedEvent'] == true;
    if (reasoning) {
      final projected = _reasoning!.ingest(method, params, replay: replay);
      if (!replay && projected != null) {
        _noteTimelineLive(projected.thread, projected.toRow());
      }
    } else {
      _reasoning!.observeTurn(
        method,
        params,
        replay: replay,
        backgroundGuess: _reversibleClosure(
          identity.thread,
          identity.turn,
          params,
        ),
      );
    }
    _syncReasoningRows();
    if (reasoning) _notify();
    return reasoning;
  }

  RemoteJson? _reasoningHistoryRow(
    RemoteJson item,
    String threadId,
    RemoteJson turn,
    _ReasoningHistory? request,
  ) {
    if (request == null ||
        !_reasoningHistoryCurrent(request) ||
        item.containsKey(reasoningMetadataKey) ||
        threadList.data.deleted.contains(threadId)) {
      return null;
    }
    final identity = reasoningIdentity({
      'threadId': threadId,
      'turn': turn,
      'item': item,
    });
    if (identity == null) return null;
    final projected = _reasoning!.history(
      item,
      thread: threadId,
      turn: identity.turn,
      status: turn['status'],
      watermark: request.watermark,
    );
    if (projected != null) {
      // Only fresh trusted history may replace an unbound legacy cache identity.
      threadList.data.timelines[threadId]?.removeWhere(
        (row) =>
            row['type'] == 'reasoning' &&
            !row.containsKey(reasoningMetadataKey) &&
            row['id'] == identity.item &&
            (row['turnId'] ?? row['turn_id']) == identity.turn,
      );
    }
    return projected?.toRow();
  }

  void _reasoningHistoryTurn(
    RemoteJson turn,
    String threadId,
    _ReasoningHistory? request,
  ) {
    if (request == null ||
        !_reasoningHistoryCurrent(request) ||
        threadList.data.deleted.contains(threadId)) {
      return;
    }
    final identity = reasoningTurn({'threadId': threadId, 'turn': turn});
    if (identity != null) {
      _reasoning!.historyTurn(
        threadId,
        identity.turn,
        turn['status'],
        watermark: request.watermark,
        canonicalItems: [
          for (final raw in (turn['items'] as List? ?? []).whereType<Map>())
            if (raw['type'] == 'reasoning' &&
                !raw.containsKey(reasoningMetadataKey))
              Map<String, dynamic>.from(raw),
        ],
      );
    }
  }
}
