import 'package:flutter/foundation.dart';
import '../../../app/desktop_deep_link.dart';

enum RunState { running, finishing, ready, failed, paused }

class StatusThread {
  const StatusThread(this.title, this.cwd);
  final String title, cwd;
}

class StatusRow {
  const StatusRow({
    required this.thread,
    required this.turn,
    required this.title,
    required this.detail,
    required this.state,
    required this.startedAt,
    required this.staleAt,
    required this.expiresAt,
    required this.url,
  });
  final String thread, turn, title, detail;
  final RunState state;
  final DateTime startedAt, staleAt, expiresAt;
  final Uri? url;
  Map<String, Object?> payload(bool detailed) => {
    'state': state.name,
    'startedAt': startedAt.millisecondsSinceEpoch,
    'staleAt': staleAt.millisecondsSinceEpoch,
    'expiresAt': expiresAt.millisecondsSinceEpoch,
    if (detailed && url != null) ...{
      'threadId': thread,
      'title': title,
      'detail': detail,
      'url': url.toString(),
    },
  };
}

class StatusSnapshot {
  StatusSnapshot(this.running, this.failed, this.ready, this.nextDeadline);
  final List<StatusRow> running, failed, ready;
  List<StatusRow> get rows =>
      [...running, ...failed, ...ready].take(3).toList(growable: false);
  // Each count describes its capped bucket, never a global job total.
  int get runningCount => running.length;
  int get failedCount => failed.length;
  int get readyCount => ready.length;
  final DateTime? nextDeadline;
  Map<String, Object?> toPayload({required bool detailed}) => {
    'schemaVersion': 1,
    'detailed': detailed,
    'counts': {
      'running': runningCount,
      'failed': failedCount,
      'ready': readyCount,
    },
    'buckets': {
      for (final bucket in {
        'running': running,
        'failed': failed,
        'ready': ready,
      }.entries)
        bucket.key: bucket.value
            .map((r) => r.payload(detailed))
            .toList(growable: false),
    },
    'action': 'openApp',
    if (nextDeadline != null)
      'nextDeadline': nextDeadline!.millisecondsSinceEpoch,
  };
}

class _Run {
  _Run(this.turn, this.startedAt) : lastEvidenceAt = startedAt;
  String turn;
  final DateTime startedAt;
  DateTime lastEvidenceAt;
  String? liveEvidenceSession;
  final items = <String, ({String? phase, bool hasText, bool streaming})>{};
  final completedItems = <String>{};
  bool get finishing => items.values.any(
    (i) => i.phase == 'final_answer' && i.hasText && i.streaming,
  );
}

class _Outcome {
  _Outcome(this.turn, this.state, this.at);
  final String turn;
  final RunState state;
  final DateTime at;
}

/// In-memory live evidence only. History/cache and transport loss are not outcomes.
class RunStatusProjector extends ChangeNotifier {
  RunStatusProjector({DateTime Function()? now}) : now = now ?? DateTime.now;
  final DateTime Function() now;
  String? _mac, _fingerprint, _session, _selected;
  bool _connected = false;
  Map<String, StatusThread> _threads = {};
  final _runs = <String, _Run>{};
  final _outcomes = <String, _Outcome>{};
  final _terminal = <(String, String)>{};
  final _superseded = <(String, String)>{};
  final _closedRuns = <(String, String), _Run>{};
  String? get scope => _mac == null ? null : '$_mac:$_fingerprint';
  void resetProjectedTerminals(String thread) {
    _terminal.removeWhere(
      (key) => key.$1 == thread && key.$2.startsWith('ipc-turn-'),
    );
    _superseded.removeWhere(
      (key) => key.$1 == thread && key.$2.startsWith('ipc-turn-'),
    );
  }

  void rememberTurn(String thread, String turn) {
    final run = _runs[thread];
    if (run?.turn == turn) _closedRuns.putIfAbsent((thread, turn), () => run!);
  }

  void rebindTurn(
    String thread,
    String oldTurn,
    String turn, {
    bool resume = false,
  }) {
    final active = _runs[thread];
    final run = active?.turn == oldTurn
        ? active
        : resume
        ? _closedRuns.remove((thread, oldTurn))
        : null;
    if (run != null) {
      run.turn = turn;
      _runs[thread] = run;
    }
    if (_terminal.remove((thread, oldTurn)) && !resume) {
      _terminal.add((thread, turn));
    }
    if (_superseded.remove((thread, oldTurn)) && !resume) {
      _superseded.add((thread, turn));
    }
    if (resume) {
      _terminal.remove((thread, turn));
      _superseded.remove((thread, turn));
    }
    final outcome = _outcomes[thread];
    if (outcome?.turn == oldTurn) {
      _outcomes[thread] = _Outcome(turn, outcome!.state, outcome.at);
    }
  }

  void reviveBackgroundGuess(String thread, String turn) {
    if (!_connected || !_threads.containsKey(thread)) return;
    _terminal.remove((thread, turn));
    _superseded.remove((thread, turn));
    if (_outcomes[thread]?.turn == turn) _outcomes.remove(thread);
    final prior = _closedRuns.remove((thread, turn));
    if (prior != null) _runs[thread] = prior;
  }

  void retireTurn(String thread, String turn) {
    if (!_connected || !_threads.containsKey(thread)) return;
    _terminal.add((thread, turn));
    if (_runs[thread]?.turn == turn) _runs.remove(thread);
    if (_outcomes[thread]?.turn == turn) _outcomes.remove(thread);
    notifyListeners();
  }

  void setContext({
    required String? mac,
    required String? fingerprint,
    required String? session,
    required bool connected,
    required String? selectedThread,
    required Map<String, StatusThread> threads,
  }) {
    final valid = mac != null && fingerprint != null;
    final nextMac = valid ? mac : null, nextPin = valid ? fingerprint : null;
    if (_mac != nextMac || _fingerprint != nextPin) {
      _runs.clear();
      _outcomes.clear();
      _terminal.clear();
      _superseded.clear();
      _closedRuns.clear();
    }
    _mac = nextMac;
    _fingerprint = nextPin;
    _session = session;
    _connected = connected && valid && session != null;
    _selected = selectedThread;
    _threads = Map.of(threads);
    _closedRuns.removeWhere((key, _) => !_threads.containsKey(key.$1));
    _runs.removeWhere((id, run) {
      if (_threads.containsKey(id)) return false;
      _superseded.add((id, run.turn));
      return true;
    });
    _outcomes.removeWhere(
      (id, _) => !_threads.containsKey(id) || id == _selected,
    );
    notifyListeners();
  }

  static Map<String, dynamic> _map(Object? value) =>
      value is Map ? Map<String, dynamic>.from(value) : {};
  static String? _text(Object? value) =>
      value is String && value.trim().isNotEmpty ? value.trim() : null;
  static String? _first(Iterable<Object?> values) =>
      values.map(_text).whereType<String>().firstOrNull;
  static String? _phase(Object? value) =>
      _text(value)?.toLowerCase().replaceAll('-', '_');

  void observe(String method, Map<String, dynamic> p, {bool replayed = false}) {
    if (!_connected || _mac == null || _session == null) return;
    final event = _map(p['msg'] ?? p['event']),
        item = _map(p['item'] ?? _map(p['event'])['item'] ?? event['item']);
    final legacy = method.startsWith('codex/event/')
        ? method.substring(12)
        : method == 'codex/event'
        ? _text(event['type'])
        : null;
    final type = legacy ?? method;
    final started = {
      'turn/started',
      'turn_started',
      'turnstarted',
      'task_started',
    }.contains(type);
    final completed = {
      'turn/completed',
      'turncompleted',
      'task_complete',
      'turn_complete',
      'turn_completed',
    }.contains(type);
    final failed = {'turn/failed', 'turnfailed'}.contains(type);
    final terminal = completed || failed;
    final legacyAssistant = {
      'agent_message',
      'agent_message_delta',
      'agent_message_content_delta',
      'assistant_message',
      'assistant_message_delta',
      'final_answer',
    }.contains(type);
    final thread = _first([
      p['threadId'],
      p['thread_id'],
      p['conversationId'],
      p['conversation_id'],
      event['threadId'],
      event['thread_id'],
      event['conversationId'],
      event['conversation_id'],
      item['threadId'],
      item['thread_id'],
    ]);
    if (thread == null || !_threads.containsKey(thread)) return;
    var turn = _first([
      p['turnId'],
      p['turn_id'],
      _map(p['turn'])['id'],
      event['turnId'],
      event['turn_id'],
      _map(event['turn'])['id'],
      item['turnId'],
      item['turn_id'],
      if (started || terminal) event['id'],
      if (started ||
          terminal ||
          legacy != null &&
              legacyAssistant &&
              (p['msg'] is Map || p['event'] is Map))
        p['id'],
    ]);
    // The source's legacy final answer may omit a turn, but only binds to this
    // known thread's exact active run. No selected-chat fallback.
    if (turn == null && type == 'final_answer') turn = _runs[thread]?.turn;
    if (turn == null) return;
    final key = (thread, turn);
    if (replayed ||
        p['djlReplayedEvent'] == true ||
        event['djlReplayedEvent'] == true) {
      if (terminal) {
        _terminal.add(key);
        if (_runs[thread]?.turn == turn) {
          _runs.remove(thread);
          notifyListeners();
        }
      }
      return;
    }
    final at = now(), run = _runs[thread];
    if (started) {
      if (_terminal.contains(key) || _superseded.contains(key)) return;
      if (run != null && run.turn != turn) _superseded.add((thread, run.turn));
      _runs[thread] = run?.turn == turn ? run! : _Run(turn, at);
      _runs[thread]!.lastEvidenceAt = at;
      _runs[thread]!.liveEvidenceSession = _session;
      _outcomes.remove(thread);
    } else if (terminal) {
      if (!_terminal.add(key) ||
          _superseded.contains(key) ||
          run != null && run.turn != turn) {
        return;
      }
      _runs.remove(thread);
      _outcomes.remove(thread);
      final rawStatus =
          _map(p['turn'])['status'] ??
          p['status'] ??
          _map(event['turn'])['status'] ??
          event['status'];
      final statusMap = _map(rawStatus);
      final status =
          (_text(rawStatus) ??
                  _first([
                    statusMap['type'],
                    statusMap['statusType'],
                    statusMap['status_type'],
                  ]) ??
                  '')
              .toLowerCase()
              .replaceAll(RegExp(r'[_\s-]'), '');
      final stopped = RegExp('cancel|abort|interrupt|stopped').hasMatch(status);
      final failureMessage = _first([
        _map(p['error'])['message'],
        _map(_map(p['turn'])['error'])['message'],
        _map(event['error'])['message'],
        p['errorMessage'],
      ]);
      final isFailed =
          failed ||
          RegExp('fail|error').hasMatch(status) ||
          failureMessage != null;
      if ((!stopped || failed || failureMessage != null) &&
          thread != _selected) {
        final outcome = _Outcome(
          turn,
          isFailed ? RunState.failed : RunState.ready,
          at,
        );
        _outcomes[thread] = outcome;
        final sameBucket = _outcomes.entries
            .where((e) => e.value.state == outcome.state)
            .toList();
        for (final oldest in sameBucket.take(
          (sameBucket.length - 3).clamp(0, 3),
        )) {
          _outcomes.remove(oldest.key);
        }
      }
    } else if (run != null && run.turn == turn) {
      final assistantType = (_text(item['type']) ?? '')
          .toLowerCase()
          .replaceAll(RegExp(r'[_-]'), '');
      final assistant =
          {
            'agentmessage',
            'assistantmessage',
            'exitedreviewmode',
          }.contains(assistantType) ||
          assistantType == 'message' && item['role'] != 'user';
      final delta = method == 'item/agentMessage/delta';
      if (!delta &&
          !legacyAssistant &&
          !(assistant && {'item/started', 'item/completed'}.contains(method))) {
        return;
      }
      final id =
          _first([
            item['id'],
            item['itemId'],
            item['item_id'],
            item['messageId'],
            item['message_id'],
            p['itemId'],
            p['item_id'],
            p['messageId'],
            p['message_id'],
            event['itemId'],
            event['item_id'],
            event['messageId'],
            event['message_id'],
            if (legacyAssistant) event['id'],
          ]) ??
          (type == 'final_answer' ? 'legacy-final' : null);
      if (id == null) return;
      if (run.completedItems.contains(id)) return;
      final prior = run.items[id];
      final phase = _first([
        p['phase'],
        event['phase'],
        item['phase'],
        _map(p['event'])['phase'],
      ]);
      final text = _first([
        p['delta'],
        p['text'],
        item['text'],
        event['delta'],
        event['text'],
      ]);
      final assistantCompleted =
          method == 'item/completed' ||
          {'agent_message', 'assistant_message', 'final_answer'}.contains(type);
      run.items[id] = (
        phase: _phase(phase) ?? prior?.phase,
        hasText: text != null || prior?.hasText == true,
        streaming: !assistantCompleted,
      );
      if (assistantCompleted) run.completedItems.add(id);
      run.lastEvidenceAt = at;
      run.liveEvidenceSession = _session;
    } else {
      return;
    }
    notifyListeners();
  }

  /// Uncapped phone-menu evidence, qualified by the caller's captured host pin.
  /// This does not change the bounded operating-system status projection.
  ({Set<String> ids, DateTime? nextDeadline}) liveRunningThreads({
    required String mac,
    required String fingerprint,
  }) {
    if (!_connected ||
        _session == null ||
        _mac != mac ||
        _fingerprint != fingerprint) {
      return (ids: const <String>{}, nextDeadline: null);
    }
    final at = now(), ids = <String>{};
    DateTime? deadline;
    for (final entry in _runs.entries) {
      final stale = entry.value.lastEvidenceAt.add(const Duration(minutes: 30)),
          expiry = entry.value.startedAt.add(const Duration(hours: 4));
      if (entry.value.liveEvidenceSession != _session ||
          !_threads.containsKey(entry.key) ||
          !at.isBefore(stale) ||
          !at.isBefore(expiry)) {
        continue;
      }
      ids.add(entry.key);
      final next = stale.isBefore(expiry) ? stale : expiry;
      if (deadline == null || next.isBefore(deadline)) deadline = next;
    }
    return (ids: Set<String>.unmodifiable(ids), nextDeadline: deadline);
  }

  StatusSnapshot project() {
    final at = now();
    final running = <StatusRow>[],
        failed = <StatusRow>[],
        ready = <StatusRow>[];
    StatusRow row(
      String id,
      String turn,
      RunState state,
      DateTime start,
      DateTime stale,
      DateTime expiry,
    ) {
      final metadata = _threads[id]!;
      final basename =
          metadata.cwd
              .replaceAll('\\', '/')
              .split('/')
              .where((s) => s.isNotEmpty)
              .lastOrNull ??
          '';
      String bounded(String text, int max) =>
          String.fromCharCodes(text.trim().runes.take(max));
      return StatusRow(
        thread: id,
        turn: turn,
        title: bounded(metadata.title, 120),
        detail: bounded(basename, 80),
        state: state,
        startedAt: start,
        staleAt: stale,
        expiresAt: expiry,
        url: _mac == null || _fingerprint == null
            ? null
            : DesktopLinkTarget.statusUri(id, _mac!, _fingerprint!),
      );
    }

    for (final entry in _runs.entries) {
      final r = entry.value,
          expiry = entry.value.startedAt.add(const Duration(hours: 4)),
          stale = entry.value.lastEvidenceAt.add(const Duration(minutes: 30));
      if (!at.isBefore(expiry)) continue;
      running.add(
        row(
          entry.key,
          r.turn,
          !_connected || !at.isBefore(stale)
              ? RunState.paused
              : r.finishing
              ? RunState.finishing
              : RunState.running,
          r.startedAt,
          stale,
          expiry,
        ),
      );
    }
    running.sort(
      (a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()),
    );
    final outcomes = _outcomes.entries.toList().reversed;
    for (final entry in outcomes) {
      final o = entry.value,
          expiry = entry.value.at.add(
            Duration(minutes: entry.value.state == RunState.ready ? 5 : 15),
          );
      if (!at.isBefore(expiry) || entry.key == _selected) continue;
      (o.state == RunState.failed ? failed : ready).add(
        row(entry.key, o.turn, o.state, o.at, expiry, expiry),
      );
    }
    final buckets = [...running.take(3), ...failed.take(3), ...ready.take(3)];
    final deadlines =
        buckets
            .expand((r) => [r.staleAt, r.expiresAt])
            .where((d) => d.isAfter(at))
            .toList()
          ..sort();
    return StatusSnapshot(
      List.unmodifiable(running.take(3)),
      List.unmodifiable(failed.take(3)),
      List.unmodifiable(ready.take(3)),
      deadlines.firstOrNull,
    );
  }
}
