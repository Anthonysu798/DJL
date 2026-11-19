import 'dart:convert';
import 'package:flutter/widgets.dart' show StringCharacters;

const reasoningMetadataKey = '_djlReasoningV1';
typedef ReasoningIdentity = ({String thread, String turn, String item});
Map<String, dynamic>? _object(Object? value) =>
    value is Map && value.keys.every((key) => key is String)
    ? Map<String, dynamic>.from(value)
    : null;
String? _id(Object? value) =>
    value is String && value.trim().isNotEmpty ? value : null;
List<Map<String, dynamic>> _envelopes(Map<String, dynamic> params) => [
  params,
  ?_object(params['msg']),
  ?_object(params['event']),
];
String? _unique(Iterable<Object?> values) {
  final ids = values.where((v) => v != null).toList();
  if (ids.any((v) => _id(v) == null)) return null;
  final distinct = ids.cast<String>().toSet();
  return distinct.length == 1 ? distinct.single : null;
}

({String thread, String turn})? reasoningTurn(Map<String, dynamic> params) {
  final maps = _envelopes(params);
  final thread = _unique([
    for (final map in maps) ...[
      map['threadId'],
      map['thread_id'],
      _object(map['item'])?['threadId'],
      _object(map['item'])?['thread_id'],
      _object(map['turn'])?['threadId'],
      _object(map['turn'])?['thread_id'],
    ],
  ]);
  final turn = _unique([
    for (final map in maps) ...[
      map['turnId'],
      map['turn_id'],
      if (map['turn'] is String) map['turn'],
      _object(map['turn'])?['id'],
      _object(map['turn'])?['turnId'],
      _object(map['turn'])?['turn_id'],
      _object(map['item'])?['turnId'],
      _object(map['item'])?['turn_id'],
    ],
  ]);
  return thread == null || turn == null ? null : (thread: thread, turn: turn);
}

ReasoningIdentity? reasoningIdentity(Map<String, dynamic> params) {
  final turn = reasoningTurn(params);
  final item = _unique([
    for (final map in _envelopes(params)) ...[
      map['itemId'],
      map['item_id'],
      _object(map['item'])?['id'],
    ],
  ]);
  return turn == null || item == null
      ? null
      : (thread: turn.thread, turn: turn.turn, item: item);
}

Map<String, dynamic>? reasoningItem(Map<String, dynamic> params) {
  for (final map in _envelopes(params)) {
    final item = _object(map['item']);
    if (item != null) return item;
  }
  return null;
}

bool isReasoningNotification(String method, Map<String, dynamic> params) =>
    const {
      'item/reasoning/summaryTextDelta',
      'item/reasoning/summaryPartAdded',
      'item/reasoning/textDelta',
    }.contains(method) ||
    const {'item/started', 'item/completed'}.contains(method) &&
        reasoningItem(params)?['type'] == 'reasoning';
String? reasoningDelta(Map<String, dynamic> params) {
  final msg = _object(params['msg']) ?? _object(params['event']);
  for (final value in [
    for (final key in [
      'delta',
      'textDelta',
      'text_delta',
      'text',
      'summary',
      'part',
    ])
      params[key],
    for (final key in ['delta', 'text', 'summary', 'part']) msg?[key],
    _object(params['event'])?['delta'],
    _object(params['event'])?['text'],
  ]) {
    if (value is String && value.isNotEmpty) return value;
  }
  return null;
}

List<String> _parts(Object? value, {required bool history}) {
  final values = value is List ? value : [value];
  return [
    for (final part in values)
      if ((part is String ? part : _object(part)?['text'])
          case final String text)
        if (_normalize(text, history).isNotEmpty) _normalize(text, history),
  ];
}

String _normalize(String text, bool history) =>
    history && utf8.encode(text).length > 64000 ? text : text.trim();
bool _meaningful(String text, bool history) =>
    text.isNotEmpty &&
    (history && utf8.encode(text).length > 512 || text.trim().isNotEmpty);
String decodeReasoningText(Map<String, dynamic> item, {bool history = false}) =>
    [
      _parts(item['summary'], history: history).join('\n'),
      _parts(item['content'], history: history).join('\n\n'),
    ].where((part) => _meaningful(part, history)).join('\n\n');

// Same replay heuristic as Swift. Envelope sequence dedup remains the primary
// protection; indistinguishable repeated legitimate chunks cannot be inferred.
String mergeReasoningDelta(String existing, String incoming) {
  if (existing.isEmpty) return incoming;
  if (existing == incoming || existing.endsWith(incoming)) return existing;
  if (incoming.startsWith(existing)) return incoming;
  if (existing.startsWith(incoming)) return existing;
  final left = existing.characters.toList(),
      right = incoming.characters.toList();
  for (
    var n = left.length < right.length ? left.length : right.length;
    n >= 16;
    n--
  ) {
    if (left.skip(left.length - n).join() == right.take(n).join()) {
      return existing + right.skip(n).join();
    }
  }
  return existing + incoming;
}

class DesktopReasoning {
  DesktopReasoning(this.mac, this.pin, this.identity);
  final String mac, pin;
  final ReasoningIdentity identity;
  String get thread => identity.thread;
  String get turn => identity.turn;
  String get id =>
      'reasoning:${jsonEncode([mac, pin, thread, turn, identity.item])}';
  final summary = <int, String>{};
  String content = '';
  Map<String, dynamic> raw = {};
  bool terminal = false, turnTerminal = false, streaming = false;
  int revision = 0;
  String get text {
    final indices = summary.keys.toList()..sort();
    return [
      indices.map((i) => summary[i]!).join('\n'),
      content,
    ].where((text) => _meaningful(text, true)).join('\n\n');
  }

  void _snapshot(Map<String, dynamic> item, {required bool history}) {
    raw = {...raw, ...item};
    if (decodeReasoningText(item, history: history).isEmpty) return;
    summary.clear();
    final parts = _parts(item['summary'], history: history);
    for (var i = 0; i < parts.length; i++) {
      summary[i] = parts[i];
    }
    content = _parts(item['content'], history: history).join('\n\n');
  }

  Map<String, dynamic> toRow() => {
    ...raw,
    'id': id,
    'type': 'reasoning',
    'threadId': thread,
    'turnId': turn,
    'text': text,
    reasoningMetadataKey: {
      'version': 1,
      'mac': mac,
      'pin': pin,
      'thread': thread,
      'turn': turn,
      'item': identity.item,
      'terminal': terminal,
      'turnTerminal': turnTerminal,
      'summaryParts': {
        for (final entry in summary.entries) '${entry.key}': entry.value,
      },
      'contentText': content,
    },
  };
  static DesktopReasoning? fromRow(Map<String, dynamic> row) {
    final meta = _object(row[reasoningMetadataKey]);
    if (meta == null || meta['version'] != 1) return null;
    for (final key in ['mac', 'pin', 'thread', 'turn', 'item']) {
      if (_id(meta[key]) == null) return null;
    }
    final result =
        DesktopReasoning(meta['mac'] as String, meta['pin'] as String, (
          thread: meta['thread'] as String,
          turn: meta['turn'] as String,
          item: meta['item'] as String,
        ));
    if (row['id'] != result.id ||
        row['threadId'] != result.thread ||
        row['turnId'] != result.turn) {
      return null;
    }
    result.raw = {...row}
      ..remove(reasoningMetadataKey)
      ..remove('text');
    result.raw['id'] = result.identity.item;
    final parts = _object(meta['summaryParts']);
    if (parts == null || meta['contentText'] is! String) return null;
    for (final entry in parts.entries) {
      final index = int.tryParse(entry.key);
      if (index == null || index < 0 || entry.value is! String) return null;
      result.summary[index] = entry.value as String;
    }
    result.content = meta['contentText'] as String;
    result.turnTerminal = meta['turnTerminal'] == true;
    result.terminal = meta['terminal'] == true || result.turnTerminal;
    return result;
  }
}

class ReasoningReducer {
  ReasoningReducer(this.mac, this.pin);
  final String mac, pin;
  final items = <String, DesktopReasoning>{};
  final _running = <(String, String)>{}, _terminal = <(String, String)>{};
  final _turnRevisions = <(String, String), int>{};
  final _guessedClosures =
      <(String, String), Map<String, ({bool terminal, bool streaming})>>{};
  int revision = 0;
  void restore(Map<String, dynamic> row) {
    final item = DesktopReasoning.fromRow(row);
    if (item == null ||
        item.mac != mac ||
        item.pin != pin ||
        items.containsKey(item.id)) {
      return;
    }
    items[item.id] = item;
    if (item.turnTerminal) _terminal.add((item.thread, item.turn));
  }

  void resetProjectedTerminals(String thread) {
    final removed = _terminal
        .where((key) => key.$1 == thread && key.$2.startsWith('ipc-turn-'))
        .toList();
    for (final key in removed) {
      _terminal.remove(key);
      _turnRevisions.remove(key);
    }
  }

  Map<String, Map<String, dynamic>> rebindHistoryTurn(
    String thread,
    String oldTurn,
    String turn, {
    Map<String, String> itemMappings = const {},
    Set<String>? rowIds,
  }) {
    final rows = <String, Map<String, dynamic>>{};
    final oldKey = (thread, oldTurn), key = (thread, turn);
    if (_terminal.remove(oldKey)) _terminal.add(key);
    if (_running.remove(oldKey) && !_terminal.contains(key)) _running.add(key);
    if (_terminal.contains(key)) _running.remove(key);
    final watermark = _turnRevisions.remove(oldKey);
    if (watermark != null && watermark > (_turnRevisions[key] ?? -1)) {
      _turnRevisions[key] = watermark;
    }
    for (final old
        in items.values
            .where(
              (i) =>
                  i.thread == thread &&
                  i.turn == oldTurn &&
                  (rowIds == null || rowIds.contains(i.id)),
            )
            .toList()) {
      items.remove(old.id);
      final rebound =
          DesktopReasoning(mac, pin, (
              thread: thread,
              turn: turn,
              item: itemMappings[old.id] ?? old.identity.item,
            ))
            ..summary.addAll(old.summary)
            ..content = old.content
            ..raw = {...old.raw}
            ..terminal = old.terminal
            ..turnTerminal = old.turnTerminal
            ..streaming = old.streaming
            ..revision = old.revision;
      final existing = items[rebound.id];
      final chosen = existing == null || old.revision > existing.revision
          ? rebound
          : existing;
      if (_terminal.contains(key)) {
        chosen.terminal = true;
        chosen.turnTerminal = true;
        chosen.streaming = false;
      }
      items[chosen.id] = chosen;
      rows[old.id] = chosen.toRow();
    }
    final closure = _guessedClosures.remove(oldKey);
    if (closure != null) {
      final target = _guessedClosures.putIfAbsent(key, () => {});
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

  void observeTurn(
    String method,
    Map<String, dynamic> params, {
    bool replay = false,
    bool backgroundGuess = false,
  }) {
    final identity = reasoningTurn(params);
    if (identity == null) return;
    final key = (identity.thread, identity.turn);
    if (method == 'turn/completed') {
      if (backgroundGuess) {
        _guessedClosures.putIfAbsent(
          key,
          () => {
            for (final item in items.values)
              if ((item.thread, item.turn) == key)
                item.id: (terminal: item.terminal, streaming: item.streaming),
          },
        );
      }
      _terminal.add(key);
      _running.remove(key);
      for (final item in items.values.where((i) => (i.thread, i.turn) == key)) {
        item.terminal = true;
        item.turnTerminal = true;
        item.streaming = false;
        item.revision = ++revision;
      }
    } else if (method == 'turn/started' &&
        !replay &&
        !_terminal.contains(key)) {
      _guessedClosures.remove(key);
      _running.add(key);
    } else {
      return;
    }
    _turnRevisions[key] = ++revision;
  }

  DesktopReasoning? ingest(
    String method,
    Map<String, dynamic> params, {
    bool replay = false,
  }) {
    final identity = reasoningIdentity(params);
    if (identity == null) return null;
    final candidate = DesktopReasoning(mac, pin, identity);
    final key = (identity.thread, identity.turn);
    if (method == 'item/completed') _guessedClosures[key]?.remove(candidate.id);
    var item = items[candidate.id];
    final running = _running.contains(key) && !_terminal.contains(key);
    final snapshot = reasoningItem(params);
    if (method == 'item/started' || method == 'item/completed') {
      if (snapshot?['type'] != 'reasoning') return null;
      if (method == 'item/started' &&
          (item?.terminal == true || !running || replay)) {
        return item;
      }
      item ??= candidate;
      item._snapshot(snapshot!, history: false);
      item.terminal |= method == 'item/completed';
    } else {
      // Late delivery may only amend an exact existing identity.
      if (item == null && (!running || replay)) return null;
      final delta = reasoningDelta(params);
      if (method != 'item/reasoning/summaryPartAdded' &&
          (delta == null || delta.trim().isEmpty)) {
        return null;
      }
      final maps = _envelopes(params);
      final indexValues = [
        for (final map in maps) ...[map['summaryIndex'], map['summary_index']],
      ].where((v) => v != null).toList();
      if (indexValues.any((v) => v is! int || v < 0) ||
          indexValues.toSet().length > 1) {
        return null;
      }
      final index = indexValues.isEmpty ? 0 : indexValues.first as int;
      item ??= candidate;
      if (method == 'item/reasoning/textDelta') {
        item.content = mergeReasoningDelta(item.content, delta!);
      } else if (method == 'item/reasoning/summaryTextDelta' ||
          method == 'item/reasoning/summaryPartAdded') {
        item.summary.putIfAbsent(index, () => '');
        if (delta != null && delta.trim().isNotEmpty) {
          item.summary[index] = mergeReasoningDelta(
            item.summary[index]!,
            delta,
          );
        }
      } else {
        return null;
      }
    }
    item.turnTerminal |= _terminal.contains(key);
    item.terminal |= item.turnTerminal;
    item.streaming = running && !item.terminal;
    item.revision = ++revision;
    if (!replay && running && !item.terminal) {
      _turnRevisions[key] = item.revision;
    }
    items[item.id] = item;
    return item;
  }

  void reviveBackgroundGuess(String thread, String turn) {
    final key = (thread, turn),
        previous = _guessedClosures.remove((thread, turn)) ?? {};
    _terminal.remove(key);
    _running.add(key);
    for (final item in items.values.where(
      (item) => (item.thread, item.turn) == key,
    )) {
      item.turnTerminal = false;
      final old = previous[item.id];
      if (old != null) item.terminal = old.terminal;
      item.streaming = old?.streaming == true && !item.terminal;
      item.revision = ++revision;
    }
    _turnRevisions[key] = ++revision;
  }

  void historyTurn(
    String thread,
    String turn,
    Object? status, {
    required int watermark,
    Iterable<Map<String, dynamic>> canonicalItems = const [],
  }) {
    final key = (thread, turn);
    var acceptedTerminal = false;
    if ((_turnRevisions[key] ?? 0) <= watermark) {
      if (const {
        'completed',
        'failed',
        'stopped',
        'interrupted',
        'cancelled',
      }.contains(status)) {
        _terminal.add(key);
        _running.remove(key);
        _turnRevisions[key] = ++revision;
        acceptedTerminal = true;
      } else if (const {'inProgress', 'running'}.contains(status) &&
          !_terminal.contains(key)) {
        _running.add(key);
        _turnRevisions[key] = ++revision;
      }
    }
    if (_terminal.contains(key)) {
      final canonicalIds = {
        for (final raw in canonicalItems)
          if (reasoningIdentity({
                'threadId': thread,
                'turnId': turn,
                'item': raw,
              })
              case final identity?)
            identity.item,
      };
      for (final item in items.values.where(
        (item) => (item.thread, item.turn) == key,
      )) {
        item.turnTerminal = true;
        item.terminal = true;
        item.streaming = false;
        // Protect retained rows from older replies, but let this response's
        // canonical items apply their snapshots under the original watermark.
        if (acceptedTerminal && !canonicalIds.contains(item.identity.item)) {
          item.revision = ++revision;
        }
      }
    }
  }

  DesktopReasoning? history(
    Map<String, dynamic> raw, {
    required String thread,
    required String turn,
    required Object? status,
    required int watermark,
  }) {
    final identity = reasoningIdentity({
      'threadId': thread,
      'turnId': turn,
      'item': raw,
    });
    if (identity == null) return null;
    final candidate = DesktopReasoning(mac, pin, identity);
    final key = (thread, turn);
    final item = items[candidate.id] ?? candidate;
    if (item.revision > watermark) return item;
    historyTurn(
      thread,
      turn,
      status,
      watermark: watermark,
      canonicalItems: [raw],
    );
    item._snapshot(raw, history: true);
    item.turnTerminal |= _terminal.contains(key);
    item.terminal |= item.turnTerminal || raw['status'] == 'completed';
    item.streaming = _running.contains(key) && !item.terminal;
    item.revision = ++revision;
    items[item.id] = item;
    return item;
  }
}
