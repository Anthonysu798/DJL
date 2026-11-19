import 'dart:convert';
import '../../activity/domain/desktop_activity.dart';
import '../../pairing/data/pairing_repository.dart';

class DesktopFilePresentation {
  DesktopFilePresentation(this.hidden, this.activities, this.aliases);
  final Set<int> hidden;
  final Map<int, DesktopActivity> activities;
  final Map<int, int> aliases;
}

String? _id(Object? value) =>
    value is String && value.trim().isNotEmpty ? value.trim() : null;
bool _streaming(RemoteJson row) =>
    row['isStreaming'] == true ||
    row['is_streaming'] == true ||
    row['streaming'] == true;
String _path(String value) {
  var result = value.trim();
  if (result.startsWith('a/') || result.startsWith('b/')) {
    result = result.substring(2);
  }
  if (result.startsWith('./')) result = result.substring(2);
  return result.replaceFirst(RegExp(r':\d+(?::\d+)?$'), '').toLowerCase();
}

bool _sameFile(String a, String b) {
  final x = _path(a), y = _path(b);
  if (x.isEmpty || y.isEmpty) return false;
  if (x == y) return true;
  final absA = a.trim().startsWith('/'), absB = b.trim().startsWith('/');
  if (absA == absB) return false;
  final absolute = absA ? x : y, relative = absA ? y : x;
  return relative.contains('/') && absolute.endsWith('/$relative');
}

String _kind(String value) {
  final type = value.toLowerCase();
  if (RegExp('add|creat').hasMatch(type)) return 'add';
  if (RegExp('delet|remov').hasMatch(type)) return 'delete';
  if (RegExp('renam|move').hasMatch(type)) return 'rename';
  return 'update';
}

(int, int) _counts(String diff) {
  var additions = 0, deletions = 0;
  for (final line in diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return (additions, deletions);
}

class _File {
  _File(this.path, this.kind);
  String path, kind;
  final diffs = <String>[], seen = <String>{};
  final totals = <int, (int, int)>{};
}

bool _bounded(
  List<int> indices,
  List<RemoteJson> rows,
  List<DesktopActivity?> activities,
) {
  var bytes = 0;
  for (final index in indices) {
    final text = rows[index]['text'];
    for (final value in [
      if (text is String) text,
      for (final file in activities[index]!.files) ...[
        file.path,
        file.kind,
        file.diff,
      ],
    ]) {
      if (value.length > 96000) return false;
      bytes += utf8.encode(value).length;
      if (bytes > 96000) return false;
    }
  }
  return true;
}

List<ActivityFileChange> _merge(
  List<int> indices,
  List<DesktopActivity?> activities,
) {
  final files = <_File>[];
  const precedence = ['add', 'delete', 'rename', 'update'];
  for (final index in indices) {
    for (final change in activities[index]!.files) {
      var file = files.where((f) => _sameFile(f.path, change.path)).firstOrNull;
      final kind = _kind(change.kind);
      if (file == null) {
        file = _File(change.path.trim(), kind);
        files.add(file);
      } else {
        final path = change.path.trim();
        if (path.isNotEmpty && path.length < file.path.length) file.path = path;
        if (precedence.indexOf(kind) < precedence.indexOf(file.kind)) {
          file.kind = kind;
        }
      }
      final diff = change.diff.trim(), counts = _counts(change.diff);
      if (diff.isNotEmpty && file.seen.add(diff)) {
        file.diffs.add(diff);
        final previous = file.totals[index] ?? (0, 0);
        file.totals[index] = (previous.$1 + counts.$1, previous.$2 + counts.$2);
      }
      if (change.additions != null || change.deletions != null) {
        file.totals[index] = (
          change.additions ?? counts.$1,
          change.deletions ?? counts.$2,
        );
      }
    }
  }
  return [
    for (final file in files)
      ActivityFileChange(
        file.path,
        file.kind,
        file.diffs.join('\n\n'),
        additions: file.totals.values.fold<int>(
          0,
          (sum, value) => sum + value.$1,
        ),
        deletions: file.totals.values.fold<int>(
          0,
          (sum, value) => sum + value.$2,
        ),
      ),
  ];
}

DesktopFilePresentation projectDesktopFileChanges(
  List<RemoteJson> rows,
  List<DesktopActivity?> activities, {
  String? activeTurn,
  bool isThreadRunning = false,
}) {
  final groups = <Object, List<int>>{}, hidden = <int>{};
  final overrides = <int, DesktopActivity>{}, aliases = <int, int>{};
  var block = 0;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]['type'] == 'userMessage') {
      block = i + 1;
      continue;
    }
    final activity = activities[i];
    if (activity?.kind != 'fileChange') continue;
    final turn = _id(rows[i]['turnId'] ?? rows[i]['turn_id'] ?? activity!.turn);
    if (isThreadRunning && turn == _id(activeTurn)) hidden.add(i);
    if (_streaming(rows[i]) || activity!.status == 'running') continue;
    final key = (
      activity.mac,
      activity.thread,
      turn == null ? ('block', block) : ('turn', turn),
    );
    groups.putIfAbsent(key, () => []).add(i);
  }
  for (final indices in groups.values) {
    if (indices.length < 2 ||
        indices.any(hidden.contains) ||
        !_bounded(indices, rows, activities)) {
      continue;
    }
    final files = _merge(indices, activities);
    if (files.isEmpty) continue;
    final index = indices.last, host = activities[index]!;
    overrides[index] = DesktopActivity(
      mac: host.mac,
      thread: host.thread,
      turn: host.turn,
      item: host.item,
      kind: host.kind,
      status: host.status,
      command: host.command,
      name: host.name,
      cwd: host.cwd,
      exitCode: host.exitCode,
      durationMs: host.durationMs,
      outputTail: host.outputTail,
      files: files,
    );
    for (final old in indices.where((i) => i != index)) {
      hidden.add(old);
      aliases[old] = index;
    }
  }
  return DesktopFilePresentation(
    Set.unmodifiable(hidden),
    Map.unmodifiable(overrides),
    Map.unmodifiable(aliases),
  );
}
