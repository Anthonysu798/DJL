import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import '../../pairing/data/pairing_repository.dart';
import '../../goals/data/goal_repository.dart';
import '../../goals/domain/thread_goal.dart';
import '../data/desktop_local_store.dart';
import '../data/remote_transport.dart';
import '../data/thread_repository.dart';
import '../domain/thread_local_state.dart';

class DesktopThreadsController extends ChangeNotifier {
  DesktopThreadsController(this.transport, this.store) {
    _events = transport.messages.listen(_incoming);
  }
  final RemoteTransport transport;
  final DesktopLocalStore store;
  late final StreamSubscription<RemoteJson> _events;
  ThreadLocalState data = ThreadLocalState();
  ThreadRepository? _repository;
  String? macDeviceId, localError, syncWarning;
  bool showArchived = false,
      loading = false,
      supportsGoals = true,
      _disposed = false;
  String query = '';
  int _generation = 0;
  Timer? _saveTimer;
  bool _cacheLoaded = false, _staging = false;
  RemoteJson? _stagedOriginal;

  Future<void> stageSwitch(String mac) async {
    final generation = ++_generation;
    _saveTimer?.cancel();
    _staging = true;
    _stagedOriginal = null;
    _cacheLoaded = false;
    macDeviceId = mac;
    data = ThreadLocalState();
    _repository = ThreadRepository(transport, macDeviceId: mac);
    localError = null;
    syncWarning = null;
    showArchived = false;
    query = '';
    supportsGoals = true;
    _goalRevisions.clear();
    _notify();
    final value = await store.load(mac);
    if (generation != _generation || _disposed) return;
    _stagedOriginal = jsonDecode(jsonEncode(value)) as RemoteJson;
    data = ThreadLocalState.fromJson(value);
    _notify();
  }

  Future<void> commitSwitch() async {
    if (!_staging || _stagedOriginal == null) return;
    _staging = false;
    _stagedOriginal = null;
    _cacheLoaded = true;
    await saveNow();
  }

  void discardSwitch({bool clear = false}) {
    ++_generation;
    _saveTimer?.cancel();
    loading = false;
    if (_staging) data = ThreadLocalState.fromJson(_stagedOriginal ?? {});
    _staging = false;
    _stagedOriginal = null;
    // Failure may show offline metadata, but must not overwrite the old file.
    _cacheLoaded = false;
    if (clear) {
      macDeviceId = null;
      _repository = null;
      data = ThreadLocalState();
    }
    _notify();
  }

  final _goalRevisions = <String, int>{};
  List<RemoteJson> get visible =>
      data.visible(archived: showArchived, query: query);
  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  void filter({bool? archived, String? search}) {
    if (archived != null) {
      showArchived = archived;
    }
    if (search != null) {
      query = search;
    }
    _notify();
  }

  Future<void> attach(String mac) async {
    if (macDeviceId == mac && (_cacheLoaded || _staging)) {
      return;
    }
    final generation = ++_generation;
    await saveNow();
    if (generation != _generation) {
      return;
    }
    macDeviceId = mac;
    _cacheLoaded = false;
    data = ThreadLocalState();
    _repository = ThreadRepository(transport, macDeviceId: mac);
    localError = null;
    syncWarning = null;
    showArchived = false;
    query = '';
    supportsGoals = true;
    _goalRevisions.clear();
    _notify();
    try {
      final value = await store.load(mac);
      if (generation == _generation && !_disposed) {
        data = ThreadLocalState.fromJson(value);
        _cacheLoaded = true;
        localError = null;
      }
    } catch (_) {
      if (generation == _generation) {
        localError =
            'Could not open offline chats. Unlock your device or reconnect to load them.';
      }
    }
    _notify();
  }

  Future<void> saveNow() async {
    _saveTimer?.cancel();
    _saveTimer = null;
    final mac = macDeviceId;
    if (mac == null || !_cacheLoaded || _staging) {
      return;
    }
    final value = data.toJson();
    try {
      await store.save(mac, value);
      if (macDeviceId == mac) {
        localError = null;
      }
    } catch (_) {
      if (macDeviceId == mac) {
        localError =
            'Could not save offline chats. Unlock your device and try again.';
        _notify();
      }
    }
  }

  void scheduleSave() {
    if (_disposed || macDeviceId == null || _staging) {
      return;
    }
    _saveTimer?.cancel();
    _saveTimer = Timer(
      const Duration(milliseconds: 200),
      () => unawaited(saveNow()),
    );
  }

  void cacheTimeline(
    RemoteJson thread,
    List<RemoteJson> items, {
    required List<RemoteJson> approvals,
    required List<RemoteJson> userInputs,
  }) {
    final id = thread['id'] as String;
    if (data.deleted.contains(id)) {
      return;
    }
    data.upsert(thread);
    data.timelines[id] = List.of(items);
    data.approvals = List.of(approvals);
    data.userInputs = List.of(userInputs);
    scheduleSave();
  }

  Future<void> refresh({bool Function()? isCurrent}) async {
    if (isCurrent?.call() == false) return;
    final repo = _repository;
    if (repo == null) {
      throw StateError('Choose a paired desktop.');
    }
    final generation = _generation;
    loading = true;
    _notify();
    try {
      final all = <RemoteJson>[];
      String? cursor;
      do {
        if (isCurrent?.call() == false) return;
        final result = await repo.list(cursor);
        if (generation != _generation || isCurrent?.call() == false) {
          return;
        }
        all.addAll(
          ((result['data'] ?? result['items'] ?? result['threads'] ?? [])
                  as List)
              .map((t) => Map<String, dynamic>.from(t as Map)),
        );
        cursor = result['nextCursor'] as String?;
      } while (cursor != null);
      data.mergeServer(all);
      scheduleSave();
    } finally {
      if (generation == _generation) {
        loading = false;
        _notify();
      }
    }
  }

  Future<void> _sync(
    Future<void> Function(ThreadRepository repository) action,
    int generation,
  ) async {
    final repository = _repository;
    await saveNow();
    if (repository == null || !transport.connected) {
      return;
    }
    try {
      await action(repository);
      if (generation == _generation) {
        syncWarning = null;
      }
    } catch (_) {
      if (generation == _generation) {
        syncWarning =
            'Saved on this device. The change on your desktop could not be confirmed; refresh before retrying.';
      }
    }
    if (generation == _generation) {
      _notify();
    }
  }

  Future<void> rename(String id, String name) async {
    final generation = _generation;
    data.rename(id, name);
    _notify();
    await _sync((repo) => repo.rename(id, name.trim()), generation);
  }

  Future<void> archive(String id, bool value) async {
    final generation = _generation;
    data.archive(id, value);
    _notify();
    await _sync((repo) => repo.archive(id, value), generation);
  }

  List<String> _groupRoots(List<String> ids) {
    final selected = ids
        .where((id) => data.find(id) != null && !data.deleted.contains(id))
        .toSet();
    return selected
        .where((id) => !selected.contains(data.find(id)?['parentThreadId']))
        .toList()
      ..sort();
  }

  Future<List<String>> archiveGroup(List<String> ids) async {
    final generation = _generation, revision = transport.connectionRevision;
    final ownedData = data;
    final repository = _repository, roots = _groupRoots(ids);
    final affected = {for (final id in roots) ...data.subtree(id)}.toList()
      ..sort();
    if (affected.isEmpty) return affected;
    for (final id in roots) {
      data.archive(id, true);
    }
    _notify();
    await saveNow();
    bool current() =>
        !_disposed &&
        identical(data, ownedData) &&
        generation == _generation &&
        revision == transport.connectionRevision;
    if (repository == null || !transport.connected || !current()) {
      return affected;
    }
    var confirmed = 0;
    for (final id in roots) {
      if (!current() || !transport.connected) break;
      try {
        await repository.archive(id, true);
        confirmed++;
      } catch (_) {
        // Retain the local archive; never replay an uncertain mutation.
      }
    }
    if (current()) {
      syncWarning = confirmed == roots.length
          ? null
          : 'Saved on this device. The change on your desktop could not be confirmed; refresh before retrying.';
      _notify();
    }
    return affected;
  }

  Future<List<String>> removeGroupLocally(List<String> ids) async {
    final roots = _groupRoots(ids);
    final affected = {for (final id in roots) ...data.subtree(id)}.toList()
      ..sort();
    if (affected.isEmpty) return affected;
    for (final id in affected) {
      data.remove(id);
    }
    _notify();
    await saveNow();
    return affected;
  }

  Future<void> pin(String id, bool value) async {
    data.pin(id, value);
    _notify();
    await saveNow();
  }

  Future<void> remove(String id, {required bool archiveOnDesktop}) async {
    final generation = _generation;
    data.remove(id);
    _notify();
    if (archiveOnDesktop) {
      await _sync((repo) => repo.archive(id, true), generation);
    } else {
      await saveNow();
    }
  }

  void setGoal(String id, ThreadGoal? goal) {
    _goalRevisions[id] = (_goalRevisions[id] ?? 0) + 1;
    if (goal == null) {
      data.goals.remove(id);
    } else if (!data.deleted.contains(id)) {
      data.goals[id] = goal.toJson();
    }
    scheduleSave();
    _notify();
  }

  void markGoalsUnsupported() {
    supportsGoals = false;
    _notify();
  }

  Future<void> hydrateGoals() async {
    if (!supportsGoals || !transport.connected) {
      return;
    }
    final generation = _generation;
    for (final thread in data.visible().take(30)) {
      if (generation != _generation || !supportsGoals || !transport.connected) {
        return;
      }
      final id = thread['id'] as String,
          revision = _goalRevisions[thread['id']] ?? 0;
      try {
        final goal = await GoalRepository(
          transport,
          threadId: id,
        ).get(timeout: const Duration(seconds: 5));
        if (generation == _generation &&
            revision == (_goalRevisions[id] ?? 0)) {
          setGoal(id, goal);
        }
      } on GoalsUnsupported {
        markGoalsUnsupported();
        return;
      } on EphemeralGoal {
        if (generation == _generation) {
          setGoal(id, null);
        }
      } catch (_) {
        return;
      }
    }
  }

  void _incoming(RemoteJson rpc) {
    if (macDeviceId == null ||
        transport.macDeviceId != macDeviceId ||
        rpc['params'] is! Map) {
      return;
    }
    final p = Map<String, dynamic>.from(rpc['params'] as Map),
        method = rpc['method'];
    final id = (p['threadId'] ?? p['thread_id']) as String?;
    if (id != null && data.deleted.contains(id)) {
      return;
    }
    switch (method) {
      case 'thread/name/updated':
        final name = p['name'] ?? p['title'];
        if (id == null || name is! String || name.trim().isEmpty) {
          return;
        }
        data.upsert({'id': id});
        data.rename(id, name);
      case 'thread/archived':
      case 'thread/unarchived':
        if (id == null) {
          return;
        }
        data.upsert({'id': id});
        data.archive(id, method == 'thread/archived');
      case 'thread/started':
      case 'thread/updated':
        if (p['thread'] is! Map) {
          return;
        }
        data.upsert(Map<String, dynamic>.from(p['thread'] as Map));
      case 'thread/goal/updated':
        try {
          final goal = ThreadGoal.fromJson(
            Map<String, dynamic>.from(p['goal'] as Map),
          );
          setGoal(goal.threadId, goal);
        } catch (_) {
          return;
        }
      case 'thread/goal/cleared':
        if (id == null) {
          return;
        }
        setGoal(id, null);
      default:
        return;
    }
    scheduleSave();
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _saveTimer?.cancel();
    unawaited(_events.cancel());
    super.dispose();
  }
}
