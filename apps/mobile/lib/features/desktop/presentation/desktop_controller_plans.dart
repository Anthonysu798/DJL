part of 'desktop_controller.dart';

/// Plan mode: plan questionnaires, proposals and implementing a plan.
extension DesktopPlans on DesktopController {
  RemoteJson? _planSession(String id) {
    final mac = active?.macDeviceId, pin = active?.data['macIdentityPublicKey'];
    final saved = threadList.data.planSessions[id];
    return mac != null &&
            threadList.macDeviceId == mac &&
            pin is String &&
            pin.isNotEmpty &&
            saved?['identityPin'] == pin
        ? saved
        : null;
  }

  void _recordPlanSession(String id, String source) {
    final mac = active?.macDeviceId, pin = active?.data['macIdentityPublicKey'];
    if (mac == null ||
        threadList.macDeviceId != mac ||
        pin is! String ||
        pin.isEmpty ||
        id.trim().isEmpty ||
        threadList.data.deleted.contains(id)) {
      return;
    }
    final previous = _planSession(id);
    threadList.data.planSessions[id] = {
      'identityPin': pin,
      'source': source == 'requested'
          ? (previous?['source'] ?? source)
          : source,
    };
    threadList.scheduleSave();
  }

  bool get usesNativePlanPresentation {
    final id = thread?['id'];
    return id is String &&
        {'requested', 'native'}.contains(_planSession(id)?['source']);
  }

  DesktopPlanQuestionnaire? inferredPlanQuestionnaire(RemoteJson row) {
    final id = thread?['id'];
    if (id is! String ||
        _planSession(id)?['source'] != 'compatibilityFallback' ||
        !desktopHistoryOwnedRow(row, id, row['turnId']) ||
        row['type'] != 'agentMessage' && !desktopIsPlanItem(row) ||
        row['type'] == 'agentMessage' && row['isStreaming'] == true) {
      return null;
    }
    final questionnaire = DesktopPlanQuestionnaire.parse(
      desktopPlanBody(row),
      assistant: row['type'] == 'agentMessage',
    );
    if (questionnaire == null) return null;
    String normalized(Object? value) =>
        value is String ? value.trim().toLowerCase() : '';
    String signature(List questions) => jsonEncode([
      for (final q in questions.whereType<Map>())
        [
          normalized(q['question']),
          for (final o in (q['options'] as List? ?? []).whereType<Map>())
            normalized(o['label']),
        ],
    ]);
    final expected = signature(questionnaire.questions);
    for (final request in pendingUserInputs) {
      final params = request['params'] as Map? ?? {};
      final turn = params['turnId'];
      if (turn != null && row['turnId'] != null
          ? turn == row['turnId']
          : signature(params['questions'] as List? ?? []) == expected) {
        return null;
      }
    }
    final index = timeline.indexWhere((item) => item['id'] == row['id']);
    var end = timeline.length;
    if (desktopIsPlanItem(row)) {
      for (var i = index + 1; i < timeline.length; i++) {
        if (desktopIsPlanItem(timeline[i])) {
          end = i;
          break;
        }
      }
    }
    for (var i = 0; i < timeline.length; i++) {
      final candidate = timeline[i];
      if (candidate['type'] != 'userInputPrompt' ||
          !desktopHistoryOwnedRow(candidate, id, candidate['turnId'])) {
        continue;
      }
      final raw = candidate['structuredUserInputRequest'];
      final questions =
          (raw is Map ? raw['questions'] : candidate['questions']) as List? ??
          [];
      if (row['turnId'] != null && candidate['turnId'] != null
          ? row['turnId'] == candidate['turnId']
          : i >= index && i < end && signature(questions) == expected) {
        return null;
      }
    }
    return questionnaire;
  }

  Future<bool> answerInferredPlanQuestionnaire(
    String item,
    Map<String, List<String>> answers, {
    bool Function()? canContinue,
  }) async {
    final scope = _stopContext;
    final row = timeline.where((row) => row['id'] == item).firstOrNull;
    final questionnaire = row == null ? null : inferredPlanQuestionnaire(row);
    if (scope == null || busy || row == null || questionnaire == null) {
      return false;
    }
    final body = desktopPlanBody(row);
    bool current() {
      final session = _planSession(scope.thread);
      return _stopContext == scope &&
          canContinue?.call() != false &&
          timeline.any((r) => r['id'] == item && desktopPlanBody(r) == body) &&
          (session?['source'] == 'compatibilityFallback' ||
              !supportsPlan && session == null);
    }

    if (!current() || answers.length != questionnaire.questions.length) {
      return false;
    }
    final sections = <String>[];
    for (final q in questionnaire.questions.indexed) {
      final values = (answers[q.$2['id']] ?? [])
          .map((s) => s.trim())
          .where((s) => s.isNotEmpty)
          .toList();
      final limit =
          q.$2['selectionLimit'] as int? ??
          ((q.$2['options'] as List).isEmpty ? null : 1);
      if (values.isEmpty || limit != null && values.length > limit) {
        return false;
      }
      sections.add(
        '${q.$1 + 1}. ${q.$2['question']}\n${values.length == 1 ? values.single : values.map((s) => '- $s').join('\n')}',
      );
    }
    final token = (scope, item, body);
    if (!_inferredPlanAnswers.add(token)) return false;
    try {
      if (turnId == null) {
        final revision = _responseRunRevision, binding = _responseConnection;
        bool lookupCurrent() =>
            current() &&
            turnId == null &&
            revision == _responseRunRevision &&
            binding == _responseConnection;
        final active = await _resolveActiveTurnSnapshot(
          scope.thread,
          lookupCurrent,
        );
        if (!lookupCurrent()) return false;
        if (active.pending) {
          throw StateError(
            'The active run has not published its ID yet. Try again in a moment.',
          );
        }
        if (active.activeTurnId case final target?) {
          _adoptTurnTarget(scope.thread, null, target);
        }
      }
      if (!current()) return false;
      if (selectedModel == null) {
        throw StateError('Choose an available desktop model first.');
      }
      final snapshot = DesktopRuntime(
        model: selectedModel,
        effort: effort,
        access: access,
        plan: true,
        serviceTier: serviceTier,
      );
      return await _sendDraft(
        DesktopComposerDraft(text: 'Answers:\n\n${sections.join('\n\n')}'),
        runtimeSnapshot: snapshot,
        collaborationMode:
            snapshot.parameters(forTurn: true)['collaborationMode']
                as RemoteJson?,
        canContinue: current,
      );
    } catch (e) {
      if (current()) error = e.toString();
      return false;
    } finally {
      _inferredPlanAnswers.remove(token);
      _notify();
    }
  }

  DesktopPlan? responsePlanProposal(RemoteJson row) {
    final id = thread?['id'];
    if (id is! String || !desktopHistoryOwnedRow(row, id, row['turnId'])) {
      return null;
    }
    final native = DesktopPlan.fromRow(row);
    if (native != null) return native;
    if (row['type'] != 'agentMessage' ||
        row['isStreaming'] == true ||
        usesNativePlanPresentation) {
      return null;
    }
    final text = desktopPlanBody(row);
    final parsed = desktopProposedPlan(text);
    final body =
        parsed?.body ??
        (_planSession(id)?['source'] == 'compatibilityFallback' &&
                inferredPlanQuestionnaire(row) == null
            ? desktopLegacyProposedPlan(text)
            : null);
    if (body == null) return null;
    final turn = row['turnId'];
    final outcome = _responseCurrent && turn is String
        ? _responseLifecycle!.facts(id).outcome(turn)
        : DesktopResponseOutcome.unknown;
    final completed =
        turn is String &&
        (outcome == DesktopResponseOutcome.completed ||
            outcome == DesktopResponseOutcome.unknown &&
                (thread?['turns'] as List? ?? []).whereType<Map>().any(
                  (t) =>
                      t['id'] == turn &&
                      desktopResponseHistoryOutcome(
                            Map<String, dynamic>.from(t),
                          ) ==
                          DesktopResponseOutcome.completed,
                ));
    return DesktopPlan({
      ...row,
      'type': 'plan',
      'text': body,
      'plan': <RemoteJson>[],
      'djlProgressPlan': false,
      'djlJsonlProgressPlan': false,
      'planPresentation': completed ? 'resultReady' : 'resultClosed',
      'isStreaming': false,
    });
  }

  bool canImplementPlan(String item, String body) {
    if (_stopContext == null ||
        busy ||
        projectMoveBusy ||
        selectedModel == null) {
      return false;
    }
    final row = timeline.where((row) => row['id'] == item).firstOrNull;
    final proposal = row == null ? null : responsePlanProposal(row);
    return proposal != null &&
        proposal.inlineResult &&
        !proposal.streaming &&
        proposal.presentation == 'resultReady' &&
        proposal.body == body;
  }

  Future<bool> implementPlan(
    String item, {
    required String body,
    bool Function()? canContinue,
  }) async {
    final scope = _stopContext;
    if (scope == null ||
        !canImplementPlan(item, body) ||
        canContinue?.call() == false) {
      return false;
    }
    final token = (scope, item, body);
    if (!_planImplementations.add(token)) return false;
    bool ownsPlan() {
      if (_stopContext != scope || canContinue?.call() == false) return false;
      final row = timeline.where((row) => row['id'] == item).firstOrNull;
      final proposal = row == null ? null : responsePlanProposal(row);
      return proposal?.presentation == 'resultReady' && proposal?.body == body;
    }

    final selected = runtime;
    final execution = DesktopRuntime(
      model: selected.model,
      effort: selected.effort,
      access: selected.access,
      plan: false,
      serviceTier: selected.serviceTier,
    );
    try {
      if (turnId == null) {
        final runRevision = _responseRunRevision;
        bool current() =>
            ownsPlan() && _responseRunRevision == runRevision && turnId == null;
        final snapshot = await _resolveActiveTurnSnapshot(
          scope.thread,
          current,
        );
        if (!current()) return false;
        if (snapshot.pending) {
          throw StateError(
            'The active run has not published its ID yet. Try again in a moment.',
          );
        }
        if (snapshot.activeTurnId case final target?) {
          if (_finishedTurns.contains((scope.thread, target))) {
            throw StateError(
              'The active run changed. Refresh before implementing this plan.',
            );
          }
          _adoptTurnTarget(scope.thread, null, target);
        }
      }
      if (!ownsPlan()) return false;
      final accepted = await _sendDraft(
        DesktopComposerDraft(text: 'Implement plan.'),
        runtimeSnapshot: execution,
        canContinue: ownsPlan,
        collaborationMode: {
          'mode': 'default',
          'settings': {
            'model': execution.modelName,
            'reasoning_effort': execution.effort,
            'developer_instructions': null,
          },
        },
      );
      if (accepted && ownsPlan()) {
        plan = false;
        _passiveSelection = null;
        _rememberCurrent();
        _notify();
      }
      return accepted;
    } catch (failure) {
      if (ownsPlan()) {
        error = failure.toString();
        _notify();
      }
      return false;
    } finally {
      _planImplementations.remove(token);
    }
  }
}
