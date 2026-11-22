import 'dart:convert';
import 'package:crypto/crypto.dart';
import '../../pairing/data/pairing_repository.dart';
import '../../../l10n/l10n.dart';

String? _text(Object? v) =>
    v is String && v.trim().isNotEmpty ? v.trim() : null;
RemoteJson _map(Object? v) => v is Map ? Map<String, dynamic>.from(v) : {};
String? _first(Iterable<Object?> values) =>
    values.map(_text).whereType<String>().firstOrNull;
String? responsePath(Object? value) {
  var p = _text(value);
  if (p == null || p == '/dev/null') return null;
  p = p.replaceFirst(RegExp(r'^(a/|b/|\./)'), '');
  if (p.startsWith('/') ||
      p.split('/').contains('..') ||
      p.contains('"') ||
      p.contains('\\')) {
    return null;
  }
  return p;
}

String _hash(String value) => sha256.convert(utf8.encode(value)).toString();

// A completed envelope supplies lifecycle context only when no explicit state
// contradicts it. Unknown or present-but-empty states are never applied proof.
bool _appliedState(RemoteJson value, {required bool absentAllowed}) {
  if (value.containsKey('success') && value['success'] != true) return false;
  if (value.containsKey('status')) {
    final raw = value['status'];
    if (raw is! String) return false;
    final status = raw.trim().toLowerCase().replaceAll(RegExp(r'[\s_-]'), '');
    return {
      'complete',
      'completed',
      'applied',
      'success',
      'succeeded',
      'done',
      'finished',
    }.contains(status);
  }
  return value['success'] == true || absentAllowed;
}

/// Exact wire bytes are kept separately from display-oriented activity cards.
class ResponsePatch {
  ResponsePatch(this.id, String raw)
    : forwardPatch = raw.endsWith('\n') ? raw : '$raw\n' {
    final lines = forwardPatch
        .split('\n')
        .map((s) => s.endsWith('\r') ? s.substring(0, s.length - 1) : s)
        .toList();
    final chunks = <List<String>>[];
    for (final line in lines) {
      if (line.startsWith('diff --git ') || chunks.isEmpty) chunks.add([]);
      chunks.last.add(line);
    }
    for (final chunk in chunks) {
      final before = chunk
          .where((l) => l.startsWith('--- '))
          .map((l) => l.substring(4))
          .toList();
      final after = chunk
          .where((l) => l.startsWith('+++ '))
          .map((l) => l.substring(4))
          .toList();
      final path = after.isEmpty
          ? null
          : responsePath(
              after.singleOrNull == '/dev/null'
                  ? before.singleOrNull
                  : after.singleOrNull,
            );
      if (!chunk.first.startsWith('diff --git ') ||
          before.length != 1 ||
          after.length != 1 ||
          path == null ||
          !chunk.any(
            (l) => RegExp(r'^@@ -\d+(,\d+)? \+\d+(,\d+)? @@').hasMatch(l),
          )) {
        reasons.add(appStrings.workspaceUndoNoExactPatch);
      } else {
        files.add(path);
        final oldPath = responsePath(before.single);
        final newPath = responsePath(after.single);
        if (oldPath != null && newPath != null && oldPath != newPath) {
          reasons.add(appStrings.workspaceUndoRenames);
        }
      }
      if (chunk.any(
        (l) => RegExp(
          r'^(Binary files |GIT binary patch|rename |copy |old mode |new mode |similarity index |new file mode 120|deleted file mode 120)',
        ).hasMatch(l),
      )) {
        reasons.add(appStrings.workspaceUndoBinary);
      }
    }
  }
  final String id, forwardPatch;
  final files = <String>{}, reasons = <String>{};
  bool get supported => reasons.isEmpty && files.isNotEmpty;
  String get hash => _hash(forwardPatch);
  RemoteJson toJson() => {'id': id, 'forwardPatch': forwardPatch};
}

class ResponseChangeSet {
  ResponseChangeSet(this.thread, this.turn, this.cwd);
  final String thread;
  String turn;
  String cwd;
  String? assistant, repoRoot;
  bool applying = false;
  int reviewRevision = 0;
  bool terminal = false, reverted = false, uncertain = false;
  String? lastError;
  final evidence = <String>{}, incompleteOperations = <String>{};
  ResponsePatch? aggregate;
  final batches = <ResponsePatch>[];
  String get id => jsonEncode([thread, turn]);
  List<ResponsePatch> get patches {
    final p = aggregate;
    if (p != null &&
        p.supported &&
        p.files.every((f) => evidence.contains(f.toLowerCase()))) {
      return [p];
    }
    // A widened aggregate must not silently fall back to a partial undo.
    if (p != null) return [];
    return incompleteOperations.isEmpty ? batches.reversed.toList() : [];
  }

  bool get ready =>
      !reverted &&
      terminal &&
      assistant != null &&
      cwd.isNotEmpty &&
      patches.isNotEmpty &&
      patches.every((p) => p.supported);
  Set<String> get files => patches.expand((p) => p.files).toSet();
  String get hash => _hash(
    jsonEncode({
      'cwd': cwd,
      'repoRoot': repoRoot,
      'assistant': assistant,
      'terminal': terminal,
      'reverted': reverted,
      'patches': patches.map((p) => p.toJson()).toList(),
    }),
  );
  String? get unavailable => reverted
      ? appStrings.workspaceAlreadyUndone
      : !terminal
      ? appStrings.workspaceStillRunning
      : cwd.isEmpty
      ? appStrings.workspaceNoDesktopWorkspace
      : !ready
      ? appStrings.workspaceNoPatchCaptured
      : null;
  RemoteJson toJson() => {
    'thread': thread,
    'turn': turn,
    'cwd': cwd,
    'repoRoot': repoRoot,
    'assistant': assistant,
    'terminal': terminal,
    'reverted': reverted,
    'uncertain': uncertain,
    'lastError': lastError,
    'evidence': evidence.toList(),
    'incompleteOperations': incompleteOperations.toList(),
    'aggregate': aggregate?.toJson(),
    'batches': batches.map((p) => p.toJson()).toList(),
  };
  static ResponseChangeSet? fromJson(RemoteJson v) {
    final t = _text(v['thread']), u = _text(v['turn']);
    if (t == null || u == null) return null;
    final e = ResponseChangeSet(t, u, _text(v['cwd']) ?? '')
      ..repoRoot = _text(v['repoRoot'])
      ..assistant = _text(v['assistant'])
      ..terminal = v['terminal'] == true
      ..reverted = v['reverted'] == true
      ..uncertain = v['uncertain'] == true
      ..lastError = _text(v['lastError']);
    e.evidence.addAll((v['evidence'] as List? ?? []).whereType<String>());
    e.incompleteOperations.addAll(
      (v['incompleteOperations'] as List? ?? []).whereType<String>(),
    );
    ResponsePatch? patch(Object? raw) {
      final m = _map(raw);
      return m['id'] is String && m['forwardPatch'] is String
          ? ResponsePatch(m['id'] as String, m['forwardPatch'] as String)
          : null;
    }

    e.aggregate = patch(v['aggregate']);
    e.batches.addAll(
      (v['batches'] as List? ?? []).map(patch).whereType<ResponsePatch>(),
    );
    return e;
  }
}

class ResponseChangeLedger {
  final entries = <String, ResponseChangeSet>{};
  final archivedEntries = <ResponseChangeSet>[];

  void archiveProjectedTerminals(String thread) {
    for (final entry
        in entries.values
            .where(
              (e) =>
                  e.thread == thread &&
                  e.turn.startsWith('ipc-turn-') &&
                  e.terminal,
            )
            .toList()) {
      entries.remove(entry.id);
      archivedEntries.add(entry);
    }
  }

  ResponseChangeSet? _archivedTurn(String thread, String turn) {
    final matches = archivedEntries
        .where((e) => e.thread == thread && e.turn == turn)
        .toList();
    return matches.length == 1 ? matches.single : null;
  }

  bool canRebindHistoryTurn(
    String thread,
    String oldTurn,
    String turn, {
    bool currentOnly = false,
  }) {
    final current = entries[jsonEncode([thread, oldTurn])];
    final archived = currentOnly
        ? <ResponseChangeSet>[]
        : archivedEntries
              .where((e) => e.thread == thread && e.turn == oldTurn)
              .toList();
    if (archived.length > 1 || current != null && archived.isNotEmpty) {
      return false;
    }
    final old = current ?? archived.firstOrNull;
    return old == null ||
        !old.applying && !entries.containsKey(jsonEncode([thread, turn]));
  }

  void rebindHistoryTurn(
    String thread,
    String oldTurn,
    String turn, {
    bool currentOnly = false,
  }) {
    if (!canRebindHistoryTurn(
      thread,
      oldTurn,
      turn,
      currentOnly: currentOnly,
    )) {
      return;
    }
    final old =
        entries.remove(jsonEncode([thread, oldTurn])) ??
        (currentOnly ? null : _archivedTurn(thread, oldTurn));
    if (old != null) {
      archivedEntries.remove(old);
      old.turn = turn;
      entries[old.id] = old;
    }
    if (running[thread] == oldTurn) running[thread] = turn;
  }

  // Live run state is session authority and is never serialized.
  final running = <String, String>{};
  ResponseChangeSet entry(String thread, String turn, String cwd) =>
      entries.putIfAbsent(
        jsonEncode([thread, turn]),
        () => ResponseChangeSet(thread, turn, cwd),
      );
  ResponseChangeSet? forAssistant(String thread, String assistant) {
    final matches = [
      ...archivedEntries,
      ...entries.values,
    ].where((e) => e.thread == thread && e.assistant == assistant).toList();
    return matches.length == 1 ? matches.single : null;
  }

  void noteAssistant(
    String thread,
    String turn,
    String assistant, {
    String cwd = '',
  }) {
    entry(thread, turn, cwd).assistant = assistant;
  }

  RemoteJson toJson() => {
    'version': 1,
    'entries': entries.values.map((e) => e.toJson()).toList(),
    if (archivedEntries.isNotEmpty)
      'archivedEntries': archivedEntries.map((e) => e.toJson()).toList(),
  };
  static ResponseChangeLedger fromJson(Object? value) {
    final l = ResponseChangeLedger(), v = _map(value);
    if (v['version'] != 1) return l;
    for (final raw in v['entries'] as List? ?? []) {
      final e = ResponseChangeSet.fromJson(_map(raw));
      if (e != null) l.entries[e.id] = e;
    }
    for (final raw in v['archivedEntries'] as List? ?? []) {
      final e = ResponseChangeSet.fromJson(_map(raw));
      if (e != null) l.archivedEntries.add(e);
    }
    return l;
  }

  bool ingest(
    String method,
    RemoteJson p, {
    required Set<String> knownThreads,
    required String? Function(String) cwdFor,
  }) {
    final event = _map(p['msg'] ?? p['event']),
        item = _map(p['item'] ?? event['item']);
    final raw = item.isNotEmpty
        ? item
        : event.isNotEmpty
        ? event
        : p;
    final legacy = method.startsWith('codex/event/')
        ? method.substring(12)
        : method == 'codex/event'
        ? _text(event['type'])
        : null;
    final legacyContext = {
      'patch_apply_begin',
      'patch_apply_end',
      'turn_diff',
      'turn_diff_updated',
      'task_started',
      'turn_started',
      'task_complete',
      'turn_complete',
      'turn_completed',
    }.contains(legacy);
    final legacyPayload = event.isNotEmpty ? event : p;
    final thread = _first([
      p['threadId'],
      p['thread_id'],
      p['conversationId'],
      p['conversation_id'],
      event['threadId'],
      event['thread_id'],
      event['conversationId'],
      event['conversation_id'],
      raw['threadId'],
      raw['thread_id'],
      raw['conversationId'],
      raw['conversation_id'],
    ]);
    final turn = _first([
      p['turnId'],
      p['turn_id'],
      _map(p['turn'])['id'],
      event['turnId'],
      event['turn_id'],
      raw['turnId'],
      raw['turn_id'],
      if (legacyContext) legacyPayload['id'],
      if (legacyContext) p['id'],
    ]);
    if (thread == null || turn == null || !knownThreads.contains(thread)) {
      return false;
    }
    final e = entry(thread, turn, cwdFor(thread) ?? '');
    if (e.cwd.isEmpty) e.cwd = cwdFor(thread) ?? '';
    if (method == 'turn/started' ||
        {'task_started', 'turn_started'}.contains(legacy)) {
      if (!e.terminal && p['djlReplayedEvent'] != true) running[thread] = turn;
      return true;
    }
    if (method == 'turn/completed' ||
        method == 'turn/failed' ||
        {'task_complete', 'turn_complete', 'turn_completed'}.contains(legacy)) {
      e.terminal = true;
      if (running[thread] == turn) running.remove(thread);
      return true;
    }
    if (raw['type'] == 'agentMessage' && method == 'item/completed') {
      e.assistant = _text(raw['id']);
      return true;
    }
    if (e.reverted) return false;
    if (method == 'turn/diff/updated' ||
        {'turn_diff', 'turn_diff_updated'}.contains(legacy)) {
      final diff = [
        p['diff'],
        p['unified_diff'],
        event['diff'],
        event['unified_diff'],
      ].whereType<String>().firstOrNull;
      if (diff != null) e.aggregate = ResponsePatch('turn:$turn', diff);
      return diff != null;
    }
    final type = (_text(raw['type']) ?? method).toLowerCase().replaceAll(
      '_',
      '',
    );
    final patchEnd = legacy == 'patch_apply_end';
    final completed =
        method == 'item/completed' ||
        RegExp(r'fileChange/(completed|finished|done)$').hasMatch(method);
    final result = _map(raw['result']);
    final toolName =
        (_first([
                  raw['name'],
                  raw['toolName'],
                  raw['tool_name'],
                  _map(raw['tool'])['name'],
                ]) ??
                '')
            .toLowerCase();
    if (type.contains('toolcall') &&
        !RegExp(
          r'filechange|apply.?patch|patch.?apply|edit|write|rename|delete|remove|create|move',
        ).hasMatch(toolName)) {
      return false;
    }
    final applied =
        (patchEnd || completed) &&
        _appliedState(raw, absentAllowed: !patchEnd && completed) &&
        _appliedState(result, absentAllowed: true);
    if (!applied ||
        !(patchEnd ||
            type.contains('filechange') ||
            type.contains('toolcall') ||
            type == 'diff')) {
      return false;
    }
    final paths = <String>{}, patches = <String>[];
    var declaredPath = false, rejectedState = false;
    void collect(Object? v, {String? path, bool pathMap = false}) {
      if (v is List) {
        for (final x in v) {
          collect(x);
        }
        return;
      }
      if (v is! Map) return;
      final m = _map(v);
      // A changes dictionary is keyed by filenames, including "status" and
      // "success". Its values, rather than its keys, are state-bearing records.
      // Array entries and values reached by a filename are actual records.
      if (pathMap && path == null && m.values.every((value) => value is Map)) {
        for (final entry in m.entries) {
          collect(entry.value, path: entry.key);
        }
        return;
      }
      final direct = _first([m['path'], m['filePath'], m['file_path'], path]);
      final normalized = responsePath(direct);
      if (normalized != null) declaredPath = true;
      if (!_appliedState(m, absentAllowed: true)) {
        rejectedState = true;
        return;
      }
      if (normalized != null) paths.add(normalized.toLowerCase());
      for (final k in [
        'diff',
        'unified_diff',
        'unifiedDiff',
        'patch',
        'delta',
      ]) {
        final d = m[k];
        if (d is String && !patches.contains(d)) patches.add(d);
      }
      for (final k in [
        'changes',
        'file_changes',
        'fileChanges',
        'files',
        'edits',
        'modified_files',
        'modifiedFiles',
        'patches',
      ]) {
        if (m[k] != null) collect(m[k], pathMap: true);
      }
    }

    collect(raw);
    if (type.contains('toolcall')) collect(result);
    // A child explicitly contradicting the completed operation cannot be
    // replaced by parent-level path or patch metadata.
    if (rejectedState) return false;
    if (paths.isEmpty &&
        !declaredPath &&
        (patchEnd || type.contains('filechange') || type == 'diff')) {
      for (final d in patches) {
        final q = ResponsePatch('', d);
        if (q.supported) paths.addAll(q.files.map((f) => f.toLowerCase()));
      }
    }
    if (paths.isEmpty) return false;
    e.evidence.addAll(paths);
    final identity = _first([
      if (patchEnd) legacyPayload['call_id'],
      if (patchEnd) legacyPayload['callId'],
      p['itemId'],
      p['item_id'],
      if (!patchEnd) raw['id'],
      if (!patchEnd) raw['call_id'],
      if (!patchEnd) raw['callId'],
    ]);
    // Without an operation identity, an exact fallback cannot distinguish echoes.
    final operation = identity ?? 'unidentified';
    final candidates = [
      for (var i = 0; i < patches.length; i++)
        ResponsePatch('$operation:$i', patches[i]),
    ];
    final covered = candidates
        .where((q) => q.supported)
        .expand((q) => q.files)
        .map((f) => f.toLowerCase())
        .toSet();
    if (identity == null || patches.isEmpty || !paths.every(covered.contains)) {
      e.incompleteOperations.add(operation);
    } else {
      e.incompleteOperations.remove(operation);
    }
    if (identity != null) {
      for (var i = 0; i < patches.length; i++) {
        final q = ResponsePatch('$identity:$i', patches[i]);
        if (!q.files.every((f) => paths.contains(f.toLowerCase()))) {
          e.incompleteOperations.add(operation);
          continue;
        }
        final prior = e.batches.where((b) => b.id == q.id).firstOrNull;
        if (prior == null) {
          e.batches.add(q);
        } else if (prior.hash != q.hash) {
          e.aggregate = ResponsePatch('ambiguous', '');
        }
      }
    }
    return true;
  }
}

class ResponseUndoPreview {
  ResponseUndoPreview(RemoteJson v)
    : canRevert = v['canRevert'] == true,
      files = List<String>.from(v['affectedFiles'] as List? ?? []),
      staged = List<String>.from(v['stagedFiles'] as List? ?? []),
      reasons = List<String>.from(v['unsupportedReasons'] as List? ?? []),
      conflicts = (v['conflicts'] as List? ?? [])
          .whereType<Map>()
          .map(
            (m) =>
                '${m['path'] ?? ''}: ${m['message'] ?? appStrings.workspaceConflictFallback}',
          )
          .toList();
  final bool canRevert;
  final List<String> files, staged, reasons, conflicts;
  bool get allowed =>
      canRevert && staged.isEmpty && reasons.isEmpty && conflicts.isEmpty;
}

class ResponseUndoResult {
  ResponseUndoResult(RemoteJson v)
    : success = v['success'] == true,
      definite = v['success'] is bool,
      files = List<String>.from(v['revertedFiles'] as List? ?? []),
      details = ResponseUndoPreview({...v, 'canRevert': false});
  final bool success, definite;
  final List<String> files;
  final ResponseUndoPreview details;
}
