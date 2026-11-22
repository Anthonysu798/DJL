part of 'desktop_controller.dart';

/// Merging history read from the Mac with what the phone already shows.
extension DesktopHistoryReconcile on DesktopController {
  String? _historyStructuredSignature(
    RemoteJson row,
    String thread,
    String turn,
  ) {
    if (desktopIsPlanItem(row) && desktopIsProgressPlan(row)) {
      return 'plan-progress';
    }
    if (row['type'] == 'reasoning' || row['type'] == 'plan') {
      final text = row['type'] == 'plan'
          ? row['text'] as String? ?? ''
          : DesktopReasoning.fromRow(row)?.text ??
                decodeReasoningText(row, history: true);
      if (text.trim().isEmpty ||
          text.length > 64000 ||
          utf8.encode(text).length > 64000) {
        return null;
      }
      return jsonEncode([row['type'], text.trim()]);
    }
    if (isSubagentItem(row)) {
      final action = SubagentAction.decode(
        row,
        mac: active?.macDeviceId ?? '',
        thread: thread,
        turn: turn,
      );
      if (action == null || action.children.isEmpty) return null;
      final children = action.children.map((child) => child.thread).toList()
        ..sort();
      final signature = jsonEncode([
        'subagent',
        action.tool,
        action.prompt,
        children,
      ]);
      return utf8.encode(signature).length <= 64000 ? signature : null;
    }
    final command = DesktopActivity.fromItem(
      row,
      mac: active?.macDeviceId ?? '',
      thread: thread,
      turn: turn,
    );
    if (command?.kind != 'command' || command!.command.trim().isEmpty) {
      return null;
    }
    final signature = jsonEncode([
      'command',
      command.command,
      command.cwd,
      command.outputTail,
    ]);
    return signature.length <= 64000 && utf8.encode(signature).length <= 64000
        ? signature
        : null;
  }

  Map<String, String> _historyStructuredItemMappings(
    String thread,
    List<RemoteJson> previous,
    List<RemoteJson> canonical,
    Map<String, String> turnMappings,
    Set<String> protectedIds,
  ) {
    final oldGroups = <(String, String), List<RemoteJson>>{},
        newGroups = <(String, String), List<RemoteJson>>{};
    for (final pair in [(previous, oldGroups), (canonical, newGroups)]) {
      for (final row in pair.$1) {
        if (desktopIsPlanItem(row) && desktopIsProgressPlan(row)) continue;
        final turn = row['turnId'];
        if (turn is! String) continue;
        final canonicalTurn = turnMappings[turn] ?? turn;
        if (desktopProvisionalHistoryTurn(canonicalTurn)) continue;
        final signature = _historyStructuredSignature(
          row,
          thread,
          canonicalTurn,
        );
        if (signature != null) {
          (pair.$2[(canonicalTurn, signature)] ??= []).add(row);
        }
      }
    }
    final mappings = <String, String>{};
    for (final entry in oldGroups.entries) {
      final incoming = newGroups[entry.key];
      if (entry.value.length != 1 || incoming?.length != 1) continue;
      final old = entry.value.single, real = incoming!.single;
      final source =
          DesktopActivity.fromRow(old)?.item ??
          DesktopReasoning.fromRow(old)?.identity.item ??
          (old['subagent'] as Map?)?['item'] as String? ??
          desktopHistorySourceId(old);
      final target = desktopHistorySourceId(real);
      if (!protectedIds.contains(old['id']) &&
          desktopProvisionalHistoryItem(source) &&
          target != null &&
          !desktopProvisionalHistoryItem(target)) {
        mappings[old['id'] as String] = target;
      }
    }
    return mappings;
  }

  List<RemoteJson> _reconcileOwnedHistory(
    RemoteJson value,
    List<RemoteJson> cached, {
    _ReasoningHistory? reasoningHistory,
    int? timelineWatermark,
  }) {
    value = desktopOwnedHistory(value);
    final id = value['id'] as String;
    for (final turn
        in (value['turns'] as List? ?? []).whereType<RemoteJson>()) {
      final observed = _responseCurrent && turn['id'] is String
          ? _responseLifecycle!.facts(id).outcome(turn['id'] as String)
          : DesktopResponseOutcome.unknown;
      final outcome = observed == DesktopResponseOutcome.unknown
          ? desktopResponseHistoryOutcome(turn)
          : observed;
      turn['items'] = [
        for (final raw
            in (turn['items'] as List? ?? []).whereType<RemoteJson>())
          if (!desktopIsPlanItem(raw))
            raw
          else
            ?desktopHistoryPlanItem(
              raw,
              completed: outcome == DesktopResponseOutcome.completed,
            ),
      ];
    }
    final pendingReplacement = _historyReplacements[id];
    final replacement =
        pendingReplacement != null &&
            pendingReplacement <= (timelineWatermark ?? _timelineRevision)
        ? pendingReplacement
        : null;
    final previous = cached
        .where((row) => desktopHistoryOwnedRow(row, id, row['turnId']))
        .map(
          (row) =>
              SubagentAction.decode(
                row,
                mac: active?.macDeviceId ?? '',
                thread: id,
                turn: subagentString(row['turnId']) ?? '',
              )?.toRow() ??
              row,
        )
        .toList();
    _bindSubagents();
    for (final row in previous) {
      final action = SubagentAction.decode(
        row,
        mac: active?.macDeviceId ?? '',
        thread: id,
        turn: subagentString(row['turnId']) ?? '',
      );
      if (action != null) subagents.merge(action);
    }
    _bindActivityDevice(
      active?.macDeviceId ??
          threadList.macDeviceId ??
          transport.macDeviceId ??
          '',
    );
    for (final row in previous.where(
      (row) => DesktopActivity.fromRow(row)?.thread == id,
    )) {
      activity.restore(row, thread: id);
    }
    for (final item in previous.where(
      (item) => isGuardianRow(item) && item['threadId'] == id,
    )) {
      final review = GuardianReview.fromRow(item);
      if (review != null) guardian.upsert(id, review, live: false);
    }
    final protectedHistoryIds = <String>{
      for (final entry in _liveTimelineRevisions.entries)
        if (entry.key.$1 == id &&
            entry.value > (timelineWatermark ?? _timelineRevision))
          entry.key.$2,
    };
    final protectedTurns = {
      for (final row in previous)
        if (protectedHistoryIds.contains(row['id'])) row['turnId'],
    };
    protectedHistoryIds.addAll(
      previous
          .where((row) => protectedTurns.contains(row['turnId']))
          .map((row) => row['id'])
          .whereType<String>(),
    );
    final canonicalRows = <RemoteJson>[
      for (final turn in (value['turns'] as List? ?? []).whereType<Map>())
        for (final raw in (turn['items'] as List? ?? []).whereType<Map>())
          {...Map<String, dynamic>.from(raw), 'turnId': turn['id']},
    ];
    final turnMappings = desktopHistoryTurnMappings(
      previous,
      canonicalRows,
      protectedIds: protectedHistoryIds,
    );

    turnMappings.removeWhere((oldTurn, canonical) {
      if (threadList.data.responseChanges.canRebindHistoryTurn(
        id,
        oldTurn,
        canonical,
      )) {
        return false;
      }
      protectedHistoryIds.addAll(
        previous
            .where((row) => row['turnId'] == oldTurn)
            .map((row) => row['id'])
            .whereType<String>(),
      );
      return true;
    });
    final idle =
        !(value['turns'] as List? ?? []).whereType<Map>().any(
          (turn) =>
              desktopResponseHistoryOutcome(Map<String, dynamic>.from(turn)) ==
              DesktopResponseOutcome.running,
        ) &&
        (!_responseCurrent || !_responseLifecycle!.facts(id).suppressesLatest);
    if (replacement != null || idle) {
      // Ambiguous details can have a counterpart without proof for an ID rebind.
      final canonicalDetails = <(String, String)>{
        for (final row in canonicalRows)
          if (row['turnId'] case final String turn)
            if (_historyStructuredSignature(row, id, turn)
                case final signature?)
              (turn, signature),
      };
      final retainedDetails = <String>{...protectedHistoryIds};
      for (final row in previous) {
        final turn = turnMappings[row['turnId']] ?? row['turnId'];
        if (turn is! String || row['id'] is! String) continue;
        final signature = _historyStructuredSignature(row, id, turn);
        if (signature != null && canonicalDetails.contains((turn, signature))) {
          retainedDetails.add(row['id'] as String);
        }
      }
      final removed = desktopHistoryReplacementRemovals(
        [
          for (final row in previous)
            {
              ...row,
              if (row[reasoningMetadataKey] is Map)
                'sourceItemId': (row[reasoningMetadataKey] as Map)['item'],
              if (row['subagent'] is Map)
                'sourceItemId': (row['subagent'] as Map)['item'],
            },
        ],
        canonicalRows,
        turnMappings: turnMappings,
        protectedIds: retainedDetails,
      );
      previous.removeWhere((row) => removed.contains(row['id']));
      activity.items.removeWhere((key, _) => removed.contains(key));
      subagents.items.removeWhere((key, _) => removed.contains(key));
      _reasoning?.items.removeWhere((key, _) => removed.contains(key));
    }
    final itemMappings = _historyStructuredItemMappings(
      id,
      previous,
      canonicalRows,
      turnMappings,
      protectedHistoryIds,
    );
    final migrations = {
      ...turnMappings,
      for (final row in previous)
        if (itemMappings.containsKey(row['id']) && row['turnId'] is String)
          row['turnId'] as String:
              turnMappings[row['turnId']] ?? row['turnId'] as String,
    };
    final replacements = <String, RemoteJson>{};
    for (final entry in migrations.entries) {
      if (entry.key != entry.value) {
        threadList.data.responseChanges.rebindHistoryTurn(
          id,
          entry.key,
          entry.value,
        );
      }
      replacements.addAll({
        ...activity.rebindHistoryTurn(
          id,
          entry.key,
          entry.value,
          itemMappings: itemMappings,
        ),
        ...subagents.rebindHistoryTurn(
          id,
          entry.key,
          entry.value,
          itemMappings: itemMappings,
        ),
        if (entry.key != entry.value)
          ...guardian.rebindHistoryTurn(id, entry.key, entry.value),
        if (_reasoningCurrent())
          ..._reasoning!.rebindHistoryTurn(
            id,
            entry.key,
            entry.value,
            itemMappings: itemMappings,
          ),
      });
      if (_responseCurrent && entry.key != entry.value) {
        _responseLifecycle!.rebindHistoryTurn(id, entry.key, entry.value);
      }
    }
    for (var i = 0; i < previous.length; i++) {
      final old = previous[i], turn = migrations[previous[i]['turnId']];
      previous[i] =
          replacements[old['id']] ??
          (turn != null
              ? {
                  ...old,
                  'id': ?itemMappings[old['id']],
                  'sourceItemId': ?itemMappings[old['id']],
                  'turnId': turn,
                  if (old.containsKey('turn_id')) 'turn_id': turn,
                }
              : old);
    }
    final items = <RemoteJson>[];
    for (final rawTurn in (value['turns'] as List? ?? [])) {
      final turn = rawTurn as RemoteJson;
      _reasoningHistoryTurn(turn, id, reasoningHistory);
      for (final rawItem in (turn['items'] as List? ?? [])) {
        final item = Map<String, dynamic>.from(rawItem as Map);
        if (item['type'] == 'reasoning' && reasoningHistory != null) {
          final row = _reasoningHistoryRow(item, id, turn, reasoningHistory);
          if (row != null && !items.any((old) => old['id'] == row['id'])) {
            items.add(row);
          }
          continue;
        }
        item['turnId'] =
            turn['id'] ??
            turn['turnId'] ??
            turn['turn_id'] ??
            item['turnId'] ??
            item['turn_id'];
        if (desktopIsPlanItem(item)) {
          final progress = desktopIsProgressPlan(item);
          final matches = previous
              .where(
                (row) =>
                    item['turnId'] is String &&
                    row['turnId'] == item['turnId'] &&
                    desktopIsPlanItem(row) &&
                    desktopIsProgressPlan(row) == progress &&
                    (progress ||
                        desktopHistorySourceId(row) ==
                            desktopHistorySourceId(item)),
              )
              .toList();
          var row = item;
          if (matches.length == 1) {
            final old = matches.single, source = desktopHistorySourceId(item);
            row = {
              ...(protectedHistoryIds.contains(old['id']) ? old : item),
              'id': old['id'],
              'sourceItemId': ?source,
            };
            if (row['sourceItemId'] == row['id']) row.remove('sourceItemId');
          }
          final existing = items.indexWhere((old) => old['id'] == row['id']);
          if (existing < 0) {
            items.add(desktopHistoryItem(row));
          } else {
            items[existing] = desktopHistoryItem(row);
          }
          continue;
        }
        if (item['type'] == 'agentMessage' &&
            item['id'] is String &&
            item['turnId'] is String) {
          // History associates existing raw provenance; it never supplies patches.
          final ledger = threadList.data.responseChanges;
          final existing = ledger.entries.values
              .where((e) => e.thread == id && e.turn == item['turnId'])
              .firstOrNull;
          if (existing != null) {
            ledger.noteAssistant(
              id,
              item['turnId'] as String,
              item['id'] as String,
            );
            if ({
              'completed',
              'failed',
              'stopped',
              'interrupted',
            }.contains(turn['status'])) {
              existing.terminal = true;
            }
          }
        }
        final subagent = SubagentAction.decode(
          item,
          mac: active?.macDeviceId ?? '',
          thread: id,
          turn: subagentString(item['turnId']) ?? '',
        );
        if (subagent != null) {
          final row = subagents.merge(subagent).toRow();
          final index = items.indexWhere((item) => item['id'] == row['id']);
          if (index < 0) {
            items.add(row);
          } else {
            items[index] = row;
          }
        } else if (isGuardianRow(item)) {
          final review = GuardianReview.decode({...item, 'threadId': id});
          if (review == null) continue;
          guardian.upsert(id, review, live: false);
          final row = guardian.find(id, review.reviewId)!.toRow(id);
          final index = items.indexWhere((item) => item['id'] == row['id']);
          if (index < 0) {
            items.add(row);
          } else {
            items[index] = row;
          }
        } else {
          final activityTurn =
              activityString(turn['id']) ??
              activityString(turn['turnId']) ??
              activityString(turn['turn_id']) ??
              activityString(item['turnId']) ??
              activityString(item['turn_id']) ??
              '';
          final candidate = DesktopActivity.fromItem(
            item,
            mac: active?.macDeviceId ?? '',
            thread: id,
            turn: activityTurn,
          );
          final newer =
              candidate != null && protectedHistoryIds.contains(candidate.id)
              ? activity.items[candidate.id]
              : null;
          final projected =
              newer ?? activity.restore(item, thread: id, turn: activityTurn);
          if (projected == null) {
            items.add(desktopHistoryItem(item));
          } else {
            final row = projected.toRow();
            final index = items.indexWhere((item) => item['id'] == row['id']);
            if (index < 0) {
              items.add(row);
            } else {
              items[index] = row;
            }
          }
        }
      }
    }
    final reconciled = desktopReconcileHistory(
      previous.where(desktopOrdinaryHistoryRow).toList(),
      items,
      protectedLiveIds: protectedHistoryIds,
      runningTurns: {
        if (_responseCurrent)
          for (final entry in _responseLifecycle!.facts(id).outcomes.entries)
            if (entry.value == DesktopResponseOutcome.running) entry.key,
      },
      canonicalSnapshot: true,
    );
    items
      ..clear()
      ..addAll(reconciled.rows);
    // Notification-only reviews may be absent from server history. Retain their prior anchors.
    for (var i = 0; i < previous.length; i++) {
      final old = previous[i];
      if (desktopOrdinaryHistoryRow(old) ||
          old['type'] == 'reasoning' && !_reasoningRowMatchesThread(old, id) ||
          old['threadId'] != null && old['threadId'] != id ||
          items.any((item) => item['id'] == old['id'])) {
        continue;
      }
      final next = previous
          .skip(i + 1)
          .map((item) => item['id'])
          .where((next) => items.any((item) => item['id'] == next))
          .firstOrNull;
      final index = next == null
          ? items.length
          : items.indexWhere((item) => item['id'] == next);
      items.insert(index, old);
    }
    if (replacement != null && _historyReplacements[id] == replacement) {
      _historyReplacements.remove(id);
    }
    _syncSubagentLifecycle(id, history: value);
    return items;
  }
}
