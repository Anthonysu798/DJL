import '../../pairing/data/pairing_repository.dart';
import 'thread_local_state.dart';

String? desktopConversationPath(Object? value) {
  if (value is! String || value.trim().isEmpty) return null;
  final path = value.trim();
  if (RegExp(r'^~/*$').hasMatch(path)) return '~/';
  if (RegExp(r'^[A-Za-z]:[/\\]+$').hasMatch(path)) {
    return '${path.substring(0, 2)}/';
  }
  final normalized = path.replaceFirst(RegExp(r'/+$'), '');
  if (normalized.isEmpty) return '/';
  return normalized.startsWith('/') ||
          normalized.startsWith('~/') ||
          normalized.startsWith(r'\\') ||
          RegExp(r'^[A-Za-z]:[/\\]').hasMatch(normalized)
      ? normalized
      : null;
}

String? desktopConversationFolder(
  RemoteJson? thread, {
  List<String> projectlessRoots = const [],
}) {
  final path = desktopConversationPath(thread?['cwd']);
  if (path == null || thread?['djlScope'] == 'studio') return null;
  if (thread?['djlScope'] != 'project') {
    final parts = _components(path);
    for (var i = 0; i < parts.length; i++) {
      if (i + 2 < parts.length &&
          parts[i] == '.codex' &&
          parts[i + 1] == 'threads') {
        return null;
      }
      if (i + 3 < parts.length &&
          parts[i] == 'Documents' &&
          parts[i + 1] == 'Codex' &&
          RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(parts[i + 2])) {
        return null;
      }
    }
    for (final root in projectlessRoots) {
      final normalized = desktopConversationPath(root);
      if (normalized == null) continue;
      final prefix = _components(normalized);
      if (prefix.isNotEmpty &&
          parts.length >= prefix.length &&
          List.generate(
            prefix.length,
            (i) => parts[i].toLowerCase() == prefix[i].toLowerCase(),
          ).every((equal) => equal)) {
        return null;
      }
    }
  }
  return desktopConversationPathLabel(path);
}

List<String> _components(String path) =>
    path.replaceAll(r'\', '/').split('/').where((p) => p.isNotEmpty).toList();

String desktopConversationPathLabel(String path) =>
    path.split('/').where((p) => p.isNotEmpty).lastOrNull ?? path;

enum DesktopOverviewScope {
  studio('Studio'),
  projects('Projects');

  const DesktopOverviewScope(this.title);
  final String title;
}

enum DesktopOverviewGroupKind { studio, project, pinned }

class DesktopOverviewGroup {
  DesktopOverviewGroup({
    required this.id,
    required this.label,
    required this.kind,
    required List<RemoteJson> threads,
    this.path,
  }) : threads = List.unmodifiable(threads);
  final String id, label;
  final String? path;
  final DesktopOverviewGroupKind kind;
  bool get pinned => kind == DesktopOverviewGroupKind.pinned;
  bool get project => kind == DesktopOverviewGroupKind.project;
  final List<RemoteJson> threads;
}

List<String> desktopProjectThreadIds(
  ThreadLocalState data,
  DesktopOverviewGroup group, {
  bool liveOnly = true,
}) {
  if (!group.project) return const [];
  final groups = projectDesktopOverview(
    data.snapshots.where((thread) {
      final id = thread['id'] as String;
      return !data.deleted.contains(id) && (!liveOnly || !data.isArchived(id));
    }).toList(),
    scope: DesktopOverviewScope.projects,
    projectlessRoots: data.projectlessChatRoots,
  );
  return groups
      .where((candidate) => candidate.id == group.id)
      .expand((candidate) => candidate.threads)
      .map((thread) => thread['id'] as String)
      .toList();
}

int _recent(RemoteJson thread) {
  final raw = thread['updatedAt'] ?? thread['createdAt'];
  if (raw is num) {
    final absolute = raw.abs();
    return (absolute >= 1000000000000000000
            ? raw / 1000000
            : absolute >= 1000000000000000
            ? raw / 1000
            : absolute >= 10000000000
            ? raw
            : raw * 1000)
        .round();
  }
  return raw is String
      ? DateTime.tryParse(raw)?.millisecondsSinceEpoch ?? 0
      : 0;
}

int _compareThreads(RemoteJson a, RemoteJson b) {
  final recent = _recent(b).compareTo(_recent(a));
  return recent != 0
      ? recent
      : (a['id'] as String).compareTo(b['id'] as String);
}

// Receives the existing encrypted cache's archive/deletion-filtered metadata.
List<DesktopOverviewGroup> projectDesktopOverview(
  List<RemoteJson> threads, {
  required DesktopOverviewScope scope,
  List<String> pinned = const [],
  List<String> projectlessRoots = const [],
  String query = '',
}) {
  final search = query.trim().toLowerCase();
  final scoped = threads.where((thread) {
    final folder = desktopConversationFolder(
      thread,
      projectlessRoots: projectlessRoots,
    );
    final studio =
        thread['djlScope'] == 'studio' ||
        thread['djlScope'] != 'project' && folder == null;
    return (scope == DesktopOverviewScope.studio ? studio : !studio) &&
        (search.isEmpty ||
            [
              threadTitle(thread),
              thread['preview'],
              thread['cwd'],
              folder ?? (!studio ? 'No Project' : null),
            ].whereType<String>().any(
              (value) => value.toLowerCase().contains(search),
            ));
  }).toList()..sort(_compareThreads);
  final byId = {for (final thread in scoped) thread['id'] as String: thread};
  final pinnedRows = <RemoteJson>[], visited = <String>{};
  void appendPinned(String id) {
    final thread = byId[id];
    if (thread == null || !visited.add(id)) return;
    pinnedRows.add(thread);
    for (final child in scoped.where((t) => t['parentThreadId'] == id)) {
      appendPinned(child['id'] as String);
    }
  }

  for (final id in pinned) {
    appendPinned(id);
  }
  final groups = <DesktopOverviewGroup>[
    if (pinnedRows.isNotEmpty)
      DesktopOverviewGroup(
        id: 'pinned',
        label: 'Pinned',
        threads: pinnedRows,
        kind: DesktopOverviewGroupKind.pinned,
      ),
  ];
  final remaining = scoped.where((t) => !visited.contains(t['id'])).toList();
  if (scope == DesktopOverviewScope.studio) {
    if (remaining.isNotEmpty) {
      groups.add(
        DesktopOverviewGroup(
          id: 'studio',
          label: 'Studio',
          threads: remaining,
          kind: DesktopOverviewGroupKind.studio,
        ),
      );
    }
  } else {
    final projects = <String?, List<RemoteJson>>{};
    for (final thread in remaining) {
      final path = desktopConversationPath(thread['cwd']);
      projects.putIfAbsent(path, () => []).add(thread);
    }
    groups.addAll(
      projects.entries
          .map(
            (entry) => DesktopOverviewGroup(
              id: 'project:${entry.key ?? ''}',
              label: entry.key == null
                  ? 'No Project'
                  : desktopConversationPathLabel(entry.key!),
              kind: DesktopOverviewGroupKind.project,
              path: entry.key,
              threads: entry.value,
            ),
          )
          .toList()
        ..sort((a, b) {
          final recent = _recent(
            b.threads.first,
          ).compareTo(_recent(a.threads.first));
          if (recent != 0) return recent;
          final label = a.label.toLowerCase().compareTo(b.label.toLowerCase());
          return label != 0 ? label : a.id.compareTo(b.id);
        }),
    );
  }
  return groups;
}
