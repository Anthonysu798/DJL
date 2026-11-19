import 'dart:convert';

/// Received status eligibility, not proof of successful work across adapters.
enum DesktopResponseOutcome { unknown, running, completed, failed, stopped }

class DesktopResponseFooterFacts {
  DesktopResponseFooterFacts({
    Map<String, DesktopResponseOutcome> outcomes = const {},
    this.pending = false,
    Set<String> interrupting = const {},
    this.latestTurn,
  }) : outcomes = Map.unmodifiable(outcomes),
       interrupting = Set.unmodifiable(interrupting);

  final Map<String, DesktopResponseOutcome> outcomes;
  final bool pending;
  final Set<String> interrupting;
  final String? latestTurn;

  DesktopResponseOutcome get latestOutcome => latestTurn == null
      ? DesktopResponseOutcome.unknown
      : outcome(latestTurn!);

  DesktopResponseOutcome outcome(String turn) =>
      outcomes[turn] ?? DesktopResponseOutcome.unknown;

  bool get suppressesLatest =>
      pending ||
      interrupting.isNotEmpty ||
      outcomes.values.contains(DesktopResponseOutcome.running);
}

Map _object(Object? value) => value is Map ? value : const {};
String? _text(Object? value) =>
    value is String && value.trim().isNotEmpty ? value : null;
String? _status(Object? value) {
  final map = _object(value);
  return _text(value) ??
      _text(map['type']) ??
      _text(map['statusType']) ??
      _text(map['status_type']);
}

DesktopResponseOutcome _outcome(String? status) {
  final value =
      status?.trim().toLowerCase().replaceAll(RegExp(r'[_\-\s]'), '') ?? '';
  if (['cancel', 'abort', 'interrupt', 'stopped'].any(value.contains)) {
    return DesktopResponseOutcome.stopped;
  }
  if (value.contains('fail') || value.contains('error')) {
    return DesktopResponseOutcome.failed;
  }
  if ({'idle', 'notloaded', 'completed', 'done', 'finished'}.contains(value)) {
    return DesktopResponseOutcome.completed;
  }
  if ({
    'inprogress',
    'running',
    'active',
    'starting',
    'started',
    'pending',
    'processing',
  }.contains(value)) {
    return DesktopResponseOutcome.running;
  }
  return DesktopResponseOutcome.unknown;
}

DesktopResponseOutcome desktopResponseHistoryOutcome(
  Map<String, dynamic> turn,
) {
  if ([
        'djlHistoryCompacted',
        'djlSynthetic',
        'synthetic',
        'isSynthetic',
      ].any((key) => turn[key] == true) ||
      (_text(turn['id'])?.startsWith('djl-history-compacted-') ?? false)) {
    return DesktopResponseOutcome.unknown;
  }
  return _outcome(_status(turn['status']) ?? _text(turn['result']));
}

DesktopResponseOutcome desktopResponseLiveOutcome(Map<String, dynamic> params) {
  final turn = _object(params['turn']), event = _object(params['event']);
  for (final value in [turn, params, event]) {
    if (_text(_object(value['error'])['message']) != null ||
        _text(value['errorMessage']) != null) {
      return DesktopResponseOutcome.failed;
    }
  }
  return _outcome(
    _status(turn['status']) ??
        _status(params['status']) ??
        _status(event['status']),
  );
}

/// Reject conflicting aliases instead of assigning a fact to an arbitrary chat.
({String thread, String? turn})? desktopResponseIdentity(
  Map<String, dynamic> params,
) {
  final threads = <Object?>[], turns = <Object?>[];
  for (final map in [
    params,
    _object(params['event']),
    _object(params['msg']),
    if ({
      'userMessage',
      'agentMessage',
    }.contains(_object(params['item'])['type']))
      _object(params['item']),
  ]) {
    final turn = _object(map['turn']);
    threads.addAll([
      map['threadId'],
      map['thread_id'],
      map['conversationId'],
      map['conversation_id'],
      _object(map['thread'])['id'],
      turn['threadId'],
      turn['thread_id'],
    ]);
    turns.addAll([
      map['turnId'],
      map['turn_id'],
      turn['id'],
      turn['turnId'],
      turn['turn_id'],
      if (map['turn'] is String) map['turn'],
    ]);
  }
  final threadIds = threads.where((v) => v != null).toSet();
  final turnIds = turns.where((v) => v != null).toSet();
  if (threadIds.length != 1 ||
      _text(threadIds.single) == null ||
      turnIds.length > 1 ||
      turnIds.any((v) => _text(v) == null)) {
    return null;
  }
  return (
    thread: threadIds.single as String,
    turn: turnIds.isEmpty ? null : turnIds.single as String,
  );
}

typedef _OutcomeFact = ({
  DesktopResponseOutcome outcome,
  int revision,
  bool terminal,
  bool backgroundGuess,
});

class _ThreadOutcomes {
  final turns = <String, _OutcomeFact>{};
  final interrupting = <String, int>{};
  bool pending = false;
  int pendingRevision = 0;
  int? localStartRevision;
  String? localStartTurn;
  int revision = 0;
  String? latestTurn;
  int latestRevision = 0;
  ({String turn, DateTime at, int staleCount})? mirror;
}

/// In-memory only. The controller owns trust, connection and cache lifetimes.
class DesktopResponseLifecycle {
  DesktopResponseLifecycle({DateTime Function()? now})
    : _now = now ?? DateTime.now;
  final DateTime Function() _now;
  int revision = 0;
  final _threads = <String, _ThreadOutcomes>{};
  _ThreadOutcomes _thread(String id) =>
      _threads.putIfAbsent(id, _ThreadOutcomes.new);

  int pendingRevisionFor(String thread) =>
      _threads[thread]?.pending == true ? _threads[thread]!.pendingRevision : 0;

  void resetProjectedTerminals(String thread) {
    final state = _threads[thread];
    if (state == null) return;
    final removed = state.turns.entries
        .where((e) => e.key.startsWith('ipc-turn-') && e.value.terminal)
        .toList();
    final owner = state.localStartRevision;
    if (owner != null && removed.any((e) => e.value.revision >= owner)) {
      state.localStartRevision = null;
      state.localStartTurn = null;
      if (state.pendingRevision == owner) state.pending = false;
    }
    for (final entry in removed) {
      state.turns.remove(entry.key);
      state.interrupting.remove(entry.key);
      if (state.latestTurn == entry.key) state.latestTurn = null;
      if (state.mirror?.turn == entry.key) state.mirror = null;
    }
    if (removed.isNotEmpty) {
      state.revision = ++revision;
      state.latestRevision = revision;
    }
  }

  int beginLocalStart(String thread) {
    final state = _thread(thread);
    _beginPending(state);
    state.localStartRevision = state.pendingRevision;
    return state.pendingRevision;
  }

  void _beginPending(_ThreadOutcomes state) {
    state.localStartRevision = null;
    state.localStartTurn = null;
    state.pending = true;
    state.revision = ++revision;
    state.pendingRevision = revision;
    state.latestTurn = null;
    state.latestRevision = revision;
  }

  bool acknowledgeLocalStart(String thread, String turn, int ownerRevision) {
    final state = _threads[thread];
    if (state == null || state.localStartRevision != ownerRevision) {
      return false;
    }
    final owns =
        (state.localStartTurn == null || state.localStartTurn == turn) &&
        (state.latestTurn == null || state.latestTurn == turn);
    state.localStartRevision = null;
    state.localStartTurn = null;
    if (!owns) return false;
    state.pending = false;
    if (state.turns[turn]?.terminal == true) {
      state.latestTurn = turn;
      state.revision = ++revision;
      state.latestRevision = revision;
    } else {
      starting(thread, turn);
    }
    return true;
  }

  bool isTurnTerminal(String thread, String turn) =>
      _threads[thread]?.turns[turn]?.terminal == true;

  bool isBackgroundGuess(String thread, String turn) =>
      _threads[thread]?.turns[turn]?.backgroundGuess == true;

  void noteActivity(
    String thread,
    String? turn,
    DateTime at, {
    bool mirrored = false,
  }) {
    final state = _threads[thread], active = _threads[thread]?.latestTurn;
    if (state == null ||
        active == null ||
        turn != null && turn != active ||
        state.turns[active]?.outcome != DesktopResponseOutcome.running) {
      return;
    }
    final previous = state.turns[active]!;
    state.turns[active] = (
      outcome: previous.outcome,
      revision: ++revision,
      terminal: previous.terminal,
      backgroundGuess: previous.backgroundGuess,
    );
    state.revision = revision;
    state.latestRevision = revision;
    if (mirrored || state.mirror?.turn == active) {
      state.mirror = (turn: active, at: at, staleCount: 0);
    }
  }

  bool reviveBackgroundGuess(String thread, String turn) {
    final state = _threads[thread], previous = _threads[thread]?.turns[turn];
    if (state == null ||
        previous?.backgroundGuess != true ||
        previous?.outcome != DesktopResponseOutcome.stopped ||
        state.pending ||
        state.latestTurn != turn &&
            state.turns[state.latestTurn]?.outcome ==
                DesktopResponseOutcome.running) {
      return false;
    }
    state.turns.remove(turn);
    state.localStartRevision = null;
    state.localStartTurn = null;
    starting(thread, turn);
    return true;
  }

  void runningStatus(String thread, String? turn) {
    final state = _thread(thread);
    if (turn == null &&
        (state.pending ||
            state.turns[state.latestTurn]?.outcome ==
                DesktopResponseOutcome.running)) {
      return;
    }
    starting(thread, turn);
  }

  void rebindHistoryTurn(String thread, String oldTurn, String turn) {
    final state = _threads[thread];
    if (state == null) return;
    final old = state.turns.remove(oldTurn);
    if (old != null) state.turns.putIfAbsent(turn, () => old);
    // Canonical history has already observed its outcome; retire stale aliases.
    final interrupted = state.interrupting.remove(oldTurn);
    if (interrupted != null && state.turns[turn]?.terminal != true) {
      state.interrupting.putIfAbsent(turn, () => interrupted);
    }
    if (state.latestTurn == oldTurn) state.latestTurn = turn;
    if (state.localStartTurn == oldTurn) state.localStartTurn = turn;
    if (state.mirror case final lease? when lease.turn == oldTurn) {
      state.mirror = (turn: turn, at: lease.at, staleCount: lease.staleCount);
    }
  }

  DesktopResponseFooterFacts facts(String thread) {
    final state = _threads[thread];
    return DesktopResponseFooterFacts(
      outcomes: {
        for (final entry
            in state?.turns.entries ?? <MapEntry<String, _OutcomeFact>>[])
          entry.key: entry.value.outcome,
      },
      pending: state?.pending ?? false,
      interrupting: state?.interrupting.keys.toSet() ?? const {},
      latestTurn: state?.latestTurn,
    );
  }

  void starting(String thread, [String? turn]) {
    final state = _thread(thread);
    if (turn == null) {
      _beginPending(state);
      return;
    }
    final previous = state.turns[turn];
    // A duplicate/reordered start cannot reopen a settled stable turn.
    if (previous?.terminal == true) return;
    if (state.localStartRevision != null) {
      if (state.localStartTurn == null && state.pending) {
        state.localStartTurn = turn;
      } else if (state.localStartTurn != turn) {
        state.localStartRevision = null;
        state.localStartTurn = null;
      }
    }
    state.turns[turn] = (
      outcome: DesktopResponseOutcome.running,
      revision: ++revision,
      terminal: false,
      backgroundGuess: false,
    );
    state.revision = revision;
    state.pending = false;
    state.latestTurn = turn;
    state.latestRevision = revision;
  }

  void interrupt(String thread, String turn) {
    final state = _thread(thread);
    state.interrupting[turn] = ++revision;
    state.revision = revision;
  }

  void cancelInterrupt(String thread, String turn, int watermark) {
    final state = _threads[thread],
        marked = _threads[thread]?.interrupting[turn];
    if (state == null || marked == null || marked > watermark) return;
    state.interrupting.remove(turn);
    state.revision = ++revision;
  }

  void terminal(
    String thread,
    String turn,
    DesktopResponseOutcome outcome, {
    bool backgroundGuess = false,
  }) {
    final state = _thread(thread), previous = _thread(thread).turns[turn];
    backgroundGuess =
        backgroundGuess &&
        outcome == DesktopResponseOutcome.stopped &&
        !state.interrupting.containsKey(turn);
    if (backgroundGuess &&
        previous?.terminal == true &&
        {
          DesktopResponseOutcome.completed,
          DesktopResponseOutcome.failed,
        }.contains(previous?.outcome)) {
      return;
    }
    if (previous?.outcome == DesktopResponseOutcome.stopped) {
      if (!backgroundGuess && previous!.backgroundGuess) {
        state.turns[turn] = (
          outcome: DesktopResponseOutcome.stopped,
          revision: ++revision,
          terminal: true,
          backgroundGuess: false,
        );
        state.revision = revision;
      }
    } else {
      state.turns[turn] = (
        outcome: outcome,
        revision: ++revision,
        terminal: true,
        backgroundGuess: backgroundGuess,
      );
      state.revision = revision;
    }
    state.interrupting.remove(turn);
    if (state.mirror?.turn == turn) state.mirror = null;
    if (state.latestTurn == turn ||
        (state.latestTurn == null && !state.pending)) {
      state.latestTurn = turn;
      state.latestRevision = revision;
    }
    // Only a stable start associates a turn with an ID-less pending start.
    // An unseen terminal may belong to older history, including replay.
  }

  String? history(
    String thread,
    Iterable<Map<String, dynamic>> turns,
    int watermark, {
    bool confirmedIdle = false,
  }) {
    final state = _thread(thread);
    final incoming = turns.toList();
    final oldLatest = state.latestTurn, lease = state.mirror;
    final previous = state.turns[oldLatest];
    final closesCurrent = incoming.any(
      (turn) =>
          turn['id'] == oldLatest &&
          {
            DesktopResponseOutcome.completed,
            DesktopResponseOutcome.failed,
            DesktopResponseOutcome.stopped,
          }.contains(desktopResponseHistoryOutcome(turn)),
    );
    var preserveMirror = false;
    String? guessedStop;
    if (!confirmedIdle &&
        lease != null &&
        lease.turn == oldLatest &&
        previous?.outcome == DesktopResponseOutcome.running &&
        previous!.revision <= watermark &&
        !closesCurrent) {
      if (lease.staleCount < 3 ||
          _now().difference(lease.at) <= const Duration(seconds: 20)) {
        preserveMirror = true;
        state.mirror = (
          turn: lease.turn,
          at: lease.at,
          staleCount: lease.staleCount + 1,
        );
      } else {
        terminal(
          thread,
          lease.turn,
          DesktopResponseOutcome.stopped,
          backgroundGuess: true,
        );
        guessedStop = lease.turn;
        preserveMirror = true;
      }
    }
    final canObservePending = state.revision <= watermark;
    final canObserveLatest = state.latestRevision <= watermark;
    final stoppedLatest =
        state.turns[state.latestTurn]?.outcome ==
        DesktopResponseOutcome.stopped;
    var sawPreviousLatest = false;
    String? latest;
    for (final turn in incoming) {
      final outcome = desktopResponseHistoryOutcome(turn);
      final id = _text(turn['id']);
      if (id == null) {
        if (canObservePending && outcome == DesktopResponseOutcome.running) {
          state.pending = true;
          state.revision = ++revision;
          state.pendingRevision = revision;
        }
        continue;
      }
      latest = id;
      if (id == state.latestTurn) sawPreviousLatest = true;
      final previous = state.turns[id];
      if (previous != null) {
        if (previous.revision > watermark) continue;
        if (previous.terminal &&
            {
              DesktopResponseOutcome.running,
              DesktopResponseOutcome.stopped,
            }.contains(outcome) &&
            {
              DesktopResponseOutcome.completed,
              DesktopResponseOutcome.failed,
            }.contains(previous.outcome)) {
          continue;
        }
        if (previous.outcome == DesktopResponseOutcome.stopped) {
          if (previous.backgroundGuess &&
              {
                DesktopResponseOutcome.completed,
                DesktopResponseOutcome.failed,
              }.contains(outcome)) {
            state.turns[id] = (
              outcome: DesktopResponseOutcome.stopped,
              revision: ++revision,
              terminal: true,
              backgroundGuess: false,
            );
            state.revision = revision;
          }
          continue;
        }
      }
      final terminal = {
        DesktopResponseOutcome.completed,
        DesktopResponseOutcome.failed,
        DesktopResponseOutcome.stopped,
      }.contains(outcome);
      final interruptedAt = state.interrupting[id];
      if (terminal && interruptedAt != null && interruptedAt <= watermark) {
        state.interrupting.remove(id);
      }
      state.turns[id] = (
        outcome: outcome,
        revision: ++revision,
        terminal: previous?.terminal == true || terminal,
        backgroundGuess: outcome == DesktopResponseOutcome.stopped,
      );
      state.revision = revision;
    }
    // Explicit recovery may close provisional facts from before its fresh idle
    // snapshot. A newer live event still owns the state above that watermark.
    if (confirmedIdle && canObservePending) {
      state.pending = false;
      state.turns.removeWhere(
        (_, turn) => turn.outcome == DesktopResponseOutcome.running,
      );
      state.interrupting.clear();
      state.revision = ++revision;
      state.mirror = null;
    }
    if (latest != null &&
        canObserveLatest &&
        !preserveMirror &&
        (!stoppedLatest || sawPreviousLatest)) {
      state.latestTurn = latest;
      state.latestRevision = revision;
    }
    return guessedStop;
  }
}

// Copy is a local action; unknown settled text is not a claim of completion.
Map<int, String> desktopResponseCopies(
  List<Map<String, dynamic>> timeline, {
  required DesktopResponseFooterFacts facts,
  bool sending = false,
  bool available = true,
  Set<int> hiddenRows = const {},
}) {
  if (!available) return {};
  final result = <int, String>{};
  final latestUser = timeline.lastIndexWhere(
    (row) => row['type'] == 'userMessage',
  );
  var latestHost = timeline.length - 1;
  while (latestHost >= 0 &&
      (timeline[latestHost]['type'] == 'userMessage' ||
          hiddenRows.contains(latestHost))) {
    latestHost--;
  }
  final suppressed = sending || facts.suppressesLatest;
  var end = timeline.length - 1;
  while (end >= 0) {
    if (timeline[end]['type'] == 'userMessage') {
      end--;
      continue;
    }
    var start = end;
    var turn = _copyTurn(timeline[end]);
    while (start > 0 && timeline[start - 1]['type'] != 'userMessage') {
      final previous = _copyTurn(timeline[start - 1]);
      if (turn != null && previous != null && turn != previous) break;
      turn ??= previous;
      start--;
    }
    var host = end;
    while (host >= start && hiddenRows.contains(host)) {
      host--;
    }
    final outcome = turn == null
        ? DesktopResponseOutcome.unknown
        : facts.outcome(turn);
    if (host >= start &&
        outcome != DesktopResponseOutcome.stopped &&
        !(host == latestHost &&
            facts.latestOutcome == DesktopResponseOutcome.stopped) &&
        (!suppressed || latestUser > end)) {
      final text = _copyBlock(timeline, start, host);
      if (text != null) result[host] = text;
    }
    end = start - 1;
  }
  return result;
}

String? _copyTurn(Map<String, dynamic> row) {
  final value = row['turnId'];
  return value is String && value.trim().isNotEmpty ? value.trim() : null;
}

String desktopAssistantCopyText(Map<String, dynamic> row) {
  if (row['type'] != 'agentMessage') return '';
  if (row['text'] is String) return row['text'] as String;
  final content = row['content'];
  if (content is! List) return '';
  return content
      .whereType<Map>()
      .where(
        (part) =>
            {'text', 'input_text', 'output_text'}.contains(part['type']) &&
            part['text'] is String,
      )
      .map((part) => part['text'] as String)
      .join('\n');
}

bool _meaningfulCopy(String text) =>
    text.isNotEmpty &&
    (text.length > 512 ||
        utf8.encode(text).length > 512 ||
        text.trim().isNotEmpty);

String? _copyBlock(List<Map<String, dynamic>> timeline, int start, int host) {
  if (timeline[host]['type'] == 'agentMessage') {
    final text = desktopAssistantCopyText(timeline[host]);
    return _meaningfulCopy(text) ? text : null;
  }
  final parts = <String>[];
  var bytes = 0;
  for (var index = start; index <= host; index++) {
    final text = desktopAssistantCopyText(timeline[index]);
    if (!_meaningfulCopy(text)) continue;
    if (text.length > 64000) return null;
    final length = utf8.encode(text).length;
    bytes += length;
    if (bytes > 64000) return null;
    parts.add(length <= 512 ? text.trim() : text);
  }
  return parts.isEmpty ? null : parts.join('\n\n');
}
