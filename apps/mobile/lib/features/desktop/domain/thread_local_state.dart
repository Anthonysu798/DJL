import '../../workspace/domain/response_change_set.dart';
import '../../pairing/data/pairing_repository.dart';
import 'desktop_composer.dart';
import '../../subagents/domain/subagent_action.dart';
import '../../guardian/domain/guardian_review.dart';
import '../../activity/domain/desktop_activity.dart';
import '../../../l10n/l10n.dart';

RemoteJson normalizeThread(RemoteJson value) {
  final result = Map<String, dynamic>.from(value),
      metadata = value['metadata'] is Map ? value['metadata'] as Map : const {};
  const aliases = {
    'parentThreadId': ['parentThreadId', 'parent_thread_id'],
    'forkedFromThreadId': [
      'forkedFromThreadId',
      'forkedFromId',
      'forked_from_thread_id',
      'forked_from_id',
    ],
    'modelProvider': ['modelProvider', 'model_provider'],
    'cwd': ['cwd', 'currentWorkingDirectory', 'current_working_directory'],
    'reasoningEffort': ['reasoningEffort', 'reasoning_effort'],
    'serviceTier': ['serviceTier', 'service_tier'],
    'runtimeMode': ['runtimeMode', 'runtime_mode'],
  };
  for (final entry in aliases.entries) {
    for (final key in entry.value) {
      final v = value[key] ?? metadata[key];
      if (v is String && v.trim().isNotEmpty) {
        result[entry.key] = v.trim();
        break;
      }
    }
  }
  return result;
}

String threadTitle(RemoteJson value) {
  final explicitName = value['name'];
  if (explicitName is String && explicitName.trim().isNotEmpty) {
    return explicitName.trim();
  }
  for (final key in ['title', 'preview']) {
    final text = value[key];
    if (text is String &&
        text.trim().isNotEmpty &&
        (key != 'title' ||
            !{
              'conversation',
              'untitled chat',
            }.contains(text.trim().toLowerCase()))) {
      return text.trim();
    }
  }
  return appStrings.desktopUntitledChat;
}

class ThreadLocalState {
  ThreadLocalState();
  ResponseChangeLedger responseChanges = ResponseChangeLedger();
  final snapshots = <RemoteJson>[];
  final renames = <String, String>{};
  final drafts = <String, String>{};
  final composerDrafts = <String, DesktopComposerDraft>{};
  DesktopComposerDraft composerDraft(String id) =>
      (composerDrafts[id] ?? DesktopComposerDraft()).copyWith(
        text: drafts[id] ?? composerDrafts[id]?.text ?? '',
      );
  void setComposerDraft(String id, DesktopComposerDraft draft) {
    drafts[id] = draft.text;
    if (draft.isEmpty) {
      composerDrafts.remove(id);
    } else {
      composerDrafts[id] = draft;
    }
  }

  final archiveOverrides = <String, bool>{};
  final deleted = <String>{};
  final pinned = <String>[];
  final overviewCollapsedProjects = <String>{};
  final projectlessChatRoots = <String>[];
  final created = <String>{};
  final projectBindings = <String, String>{};
  final associatedWorktreePaths = <String, String>{};
  final timelines = <String, List<RemoteJson>>{};
  final runtimes = <String, RemoteJson>{};
  final planSessions = <String, RemoteJson>{};
  final goals = <String, RemoteJson>{};
  List<RemoteJson> approvals = [], userInputs = [];
  factory ThreadLocalState.fromJson(RemoteJson value) {
    final state = ThreadLocalState();
    state.responseChanges = ResponseChangeLedger.fromJson(
      value['responseChanges'],
    );
    state.snapshots.addAll(
      (value['threads'] as List? ?? []).whereType<Map>().map(
        (t) => normalizeThread(
          sanitizedSubagentThread(
            sanitizedActivityThread(
              sanitizedGuardianThread(Map<String, dynamic>.from(t)),
            ),
          ),
        ),
      ),
    );
    state.created.addAll(List<String>.from(value['created'] as List? ?? []));
    state.projectBindings.addAll(
      Map<String, String>.from(value['projectBindings'] as Map? ?? {}),
    );
    state.associatedWorktreePaths.addAll(
      Map<String, String>.from(value['associatedWorktreePaths'] as Map? ?? {}),
    );
    state.drafts.addAll(
      Map<String, String>.from(value['drafts'] as Map? ?? {}),
    );
    for (final entry in (value['composerDrafts'] as Map? ?? {}).entries) {
      state.composerDrafts[entry.key as String] = DesktopComposerDraft.fromJson(
        Map<String, dynamic>.from(entry.value as Map),
      );
    }
    state.renames.addAll(
      Map<String, String>.from(value['renames'] as Map? ?? {}),
    );
    state.archiveOverrides.addAll(
      Map<String, bool>.from(value['archiveOverrides'] as Map? ?? {}),
    );
    state.deleted.addAll(List<String>.from(value['deleted'] as List? ?? []));
    state.pinned.addAll(List<String>.from(value['pinned'] as List? ?? []));
    state.overviewCollapsedProjects.addAll(
      (value['overviewCollapsedProjects'] as List? ?? []).whereType<String>(),
    );
    state.projectlessChatRoots.addAll(
      (value['projectlessChatRoots'] as List? ?? []).whereType<String>(),
    );
    for (final entry in (value['timelines'] as Map? ?? {}).entries) {
      state.timelines[entry.key as String] = (entry.value as List)
          .map(
            (v) => sanitizedSubagentRow(
              sanitizedActivityRow(
                sanitizedGuardianRow(
                  Map<String, dynamic>.from(v as Map),
                  entry.key as String,
                ),
                entry.key as String,
              ),
              entry.key as String,
            ),
          )
          .toList();
    }
    for (final name in ['runtimes', 'goals']) {
      final target = name == 'runtimes' ? state.runtimes : state.goals;
      for (final entry in (value[name] as Map? ?? {}).entries) {
        target[entry.key as String] = Map<String, dynamic>.from(
          entry.value as Map,
        );
      }
    }
    final sessions = value['planSessions'];
    if (sessions is Map) {
      for (final entry in sessions.entries) {
        final saved = entry.value;
        if (entry.key is! String || saved is! Map) continue;
        final pin = saved['identityPin'], source = saved['source'];
        if ((entry.key as String).trim().isNotEmpty &&
            pin is String &&
            pin.trim().isNotEmpty &&
            {'requested', 'native', 'compatibilityFallback'}.contains(source)) {
          state.planSessions[entry.key as String] = {
            'identityPin': pin,
            'source': source,
          };
        }
      }
    }
    // Command/permission approvals are live-session authority, never restored from disk.
    state.approvals = [];
    state.userInputs = (value['userInputs'] as List? ?? [])
        .map((v) => Map<String, dynamic>.from(v as Map))
        .toList();
    return state;
  }
  RemoteJson toJson() => {
    'responseChanges': responseChanges.toJson(),
    'created': created.toList(),
    'projectBindings': projectBindings,
    'associatedWorktreePaths': associatedWorktreePaths,
    'overviewCollapsedProjects': overviewCollapsedProjects.toList()..sort(),
    'projectlessChatRoots': projectlessChatRoots,
    'threads': snapshots
        .map(
          (thread) => sanitizedSubagentThread(
            sanitizedActivityThread(sanitizedGuardianThread(thread)),
          ),
        )
        .toList(),
    'renames': renames,
    'drafts': drafts,
    'composerDrafts': composerDrafts.map(
      (id, draft) => MapEntry(id, draft.toJson()),
    ),
    'archiveOverrides': archiveOverrides,
    'deleted': deleted.toList(),
    'pinned': pinned,
    'timelines': timelines.map(
      (id, rows) => MapEntry(
        id,
        rows
            .map(
              (row) => sanitizedSubagentRow(
                sanitizedActivityRow(sanitizedGuardianRow(row, id), id),
                id,
              ),
            )
            .toList(),
      ),
    ),
    'runtimes': runtimes,
    'planSessions': planSessions,
    'goals': goals,
    'approvals': [],
    'userInputs': userInputs,
  };
  RemoteJson? find(String id) =>
      snapshots.where((t) => t['id'] == id).firstOrNull;
  List<String> subtree(String id) {
    final visited = <String>{id}, queue = <String>[id];
    for (var i = 0; i < queue.length; i++) {
      for (final t in snapshots) {
        final child = t['id'];
        if (t['parentThreadId'] == queue[i] &&
            child is String &&
            visited.add(child)) {
          queue.add(child);
        }
      }
    }
    return queue;
  }

  String rootOf(String id) {
    var current = id;
    final visited = <String>{id};
    while (true) {
      final parent = find(current)?['parentThreadId'];
      if (parent is! String || find(parent) == null || !visited.add(parent)) {
        return current;
      }
      current = parent;
    }
  }

  bool isArchived(String id) =>
      archiveOverrides[id] ?? find(id)?['archived'] == true;
  bool isPinned(String id) => pinned.contains(rootOf(id));
  void noteCreated(RemoteJson value) {
    created.add(value['id'] as String);
    upsert(value);
  }

  void bindProject(String id, String path) {
    projectBindings[id] = path;
    final thread = find(id);
    if (thread != null) {
      thread['cwd'] = path;
    }
  }

  void upsert(RemoteJson raw, {bool fromServer = false}) {
    final value = normalizeThread(raw)..remove('turns');
    final id = value['id'] as String;
    final binding = projectBindings[id];
    if (binding != null) {
      if (fromServer && value['cwd'] == binding) {
        projectBindings.remove(id);
      } else {
        value['cwd'] = binding;
      }
    }
    final index = snapshots.indexWhere((t) => t['id'] == id);
    if (renames.containsKey(id)) {
      value['name'] = renames[id];
      value['title'] = renames[id];
    }
    if (index < 0) {
      snapshots.add(value);
    } else {
      snapshots[index] = {...snapshots[index], ...value};
    }
  }

  void mergeServer(List<RemoteJson> values) {
    final retain = <String>{
      for (final t in snapshots)
        if (isArchived(t['id'] as String)) t['id'] as String,
    };
    for (final id in pinned) {
      retain.addAll(subtree(id));
    }
    final incoming = values.map((t) => t['id']).toSet();
    created.removeWhere(incoming.contains);
    retain.addAll(created);
    retain.addAll(projectBindings.keys);
    snapshots.removeWhere((t) => !retain.contains(t['id']));
    for (final value in values) {
      upsert(value, fromServer: true);
    }
  }

  void rename(String id, String name) {
    final trimmed = name.trim();
    if (trimmed.isEmpty) {
      throw FormatException(appStrings.desktopEnterChatName);
    }
    renames[id] = trimmed;
    final t = find(id);
    if (t != null) {
      t['name'] = trimmed;
      t['title'] = trimmed;
    }
  }

  void archive(String id, bool value) {
    for (final child in subtree(id)) {
      archiveOverrides[child] = value;
      if (value) {
        pinned.remove(child);
        goals.remove(child);
      }
    }
  }

  void pin(String id, bool value) {
    final root = rootOf(id);
    pinned.remove(root);
    if (value) {
      pinned.insert(0, root);
    }
  }

  void remove(String id) {
    for (final child in subtree(id).skip(1)) {
      archiveOverrides[child] = true;
      pinned.remove(child);
      goals.remove(child);
    }
    deleted.add(id);
    created.remove(id);
    projectBindings.remove(id);
    associatedWorktreePaths.remove(id);
    pinned.remove(id);
    drafts.remove(id);
    composerDrafts.remove(id);
    timelines.remove(id);
    runtimes.remove(id);
    planSessions.remove(id);
    goals.remove(id);
    snapshots.removeWhere((t) => t['id'] == id);
  }

  List<RemoteJson> visible({bool archived = false, String query = ''}) {
    final items = snapshots
        .where(
          (t) =>
              !deleted.contains(t['id']) &&
              isArchived(t['id'] as String) == archived &&
              (query.trim().isEmpty ||
                  threadTitle(
                    t,
                  ).toLowerCase().contains(query.trim().toLowerCase())),
        )
        .toList();
    items.sort((a, b) {
      final ai = pinned.indexOf(rootOf(a['id'] as String)),
          bi = pinned.indexOf(rootOf(b['id'] as String));
      if (ai == bi) {
        return snapshots.indexOf(a).compareTo(snapshots.indexOf(b));
      }
      return (ai < 0 ? pinned.length : ai).compareTo(
        bi < 0 ? pinned.length : bi,
      );
    });
    return items;
  }
}
