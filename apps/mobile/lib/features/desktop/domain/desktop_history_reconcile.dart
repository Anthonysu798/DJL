import 'dart:convert';
import 'package:uuid/uuid.dart';
import '../../pairing/data/pairing_repository.dart';
import 'desktop_composer.dart';

String? _text(Object? value) =>
    value is String && value.trim().isNotEmpty ? value.trim() : null;

bool desktopHistoryOwnedRow(RemoteJson row, String thread, Object? turn) {
  for (final key in [
    'threadId',
    'thread_id',
    'conversationId',
    'conversation_id',
  ]) {
    if (row[key] != null && row[key] != thread) return false;
  }
  for (final key in ['turnId', 'turn_id']) {
    if (row[key] != null && row[key] != turn) return false;
  }
  for (final key in ['activity', 'subagent', '_djlReasoningV1']) {
    final metadata = row[key];
    if (metadata is Map &&
        (metadata['thread'] != thread || metadata['turn'] != turn)) {
      return false;
    }
  }
  return true;
}

RemoteJson desktopOwnedHistory(RemoteJson value) {
  final thread = value['id'];
  if (thread is! String) return {...value, 'turns': <dynamic>[]};
  final turns = <RemoteJson>[];
  for (final raw in (value['turns'] as List? ?? []).whereType<Map>()) {
    final turn = Map<String, dynamic>.from(raw);
    final identities = [
      turn['id'],
      turn['turnId'],
      turn['turn_id'],
    ].where((v) => v != null).toSet();
    if (identities.length > 1 || identities.any((v) => _text(v) == null)) {
      continue;
    }
    final id = identities.firstOrNull;
    if (!desktopHistoryOwnedRow(turn, thread, id)) continue;
    turns.add({
      ...turn,
      'id': id,
      'items': [
        for (final item in (turn['items'] as List? ?? []).whereType<Map>())
          if (desktopHistoryOwnedRow(
            Map<String, dynamic>.from(item),
            thread,
            id,
          ))
            {...Map<String, dynamic>.from(item), 'turnId': id},
      ],
    });
  }
  return {...value, 'turns': turns};
}

bool desktopProvisionalHistoryTurn(Object? value) {
  final id = _text(value);
  return id != null &&
      [
        'ipc-turn-',
        'turn-line-',
        'rollout-',
        'djl-history-compacted-',
      ].any(id.startsWith);
}

bool desktopProvisionalHistoryItem(String? id) =>
    id == null ||
    id.endsWith(':input') ||
    [
      'turn:',
      'rollout-',
      'djl-jsonl-',
      'user-message-line-',
      'response-item-line-',
      'apply-patch-line-',
    ].any(id.startsWith);

String? desktopHistorySourceId(RemoteJson row) {
  final source = _text(row['sourceItemId']);
  if (source != null) return source;
  final id = _text(row['id']);
  return id != null &&
          !id.startsWith('local-') &&
          !id.startsWith('_djl-local-history:')
      ? id
      : null;
}

bool desktopOrdinaryHistoryRow(RemoteJson row) =>
    {'userMessage', 'agentMessage'}.contains(row['type']);

String desktopHistoryUserText(RemoteJson row) => (row['content'] as List? ?? [])
    .whereType<Map>()
    .where((part) => part['text'] is String)
    .map((part) => part['text'] as String)
    .join('\n');

List<Map> _images(RemoteJson row) => (row['content'] as List? ?? [])
    .whereType<Map>()
    .where(desktopIsImage)
    .toList();

String _files(RemoteJson row) {
  final files =
      (row['fileMentions'] as List? ?? [])
          .whereType<String>()
          .map((s) => s.trim().toLowerCase())
          .where((s) => s.isNotEmpty)
          .toList()
        ..sort();
  return files.join('|');
}

bool _smallText(String text) =>
    text.length <= 64000 && utf8.encode(text).length <= 64000;
String _normalizedText(String text) => _smallText(text) ? text.trim() : text;
List<Map> _mentions(RemoteJson row) => (row['content'] as List? ?? [])
    .whereType<Map>()
    .where((p) => {'skill', 'mention'}.contains(p['type']))
    .toList();

typedef _HistoryMentionKey = ({String body, String skills, String plugins});
_HistoryMentionKey _mentionKey(RemoteJson row) {
  var body = desktopHistoryUserText(row);
  final skills = <String>{}, plugins = <String>{};
  for (final part in _mentions(row)) {
    final name = _text(part['name'] ?? part['id'])?.toLowerCase();
    if (name != null) (part['type'] == 'skill' ? skills : plugins).add(name);
  }
  for (final entry in [
    ('skillMentions', skills),
    ('pluginMentions', plugins),
  ]) {
    for (final name in (row[entry.$1] as List? ?? []).whereType<String>()) {
      if (name.trim().isNotEmpty) entry.$2.add(name.trim().toLowerCase());
    }
  }
  final tokens = RegExp(
    r'(?<!\S)([$/@])([A-Za-z0-9][A-Za-z0-9._-]*)(?=[\s,.;:!?)\]}>]|$)',
  );
  body = body.replaceAllMapped(tokens, (m) {
    (m[1] == '@' ? plugins : skills).add(m[2]!.toLowerCase());
    return '';
  });
  String remove(String text, String phrase) => text.replaceAll(
    RegExp(
      r'(?<!\S)' + RegExp.escape(phrase) + r'(?=[\s,.;:!?)\]}>]|$)',
      caseSensitive: false,
    ),
    '',
  );
  for (final skill in skills) {
    body = remove(remove(body, '\$$skill'), '/$skill');
    body = remove(body, skill.split(RegExp('[-_]')).join(' '));
  }
  for (final plugin in plugins) {
    body = remove(body, '@$plugin');
  }
  final orderedSkills = skills.toList()..sort(),
      orderedPlugins = plugins.toList()..sort();
  return (
    body: body.trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase(),
    skills: orderedSkills.join('|'),
    plugins: orderedPlugins.join('|'),
  );
}

bool desktopHistoryUsersMatch(RemoteJson a, RemoteJson b) {
  final leftText = desktopHistoryUserText(a),
      rightText = desktopHistoryUserText(b);
  if (_normalizedText(leftText) != _normalizedText(rightText)) {
    if (!_smallText(leftText) || !_smallText(rightText)) return false;
    final key = _mentionKey(a);
    if (key.skills.isEmpty && key.plugins.isEmpty || key != _mentionKey(b)) {
      return false;
    }
  }
  final leftFiles = _files(a), rightFiles = _files(b);
  if (leftFiles.isNotEmpty &&
      rightFiles.isNotEmpty &&
      leftFiles != rightFiles) {
    return false;
  }
  final left = _images(a), right = _images(b);
  if (left.isEmpty || right.isEmpty) return true;
  final exact =
      left.length == right.length &&
      List.generate(
        left.length,
        (i) => desktopImageSource(left[i]) == desktopImageSource(right[i]),
      ).every((same) => same);
  if (exact) return true;
  return left.length == right.length &&
      (a['delivery'] == 'pending' ||
          a['turnId'] != null && a['turnId'] == b['turnId']);
}

bool _compatibleTurn(RemoteJson a, RemoteJson b) {
  final x = _text(a['turnId']), y = _text(b['turnId']);
  return x == null ||
      y == null ||
      x == y ||
      desktopProvisionalHistoryTurn(x) ||
      desktopProvisionalHistoryTurn(y);
}

bool _exactIdentity(RemoteJson a, RemoteJson b) {
  final id = desktopHistorySourceId(b);
  if (id == null || desktopHistorySourceId(a) != id || a['type'] != b['type']) {
    return false;
  }
  if (!desktopProvisionalHistoryItem(id)) return true;
  if (a['type'] == 'userMessage') {
    return _compatibleTurn(a, b) && desktopHistoryUsersMatch(a, b);
  }
  if ([
    'user-message-line-',
    'response-item-line-',
    'apply-patch-line-',
  ].any(id.startsWith)) {
    return a['turnId'] != null &&
        a['turnId'] == b['turnId'] &&
        !desktopProvisionalHistoryTurn(a['turnId']) &&
        _text(a['text']) != null &&
        _text(a['text']) == _text(b['text']);
  }
  return true;
}

bool _lineFallback(String? id) =>
    id != null &&
    [
      'user-message-line-',
      'response-item-line-',
      'apply-patch-line-',
    ].any(id.startsWith);

bool _semanticIdentity(
  RemoteJson a,
  RemoteJson b, {
  required bool allowClosedAssistant,
}) {
  if (a['type'] != b['type'] || !_compatibleTurn(a, b)) return false;
  final x = desktopHistorySourceId(a), y = desktopHistorySourceId(b);
  if (!desktopProvisionalHistoryItem(x) && !desktopProvisionalHistoryItem(y)) {
    return false;
  }
  if (a['type'] == 'userMessage') return desktopHistoryUsersMatch(a, b);
  if ((_lineFallback(x) || _lineFallback(y)) &&
      (a['turnId'] == null ||
          a['turnId'] != b['turnId'] ||
          desktopProvisionalHistoryTurn(a['turnId']))) {
    return false;
  }
  if ((a['turnId'] == null || a['turnId'] == b['turnId']) &&
      _text(a['text']) != null &&
      _normalizedText(a['text'] as String) ==
          _normalizedText(b['text'] as String? ?? '')) {
    return true;
  }
  return a['turnId'] != null &&
      a['turnId'] == b['turnId'] &&
      (a['isStreaming'] == true
          ? desktopProvisionalHistoryItem(x)
          : allowClosedAssistant);
}

bool _replaceClosedAssistant(String old, String incoming) {
  if (!_smallText(old) || !_smallText(incoming)) {
    return incoming.trim().isNotEmpty &&
        (old.trim().isEmpty || old == incoming);
  }
  final left = old.trim(), right = incoming.trim();
  if (right.isEmpty) return false;
  if (left.isEmpty || left == right) return true;
  if (left.length > right.length && left.startsWith(right)) return false;
  if (right.startsWith(left)) {
    final tail = right.substring(left.length);
    if (tail.contains('\n\n') || tail.contains(left)) return false;
  }
  return right.indexOf(left) <= 0 && !right.contains('\n\n');
}

String? _preferIdentity(
  String? local,
  String? incoming,
  bool Function(String?) provisional,
) => incoming != null && !provisional(incoming)
    ? incoming
    : local != null && !provisional(local)
    ? local
    : incoming ?? local;

RemoteJson desktopMergeHistoryRow(
  RemoteJson local,
  RemoteJson incoming, {
  required bool protectLive,
  required bool snapshot,
  required Set<String> runningTurns,
}) {
  if (protectLive && snapshot) return local;
  if (snapshot &&
      incoming['type'] == 'agentMessage' &&
      desktopHistorySourceId(local) != desktopHistorySourceId(incoming) &&
      local['isStreaming'] != true &&
      !_replaceClosedAssistant(
        local['text'] as String? ?? '',
        incoming['text'] as String? ?? '',
      )) {
    return local;
  }
  final wire = _preferIdentity(
    desktopHistorySourceId(local),
    desktopHistorySourceId(incoming),
    desktopProvisionalHistoryItem,
  );
  final turn = _preferIdentity(
    _text(local['turnId']),
    _text(incoming['turnId']),
    desktopProvisionalHistoryTurn,
  );
  RemoteJson payload = incoming;
  if (protectLive) {
    payload = local;
  } else if (incoming['type'] == 'userMessage') {
    final images = _images(incoming).isEmpty
        ? _images(local)
        : _images(incoming);
    final textSource =
        _mentions(incoming).isEmpty && _mentions(local).isNotEmpty
        ? local
        : incoming;
    payload = {
      ...incoming,
      'content': [
        ...images,
        ...(textSource['content'] as List? ?? []).where(
          (part) => part is! Map || !desktopIsImage(part),
        ),
      ],
    };
    payload = desktopMergeUserEcho(local, payload);
  }
  final result = <String, dynamic>{
    ...local,
    ...payload,
    'id': local['id'],
    'turnId': ?turn,
    if (!protectLive && incoming['type'] == 'userMessage')
      'delivery': 'confirmed',
  };
  if (incoming['type'] == 'agentMessage') {
    final preservesStream =
        snapshot &&
        local['isStreaming'] == true &&
        runningTurns.contains(local['turnId']) &&
        (local['turnId'] == null ||
            incoming['turnId'] == null ||
            local['turnId'] == incoming['turnId']);
    if (preservesStream || _text(incoming['text']) == null || protectLive) {
      result['text'] = local['text'] ?? incoming['text'];
    }
    if (snapshot) result['isStreaming'] = preservesStream;
  }
  if (wire != null &&
      (wire != result['id'] || result.containsKey('sourceItemId'))) {
    result['sourceItemId'] = wire;
  }
  return result;
}

class _HistoryLookup {
  _HistoryLookup(this.rows) {
    for (var i = 0; i < rows.length; i++) {
      add(i);
    }
  }

  final List<RemoteJson> rows;
  final _sources = <(Object?, String), Set<int>>{};
  final _roles = <Object?, Set<int>>{};
  final _provisional = <Object?, Set<int>>{};
  final _userRaw = <String, Set<int>>{};
  final _userSemantic = <_HistoryMentionKey, Set<int>>{};

  Set<int> userCandidates(RemoteJson row) {
    final text = desktopHistoryUserText(row);
    return {
      ...?_userRaw[_normalizedText(text)],
      if (_smallText(text)) ...?_userSemantic[_mentionKey(row)],
    };
  }

  Iterable<int> matchingUsers(RemoteJson row) =>
      userCandidates(row).where((i) => desktopHistoryUsersMatch(rows[i], row));

  void add(int index) {
    final row = rows[index], type = row['type'];
    if (!desktopOrdinaryHistoryRow(row)) return;
    (_roles[type] ??= {}).add(index);
    final source = desktopHistorySourceId(row);
    if (source != null) (_sources[(type, source)] ??= {}).add(index);
    if (desktopProvisionalHistoryItem(source)) {
      (_provisional[type] ??= {}).add(index);
    }
    if (type == 'userMessage') {
      final text = desktopHistoryUserText(row);
      (_userRaw[_normalizedText(text)] ??= {}).add(index);
      if (_smallText(text)) (_userSemantic[_mentionKey(row)] ??= {}).add(index);
    }
  }

  void remove(int index) {
    final row = rows[index], type = row['type'];
    _roles[type]?.remove(index);
    final source = desktopHistorySourceId(row);
    if (source != null) _sources[(type, source)]?.remove(index);
    _provisional[type]?.remove(index);
    if (type == 'userMessage') {
      final text = desktopHistoryUserText(row);
      _userRaw[_normalizedText(text)]?.remove(index);
      if (_smallText(text)) _userSemantic[_mentionKey(row)]?.remove(index);
    }
  }

  List<int> candidates(
    RemoteJson item,
    Set<String> protectedLiveIds,
    Set<String> coveredIds, {
    required bool allowClosedAssistant,
  }) {
    final source = desktopHistorySourceId(item), type = item['type'];
    final exact = [
      for (final i in _sources[(type, source)] ?? <int>{})
        if (_exactIdentity(rows[i], item)) i,
    ];
    if (exact.isNotEmpty) return exact;
    return [
      for (final i
          in (type == 'userMessage'
                  ? userCandidates(item)
                  : desktopProvisionalHistoryItem(source)
                  ? _roles[type]
                  : _provisional[type]) ??
              <int>{})
        if (!coveredIds.contains(rows[i]['id']) &&
            !protectedLiveIds.contains(rows[i]['id']) &&
            _semanticIdentity(
              rows[i],
              item,
              allowClosedAssistant: allowClosedAssistant,
            ))
          i,
    ];
  }
}

int desktopHistoryMatchIndex(List<RemoteJson> rows, RemoteJson item) {
  final candidates = _HistoryLookup(
    rows,
  ).candidates(item, const {}, const {}, allowClosedAssistant: true);
  return candidates.length == 1 ? candidates.single : -1;
}

RemoteJson desktopHistoryNewRow(RemoteJson incoming, Set<String> usedIds) {
  final row = Map<String, dynamic>.of(incoming),
      wire = desktopHistorySourceId(incoming);
  var id = _text(row['id']);
  if (id == null || usedIds.contains(id)) {
    id = '_djl-local-history:${const Uuid().v4()}';
    if (wire != null) row['sourceItemId'] = wire;
  }
  return {
    ...row,
    'id': id,
    if (row['type'] == 'userMessage')
      'delivery': row['delivery'] ?? 'confirmed',
  };
}

List<RemoteJson> _healCachedAssistants(
  List<RemoteJson> previous,
  Set<String> protectedIds,
) {
  final rows = <RemoteJson>[], ids = <String>{};
  final stable = <String, int>{};
  for (var row in previous) {
    final wire = desktopHistorySourceId(row);
    final duplicate =
        row['type'] == 'agentMessage' && !desktopProvisionalHistoryItem(wire)
        ? stable[wire]
        : null;
    if (duplicate != null) {
      final old = rows[duplicate];
      final oldLive = protectedIds.contains(old['id']),
          newLive = protectedIds.contains(row['id']);
      if (newLive && !oldLive ||
          newLive == oldLive &&
              (row['text'] as String? ?? '').length >
                  (old['text'] as String? ?? '').length) {
        rows[duplicate] = desktopMergeHistoryRow(
          old,
          row,
          protectLive: false,
          snapshot: false,
          runningTurns: {},
        );
        if (newLive) protectedIds.add(old['id'] as String);
      }
      continue;
    }
    if (_text(row['id']) == null || ids.contains(row['id'])) {
      row = desktopHistoryNewRow(row, ids);
    }
    if (row['type'] == 'agentMessage' && !desktopProvisionalHistoryItem(wire)) {
      stable[wire!] = rows.length;
    }
    rows.add(row);
    ids.add(row['id'] as String);
  }
  return rows;
}

List<RemoteJson> _canonicalGroups(
  List<RemoteJson> rows,
  List<String> order,
  Set<String> originalIds,
) {
  if (order.isEmpty) return rows;
  final byId = {for (final row in rows) row['id'] as String: row};
  final positions = {
    for (var i = 0; i < rows.length; i++) rows[i]['id'] as String: i,
  };
  final canonical = order.toSet(), groups = <String, List<RemoteJson>>{};
  final groupForId = <String, String>{}, coveredTurns = <String>{};
  for (final id in order) {
    final row = byId[id]!, turn = _text(row['turnId']);
    final key = turn == null ? 'item:$id' : 'turn:$turn';
    (groups[key] ??= []).add(row);
    groupForId[id] = key;
    if (turn != null) coveredTurns.add(turn);
  }
  String? group(RemoteJson row) =>
      groupForId[row['id']] ??
      (coveredTurns.contains(row['turnId']) ? 'turn:${row['turnId']}' : null);
  final all = <String, List<RemoteJson>>{}, uncovered = <RemoteJson>[];
  final before = <int>[];
  for (final row in rows) {
    before.add(uncovered.length);
    final key = group(row);
    if (key == null) {
      uncovered.add(row);
    } else {
      (all[key] ??= []).add(row);
    }
  }
  before.add(uncovered.length);
  final rebuilt = <String, List<RemoteJson>>{}, anchored = <String, int>{};
  for (final entry in groups.entries) {
    final ranks = {
      for (var i = 0; i < entry.value.length; i++) entry.value[i]['id']: i,
    };
    final anchors = [
      for (final row in entry.value)
        if (originalIds.contains(row['id']))
          (position: positions[row['id']]!, rank: ranks[row['id']]!),
    ];
    anchors.sort((a, b) => a.position.compareTo(b.position));
    final buckets = List.generate(
      entry.value.length + 1,
      (_) => <RemoteJson>[],
    );
    var cursor = 0;
    final local = all[entry.key] ?? entry.value;
    for (final row in local.where((r) => !canonical.contains(r['id']))) {
      final position = positions[row['id']]!;
      while (cursor < anchors.length && anchors[cursor].position < position) {
        cursor++;
      }
      final previous = cursor == 0 ? null : anchors[cursor - 1];
      final next = cursor == anchors.length ? null : anchors[cursor];
      int slot;
      if (previous != null && next != null && previous.rank < next.rank) {
        slot = next.rank;
      } else if (previous != null) {
        slot = previous.rank + 1;
        if (slot > entry.value.length) slot = entry.value.length;
      } else {
        slot =
            next?.rank ?? (entry.value.first['type'] == 'userMessage' ? 1 : 0);
      }
      buckets[slot].add(row);
    }
    rebuilt[entry.key] = [
      for (var i = 0; i < entry.value.length; i++) ...[
        ...buckets[i],
        entry.value[i],
      ],
      ...buckets.last,
    ];
    final originals = local.where((r) => originalIds.contains(r['id']));
    if (originals.isNotEmpty) {
      anchored[entry.key] = before[positions[originals.first['id']]!];
    }
  }
  final keys = groups.keys.toList();
  final previousAnchors = List<int?>.filled(keys.length, null),
      nextAnchors = List<int?>.filled(keys.length, null);
  int? previous;
  for (var i = 0; i < keys.length; i++) {
    previousAnchors[i] = previous;
    previous = anchored[keys[i]] ?? previous;
  }
  previous = null;
  for (var i = keys.length - 1; i >= 0; i--) {
    nextAnchors[i] = previous;
    previous = anchored[keys[i]] ?? previous;
  }
  final pending = uncovered.indexWhere(
    (r) =>
        r['type'] == 'userMessage' &&
        {'pending', 'unknown', 'failed'}.contains(r['delivery']),
  );
  final segments = <int, List<String>>{};
  for (var i = 0; i < keys.length; i++) {
    final key = keys[i],
        natural = before[positions[(all[key] ?? groups[key])!.first['id']]!];
    final neighboursAgree =
        previousAnchors[i] != null && previousAnchors[i] == nextAnchors[i];
    final segment =
        anchored[key] ??
        (neighboursAgree
            ? previousAnchors[i]!
            : pending < 0 || natural < pending
            ? natural
            : pending);
    (segments[segment] ??= []).add(key);
  }
  return [
    for (var i = 0; i <= uncovered.length; i++) ...[
      for (final key in segments[i] ?? <String>[]) ...rebuilt[key]!,
      if (i < uncovered.length) uncovered[i],
    ],
  ];
}

Map<String, String> desktopHistoryTurnMappings(
  List<RemoteJson> rows,
  List<RemoteJson> incoming, {
  required Set<String> protectedIds,
}) {
  final protectedTurns = {
    for (final row in rows)
      if (protectedIds.contains(row['id'])) row['turnId'],
  };
  final users = rows.where((row) => row['type'] == 'userMessage').toList();
  final canonicalUsers = incoming
      .where((row) => row['type'] == 'userMessage')
      .toList();
  final mappings = <String, String>{};
  final userLookup = _HistoryLookup(users),
      canonicalLookup = _HistoryLookup(canonicalUsers);
  final turnCounts = <Object?, int>{};
  for (final row in users) {
    turnCounts.update(row['turnId'], (n) => n + 1, ifAbsent: () => 1);
  }
  for (final opener in users) {
    final turn = _text(opener['turnId']);
    if (turn == null ||
        protectedTurns.contains(turn) ||
        !desktopProvisionalHistoryTurn(turn) ||
        turnCounts[turn] != 1 ||
        userLookup.matchingUsers(opener).take(2).length != 1) {
      continue;
    }
    final matches = canonicalLookup
        .matchingUsers(opener)
        .map((i) => canonicalUsers[i])
        .where(
          (row) =>
              _text(row['turnId']) != null &&
              !desktopProvisionalHistoryTurn(row['turnId']) &&
              (desktopHistorySourceId(opener) == desktopHistorySourceId(row) ||
                  desktopProvisionalHistoryItem(
                    desktopHistorySourceId(opener),
                  ) ||
                  desktopProvisionalHistoryItem(desktopHistorySourceId(row))),
        )
        .take(2)
        .toList();
    if (matches.length == 1) {
      mappings[turn] = matches.single['turnId'] as String;
    }
  }
  return mappings;
}

/// An idle canonical read or explicit source handoff can repair an anchored tail.
Set<String> desktopHistoryReplacementRemovals(
  List<RemoteJson> previous,
  List<RemoteJson> incoming, {
  required Map<String, String> turnMappings,
  required Set<String> protectedIds,
}) {
  if (previous.isEmpty || incoming.isEmpty) return {};
  final sources = <(Object?, String), List<RemoteJson>>{};
  final turns = <(Object?, Object?), List<RemoteJson>>{};
  for (final row in incoming) {
    final source = desktopHistorySourceId(row);
    if (source != null) (sources[(row['type'], source)] ??= []).add(row);
    (turns[(row['type'], row['turnId'])] ??= []).add(row);
  }
  final anchoredTurns = <Object?>{}, anchors = <int>[];
  for (var i = 0; i < previous.length; i++) {
    final row = previous[i], source = desktopHistorySourceId(previous[i]);
    final mapped = turnMappings[row['turnId']];
    final exactStable =
        source != null &&
        !desktopProvisionalHistoryItem(source) &&
        sources.containsKey((row['type'], source));
    final promptAnchor =
        row['type'] == 'userMessage' &&
        (mapped != null ||
            row['turnId'] != null &&
                !desktopProvisionalHistoryTurn(row['turnId'])) &&
        (turns[('userMessage', mapped ?? row['turnId'])] ?? []).any(
          (r) => desktopHistoryUsersMatch(row, r),
        );
    if (exactStable || promptAnchor) {
      anchors.add(i);
      if (row['turnId'] != null) anchoredTurns.add(row['turnId']);
    }
  }
  if (anchors.isEmpty) return {};
  var start = anchors.first;
  for (var i = 0; i < start; i++) {
    if (anchoredTurns.contains(previous[i]['turnId'])) {
      start = i;
      break;
    }
  }
  final removed = <String>{};
  for (final row in previous.skip(start)) {
    final source = desktopHistorySourceId(row), id = row['id'];
    if (id is! String ||
        protectedIds.contains(id) ||
        !desktopProvisionalHistoryItem(source) ||
        source == null && !desktopProvisionalHistoryTurn(row['turnId']) ||
        row['type'] == 'userMessage' && row['delivery'] != 'confirmed' ||
        row['type'] == 'automaticApprovalReview') {
      continue;
    }
    final turn = turnMappings[row['turnId']] ?? row['turnId'];
    final rebound = {...row, 'turnId': turn};
    final exact = sources[(row['type'], source)] ?? [];
    final sameTurn = turns[(row['type'], turn)] ?? [];
    final counterpart =
        exact.any(
          (r) => _exactIdentity(rebound, r) && _compatibleTurn(rebound, r),
        ) ||
        sameTurn.any(
          (r) =>
              desktopOrdinaryHistoryRow(row) &&
              _semanticIdentity(rebound, r, allowClosedAssistant: false),
        );
    if (!counterpart) removed.add(id);
  }
  return removed;
}

/// Reconcile one owned transcript; live rows newer than its read are not snapshots.
({List<RemoteJson> rows, Map<String, String> turns}) desktopReconcileHistory(
  List<RemoteJson> previous,
  List<RemoteJson> incoming, {
  required Set<String> protectedLiveIds,
  required Set<String> runningTurns,
  required bool canonicalSnapshot,
}) {
  protectedLiveIds = {...protectedLiveIds};
  final rows = _healCachedAssistants(previous, protectedLiveIds);
  final originalIds = rows.map((r) => r['id'] as String).toSet();
  final mappings = desktopHistoryTurnMappings(
    rows,
    incoming,
    protectedIds: protectedLiveIds,
  );
  for (final row in rows) {
    if (mappings[row['turnId']] case final canonical?) {
      row['turnId'] = canonical;
    }
  }
  final canonicalOrder = <String>{};
  final coveredIds = <String>{};
  final usedIds = rows.map((row) => row['id']).whereType<String>().toSet();
  final assistantCounts = <Object?, int>{};
  final lookup = _HistoryLookup(rows);
  for (final row in incoming.where((r) => r['type'] == 'agentMessage')) {
    assistantCounts.update(row['turnId'], (n) => n + 1, ifAbsent: () => 1);
  }
  for (final raw in incoming) {
    final item = Map<String, dynamic>.of(raw);
    var candidates = <int>[];
    if (desktopOrdinaryHistoryRow(item)) {
      candidates = lookup.candidates(
        item,
        protectedLiveIds,
        coveredIds,
        allowClosedAssistant:
            desktopHistorySourceId(item) == null ||
            assistantCounts[item['turnId']] == 1,
      );
    }
    if (candidates.length != 1 &&
        item['type'] == 'agentMessage' &&
        desktopHistorySourceId(item) == null &&
        runningTurns.contains(item['turnId']) &&
        rows.any(
          (r) =>
              r['type'] == 'agentMessage' &&
              r['turnId'] == item['turnId'] &&
              r['isStreaming'] == true &&
              !desktopProvisionalHistoryItem(desktopHistorySourceId(r)),
        )) {
      continue;
    }
    RemoteJson chosen;
    if (candidates.length == 1) {
      final index = candidates.single;
      chosen = desktopMergeHistoryRow(
        rows[index],
        item,
        protectLive: protectedLiveIds.contains(rows[index]['id']),
        snapshot: canonicalSnapshot,
        runningTurns: runningTurns,
      );
      lookup.remove(index);
      rows[index] = chosen;
      lookup.add(index);
    } else {
      if (candidates.length > 1 &&
          item['type'] == 'userMessage' &&
          (desktopProvisionalHistoryTurn(item['turnId']) ||
              desktopProvisionalHistoryItem(desktopHistorySourceId(item)))) {
        continue;
      }
      chosen = desktopHistoryNewRow(item, usedIds);
      usedIds.add(chosen['id'] as String);
      rows.add(chosen);
      lookup.add(rows.length - 1);
    }
    final id = chosen['id'] as String;
    canonicalOrder.remove(id);
    canonicalOrder.add(id);
    coveredIds.add(id);
  }
  return (
    rows: canonicalSnapshot
        ? _canonicalGroups(rows, canonicalOrder.toList(), originalIds)
        : rows,
    turns: mappings,
  );
}
