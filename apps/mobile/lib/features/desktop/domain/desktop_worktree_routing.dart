import '../../pairing/data/pairing_repository.dart';
import 'desktop_overview.dart';
import 'thread_local_state.dart';

bool isManagedWorktreePath(Object? value) {
  final path = comparableWorktreePath(value);
  if (path == null) return false;
  final parts = path.split(RegExp(r'[/\\]'));
  for (var i = 0; i + 2 < parts.length; i++) {
    if (parts[i] == '.codex' &&
        parts[i + 1] == 'worktrees' &&
        parts[i + 2].trim().isNotEmpty) {
      return true;
    }
  }
  return false;
}

// These are remote paths: resolving them through the phone filesystem would
// compare unrelated files. Canonical server paths get lexical normalization only.
String? comparableWorktreePath(Object? value) {
  final path = desktopConversationPath(value);
  if (path == null || !path.startsWith('/') || path.startsWith('//')) {
    return path;
  }
  final parts = <String>[];
  for (final part in path.split('/')) {
    if (part.isEmpty || part == '.') continue;
    if (part == '..') {
      if (parts.isNotEmpty) parts.removeLast();
    } else {
      parts.add(part);
    }
  }
  return '/${parts.join('/')}';
}

List<RemoteJson> liveWorktreeChats(ThreadLocalState state, String path) {
  final target = comparableWorktreePath(path);
  if (target == null) return [];
  final matches = state.snapshots.where((thread) {
    final id = thread['id'];
    return id is String &&
        id.isNotEmpty &&
        !state.deleted.contains(id) &&
        !state.isArchived(id) &&
        thread['syncState'] != 'archivedLocal' &&
        comparableWorktreePath(thread['cwd']) == target;
  }).toList();
  matches.sort((a, b) {
    final date = _date(b).compareTo(_date(a));
    return date != 0 ? date : (a['id'] as String).compareTo(b['id'] as String);
  });
  return matches;
}

double _date(RemoteJson thread) {
  for (final field in ['updatedAt', 'updated_at', 'createdAt', 'created_at']) {
    final value = thread[field];
    final number = value is num
        ? value.toDouble()
        : value is String
        ? double.tryParse(value.trim())
        : null;
    if (number != null && number.isFinite) {
      final n = number.abs();
      return number /
          (n >= 1e18
              ? 1e9
              : n >= 1e15
              ? 1e6
              : n >= 1e10
              ? 1e3
              : 1);
    }
    final date = value is String ? DateTime.tryParse(value.trim()) : null;
    if (date != null) return date.microsecondsSinceEpoch / 1e6;
  }
  return double.negativeInfinity;
}
