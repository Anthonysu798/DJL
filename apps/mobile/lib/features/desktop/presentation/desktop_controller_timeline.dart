part of 'desktop_controller.dart';

/// Applying live events to the timeline and following runs.
extension DesktopTimelineEvents on DesktopController {
  List<RemoteJson> _applyOrdinaryTimelineEvent(
    String owner,
    List<RemoteJson> rows,
    String method,
    RemoteJson params,
    RemoteJson rpc,
  ) {
    switch (method) {
      case 'item/agentMessage/delta':
        final id = params['itemId'];
        var item = rows
            .where(
              (i) =>
                  i['type'] == 'agentMessage' &&
                  desktopHistorySourceId(i) == id,
            )
            .firstOrNull;
        if (item == null) {
          item = desktopHistoryNewRow({
            'id': id,
            'type': 'agentMessage',
            'text': '',
            'turnId': params['turnId'],
          }, rows.map((r) => r['id']).whereType<String>().toSet());
          rows.add(item);
        }
        item['text'] = '${item['text'] ?? ''}${params['delta'] ?? ''}';
        final knownClosed =
            _responseCurrent &&
            params['turnId'] is String &&
            _responseLifecycle!.isTurnTerminal(
              owner,
              params['turnId'] as String,
            );
        item['isStreaming'] =
            params['djlReplayedEvent'] != true && !knownClosed;
        if (params['djlReplayedEvent'] != true) {
          _noteTimelineLive(owner, item);
        }
      case 'item/started':
      case 'item/completed':
        final item = params['item'] as RemoteJson?;
        if (item != null) {
          final itemTurn = item['turnId'] ?? params['turnId'];
          final knownClosed =
              _responseCurrent &&
              itemTurn is String &&
              _responseLifecycle!.isTurnTerminal(owner, itemTurn);
          final resolved = desktopHistoryItem(<String, dynamic>{
            ...item,
            'turnId': item['turnId'] ?? params['turnId'],
            if (item['type'] == 'agentMessage')
              'isStreaming':
                  method == 'item/started' &&
                  params['djlReplayedEvent'] != true &&
                  !knownClosed,
          });
          final index = desktopOrdinaryHistoryRow(resolved)
              ? desktopHistoryMatchIndex(rows, resolved)
              : rows.indexWhere((i) => i['id'] == item['id']);
          final attempt = _queuedDelivery;
          if (item['type'] == 'userMessage' &&
              item['id'] is String &&
              (item['id'] as String).trim().isNotEmpty &&
              desktopHistorySourceId(resolved) != null &&
              _realTurnId(item['turnId'] ?? params['turnId']) != null &&
              index >= 0 &&
              attempt is _QueuedAttempt &&
              attempt.requested &&
              rows[index]['id'] == attempt.messageId &&
              _responseCurrent &&
              requestMatchesConnection(rpc) &&
              rpc['djlReplayedEvent'] != true &&
              params['djlReplayedEvent'] != true) {
            attempt.received = true;
          }
          RemoteJson? edited;
          if (item['type'] == 'userMessage') {
            final old = index < 0 ? null : rows[index];
            final oldLength = rows.length;
            final reconciliation = desktopReconcileHistory(
              rows,
              [resolved],
              protectedLiveIds: {},
              runningTurns: {},
              canonicalSnapshot: false,
            );
            rows = reconciliation.rows;
            edited = old == null
                ? rows.length > oldLength
                      ? rows.last
                      : null
                : rows.where((r) => r['id'] == old['id']).firstOrNull;
            // Preserve the established optimistic-to-provider UI handoff. History
            // aliases and projected collisions keep their separate display IDs.
            if (edited != null &&
                old?['sourceItemId'] == null &&
                (old?['id'] as String? ?? '').startsWith('local-') &&
                !desktopProvisionalHistoryItem(
                  desktopHistorySourceId(resolved),
                )) {
              edited['id'] = resolved['id'];
              if (edited['sourceItemId'] == edited['id']) {
                edited.remove('sourceItemId');
              }
            }
          } else if (index < 0) {
            edited = desktopHistoryNewRow(
              resolved,
              rows.map((r) => r['id']).whereType<String>().toSet(),
            );
            rows.add(edited);
          } else {
            edited = desktopMergeHistoryRow(
              rows[index],
              resolved,
              protectLive: false,
              snapshot: false,
              runningTurns: {},
            );
            rows[index] = edited;
          }
          if (edited != null && params['djlReplayedEvent'] != true) {
            _noteTimelineLive(owner, edited);
          }
        }
    }
    return rows;
  }

  void _syncSubagentLifecycle(String id, {RemoteJson? history}) {
    if (!_responseCurrent) return;
    final metadata = threadList.data.find(id);
    if (metadata?['isSubagent'] != true && history?['isSubagent'] != true) {
      return;
    }
    final facts = _responseLifecycle!.facts(id),
        turn = _responseLifecycle!.facts(id).latestTurn;
    if (turn == null) return;
    final status = switch (facts.latestOutcome) {
      DesktopResponseOutcome.running => 'running',
      DesktopResponseOutcome.completed => 'completed',
      DesktopResponseOutcome.failed => 'failed',
      DesktopResponseOutcome.stopped => 'stopped',
      DesktopResponseOutcome.unknown => null,
    };
    if (status == null) return;
    for (final value in [metadata, history, if (thread?['id'] == id) thread]) {
      if (value != null) {
        value['subagentStatus'] = status;
        value['subagentTurnId'] = turn;
      }
    }
  }

  void _retireObservedRun(String thread, String turn, {required bool guessed}) {
    if (!_responseCurrent) return;
    _settlePlans(
      thread,
      turn,
      completed:
          _responseLifecycle!.facts(thread).outcome(turn) ==
          DesktopResponseOutcome.completed,
    );
    final params = <String, dynamic>{'threadId': thread, 'turnId': turn};
    _finishedTurns.add((thread, turn));
    // Canonical reasoning closes in historyTurn under this read's watermark,
    // so its own final snapshot can still replace streamed text.
    if (_reasoningCurrent() && guessed) {
      _reasoning!.observeTurn(
        'turn/completed',
        params,
        backgroundGuess: guessed,
      );
    }
    _bindActivityDevice(active!.macDeviceId);
    activity.observeTurn(
      'turn/completed',
      params,
      knownThreads: _knownActivityThreads,
      selectedThread: this.thread?['id'] as String?,
      backgroundGuess: guessed,
    );
    _syncRunStatus();
    if (guessed) _runStatus?.rememberTurn(thread, turn);
    _runStatus?.retireTurn(thread, turn);
    final ledger = threadList.data.responseChanges;
    if (ledger.running[thread] == turn) ledger.running.remove(thread);
    for (final entry in ledger.entries.values.where(
      (e) => e.thread == thread && e.turn == turn,
    )) {
      if (!guessed) entry.terminal = true;
      entry.reviewRevision++;
    }
    _syncReasoningRows();
    _syncActivityRows();
  }

  void _reviveBackgroundGuess(
    String method,
    RemoteJson params,
    RemoteJson rpc,
  ) {
    if (method != 'turn/started' ||
        rpc['id'] != null ||
        !_responseCurrent ||
        !requestMatchesConnection(rpc) ||
        params['djlBackgroundDiscovery'] != true ||
        params['djlReplayedEvent'] == true ||
        rpc['djlReplayedEvent'] == true) {
      return;
    }
    final identity = desktopResponseIdentity(params);
    if (identity == null ||
        identity.turn == null ||
        threadList.data.deleted.contains(identity.thread) ||
        !_responseLifecycle!.reviveBackgroundGuess(
          identity.thread,
          identity.turn!,
        )) {
      return;
    }
    final turn = identity.turn!, thread = identity.thread;
    _finishedTurns.remove((thread, turn));
    _subagentFinishedTurns.remove((thread, turn));
    _syncSubagentLifecycle(thread);
    if (_reasoningCurrent()) _reasoning!.reviveBackgroundGuess(thread, turn);
    _bindActivityDevice(active!.macDeviceId);
    activity.reviveBackgroundGuess(thread, turn);
    _syncRunStatus();
    _runStatus?.reviveBackgroundGuess(thread, turn);
    for (final entry in threadList.data.responseChanges.entries.values.where(
      (e) => e.thread == thread && e.turn == turn,
    )) {
      entry.terminal = false;
      entry.reviewRevision++;
    }
    _syncReasoningRows();
    _syncActivityRows();
  }

  void _adoptSourceContinuity(
    String method,
    RemoteJson params,
    RemoteJson rpc,
  ) {
    if (method != 'turn/started' ||
        rpc['id'] != null ||
        !_responseCurrent ||
        !requestMatchesConnection(rpc) ||
        params['djlReplayedEvent'] == true ||
        rpc['djlReplayedEvent'] == true) {
      return;
    }
    final identity = desktopResponseIdentity(params);
    if (identity == null || identity.turn == null) return;
    final prior = _sourceContinuity.remove(identity.thread);
    if (params['djlTurnIdentityContinuity'] != true ||
        prior == null ||
        prior.connection != _responseConnection) {
      return;
    }
    final thread = identity.thread, turn = identity.turn!;
    final previousOutcome = _responseLifecycle!
        .facts(thread)
        .outcome(prior.turn);
    if (!prior.turn.startsWith('ipc-turn-') &&
        _responseLifecycle!.isTurnTerminal(thread, prior.turn) &&
        (previousOutcome != DesktopResponseOutcome.stopped ||
            !_responseLifecycle!.isBackgroundGuess(thread, prior.turn))) {
      return;
    }
    final outcome = _responseLifecycle!.facts(thread).outcome(turn);
    if (_responseLifecycle!.isTurnTerminal(thread, turn) &&
        outcome != DesktopResponseOutcome.stopped) {
      return;
    }
    _bindSubagents();
    _bindActivityDevice(active!.macDeviceId);
    final rows = this.thread?['id'] == thread
        ? timeline
        : threadList.data.timelines[thread] ?? <RemoteJson>[];
    final rowIds = prior.currentOnly
        ? {
            for (final row in rows)
              if (!prior.excludedIds.contains(row['id']) && row['id'] is String)
                row['id'] as String,
          }
        : null;
    final replacements = <String, RemoteJson>{
      ...activity.rebindHistoryTurn(thread, prior.turn, turn, rowIds: rowIds),
      ...subagents.rebindHistoryTurn(thread, prior.turn, turn, rowIds: rowIds),
      if (prior.turn != turn)
        ...guardian.rebindHistoryTurn(thread, prior.turn, turn, rowIds: rowIds),
      if (_reasoningCurrent())
        ..._reasoning!.rebindHistoryTurn(
          thread,
          prior.turn,
          turn,
          rowIds: rowIds,
        ),
    };
    final ledger = threadList.data.responseChanges;
    if (ledger.canRebindHistoryTurn(
      thread,
      prior.turn,
      turn,
      currentOnly: prior.currentOnly,
    )) {
      ledger.rebindHistoryTurn(
        thread,
        prior.turn,
        turn,
        currentOnly: prior.currentOnly,
      );
    }
    for (final entry in ledger.entries.values.where(
      (e) => e.thread == thread && e.turn == turn,
    )) {
      entry.terminal = false;
      entry.reviewRevision++;
    }
    _responseLifecycle!.rebindHistoryTurn(thread, prior.turn, turn);
    _responseLifecycle!.reviveBackgroundGuess(thread, turn);
    if (_responseLifecycle!.facts(thread).outcome(turn) ==
        DesktopResponseOutcome.running) {
      _finishedTurns.remove((thread, turn));
    }
    if (_reasoningCurrent()) _reasoning!.reviveBackgroundGuess(thread, turn);
    activity.reviveBackgroundGuess(thread, turn);
    _runStatus?.rebindTurn(
      thread,
      prior.turn,
      turn,
      resume: !prior.currentOnly,
    );
    for (var i = 0; i < rows.length; i++) {
      final row = rows[i];
      rows[i] =
          replacements[row['id']] ??
          (row['turnId'] == prior.turn &&
                  (rowIds == null || rowIds.contains(row['id']))
              ? {
                  ...row,
                  'turnId': turn,
                  if (row.containsKey('turn_id')) 'turn_id': turn,
                }
              : row);
    }
    threadList.data.timelines[thread] = List.of(rows);
    _syncReasoningRows();
    _syncActivityRows();
    _syncSubagentRows();
    _syncGuardianRows();
  }

  void _resetProjectedSource(String thread) {
    if (!_responseCurrent) return;
    final previous = _responseLifecycle!.facts(thread).latestTurn;
    if (previous != null) {
      _sourceContinuity[thread] = (
        connection: _responseConnection!,
        turn: previous,
        revision: _responseLifecycle!.revision,
        excludedIds: <String>{},
        currentOnly: false,
      );
    }
    _responseLifecycle!.resetProjectedTerminals(thread);
    _subagentFinishedTurns.removeWhere(
      (key) => key.$1 == thread && key.$2.startsWith('ipc-turn-'),
    );
    final metadata = threadList.data.find(thread);
    if ((metadata?['subagentTurnId'] as String? ?? '').startsWith(
      'ipc-turn-',
    )) {
      metadata?.remove('subagentTurnId');
    }
    _finishedTurns.removeWhere(
      (key) => key.$1 == thread && key.$2.startsWith('ipc-turn-'),
    );
    if (_reasoningCurrent()) _reasoning!.resetProjectedTerminals(thread);
    _bindActivityDevice(active!.macDeviceId);
    activity.resetProjectedTerminals(thread);
    _syncRunStatus();
    _runStatus?.resetProjectedTerminals(thread);
    threadList.data.responseChanges.archiveProjectedTerminals(thread);
    final connection = (
      transport.macDeviceId,
      transport.sessionId,
      transport.connectionRevision,
    );
    final old = {..._checkpointsByTurn.keys, ..._checkpointEnds.keys}
        .where(
          (key) =>
              key.connection == connection &&
              key.thread == thread &&
              key.turn.startsWith('ipc-turn-'),
        )
        .toList();
    for (final key in old) {
      _unverifiedCheckpointOwners.add(key);
      _checkpointsByTurn.remove(key);
      _checkpointEnds.remove(key);
    }
    _responseRunRevision++;
  }

  void _settlePlans(
    String owner,
    String turn, {
    required bool completed,
    bool live = false,
    bool allowReady = true,
  }) {
    final selected = thread?['id'] == owner;
    final rows = selected ? timeline : threadList.data.timelines[owner];
    if (rows == null) return;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i]['turnId'] != turn || !desktopIsPlanItem(rows[i])) continue;
      rows[i] = desktopClosedPlan(
        rows[i],
        completed: completed,
        allowReady: allowReady,
      );
      if (live) _noteTimelineLive(owner, rows[i]);
    }
    if (!selected) threadList.scheduleSave();
  }

  ({String thread, String? turn})? _planIdentity(RemoteJson params) {
    var scoped = params;
    final envelopes = [
      params,
      ?activityObject(params['turn']),
      ?activityObject(params['event']),
      ?activityObject(params['msg']),
    ];
    final hasThread = envelopes.any(
      (map) =>
          map['thread'] != null ||
          [
            'threadId',
            'thread_id',
            'conversationId',
            'conversation_id',
          ].any((key) => map[key] != null),
    );
    if (!hasThread) {
      final turns = [
        for (final map in envelopes) ...[map['turnId'], map['turn_id']],
        activityObject(params['turn'])?['id'],
      ].where((v) => v != null).toSet();
      if (turns.length != 1 || turns.single is! String) return null;
      final turn = turns.single as String;
      final owners = <String>{
        for (final id in {
          ..._knownActivityThreads,
          ...threadList.data.timelines.keys,
          if (thread?['id'] is String) thread!['id'] as String,
        })
          if (_responseLifecycle!.facts(id).outcomes.containsKey(turn) ||
              (thread?['id'] == id
                      ? timeline
                      : threadList.data.timelines[id] ?? <RemoteJson>[])
                  .any((row) => row['turnId'] == turn))
            id,
      };
      if (owners.length != 1) return null;
      scoped = {...params, 'threadId': owners.single};
    }
    return desktopResponseIdentity(scoped);
  }

  bool _capturePlan(String method, RemoteJson params, RemoteJson rpc) {
    if ({'turn/completed', 'turn/failed'}.contains(method)) {
      final identity = desktopResponseIdentity(params);
      if (_responseCurrent &&
          requestMatchesConnection(rpc) &&
          identity?.turn != null &&
          _responseLifecycle!.isTurnTerminal(
            identity!.thread,
            identity.turn!,
          )) {
        final replay =
            params['djlReplayedEvent'] == true ||
            rpc['djlReplayedEvent'] == true;
        _settlePlans(
          identity.thread,
          identity.turn!,
          completed:
              _responseLifecycle!
                  .facts(identity.thread)
                  .outcome(identity.turn!) ==
              DesktopResponseOutcome.completed,
          live: !replay,
          allowReady: !replay,
        );
      }
      return false;
    }
    final item = activityObject(params['item']);
    final handles =
        method == 'turn/plan/updated' ||
        method == 'item/plan/delta' ||
        {'item/started', 'item/completed'}.contains(method) &&
            item != null &&
            desktopIsPlanItem(item);
    if (!handles) return false;
    if (!_responseCurrent ||
        !connected ||
        !requestMatchesConnection(rpc) ||
        transport.macDeviceId != active?.macDeviceId) {
      return true;
    }
    final identity = _planIdentity(params);
    if (identity == null ||
        identity.turn == null ||
        threadList.data.deleted.contains(identity.thread) ||
        item != null &&
            !desktopHistoryOwnedRow(item, identity.thread, identity.turn)) {
      return true;
    }
    final scoped = {
      ...params,
      'threadId': identity.thread,
      'turnId': identity.turn,
    };
    final owner = identity.thread, turn = identity.turn!;
    final selected = thread?['id'] == owner;
    final rows = selected
        ? timeline
        : threadList.data.timelines[owner] ?? <RemoteJson>[];
    final handoff = _sourceContinuity[owner];
    final excluded =
        handoff != null &&
            handoff.currentOnly &&
            handoff.connection == _responseConnection &&
            handoff.turn == turn
        ? handoff.excludedIds
        : const <String>{};
    final changed = desktopPlanNotification(
      excluded.isEmpty
          ? rows
          : rows.where((row) => !excluded.contains(row['id'])).toList(),
      thread: owner,
      turn: turn,
      method: method,
      params: scoped,
      closed: _responseLifecycle!.isTurnTerminal(owner, turn),
      completed:
          _responseLifecycle!.facts(owner).outcome(turn) ==
          DesktopResponseOutcome.completed,
      replay:
          params['djlReplayedEvent'] == true || rpc['djlReplayedEvent'] == true,
    );
    if (changed == null) return true;
    if (desktopResponseIdentity(params) == null) {
      _noteMirroredRunActivity(method, scoped, rpc);
    }
    final index = rows.indexWhere(
      (row) =>
          row['id'] == changed['id'] &&
          row['turnId'] == turn &&
          desktopIsPlanItem(row) &&
          !excluded.contains(row['id']),
    );
    if (index < 0) {
      rows.add(
        desktopHistoryNewRow(
          changed,
          rows.map((row) => row['id']).whereType<String>().toSet(),
        ),
      );
    } else {
      rows[index] = changed;
    }
    if (params['djlReplayedEvent'] != true && rpc['djlReplayedEvent'] != true) {
      _noteTimelineLive(owner, index < 0 ? rows.last : rows[index]);
    }
    if (selected) {
      _rememberCurrent();
    } else {
      threadList.data.timelines[owner] = rows;
      threadList.scheduleSave();
    }
    _notify();
    return true;
  }

  bool _ignoreClosedRunActivity(
    String method,
    RemoteJson params,
    RemoteJson rpc,
  ) {
    if (!_responseCurrent ||
        !requestMatchesConnection(rpc) ||
        rpc['id'] != null ||
        rpc['djlReplayedEvent'] == true ||
        params['djlReplayedEvent'] == true) {
      return false;
    }
    final item = activityObject(params['item']);
    if (method != 'item/agentMessage/delta' &&
        !(method == 'item/started' && item?['type'] != 'userMessage')) {
      return false;
    }
    final identity = desktopResponseIdentity(params);
    return identity != null &&
        identity.turn != null &&
        _finishedTurns.contains((identity.thread, identity.turn!));
  }

  void _noteMirroredRunActivity(
    String method,
    RemoteJson params,
    RemoteJson rpc,
  ) {
    final planItem = activityObject(params['item']);
    if (method == 'turn/plan/updated' &&
            desktopPlanSteps(params['plan']).isEmpty &&
            activityString(params['explanation']) == null ||
        method == 'item/plan/delta' &&
            (params['delta'] is! String ||
                (params['delta'] as String).isEmpty) ||
        method == 'item/started' &&
            planItem != null &&
            desktopIsPlanItem(planItem) &&
            DesktopPlan.fromRow(planItem) == null) {
      return;
    }
    if (!_responseCurrent ||
        !requestMatchesConnection(rpc) ||
        rpc['id'] != null ||
        params['djlReplayedEvent'] == true ||
        rpc['djlReplayedEvent'] == true ||
        !(method == 'turn/started' ||
            method == 'item/started' ||
            method == 'turn/plan/updated' ||
            method.startsWith('item/') &&
                (method.endsWith('Delta') || method.endsWith('/delta')))) {
      return;
    }
    final identity = desktopResponseIdentity(params);
    if (identity == null) return;
    final item = activityObject(params['item']);
    if (item != null &&
        !desktopHistoryOwnedRow(item, identity.thread, identity.turn)) {
      return;
    }
    final mirrored =
        params['djlDesktopMirror'] == true ||
        params['djlRolloutLiveMirror'] == true;
    final facts = _responseLifecycle!.facts(identity.thread);
    if (mirrored &&
        facts.latestOutcome != DesktopResponseOutcome.running &&
        !threadList.data.deleted.contains(identity.thread)) {
      final turn = identity.turn;
      if (turn == null) {
        _responseLifecycle!.runningStatus(identity.thread, null);
      } else if (!_responseLifecycle!.isTurnTerminal(identity.thread, turn)) {
        _responseLifecycle!.starting(identity.thread, turn);
        if (_reasoningCurrent()) {
          _reasoning!.observeTurn('turn/started', params);
        }
        _bindActivityDevice(active!.macDeviceId);
        activity.observeTurn(
          'turn/started',
          params,
          knownThreads: _knownActivityThreads,
          selectedThread: thread?['id'] as String?,
        );
        _syncRunStatus();
        _runStatus?.observe('turn/started', params);
        _captureResponseChanges('turn/started', params, rpc);
        if (thread?['id'] == identity.thread) turnId = turn;
      }
    }
    _responseLifecycle!.noteActivity(
      identity.thread,
      identity.turn,
      _runClock(),
      mirrored: mirrored,
    );
  }
}
