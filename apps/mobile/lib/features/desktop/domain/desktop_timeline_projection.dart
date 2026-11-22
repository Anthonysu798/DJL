import 'dart:convert';
import '../../activity/domain/desktop_activity.dart';
import '../../pairing/data/pairing_repository.dart';
import '../../reasoning/domain/desktop_reasoning.dart';
import '../../reasoning/domain/thinking_disclosure.dart';
import '../../guardian/domain/guardian_review.dart';
import 'desktop_response_footer.dart';
import 'desktop_file_presentation.dart';

String? _identifier(Object? value) =>
    value is String && value.trim().isNotEmpty ? value.trim() : null;
String? _phase(RemoteJson row) => _identifier(
  row['phase'] ?? row['assistantPhase'] ?? row['assistant_phase'],
);
bool _streaming(RemoteJson row) =>
    row['isStreaming'] == true ||
    row['is_streaming'] == true ||
    row['streaming'] == true;
bool _meaningful(String text) =>
    text.isNotEmpty &&
    (text.length > 512 ||
        utf8.encode(text).length > 512 ||
        text.trim().isNotEmpty);
bool _artifactOnly(RemoteJson row) {
  if (row['type'] != 'agentMessage' || _streaming(row)) return false;
  final text = desktopAssistantCopyText(row);
  if (text.length > 64000 || utf8.encode(text).length > 64000) return false;
  final trimmed = text.trim();
  if (trimmed.startsWith('::code-comment[')) return true;
  final images = RegExp(r'!\[[^\]]*\]\([^)]*\)');
  return images.hasMatch(trimmed) &&
      trimmed.replaceAll(images, '').trim().isEmpty;
}

bool desktopTimelineEmptyReasoning(RemoteJson row) {
  final reasoning = DesktopReasoning.fromRow(row);
  if (reasoning == null) return false;
  final text = reasoning.text;
  return text.length <= 512 &&
      utf8.encode(text).length <= 512 &&
      ThinkingDisclosureParser.normalized(text).isEmpty;
}

enum DesktopTimelineKind { message, toolBurst, commands, previous }

class DesktopTimelineItem {
  DesktopTimelineItem._(
    this.kind,
    List<int> indices, {
    List<int> commands = const [],
    this.failedCommandCount = 0,
    this.stoppedCommandCount = 0,
    this.finalIndex,
  }) : indices = List.unmodifiable(indices),
       commandIndices = List.unmodifiable(commands);
  final DesktopTimelineKind kind;
  final List<int> indices, commandIndices;
  final int failedCommandCount, stoppedCommandCount;
  final int? finalIndex;
  int get accessoryHost => finalIndex ?? indices.last;
  List<int> get collapsedIndices {
    if (kind == DesktopTimelineKind.toolBurst) return [indices.last];
    if (kind == DesktopTimelineKind.previous) return const [];
    if (kind != DesktopTimelineKind.commands) return indices;
    final commands = commandIndices.toSet();
    return indices.where((index) => !commands.contains(index)).toList();
  }
}

class DesktopTimelineProjection {
  DesktopTimelineProjection._(
    this.items,
    this._rawToRender,
    this.hiddenRows,
    this.activityOverrides,
    this._focusAliases,
  );
  final List<DesktopTimelineItem> items;
  final Map<int, int> _rawToRender;
  final Set<int> hiddenRows;
  final Map<int, DesktopActivity> activityOverrides;
  final Map<int, int> _focusAliases;
  int? renderIndexFor(int? rawIndex) => _rawToRender[rawIndex];
  int? focusRawFor(int? rawIndex) =>
      rawIndex == null ? null : _focusAliases[rawIndex] ?? rawIndex;
}

DesktopTimelineProjection projectDesktopTimeline(
  List<RemoteJson> rows, {
  Map<String, DesktopActivity> activities = const {},
  Set<int> hiddenRows = const {},
  Set<String> completedTurns = const {},
  String? activeTurn,
  bool isThreadRunning = false,
}) {
  final hidden = {
    ...hiddenRows,
    for (var i = 0; i < rows.length; i++)
      if (!hiddenRows.contains(i) && desktopTimelineEmptyReasoning(rows[i])) i,
  };
  final resolved = [
    for (final row in rows)
      switch (DesktopActivity.fromRow(row)) {
        final DesktopActivity activity => activities[activity.id] ?? activity,
        _ => null,
      },
  ];
  String? turn(int index) => _identifier(
    rows[index]['turnId'] ?? rows[index]['turn_id'] ?? resolved[index]?.turn,
  );
  bool compatible(int previous, int incoming) {
    final a = turn(previous), b = turn(incoming);
    return a == null || b == null || a == b;
  }

  final fileChanges = projectDesktopFileChanges(
    rows,
    resolved,
    activeTurn: activeTurn,
    isThreadRunning: isThreadRunning,
  );
  hidden.addAll(fileChanges.hidden);

  final completed = completedTurns.map(_identifier).whereType<String>().toSet();
  final protected =
      _identifier(activeTurn) ??
      (isThreadRunning
          ? [
              for (var i = rows.length - 1; i >= 0; i--) turn(i),
            ].whereType<String>().firstOrNull
          : null);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]['type'] == 'agentMessage' &&
        !_streaming(rows[i]) &&
        _phase(rows[i]) == 'final_answer' &&
        turn(i) != null &&
        turn(i) != protected) {
      completed.add(turn(i)!);
    }
  }
  final fallback = <String, int>{},
      preferred = <String, int>{},
      phased = <String, int>{},
      explicit = <String>{};
  final byTurn = <String, List<int>>{};
  for (var i = 0; i < rows.length; i++) {
    final id = turn(i);
    if (id == null) continue;
    byTurn.putIfAbsent(id, () => []).add(i);
    final row = rows[i];
    if (hidden.contains(i) ||
        row['type'] != 'agentMessage' ||
        _streaming(row) ||
        !completed.contains(id) ||
        !_meaningful(desktopAssistantCopyText(row))) {
      continue;
    }
    fallback[id] = i;
    if (_phase(row) != null) explicit.add(id);
    if (_phase(row) == 'final_answer') phased[id] = i;
    if (!_artifactOnly(row)) preferred[id] = i;
  }
  final finals = <String, int>{...phased};
  for (final entry in preferred.entries) {
    if (!explicit.contains(entry.key)) {
      finals.putIfAbsent(entry.key, () => entry.value);
    }
  }
  for (final entry in fallback.entries) {
    if (!explicit.contains(entry.key)) {
      finals.putIfAbsent(entry.key, () => entry.value);
    }
  }
  bool priority(int index) {
    final row = rows[index], type = normalizedActivityType(row['type']);
    return resolved[index]?.kind == 'fileChange' ||
        isGuardianRow(row) ||
        {
          'filechange',
          'subagentaction',
          'collabagenttoolcall',
          'userinputprompt',
          'requestuserinput',
          'userinput',
          'plan',
        }.contains(type) ||
        _artifactOnly(row) ||
        row['type'] == 'agentMessage' &&
            (row['content'] is List ? row['content'] as List : const [])
                .whereType<Map>()
                .any(
                  (part) => {
                    'image',
                    'input_image',
                    'image_url',
                  }.contains(part['type']),
                );
  }

  final previous = <int, List<DesktopTimelineItem>>{};
  final previousHidden = <int>{};
  for (final entry in finals.entries) {
    final finalIndex = entry.value;
    final indices = byTurn[entry.key]!;
    final user = indices
        .where((i) => i < finalIndex && rows[i]['type'] == 'userMessage')
        .lastOrNull;
    final lower = user == null ? 0 : user + 1;
    final members = indices
        .where(
          (i) =>
              i >= lower &&
              i != finalIndex &&
              rows[i]['type'] != 'userMessage' &&
              !hidden.contains(i) &&
              !priority(i),
        )
        .toList();
    if (members.isEmpty) continue;
    previous
        // Desktop history can keep its user prompt on a synthetic turn. Keep
        // that turn's disclosure at its first member, after unrelated history.
        .putIfAbsent(user == null ? members.first : lower, () => [])
        .add(
          DesktopTimelineItem._(
            DesktopTimelineKind.previous,
            members,
            finalIndex: finalIndex,
          ),
        );
    previousHidden.addAll(members);
  }
  hidden.addAll(previousHidden);

  final items = <DesktopTimelineItem>[];
  final tools = <int>[],
      commands = <int>[],
      ordered = <int>[],
      trailing = <int>[];
  void message(int index) =>
      items.add(DesktopTimelineItem._(DesktopTimelineKind.message, [index]));
  void flushTools() {
    if (tools.length > 4) {
      items.add(DesktopTimelineItem._(DesktopTimelineKind.toolBurst, tools));
    } else {
      for (final index in tools) {
        message(index);
      }
    }
    tools.clear();
  }

  void flushCommands() {
    if (commands.isNotEmpty) {
      items.add(
        DesktopTimelineItem._(
          DesktopTimelineKind.commands,
          ordered,
          commands: commands,
          failedCommandCount: commands
              .where((index) => resolved[index]?.status == 'failed')
              .length,
          stoppedCommandCount: commands
              .where((index) => resolved[index]?.status == 'stopped')
              .length,
        ),
      );
    }
    for (final index in trailing) {
      message(index);
    }
    commands.clear();
    ordered.clear();
    trailing.clear();
  }

  void commitTrailing() {
    ordered.addAll(trailing);
    trailing.clear();
  }

  for (var index = 0; index < rows.length; index++) {
    if (previous[index] case final List<DesktopTimelineItem> groups) {
      flushTools();
      flushCommands();
      items.addAll(groups);
    }
    if (hidden.contains(index)) {
      if (previousHidden.contains(index) &&
          !rows[index].containsKey(reasoningMetadataKey) &&
          resolved[index]?.kind != 'fileChange') {
        flushTools();
        flushCommands();
      }
      continue;
    }
    final activity = resolved[index];
    final trace = rows[index].containsKey(reasoningMetadataKey);
    if (commands.isNotEmpty && (trace || activity?.kind == 'fileChange')) {
      flushTools();
      if (!compatible(commands.last, index)) {
        flushCommands();
        message(index);
      } else if (trace) {
        commitTrailing();
        ordered.add(index);
      } else {
        trailing.add(index);
      }
      continue;
    }
    if (activity == null || !{'tool', 'command'}.contains(activity.kind)) {
      flushTools();
      flushCommands();
      message(index);
      continue;
    }
    if (activity.kind == 'command' &&
        {'completed', 'failed', 'stopped'}.contains(activity.status)) {
      flushTools();
      if (commands.isNotEmpty && !compatible(commands.last, index)) {
        flushCommands();
      }
      commitTrailing();
      commands.add(index);
      ordered.add(index);
      continue;
    }
    flushCommands();
    if (tools.isNotEmpty && !compatible(tools.last, index)) flushTools();
    tools.add(index);
  }
  flushTools();
  flushCommands();

  final rawToRender = <int, int>{
    for (var i = 0; i < items.length; i++)
      for (final raw in items[i].indices) raw: i,
  };
  final focusAliases = <int, int>{};
  for (final entry in fileChanges.aliases.entries) {
    final target = rawToRender[entry.value];
    if (target != null) {
      rawToRender[entry.key] = target;
      focusAliases[entry.key] = entry.value;
    }
  }
  // Rehome only inside the same user/turn block. A stale hidden row must not
  // focus an unrelated message simply because that message precedes it.
  // A turn usually runs work first and answers last, and the work rows are
  // hidden. Those rows have no earlier visible row in their block, so they
  // wait for the block's first visible row instead of dead-ending a link.
  int? visibleHost;
  String? blockTurn;
  final waiting = <int>[];
  for (var index = 0; index < rows.length; index++) {
    if (rows[index]['type'] == 'userMessage') {
      visibleHost = null;
      blockTurn = null;
      waiting.clear();
      continue;
    }
    final currentTurn = turn(index);
    if (blockTurn != null && currentTurn != null && blockTurn != currentTurn) {
      visibleHost = null;
      waiting.clear();
    }
    blockTurn = currentTurn ?? blockTurn;
    if (rawToRender.containsKey(index)) {
      visibleHost = index;
      for (final hiddenRow in waiting) {
        rawToRender[hiddenRow] = rawToRender[index]!;
        focusAliases[hiddenRow] = focusAliases[index] ?? index;
      }
      waiting.clear();
    } else if (visibleHost != null) {
      rawToRender[index] = rawToRender[visibleHost]!;
      focusAliases[index] = focusAliases[visibleHost] ?? visibleHost;
    } else {
      waiting.add(index);
    }
  }
  return DesktopTimelineProjection._(
    List.unmodifiable(items),
    Map.unmodifiable(rawToRender),
    Set.unmodifiable(hidden),
    fileChanges.activities,
    Map.unmodifiable(focusAliases),
  );
}
