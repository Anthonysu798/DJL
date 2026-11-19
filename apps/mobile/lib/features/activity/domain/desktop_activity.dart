import 'dart:convert';
import '../../pairing/data/pairing_repository.dart';

const activityOutputLines = 30;
RemoteJson? activityObject(Object? value) =>
    value is Map && value.keys.every((key) => key is String)
    ? Map<String, dynamic>.from(value)
    : null;
String? activityString(Object? value) =>
    value is String && value.trim().isNotEmpty ? value : null;
String normalizedActivityType(Object? value) =>
    value is String ? value.toLowerCase().replaceAll(RegExp('[^a-z]'), '') : '';
Object? activityValue(Object? value, List<String> keys, [int depth = 8]) {
  if (depth < 0) return null;
  final object = activityObject(value);
  if (object != null) {
    for (final key in keys) {
      if (object[key] != null) return object[key];
    }
    for (final nested in object.values) {
      final found = activityValue(nested, keys, depth - 1);
      if (found != null) return found;
    }
  } else if (value is List) {
    for (final nested in value) {
      final found = activityValue(nested, keys, depth - 1);
      if (found != null) return found;
    }
  }
  return null;
}

// Extract text, never stringify arbitrary result objects into a universal inspector.
String activityText(Object? value, [int depth = 8]) {
  if (depth < 0 || value == null) return '';
  if (value is String) return value;
  if (value is List) {
    return value
        .map((v) => activityText(v, depth - 1))
        .where((v) => v.isNotEmpty)
        .join('\n');
  }
  final object = activityObject(value);
  if (object == null) return '';
  final channels = [
    for (final key in ['stdout', 'stderr'])
      activityText(object[key], depth - 1),
  ].where((text) => text.isNotEmpty).toList();
  if (channels.isNotEmpty) return channels.join('\n');
  for (final key in [
    'text',
    'message',
    'summary',
    'output_text',
    'outputText',
    'content',
    'aggregatedOutput',
    'output',
    'stdout',
    'stderr',
    'result',
    'payload',
    'data',
  ]) {
    final text = activityText(object[key], depth - 1);
    if (text.isNotEmpty) return text;
  }
  return '';
}

String activityTail(String output) {
  final lines = output.split(RegExp(r'\r\n|\r|\n'));
  return lines.length <= activityOutputLines
      ? output
      : lines.skip(lines.length - activityOutputLines).join('\n');
}

int? activityInt(Object? value) => value is int
    ? value
    : value is num && value.isFinite
    ? value.toInt()
    : value is String
    ? int.tryParse(value)
    : null;
String? activityCommand(RemoteJson item) {
  final value = activityValue(item, [
    'command',
    'cmd',
    'raw_command',
    'rawCommand',
    'input',
    'invocation',
  ]);
  if (value is List) return activityString(value.whereType<String>().join(' '));
  if (value is String) return activityString(value.trim());
  return null;
}

String activityPhase(String? status, {bool completed = false}) {
  final lower = status?.toLowerCase() ?? '';
  if (lower.contains('fail') || lower.contains('error')) return 'failed';
  if (lower.trim() == 'stopped' ||
      lower.contains('cancel') ||
      lower.contains('abort') ||
      lower.contains('interrupt')) {
    return 'stopped';
  }
  if (completed ||
      lower.contains('complete') ||
      lower.contains('success') ||
      lower.contains('done')) {
    return 'completed';
  }
  return 'running';
}

bool activityPatchText(String text) =>
    text.contains('diff --git ') ||
    text.contains('\n@@ ') ||
    text.startsWith('@@ ') ||
    text.contains('\n+++ ') && text.contains('\n--- ');
String? activityKind(RemoteJson item) {
  final type = normalizedActivityType(item['type']);
  if (type == 'commandexecution') return 'command';
  if (type == 'filechange' || type == 'diff') return 'fileChange';
  if (type == 'mcptoolcall') return 'tool';
  if (type != 'toolcall') return null;
  final name =
      (activityString(item['name']) ??
              activityString(item['toolName']) ??
              activityString(item['tool_name']) ??
              activityString(activityObject(item['tool'])?['name']) ??
              activityString(activityObject(item['call'])?['name']) ??
              '')
          .toLowerCase();
  if (name == 'exec_command' || name == 'shell' || name == 'shell_command') {
    return 'command';
  }
  final hasPatch = ['diff', 'patch', 'unified_diff', 'unifiedDiff']
      .map((key) => activityString(activityValue(item, [key])))
      .whereType<String>()
      .any(activityPatchText);
  final hasChanges =
      activityValue(item, [
        'changes',
        'file_changes',
        'fileChanges',
        'files',
        'edits',
        'modified_files',
        'modifiedFiles',
        'patches',
      ]) !=
      null;
  return hasPatch ||
          hasChanges &&
              RegExp(
                'filechange|apply.?patch|patch.?apply|diff|edit|write|rename|delete|remove|create|add|move',
              ).hasMatch(name)
      ? 'fileChange'
      : 'tool';
}

class ActivityFileChange {
  const ActivityFileChange(
    this.path,
    this.kind,
    this.diff, {
    this.additions,
    this.deletions,
  });
  final String path, kind, diff;
  final int? additions, deletions;
  RemoteJson toJson() => {
    'path': path,
    'kind': kind,
    'diff': diff,
    'additions': additions,
    'deletions': deletions,
  };
  static List<ActivityFileChange> decode(RemoteJson item) {
    final raw = activityValue(item, [
      'changes',
      'file_changes',
      'fileChanges',
      'files',
      'edits',
      'modified_files',
      'modifiedFiles',
      'patches',
    ]);
    final objects = <RemoteJson>[];
    if (raw is List) {
      objects.addAll(raw.map(activityObject).whereType<RemoteJson>());
    } else if (activityObject(raw) case final RemoteJson map) {
      for (final key in (map.keys.toList()..sort())) {
        final change = activityObject(map[key]);
        if (change != null) objects.add({'path': key, ...change});
      }
    }
    final result = <ActivityFileChange>[];
    for (final change in objects) {
      final path =
          [
                'path',
                'file',
                'file_path',
                'filePath',
                'relative_path',
                'relativePath',
                'new_path',
                'newPath',
                'to',
                'target',
                'name',
                'old_path',
                'oldPath',
                'from',
              ]
              .map((key) => activityString(change[key]))
              .whereType<String>()
              .firstOrNull ??
          'unknown';
      final kind =
          activityString(change['kind']) ??
          activityString(change['action']) ??
          activityString(activityObject(change['kind'])?['type']) ??
          activityString(change['type']) ??
          'update';
      var diff =
          ['diff', 'unified_diff', 'unifiedDiff', 'patch', 'delta']
              .map((key) => activityString(change[key]))
              .whereType<String>()
              .firstOrNull ??
          '';
      final content = activityString(change['content']);
      if (diff.isEmpty &&
          content != null &&
          RegExp(
            'add|create|delete|remove',
            caseSensitive: false,
          ).hasMatch(kind)) {
        final adding = RegExp(
          'add|create',
          caseSensitive: false,
        ).hasMatch(kind);
        diff = [
          'diff --git a/$path b/$path',
          adding ? 'new file mode 100644' : 'deleted file mode 100644',
          adding ? '--- /dev/null' : '--- a/$path',
          adding ? '+++ b/$path' : '+++ /dev/null',
          ...content.split('\n').map((line) => '${adding ? '+' : '-'}$line'),
        ].join('\n');
      }
      int? total(List<String> keys) => keys
          .map((key) => activityInt(change[key]))
          .whereType<int>()
          .firstOrNull;
      result.add(
        ActivityFileChange(
          path.trim(),
          kind,
          diff.trim(),
          additions: total([
            'additions',
            'lines_added',
            'line_additions',
            'lineAdditions',
            'added',
            'insertions',
            'inserted',
            'num_added',
          ]),
          deletions: total([
            'deletions',
            'lines_deleted',
            'line_deletions',
            'lineDeletions',
            'removed',
            'deleted',
            'num_deleted',
            'num_removed',
          ]),
        ),
      );
    }
    if (result.isEmpty) {
      final diff = activityString(
        activityValue(item, ['diff', 'unified_diff', 'unifiedDiff', 'patch']),
      );
      if (diff != null) {
        final chunks = diff.split(RegExp(r'(?=diff --git )'));
        for (final chunk in chunks.where((part) => part.trim().isNotEmpty)) {
          final path =
              RegExp(
                r'^\+\+\+ (?:b/)?(.+)$',
                multiLine: true,
              ).firstMatch(chunk)?.group(1) ??
              RegExp(
                r'^--- (?:a/)?(.+)$',
                multiLine: true,
              ).firstMatch(chunk)?.group(1) ??
              'unknown';
          result.add(
            ActivityFileChange(
              path == '/dev/null'
                  ? RegExp(
                          r'^--- (?:a/)?(.+)$',
                          multiLine: true,
                        ).firstMatch(chunk)?.group(1) ??
                        'unknown'
                  : path,
              chunk.contains('new file mode')
                  ? 'add'
                  : chunk.contains('deleted file mode')
                  ? 'delete'
                  : 'update',
              chunk.trim(),
            ),
          );
        }
      }
    }
    return result;
  }
}

class DesktopActivity {
  DesktopActivity({
    required this.mac,
    required this.thread,
    required this.turn,
    required this.item,
    required this.kind,
    required this.status,
    this.command = '',
    this.name = '',
    this.cwd,
    this.exitCode,
    this.durationMs,
    String outputTail = '',
    this.files = const [],
  }) : outputTail = activityTail(outputTail);
  final String mac, thread, turn, item;
  String kind, status, command, name, outputTail;
  String? cwd;
  int? exitCode, durationMs;
  List<ActivityFileChange> files;
  bool get terminal => status != 'running';
  String get id => 'activity:${jsonEncode([mac, thread, turn, item])}';
  String get title => kind == 'command'
      ? (command.isEmpty ? 'Command' : command)
      : kind == 'fileChange'
      ? (files.isEmpty
            ? 'File changes'
            : '${files.length} ${files.length == 1 ? 'file' : 'files'} changed')
      : name.isEmpty
      ? 'Tool activity'
      : name;
  RemoteJson toRow() => {
    'id': id,
    'type': kind == 'command'
        ? 'commandExecution'
        : kind == 'fileChange'
        ? 'fileChange'
        : 'toolCall',
    'threadId': thread,
    'turnId': turn,
    'sourceItemId': item,
    'activity': {
      'mac': mac,
      'thread': thread,
      'turn': turn,
      'item': item,
      'kind': kind,
      'status': status,
      'command': command,
      'name': name,
      'cwd': cwd,
      'exitCode': exitCode,
      'durationMs': durationMs,
      'outputTail': outputTail,
      'files': files.map((f) => f.toJson()).toList(),
    },
  };
  static DesktopActivity? fromRow(RemoteJson row) {
    final a = activityObject(row['activity']);
    if (a == null ||
        [
          'mac',
          'thread',
          'turn',
          'item',
          'kind',
          'status',
        ].any((key) => a[key] is! String) ||
        !{'command', 'tool', 'fileChange'}.contains(a['kind'])) {
      return null;
    }
    return DesktopActivity(
      mac: a['mac'],
      thread: a['thread'],
      turn: a['turn'],
      item: a['item'],
      kind: a['kind'],
      status: a['status'],
      command: activityString(a['command']) ?? '',
      name: activityString(a['name']) ?? '',
      cwd: activityString(a['cwd']),
      exitCode: activityInt(a['exitCode']),
      durationMs: activityInt(a['durationMs']),
      outputTail: activityText(a['outputTail']),
      files: (a['files'] is List ? a['files'] as List : <dynamic>[])
          .map(activityObject)
          .whereType<RemoteJson>()
          .map(
            (f) => ActivityFileChange(
              activityString(f['path']) ?? 'unknown',
              activityString(f['kind']) ?? 'update',
              activityString(f['diff']) ?? '',
              additions: activityInt(f['additions']),
              deletions: activityInt(f['deletions']),
            ),
          )
          .toList(),
    );
  }

  static DesktopActivity? fromItem(
    RemoteJson raw, {
    required String mac,
    required String thread,
    required String turn,
    bool completed = true,
  }) {
    final cached = fromRow(raw);
    if (cached != null) {
      return DesktopActivity(
        mac: mac,
        thread: thread,
        turn: turn,
        item: cached.item,
        kind: cached.kind,
        status: cached.status,
        command: cached.command,
        name: cached.name,
        cwd: cached.cwd,
        exitCode: cached.exitCode,
        durationMs: cached.durationMs,
        outputTail: cached.outputTail,
        files: cached.files,
      );
    }
    final kind = activityKind(raw);
    if (kind == null) return null;
    var source = raw;
    if (kind == 'command' && raw['arguments'] is String) {
      try {
        final args = activityObject(jsonDecode(raw['arguments'] as String));
        if (args != null) source = {...args, ...raw};
      } on FormatException {
        /* Keep the source's safe command fallback. */
      }
    } else if (kind == 'command') {
      final args = activityObject(raw['arguments']);
      if (args != null) source = {...args, ...raw};
    }
    final item =
        [
          raw['id'],
          raw['call_id'],
          raw['callId'],
        ].map(activityString).whereType<String>().firstOrNull ??
        '@$kind';
    final status = activityString(activityValue(source, ['status']));
    final output =
        [
              'aggregatedOutput',
              'aggregated_output',
              'output',
              'result',
              'text',
              'message',
              'summary',
              'stdout',
              'stderr',
              'error',
              'content',
            ]
            .map((key) => activityText(source[key]))
            .where((text) => text.isNotEmpty)
            .firstOrNull ??
        '';
    return DesktopActivity(
      mac: mac,
      thread: thread,
      turn: turn,
      item: item,
      kind: kind,
      status: activityPhase(status, completed: completed),
      command: kind == 'command' ? activityCommand(source) ?? '' : '',
      name:
          ['name', 'tool_name', 'toolName', 'title']
              .map((key) => activityString(source[key]))
              .whereType<String>()
              .firstOrNull ??
          activityString(activityObject(source['tool'])?['name']) ??
          activityString(source['tool']) ??
          '',
      cwd:
          activityString(source['cwd']) ??
          activityString(source['working_directory']) ??
          activityString(source['workdir']),
      exitCode: activityInt(activityValue(source, ['exitCode', 'exit_code'])),
      durationMs: activityInt(
        activityValue(source, ['durationMs', 'duration_ms']),
      ),
      outputTail: output,
      files: kind == 'fileChange'
          ? ActivityFileChange.decode(source)
          : const [],
    );
  }
}

RemoteJson sanitizedActivityRow(RemoteJson row, String thread, {String? turn}) {
  final activity = DesktopActivity.fromItem(
    row,
    mac: DesktopActivity.fromRow(row)?.mac ?? '',
    thread: thread,
    turn:
        turn ??
        activityString(row['turnId']) ??
        activityString(row['turn_id']) ??
        '',
  );
  return activity?.toRow() ?? row;
}

RemoteJson sanitizedActivityThread(RemoteJson thread) => {
  ...thread,
  if (thread['turns'] is List)
    'turns': [
      for (final raw in thread['turns'] as List)
        if (activityObject(raw) case final RemoteJson turn)
          {
            ...turn,
            if (turn['items'] is List)
              'items': [
                for (final rawItem in turn['items'] as List)
                  if (activityObject(rawItem) case final RemoteJson item)
                    sanitizedActivityRow(
                      item,
                      activityString(thread['id']) ?? '',
                      turn:
                          activityString(turn['id']) ??
                          activityString(turn['turnId']) ??
                          activityString(turn['turn_id']),
                    )
                  else
                    rawItem,
              ],
          }
        else
          raw,
    ],
};
