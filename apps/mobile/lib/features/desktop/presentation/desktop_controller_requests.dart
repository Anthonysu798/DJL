part of 'desktop_controller.dart';

/// Approvals and questions from the agent, and answering them.
extension DesktopRequests on DesktopController {
  bool canRespond(RemoteJson request) =>
      runtimeReady &&
      requestMatchesConnection(request) &&
      !isClosingQuestion(request) &&
      request['_submitted'] != true &&
      request['_submitting'] != true;

  Future<void> _respond(RemoteJson request, RemoteJson result) async {
    if (_closingQuestions.containsKey(request)) return;
    if (request['_submitted'] == true || request['_submitting'] == true) return;
    if (!requestMatchesConnection(request)) {
      error =
          'This request belongs to an earlier desktop session. Refresh the chat.';
      _notify();
      return;
    }
    final generation = _connectGeneration;
    request['_submitting'] = true;
    _rememberCurrent();
    _notify();
    try {
      await transport.send({'id': request['id'], 'result': result});
      if (generation == _connectGeneration) request['_submitted'] = true;
    } catch (e) {
      if (generation == _connectGeneration) error = e.toString();
    } finally {
      request.remove('_submitting');
      if (generation == _connectGeneration) {
        _rememberCurrent();
        _notify();
      }
    }
  }

  void _resetSubmittedQuestions() {
    for (final request in userInputs) {
      if (request.remove('_submitted') == true ||
          request.remove('_submitting') == true) {
        request['_responseUnknown'] = true;
      }
    }
  }

  bool isClosingQuestion(RemoteJson request) =>
      _closingQuestions[request] == _stopContext &&
      _closingQuestions.containsKey(request);

  Future<bool> cancelQuestion(RemoteJson request) async {
    final scope = _stopContext;
    if (scope == null ||
        !canRespond(request) ||
        !_requestForCurrentThread(request) ||
        !userInputs.any((q) => identical(q, request)) ||
        _closingQuestions.containsKey(request)) {
      return false;
    }
    final params = request['params'] as RemoteJson? ?? {};
    final prompts = userInputs
        .where(
          (q) => _requestForCurrentThread(q) && requestMatchesConnection(q),
        )
        .toList();
    final session = _planSession(scope.thread);
    bool current() =>
        _stopContext == scope &&
        requestMatchesConnection(request) &&
        !userInputs.any(
          (q) => q['id'] == request['id'] && !identical(q, request),
        );
    _closingQuestions[request] = scope;
    error = null;
    setPlan(false);
    try {
      var target = _realTurnId(params['turnId']) ?? _realTurnId(turnId);
      target ??= await _steerActiveTurnId(scope.thread, current);
      if (!current()) return false;
      if (target != null) {
        await transport.request('turn/interrupt', {
          'threadId': scope.thread,
          'turnId': target,
        });
      }
      if (!current()) return false;
      userInputs.removeWhere((q) => prompts.any((p) => identical(p, q)));
      if (!userInputs.any(_requestForCurrentThread) &&
          identical(_planSession(scope.thread), session)) {
        threadList.data.planSessions.remove(scope.thread);
        threadList.scheduleSave();
      }
      _rememberCurrent();
      return true;
    } catch (e) {
      if (current()) error = e.toString();
      return false;
    } finally {
      _closingQuestions.remove(request);
      if (_stopContext == scope) {
        _notify();
      }
    }
  }

  void _enqueueRequest(List<RemoteJson> list, RemoteJson rpc) {
    final index = list.indexWhere((old) => old['id'] == rpc['id']);
    rpc = {
      ...rpc,
      '_macDeviceId': transport.macDeviceId ?? active?.macDeviceId,
      '_sessionId': transport.sessionId ?? active?.sessionId,
      '_receivedAt':
          (index < 0 ? null : list[index]['_receivedAt']) ??
          DateTime.now().millisecondsSinceEpoch,
    };
    if (index < 0) {
      list.add(rpc);
    } else {
      list[index] = rpc;
    }
  }

  Future<void> _rejectUnknown(RemoteJson rpc) async {
    try {
      await transport.send({
        'id': rpc['id'],
        'error': {
          'code': -32601,
          'message': 'Unsupported request method: ${rpc['method']}',
        },
      });
    } catch (e) {
      error = e.toString();
      _notify();
    }
  }
}
