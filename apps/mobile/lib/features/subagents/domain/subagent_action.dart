import 'dart:convert';
import '../../pairing/data/pairing_repository.dart';
import '../../activity/domain/desktop_activity.dart'
    show activityObject, normalizedActivityType;

String? subagentString(Object? value) =>
    value is String && value.trim().isNotEmpty ? value.trim() : null;
String? _first(RemoteJson value, List<String> keys) =>
    keys.map((k) => subagentString(value[k])).whereType<String>().firstOrNull;
const _threads = [
  'receiverThreadId',
  'receiver_thread_id',
  'threadId',
  'thread_id',
  'newThreadId',
  'new_thread_id',
];
const _nicknames = [
  'agentNickname',
  'agent_nickname',
  'receiverAgentNickname',
  'receiver_agent_nickname',
  'newAgentNickname',
  'new_agent_nickname',
  'nickname',
  'name',
];
const _roles = [
  'agentRole',
  'agent_role',
  'receiverAgentRole',
  'receiver_agent_role',
  'newAgentRole',
  'new_agent_role',
  'agentType',
  'agent_type',
];
const _agents = [
  'agentId',
  'agent_id',
  'receiverAgentId',
  'receiver_agent_id',
  'newAgentId',
  'new_agent_id',
];
const _models = [
  'model',
  'modelName',
  'model_name',
  'modelProvider',
  'model_provider',
  'modelProviderId',
  'model_provider_id',
  'requestedModel',
  'requested_model',
];
const _prompts = ['prompt', 'instructions', 'instruction', 'task', 'message'];
Object? _value(RemoteJson object, List<String> keys) =>
    keys.map((k) => object[k]).where((v) => v != null).firstOrNull;
String subagentStatus(Object? raw) => switch (normalizedActivityType(raw)) {
  'running' || 'inprogress' => 'running',
  'completed' || 'done' || 'finished' || 'success' => 'completed',
  'failed' || 'error' || 'errored' => 'failed',
  'stopped' || 'cancelled' || 'canceled' || 'interrupted' => 'stopped',
  'queued' || 'pending' => 'queued',
  _ => 'unknown',
};
bool _terminal(String status) =>
    const {'completed', 'failed', 'stopped'}.contains(status);
bool isSubagentItem(RemoteJson item) {
  if (item['type'] == 'subagentAction') return true;
  final type = normalizedActivityType(item['type']);
  return type == 'collabagenttoolcall' ||
      type == 'collabtoolcall' ||
      type.startsWith('collab') &&
          const [
            'spawn',
            'wait',
            'close',
            'resume',
            'interaction',
            'sendinput',
          ].any(type.contains);
}

String _tool(RemoteJson item) {
  final raw = normalizedActivityType(
    item['tool'] ?? item['name'] ?? item['type'],
  );
  if (raw.contains('spawn')) return 'spawnagent';
  if (raw.contains('wait')) return 'wait';
  if (raw.contains('close')) return 'closeagent';
  if (raw.contains('resume')) return 'resumeagent';
  if (raw.contains('sendinput') || raw.contains('interaction')) {
    return 'sendinput';
  }
  return 'unknown';
}

class SubagentChild {
  SubagentChild(
    this.thread, {
    this.agentId,
    this.nickname,
    this.role,
    this.model,
    this.prompt,
    this.message,
    this.status = 'unknown',
    this.requestedModel = false,
  });
  final String thread;
  String? agentId, nickname, role, model, prompt, message;
  String status;
  bool requestedModel;
  String get label => nickname ?? role ?? 'Subagent';
  bool get hasIdentity => nickname != null || role != null;
  factory SubagentChild.decode(
    String thread,
    RemoteJson value, {
    String? fallbackStatus,
    bool requested = false,
    bool cached = false,
    bool synthetic = false,
  }) => SubagentChild(
    thread,
    agentId:
        _first(value, _agents) ??
        (synthetic ? null : subagentString(value['id'])),
    nickname: _first(
      value,
      synthetic ? _nicknames.where((k) => k != 'name').toList() : _nicknames,
    ),
    role: _first(value, _roles),
    model: _first(value, _models),
    prompt: _first(
      value,
      cached ? _prompts.where((k) => k != 'message').toList() : _prompts,
    ),
    message: subagentString(value['message']),
    status: subagentStatus(value['status'] ?? fallbackStatus),
    requestedModel: requested,
  );
  factory SubagentChild.fromThread(String thread, RemoteJson value) {
    final metadata = subagentThreadMetadata(value, thread)
      ..remove('id')
      ..remove('name')
      ..remove('modelProvider')
      ..remove('model_provider');
    return SubagentChild.decode(thread, metadata, cached: true);
  }

  void merge(SubagentChild newer) {
    agentId = newer.agentId ?? agentId;
    nickname = newer.nickname ?? nickname;
    role = newer.role ?? role;
    if (newer.model != null && (model == null || !newer.requestedModel)) {
      model = newer.model;
      requestedModel = newer.requestedModel;
    }
    prompt = newer.prompt ?? prompt;
    if (!_terminal(status) ||
        status == 'completed' && _terminal(newer.status)) {
      status = newer.status == 'unknown' ? status : newer.status;
      message = newer.message ?? message;
    }
  }

  RemoteJson toJson() => {
    'threadId': thread,
    'agentId': ?agentId,
    'nickname': ?nickname,
    'agentRole': ?role,
    'model': ?model,
    'prompt': ?prompt,
    'message': ?message,
    'status': status,
    'requestedModelHint': requestedModel,
  };
}

class SubagentAction {
  SubagentAction({
    required this.mac,
    required this.thread,
    required this.turn,
    required this.item,
    required this.tool,
    required this.status,
    required this.children,
    this.prompt,
  });
  final String mac, thread, turn, item, tool;
  String status;
  String? prompt;
  final List<SubagentChild> children;
  String get id => 'subagent:${jsonEncode([mac, thread, turn, item])}';
  String get title => switch (tool) {
    'spawnagent' => 'Spawn agent',
    'wait' => 'Wait for agents',
    'sendinput' => 'Update agent',
    'resumeagent' => 'Resume agent',
    'closeagent' => 'Close agent',
    _ => 'Subagent activity',
  };
  static SubagentAction? decode(
    RemoteJson raw, {
    required String mac,
    required String thread,
    required String turn,
  }) {
    if (!isSubagentItem(raw)) return null;
    final saved = activityObject(raw['subagent']);
    if (saved != null) {
      if (subagentString(saved['mac']) != null &&
          saved['mac'] != mac &&
          mac.isNotEmpty) {
        return null;
      }
      if (saved['thread'] != thread) return null;
    }
    final value = saved ?? raw;
    final item =
        subagentString(saved?['item']) ??
        _first(raw, ['id', 'itemId', 'item_id', 'callId', 'call_id']);
    if (item == null) return null;
    final tool = saved == null
        ? _tool(value)
        : subagentString(saved['tool']) ?? 'unknown';
    final status = subagentStatus(value['status']);
    final ids = <String>{};
    final plural = _value(value, [
      'receiverThreadIds',
      'receiver_thread_ids',
      'threadIds',
      'thread_ids',
    ]);
    if (plural is List) {
      ids.addAll(plural.map(subagentString).whereType<String>());
    }
    if (ids.isEmpty) {
      final singular = _first(value, _threads);
      if (singular != null) ids.add(singular);
    }
    final fallbackIds = List<String>.of(ids);
    final refs = <String, SubagentChild>{};
    final rawRefs =
        saved?['children'] ??
        _value(value, ['receiverAgents', 'receiver_agents', 'agents']);
    if (rawRefs is List) {
      for (var i = 0; i < rawRefs.length; i++) {
        final ref = activityObject(rawRefs[i]);
        if (ref == null) continue;
        final id =
            _first(ref, _threads) ??
            (i < fallbackIds.length ? fallbackIds[i] : null);
        if (id == null) continue;
        refs[id] = SubagentChild.decode(
          id,
          ref,
          fallbackStatus: status,
          cached: saved != null,
          requested: saved != null
              ? ref['requestedModelHint'] == true
              : tool == 'spawnagent',
        );
        ids.add(id);
      }
    }
    final states = _value(value, [
      'statuses',
      'agentsStates',
      'agents_states',
      'agentStates',
      'agent_states',
    ]);
    final stateMap = <String, RemoteJson>{};
    if (states is Map) {
      for (final entry in states.entries) {
        final id = subagentString(entry.key);
        if (id != null) {
          ids.add(id);
          stateMap[id] = activityObject(entry.value) ?? {};
        }
      }
    } else if (states is List) {
      for (final entry in states) {
        final state = activityObject(entry);
        if (state == null) continue;
        final id = _first(state, ['threadId', 'thread_id']);
        if (id != null) {
          ids.add(id);
          stateMap[id] = state;
        }
      }
    }
    final identities = <String, RemoteJson>{...stateMap};
    final statusIdentities = _value(value, ['agentStatuses', 'agent_statuses']);
    if (statusIdentities is List) {
      for (final rawIdentity in statusIdentities) {
        final identity = activityObject(rawIdentity);
        if (identity == null) continue;
        final id = _first(identity, _threads);
        if (id != null) identities[id] = {...?identities[id], ...identity};
      }
    }
    final children = <SubagentChild>[];
    for (final id in ids) {
      final child =
          refs[id] ??
          SubagentChild.decode(
            id,
            ids.length == 1 ? value : {},
            synthetic: true,
            fallbackStatus: status,
            requested: tool == 'spawnagent',
          );
      final identity = identities[id];
      if (identity != null) {
        child.agentId = _first(identity, _agents) ?? child.agentId;
        child.nickname =
            _first(identity, _nicknames.where((k) => k != 'name').toList()) ??
            child.nickname;
        child.role = _first(identity, _roles) ?? child.role;
      }
      final state = stateMap[id];
      if (state != null) {
        child.status = subagentStatus(state['status']);
        child.message = _first(state, ['message', 'text', 'delta', 'summary']);
      }
      children.add(child);
    }
    return SubagentAction(
      mac: subagentString(saved?['mac']) ?? mac,
      thread: thread,
      turn: subagentString(saved?['turn']) ?? turn,
      item: item,
      tool: tool,
      status: status,
      children: children,
      prompt: _first(value, _prompts),
    );
  }

  RemoteJson toRow() => {
    'id': id,
    'type': 'subagentAction',
    'threadId': thread,
    'turnId': turn,
    'subagent': {
      'mac': mac,
      'thread': thread,
      'turn': turn,
      'item': item,
      'tool': tool,
      'status': status,
      'prompt': ?prompt,
      'children': children.map((c) => c.toJson()).toList(),
    },
  };
}

class SubagentActions {
  final items = <String, SubagentAction>{};
  Map<String, RemoteJson> rebindHistoryTurn(
    String thread,
    String oldTurn,
    String turn, {
    Map<String, String> itemMappings = const {},
    Set<String>? rowIds,
  }) {
    final rows = <String, RemoteJson>{};
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
      final rebound = SubagentAction(
        mac: old.mac,
        thread: thread,
        turn: turn,
        item: itemMappings[old.id] ?? old.item,
        tool: old.tool,
        status: old.status,
        children: old.children,
        prompt: old.prompt,
      );
      rows[old.id] = merge(rebound).toRow();
    }
    return rows;
  }

  SubagentAction merge(SubagentAction incoming) {
    final old = items[incoming.id];
    if (old == null) {
      items[incoming.id] = incoming;
      return incoming;
    }
    if (!_terminal(old.status) ||
        old.status == 'completed' && _terminal(incoming.status)) {
      old.status = incoming.status == 'unknown' ? old.status : incoming.status;
    }
    old.prompt = incoming.prompt ?? old.prompt;
    for (final child in incoming.children) {
      final prior = old.children
          .where((c) => c.thread == child.thread)
          .firstOrNull;
      if (prior == null) {
        old.children.add(child);
      } else {
        prior.merge(child);
      }
    }
    return old;
  }
}

RemoteJson sanitizedSubagentRow(
  RemoteJson row,
  String thread, {
  String turn = '',
}) {
  if (!isSubagentItem(row)) return row;
  return SubagentAction.decode(
        row,
        mac: subagentString(activityObject(row['subagent'])?['mac']) ?? '',
        thread: thread,
        turn: subagentString(row['turnId']) ?? turn,
      )?.toRow() ??
      {
        'id': row['id'],
        'type': 'subagentAction',
        'threadId': thread,
        'text': 'Subagent metadata unavailable',
      };
}

RemoteJson sanitizedSubagentThread(RemoteJson thread) {
  if (thread['turns'] is! List) return thread;
  return {
    ...thread,
    'turns': (thread['turns'] as List)
        .whereType<Map>()
        .map(
          (turn) => {
            ...turn,
            'items': (turn['items'] as List? ?? [])
                .whereType<Map>()
                .map(
                  (row) => sanitizedSubagentRow(
                    Map<String, dynamic>.from(row),
                    thread['id'] as String,
                    turn: subagentString(turn['id']) ?? '',
                  ),
                )
                .toList(),
          },
        )
        .toList(),
  };
}

// Only display identity fields; generic `type` is never a role.
RemoteJson subagentThreadMetadata(RemoteJson raw, String id) {
  final source = activityObject(raw['source']);
  final sub =
      activityObject(source?['subAgent']) ??
      activityObject(source?['sub_agent']);
  final spawn =
      activityObject(sub?['thread_spawn']) ??
      activityObject(sub?['threadSpawn']);
  final merged = {...?sub, ...?spawn, ...raw};
  final result = <String, dynamic>{'id': id};
  for (final key in [
    'title',
    'name',
    'preview',
    'model',
    'modelProvider',
    'model_provider',
    'reasoningEffort',
    'reasoning_effort',
    'runtimeMode',
    'runtime_mode',
    'serviceTier',
    'service_tier',
    'runtimeSettingsRevision',
    'cwd',
    'parentThreadId',
    'parent_thread_id',
    'forkedFromThreadId',
  ]) {
    if (raw[key] is String || raw[key] is num) result[key] = raw[key];
  }
  result.addAll({
    'agentId': ?_first(merged, _agents),
    'agentNickname':
        ?(_first(raw, ['agentNickname', 'agent_nickname', 'nickname']) ??
        _first({...?sub, ...?spawn}, _nicknames)),
    'agentRole': ?_first(merged, _roles),
  });
  return result;
}
