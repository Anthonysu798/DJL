import '../../pairing/data/pairing_repository.dart';
import 'desktop_activity.dart';
import '../../../l10n/l10n.dart';

class ActivityReducer {
  ActivityReducer({DateTime Function()? now}) : _now = now ?? DateTime.now;
  final DateTime Function() _now;
  String? mac;
  final items = <String, DesktopActivity>{};
  final runningTurns = <String, String>{};
  final _threadsForTurn = <String, Set<String>>{};
  final _finishedTurns = <(String, String)>{};
  final _guessedClosures = <(String, String), Map<String, String>>{};
  void resetProjectedTerminals(String thread) {
    _finishedTurns.removeWhere(
      (key) => key.$1 == thread && key.$2.startsWith('ipc-turn-'),
    );
  }

  final _recentEssential = <(String, String), ({String line, DateTime time})>{};
  Map<String, RemoteJson> rebindHistoryTurn(
    String thread,
    String oldTurn,
    String turn, {
    Map<String, String> itemMappings = const {},
    Set<String>? rowIds,
  }) {
    final rows = <String, RemoteJson>{};
    if (_finishedTurns.remove((thread, oldTurn))) {
      _finishedTurns.add((thread, turn));
    }
    if (runningTurns[thread] == oldTurn) {
      if (_finishedTurns.contains((thread, turn))) {
        runningTurns.remove(thread);
      } else {
        runningTurns[thread] = turn;
      }
    }
    _threadsForTurn[oldTurn]?.remove(thread);
    _threadsForTurn.putIfAbsent(turn, () => {}).add(thread);
    final essential = _recentEssential.remove((thread, oldTurn));
    if (essential != null) {
      _recentEssential.putIfAbsent((thread, turn), () => essential);
    }
    for (final old
        in items.values
            .where(
              (a) =>
                  a.thread == thread &&
                  a.turn == oldTurn &&
                  (rowIds == null || rowIds.contains(a.id)),
            )
            .toList()) {
      items.remove(old.id);
      final saved = old.toRow();
      if (itemMappings[old.id] case final item?) {
        (saved['activity'] as Map)['item'] = item;
      }
      final rebound = DesktopActivity.fromItem(
        saved,
        mac: old.mac,
        thread: thread,
        turn: turn,
      )!;
      rows[old.id] = merge(rebound, history: true).toRow();
    }
    final closure = _guessedClosures.remove((thread, oldTurn));
    if (closure != null) {
      final target = _guessedClosures.putIfAbsent((thread, turn), () => {});
      for (final entry in closure.entries) {
        if (rowIds != null && !rowIds.contains(entry.key)) continue;
        target.putIfAbsent(
          rows[entry.key]?['id'] as String? ?? entry.key,
          () => entry.value,
        );
      }
    }
    return rows;
  }

  void bind(String device) {
    if (mac == device) return;
    mac = device;
    items.clear();
    runningTurns.clear();
    _threadsForTurn.clear();
    _finishedTurns.clear();
    _guessedClosures.clear();
    _recentEssential.clear();
  }

  String? _first(List<Object?> values) =>
      values.map(activityString).whereType<String>().firstOrNull;
  String? _thread(
    RemoteJson p,
    RemoteJson event,
    String? turn,
    Set<String> known,
    String? selected,
  ) {
    final direct = _first([
      for (final object in [p, event]) ...[
        object['threadId'],
        object['thread_id'],
        object['conversationId'],
        object['conversation_id'],
        activityObject(object['thread'])?['id'],
        activityObject(object['turn'])?['threadId'],
        activityObject(object['turn'])?['thread_id'],
        activityObject(object['item'])?['threadId'],
        activityObject(object['item'])?['thread_id'],
      ],
    ]);
    if (direct != null) return direct;
    final mapped = _threadsForTurn[turn];
    if (mapped?.length == 1) return mapped!.single;
    if (mapped != null && mapped.length > 1) return null;
    if (runningTurns.length == 1) return runningTurns.keys.single;
    if (known.length == 1) return known.single;
    final contexts = items.values.map((a) => a.thread).toSet();
    return known.isEmpty && contexts.length <= 1 ? selected : null;
  }

  String? _turn(RemoteJson p, RemoteJson e, RemoteJson item) => _first([
    p['turn'] is String ? p['turn'] : null,
    activityObject(p['turn'])?['id'],
    p['turnId'],
    p['turn_id'],
    item['turnId'],
    item['turn_id'],
    e['turnId'],
    e['turn_id'],
    e['turn'] is String ? e['turn'] : null,
    activityObject(e['turn'])?['id'],
    activityObject(e['item'])?['turnId'],
    activityObject(e['item'])?['turn_id'],
  ]);
  void observeTurn(
    String method,
    RemoteJson p, {
    required Set<String> knownThreads,
    String? selectedThread,
    bool backgroundGuess = false,
  }) {
    final e =
        activityObject(p['msg']) ??
        activityObject(p['event']) ??
        const <String, dynamic>{};
    final turn = _turn(p, e, const {}) ?? _first([p['id'], e['id']]);
    final thread = _thread(p, e, turn, knownThreads, selectedThread);
    if (thread == null || turn == null) return;
    _threadsForTurn.putIfAbsent(turn, () => {}).add(thread);
    if (method == 'turn/completed') {
      if (backgroundGuess) {
        _guessedClosures.putIfAbsent(
          (thread, turn),
          () => {
            for (final item in items.values)
              if (item.thread == thread && item.turn == turn && !item.terminal)
                item.id: item.status,
          },
        );
      }
      _finishedTurns.add((thread, turn));
      if (runningTurns[thread] == turn) runningTurns.remove(thread);
      for (final a in items.values.where(
        (a) => a.thread == thread && a.turn == turn && !a.terminal,
      )) {
        a.status = 'completed';
      }
    } else if (!_finishedTurns.contains((thread, turn)) &&
        p['djlReplayedEvent'] != true) {
      _guessedClosures.remove((thread, turn));
      runningTurns[thread] = turn;
    }
  }

  DesktopActivity merge(
    DesktopActivity incoming, {
    String? delta,
    bool history = false,
  }) {
    _threadsForTurn.putIfAbsent(incoming.turn, () => {}).add(incoming.thread);
    if (!history && incoming.terminal) {
      _guessedClosures[(incoming.thread, incoming.turn)]?.remove(incoming.id);
    }
    final old = items[incoming.id];
    if (old == null) {
      if (delta != null) incoming.outputTail = activityTail(delta);
      if (_finishedTurns.contains((incoming.thread, incoming.turn)) &&
          !incoming.terminal) {
        incoming.status = 'completed';
      }
      items[incoming.id] = incoming;
      return incoming;
    }
    if (!old.terminal ||
        incoming.terminal &&
            old.status == 'completed' &&
            incoming.status != 'completed') {
      old.status = incoming.status;
    }
    if (old.kind == 'tool' && incoming.kind != 'tool') old.kind = incoming.kind;
    if (incoming.command.length > old.command.length) {
      old.command = incoming.command;
    }
    if (old.name.isEmpty) old.name = incoming.name;
    old.cwd ??= incoming.cwd;
    old.exitCode = incoming.exitCode ?? old.exitCode;
    old.durationMs = incoming.durationMs ?? old.durationMs;
    if (delta != null) {
      old.outputTail = activityTail(old.outputTail + delta);
    } else if (incoming.outputTail.length > old.outputTail.length ||
        !history &&
            incoming.terminal &&
            !old.outputTail.contains(incoming.outputTail)) {
      old.outputTail = activityTail(incoming.outputTail);
    }
    final files = {for (final f in old.files) f.path: f};
    for (final f in incoming.files) {
      final prior = files[f.path];
      files[f.path] = ActivityFileChange(
        f.path,
        f.kind,
        prior != null && prior.diff.length > f.diff.length
            ? prior.diff
            : f.diff,
        additions: f.additions ?? prior?.additions,
        deletions: f.deletions ?? prior?.deletions,
      );
    }
    old.files = files.values.toList();
    if (_finishedTurns.contains((old.thread, old.turn)) && !old.terminal) {
      old.status = 'completed';
    }
    return old;
  }

  void reviveBackgroundGuess(String thread, String turn) {
    _finishedTurns.remove((thread, turn));
    final previous = _guessedClosures.remove((thread, turn)) ?? {};
    for (final item in items.values.where(
      (item) => item.thread == thread && item.turn == turn,
    )) {
      if (previous[item.id] case final status?) item.status = status;
    }
  }

  DesktopActivity? restore(
    RemoteJson row, {
    required String thread,
    String? turn,
  }) {
    final saved = DesktopActivity.fromRow(row);
    if (saved != null && saved.mac.isNotEmpty && saved.mac != mac) return null;
    final a = DesktopActivity.fromItem(
      row,
      mac: mac ?? '',
      thread: thread,
      turn:
          turn ??
          activityString(row['turnId']) ??
          activityString(row['turn_id']) ??
          '',
      completed:
          activityPhase(activityString(row['status'])) != 'running' ||
          row['status'] == null,
    );
    return a == null ? null : merge(a, history: true);
  }

  DesktopActivity? ingest(
    String method,
    RemoteJson p, {
    required Set<String> knownThreads,
    String? selectedThread,
    String? selectedTurn,
  }) {
    final e =
        activityObject(p['msg']) ??
        activityObject(p['event']) ??
        const <String, dynamic>{};
    var payload =
        activityObject(p['item']) ??
        activityObject(e['item']) ??
        (e.isNotEmpty ? e : p);
    final lower = method.toLowerCase().replaceAll('_', '').replaceAll('-', '');
    final legacyType = method == 'codex/event'
        ? activityString(e['type']) ?? activityString(e['event_type'])
        : method.startsWith('codex/event/')
        ? method.substring('codex/event/'.length)
        : null;
    final essential = {
      'background_event',
      'read',
      'search',
      'list_files',
    }.contains(legacyType);
    final exec = legacyType?.startsWith('exec_command_') == true;
    final patch = {'patch_apply_begin', 'patch_apply_end'}.contains(legacyType);
    if (patch && payload['status'] == null && legacyType == 'patch_apply_end') {
      payload = {
        ...payload,
        'status': payload['success'] == false ? 'failed' : 'completed',
      };
    }
    final lifecycle = method == 'item/started' || method == 'item/completed';
    final command = lower.contains('commandexecution');
    final tool = lower.contains('toolcall');
    final file = lower.contains('filechange');
    if (!essential &&
        !exec &&
        !patch &&
        !lifecycle &&
        !command &&
        !tool &&
        !file) {
      return null;
    }
    String? kind = exec || command
        ? 'command'
        : file || patch
        ? 'fileChange'
        : tool || essential
        ? 'tool'
        : activityKind(payload);
    if (kind == null) return null;
    var turn =
        _turn(p, e, payload) ??
        (exec
            ? _first([p['id']])
            : patch
            ? _first([payload['id']])
            : null);
    final thread = _thread(p, e, turn, knownThreads, selectedThread);
    if (thread == null) return null;
    final sourceId = _first([
      if (!patch) payload['id'],
      payload['call_id'],
      payload['callId'],
      p['itemId'],
      p['item_id'],
      p['call_id'],
      p['callId'],
      if (!exec && !essential && !patch) p['id'],
      e['itemId'],
      e['item_id'],
      e['call_id'],
      e['callId'],
    ]);
    if (turn == null && sourceId != null) {
      final matches = items.values
          .where((a) => a.thread == thread && a.item == sourceId)
          .toList();
      if (matches.length == 1) turn = matches.single.turn;
      if (matches.length > 1) return null;
    }
    turn ??=
        runningTurns[thread] ??
        (thread == selectedThread ? selectedTurn : null);
    if (essential &&
        turn == null &&
        _finishedTurns.any((key) => key.$1 == thread)) {
      return null;
    }
    turn ??= '';
    if (lower.contains('terminalinteraction') && sourceId == null) return null;
    final completed =
        method == 'item/completed' ||
        lower.endsWith('/completed') ||
        lower.endsWith('/finished') ||
        legacyType == 'exec_command_end' ||
        legacyType == 'patch_apply_end' ||
        payload['type'] == 'exec_command_end';
    final isDelta =
        legacyType == 'exec_command_output_delta' ||
        lower.contains('delta') ||
        lower.contains('partadded');
    String? delta;
    if (isDelta) {
      delta = _first([
        p['delta'],
        p['textDelta'],
        p['text_delta'],
        p['text'],
        p['output'],
        p['summary'],
        p['part'],
        e['delta'],
        e['text'],
        e['summary'],
        e['part'],
      ]);
    }
    if (isDelta && delta == null) {
      return null;
    }
    if (kind == 'tool' && delta != null && activityPatchText(delta)) {
      kind = 'fileChange';
      payload = {...payload, 'diff': delta};
    }
    if (essential) {
      final value = switch (legacyType) {
        'read' =>
          activityString(
                activityValue(payload, ['path', 'file_path', 'file']),
              ) ??
              '',
        'search' =>
          activityString(
                activityValue(payload, ['query', 'pattern', 'regex']),
              ) ??
              '',
        'list_files' =>
          activityString(activityValue(payload, ['path', 'cwd'])) ?? '',
        _ =>
          activityString(activityValue(payload, ['message', 'text', 'body'])) ??
              '',
      };
      final line = switch (legacyType) {
        'read' =>
          value.isEmpty
              ? appStrings.activityReadFile
              : appStrings.activityReadValue(value),
        'search' =>
          value.isEmpty
              ? appStrings.activitySearchFiles
              : appStrings.activitySearchValue(value),
        'list_files' =>
          value.isEmpty
              ? appStrings.activityListFiles
              : appStrings.activityListFilesValue(value),
        _ => value.trim(),
      };
      if (line.isEmpty ||
          legacyType == 'background_event' && line.length > 140) {
        return null;
      }
      final recent = _recentEssential[(thread, turn)];
      if (recent != null &&
          recent.line.toLowerCase() == line.toLowerCase() &&
          _now().difference(recent.time) <= const Duration(seconds: 4)) {
        return null;
      }
      _recentEssential[(thread, turn)] = (line: line, time: _now());
      delta = '$line\n';
      payload = {'type': 'toolCall', 'name': appStrings.activityToolActivity};
    }
    payload = {
      ...payload,
      'id': sourceId ?? '@$kind',
      'type': kind == 'command'
          ? 'commandExecution'
          : kind == 'fileChange'
          ? 'fileChange'
          : normalizedActivityType(payload['type']) == 'mcptoolcall'
          ? 'mcpToolCall'
          : 'toolCall',
    };
    kind = activityKind(payload) ?? kind;
    final a = DesktopActivity.fromItem(
      payload,
      mac: mac ?? '',
      thread: thread,
      turn: turn,
      completed: completed,
    )!;
    a.cwd ??= activityString(p['cwd']);
    if (p['djlReplayedEvent'] == true &&
        delta != null &&
        items[a.id]?.outputTail.contains(delta) == true) {
      delta = '';
    }
    return merge(a, delta: delta);
  }
}

bool isActivityNotification(String method, RemoteJson params) {
  if (method == 'item/started' || method == 'item/completed') {
    final event =
        activityObject(params['msg']) ?? activityObject(params['event']);
    final item =
        activityObject(params['item']) ?? activityObject(event?['item']);
    return item != null && activityKind(item) != null;
  }
  final normalized = method
      .toLowerCase()
      .replaceAll('_', '')
      .replaceAll('-', '');
  if ([
    'item/commandexecution/',
    'item/toolcall/',
    'item/filechange/',
  ].any(normalized.startsWith)) {
    return true;
  }
  final legacy = method == 'codex/event'
      ? (activityObject(params['msg'])?['type'] ??
            activityObject(params['msg'])?['event_type'] ??
            activityObject(params['event'])?['type'] ??
            activityObject(params['event'])?['event_type'])
      : method.startsWith('codex/event/')
      ? method.substring('codex/event/'.length)
      : null;
  return {
    'patch_apply_begin',
    'patch_apply_end',
    'exec_command_begin',
    'exec_command_output_delta',
    'exec_command_end',
    'background_event',
    'read',
    'search',
    'list_files',
  }.contains(legacy);
}
