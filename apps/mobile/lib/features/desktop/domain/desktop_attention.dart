import 'dart:convert';
import 'package:flutter/widgets.dart' show StringCharacters;
import '../../../app/desktop_deep_link.dart';
import '../../pairing/data/pairing_repository.dart';
import 'desktop_overview.dart';
import '../../../l10n/l10n.dart';
import 'thread_local_state.dart';

enum DesktopAttentionSection { needsYou, readyToReview }

enum DesktopAttentionKind {
  approval,
  question,
  failedRun,
  blockedGoal,
  completedRun;

  String get title => switch (this) {
    DesktopAttentionKind.approval => appStrings.desktopAttentionApproval,
    DesktopAttentionKind.question => appStrings.desktopAttentionQuestion,
    DesktopAttentionKind.failedRun => appStrings.desktopAttentionFailedRun,
    DesktopAttentionKind.blockedGoal => appStrings.desktopAttentionBlockedGoal,
    DesktopAttentionKind.completedRun =>
      appStrings.desktopAttentionCompletedRun,
  };
  DesktopAttentionSection get section => this == completedRun
      ? DesktopAttentionSection.readyToReview
      : DesktopAttentionSection.needsYou;
}

class DesktopAttentionItem {
  const DesktopAttentionItem({
    required this.id,
    required this.kind,
    required this.threadTitle,
    required this.projectTitle,
    required this.summary,
    required this.date,
    required this.sourceOrder,
    required this.target,
    this.requestId,
  });
  final String id, threadTitle, summary;
  final String? projectTitle;
  final DesktopAttentionKind kind;
  final double date;
  final int sourceOrder;
  final DesktopLinkTarget target;
  final Object? requestId;
  DesktopAttentionSection get section => kind.section;
}

String? _text(Object? value) =>
    value is String && value.trim().isNotEmpty ? value.trim() : null;
Map _object(Object? value) => value is Map ? value : const {};

double? _timestamp(Object? value) {
  final number = value is num
      ? value.toDouble()
      : value is String
      ? double.tryParse(value.trim())
      : null;
  if (number != null && number.isFinite) {
    final absolute = number.abs();
    return number /
        (absolute >= 1e18
            ? 1e9
            : absolute >= 1e15
            ? 1e6
            : absolute >= 1e10
            ? 1e3
            : 1);
  }
  final date = value is String ? DateTime.tryParse(value.trim()) : null;
  return date == null ? null : date.microsecondsSinceEpoch / 1e6;
}

double _date(Map value) =>
    _timestamp(value['updatedAt']) ??
    _timestamp(value['updated_at']) ??
    _timestamp(value['createdAt']) ??
    _timestamp(value['created_at']) ??
    double.negativeInfinity;

String _concise(String value, {int limit = 160}) {
  final line = value.split(RegExp(r'\s+')).where((v) => v.isNotEmpty).join(' ');
  return line.characters.length <= limit
      ? line
      : '${line.characters.take(limit - 1).toString().trimRight()}…';
}

String? _requestThread(Map params, String? active) {
  final values = [
    params['threadId'],
    params['thread_id'],
  ].where((v) => v != null);
  if (values.any((v) => v is! String)) return null;
  final ids = values.map(_text).whereType<String>().toSet();
  return ids.length > 1 ? null : ids.firstOrNull ?? _text(active);
}

RemoteJson? _reviewTarget(List<RemoteJson> rows) =>
    rows
        .where(
          (row) =>
              (row['type'] == 'agentMessage' ||
                  row['role'] == 'assistant' &&
                      {null, 'chat', 'message'}.contains(row['type'])) &&
              _text(row['text']) != null,
        )
        .lastOrNull ??
    rows
        .where((row) => row['role'] != 'user' && row['type'] != 'userMessage')
        .lastOrNull ??
    rows.lastOrNull;

String _failureSummary(String? raw) {
  final text = raw?.toLowerCase() ?? '';
  bool has(List<String> values) => values.any(text.contains);
  if (has(['permission denied', 'operation not permitted'])) {
    return appStrings.desktopFailurePermission;
  }
  if (has(['authentication', 'unauthorized', 'sign in'])) {
    return appStrings.desktopFailureSignIn;
  }
  if (has(['timed out', 'timeout'])) {
    return appStrings.desktopFailureTimeout;
  }
  if (has(['network', 'connection refused', 'offline'])) {
    return appStrings.desktopFailureNetwork;
  }
  if (has(['test failed', 'tests failed', 'build failed'])) {
    return appStrings.desktopFailureCheck;
  }
  return appStrings.desktopFailureGeneric;
}

/// Review presentation only. The controller supplies host-scoped live authority
/// and unread sets; historical terminal rows alone never create unread work.
List<DesktopAttentionItem> projectDesktopAttention(
  ThreadLocalState data, {
  List<RemoteJson> approvals = const [],
  List<RemoteJson> userInputs = const [],
  Set<String> ready = const {},
  Set<String> failed = const {},
  String? activeThreadId,
  String query = '',
}) {
  final threads = {
    for (final thread in data.snapshots)
      if (thread['id'] is String &&
          !data.deleted.contains(thread['id']) &&
          !data.isArchived(thread['id'] as String) &&
          thread['syncState'] != 'archivedLocal' &&
          thread['sync_state'] != 'archivedLocal')
        thread['id'] as String: thread,
  };
  final items = <DesktopAttentionItem>[];
  void append(
    String id,
    DesktopAttentionKind kind,
    RemoteJson thread,
    String summary, {
    RemoteJson? row,
    Map? params,
    Object? requestId,
    double? receivedAt,
    int sourceOrder = 0,
  }) {
    final focus = params ?? row ?? const {};
    items.add(
      DesktopAttentionItem(
        id: id,
        kind: kind,
        threadTitle: threadTitle(thread),
        projectTitle: desktopConversationFolder(
          thread,
          projectlessRoots: data.projectlessChatRoots,
        ),
        summary: summary,
        date:
            receivedAt ??
            (row == null || _date(row) == double.negativeInfinity
                ? _date(thread)
                : _date(row)),
        sourceOrder: row?['orderIndex'] is int
            ? row!['orderIndex'] as int
            : sourceOrder,
        target: DesktopLinkTarget(
          thread['id'] as String,
          turn: _text(focus['turnId']) ?? _text(focus['turn_id']),
          item:
              _text(focus['itemId']) ??
              _text(focus['item_id']) ??
              _text(focus['sourceItemKey']) ??
              _text(focus['sourceItemId']),
          message: row == null ? null : _text(row['id']),
        ),
        requestId: requestId,
      ),
    );
  }

  for (final (isApproval, requests) in [
    (true, approvals),
    (false, userInputs),
  ]) {
    for (var index = 0; index < requests.length; index++) {
      final request = requests[index], params = _object(request['params']);
      final id = request['id'];
      final thread = threads[_requestThread(params, activeThreadId)];
      if (thread == null ||
          id is! num && id is! String ||
          request['_submitted'] == true ||
          request['_submitting'] == true) {
        continue;
      }
      final reason = _text(params['reason']),
          command = _text(params['command']);
      final questions = params['questions'];
      final question = questions is List && questions.isNotEmpty
          ? _object(questions.first)
          : const {};
      final summary = isApproval
          ? reason != null
                ? _concise(reason)
                : command != null
                ? appStrings.desktopAttentionAllowCommand(
                    _concise(command, limit: 96),
                  )
                : appStrings.desktopAttentionAwaitingPermission
          : _concise(
              _text(question['question']) ??
                  _text(question['header']) ??
                  appStrings.desktopAttentionAnswerAgent,
            );
      append(
        '${isApproval ? 'approval' : 'question'}:${jsonEncode(id)}',
        isApproval
            ? DesktopAttentionKind.approval
            : DesktopAttentionKind.question,
        thread,
        summary,
        params: params,
        requestId: id,
        receivedAt: isApproval ? null : _timestamp(request['_receivedAt']),
        sourceOrder: index,
      );
    }
  }
  for (final entry in threads.entries) {
    final id = entry.key, thread = entry.value;
    final rows = data.timelines[id] ?? const <RemoteJson>[];
    final target = _reviewTarget(rows);
    if (failed.contains(id)) {
      append(
        'failed:$id',
        DesktopAttentionKind.failedRun,
        thread,
        _failureSummary(
          _text(target?['text']) ??
              _text(_object(target?['activity'])['outputTail']),
        ),
        row: target,
      );
    }
    final goalSummary = switch (data.goals[id]?['status']) {
      'blocked' => appStrings.desktopGoalBlocked,
      'usageLimited' => appStrings.desktopGoalUsageLimited,
      'budgetLimited' => appStrings.desktopGoalBudgetLimited,
      _ => null,
    };
    if (goalSummary != null) {
      append(
        'goal:$id',
        DesktopAttentionKind.blockedGoal,
        thread,
        goalSummary,
        row: rows.lastOrNull,
      );
    }
    if (ready.contains(id)) {
      append(
        'completed:$id',
        DesktopAttentionKind.completedRun,
        thread,
        appStrings.desktopRunFinishedReview,
        row: target,
      );
    }
  }
  items.sort((a, b) {
    var order = a.kind.index.compareTo(b.kind.index);
    if (order != 0) return order;
    if (a.kind == DesktopAttentionKind.approval) {
      order = a.sourceOrder.compareTo(b.sourceOrder);
      if (order != 0) return order;
    }
    order = b.date.compareTo(a.date);
    if (order != 0) return order;
    order = b.sourceOrder.compareTo(a.sourceOrder);
    return order != 0 ? order : a.id.compareTo(b.id);
  });
  return filterDesktopAttention(items, query);
}

List<DesktopAttentionItem> filterDesktopAttention(
  List<DesktopAttentionItem> items,
  String query,
) {
  final search = query.trim().toLowerCase();
  return search.isEmpty
      ? items
      : items
            .where(
              (item) =>
                  [
                    item.kind.title,
                    item.threadTitle,
                    item.projectTitle,
                    item.summary,
                  ].whereType<String>().any(
                    (v) => v.toLowerCase().contains(search),
                  ),
            )
            .toList();
}
