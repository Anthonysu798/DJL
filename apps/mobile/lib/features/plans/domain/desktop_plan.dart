import '../../pairing/data/pairing_repository.dart';

String? _text(Object? value) =>
    value is String && value.trim().isNotEmpty ? value.trim() : null;

String _parts(Object? value) {
  if (value is String) return value;
  if (value is List) {
    return value.map(_parts).where((s) => s.isNotEmpty).join('\n');
  }
  if (value is Map) return _parts(value['text']);
  return '';
}

bool desktopIsPlanItem(RemoteJson row) => {'plan', 'todolist'}.contains(
  (row['type'] is String ? row['type'] as String : '').toLowerCase().replaceAll(
    RegExp('[-_]'),
    '',
  ),
);

List<RemoteJson> desktopPlanSteps(Object? value) => [
  if (value is List)
    for (final raw in value.whereType<Map>())
      if (_text(raw['step']) case final step?)
        if (_text(raw['status']) case final status?)
          if ({
            'pending',
            'in_progress',
            'inProgress',
            'completed',
          }.contains(status))
            {
              'step': step,
              'status': status == 'inProgress' ? 'in_progress' : status,
            },
];

String desktopPlanBody(RemoteJson row) {
  for (final value in [row['text'], row['content'], row['summary']]) {
    final text = _parts(value);
    if (text.trim().isNotEmpty) return text;
  }
  return '';
}

({String body, String prose})? desktopProposedPlan(String text) {
  final envelope = RegExp(
    r'<proposed_plan>([\s\S]*?)</proposed_plan>',
    caseSensitive: false,
  );
  final match = envelope.firstMatch(text);
  final body = match?.group(1)?.trim();
  if (body == null || body.isEmpty) return null;
  return (body: body, prose: text.replaceAll(envelope, '').trim());
}

bool desktopIsProgressPlan(RemoteJson row) =>
    (row['type'] is String ? row['type'] as String : '')
            .toLowerCase()
            .replaceAll(RegExp('[-_]'), '') ==
        'todolist' ||
    row['djlProgressPlan'] == true ||
    row['djlJsonlProgressPlan'] == true ||
    row['planPresentation'] == 'progress' ||
    desktopPlanSteps(row['plan']).isNotEmpty;

class DesktopPlan {
  DesktopPlan(this.row);
  final RemoteJson row;
  String get body => desktopPlanBody(row);
  String? get explanation => _text(row['explanation']) ?? _text(row['summary']);
  List<RemoteJson> get steps => desktopPlanSteps(row['plan']);
  bool get progress => desktopIsProgressPlan(row);
  bool get streaming => row['isStreaming'] == true;
  bool get meaningful =>
      body.trim().isNotEmpty || explanation != null || steps.isNotEmpty;
  String get presentation =>
      (row['planPresentation'] is String
          ? row['planPresentation'] as String
          : null) ??
      (progress ? 'progress' : 'resultClosed');
  bool get pinned =>
      progress && (streaming || steps.any((s) => s['status'] != 'completed'));
  bool get inlineResult =>
      !progress &&
      {'resultReady', 'resultCompletedItem'}.contains(presentation) &&
      body.trim().isNotEmpty;
  int get currentStep {
    final values = steps;
    if (values.isEmpty) return 0;
    final active = values.indexWhere((s) => s['status'] == 'in_progress');
    final pending = values.indexWhere((s) => s['status'] == 'pending');
    return (active >= 0
            ? active
            : pending >= 0
            ? pending
            : values.length - 1) +
        1;
  }

  static DesktopPlan? fromRow(RemoteJson row) {
    if (!desktopIsPlanItem(row)) return null;
    final plan = DesktopPlan(row);
    return plan.meaningful ? plan : null;
  }
}

DesktopPlan? desktopPinnedPlan(List<RemoteJson> rows, {String? activeTurn}) {
  final plans = rows
      .map(DesktopPlan.fromRow)
      .whereType<DesktopPlan>()
      .where((p) => p.progress)
      .toList();
  final plan =
      plans
          .where((p) => activeTurn != null && p.row['turnId'] == activeTurn)
          .lastOrNull ??
      plans.lastOrNull;
  return plan?.pinned == true ? plan : null;
}

/// Produces one display row; the controller owns connection, thread and read fences.
RemoteJson? desktopPlanNotification(
  List<RemoteJson> rows, {
  required String thread,
  required String turn,
  required String method,
  required RemoteJson params,
  required bool closed,
  required bool completed,
  required bool replay,
}) {
  final item = params['item'] is Map
      ? Map<String, dynamic>.from(params['item'] as Map)
      : <String, dynamic>{};
  final snapshot = method == 'turn/plan/updated';
  final delta = method == 'item/plan/delta';
  final progress = snapshot || desktopIsProgressPlan(item);
  final source =
      _text(item['id']) ?? _text(params['itemId']) ?? _text(params['item_id']);
  if (!progress && source == null) return null;
  final candidates = rows
      .where(
        (r) =>
            r['turnId'] == turn &&
            desktopIsPlanItem(r) &&
            (progress
                ? desktopIsProgressPlan(r)
                : !desktopIsProgressPlan(r) &&
                      (r['sourceItemId'] ?? r['id']) == source),
      )
      .toList();
  final old = candidates.length == 1 ? candidates.single : null;
  if (replay && (delta || old != null)) return null;
  final incoming = snapshot ? params : item;
  final incomingBody = delta
      ? (params['delta'] is String ? params['delta'] as String : '')
      : desktopPlanBody(incoming);
  final explanation =
      _text(incoming['explanation']) ?? _text(incoming['summary']);
  final steps = desktopPlanSteps(incoming['plan']);
  final meaningful =
      (delta ? incomingBody.isNotEmpty : incomingBody.trim().isNotEmpty) ||
      explanation != null ||
      steps.isNotEmpty;
  final finishing = method == 'item/completed';
  if (!progress &&
      old != null &&
      !finishing &&
      {
        'resultCompletedItem',
        'resultReady',
      }.contains(old['planPresentation'])) {
    return null;
  }
  if (!meaningful && !(finishing && !progress && old != null)) return null;
  if (delta && incomingBody.isEmpty) return null;
  var chosenSource = source ?? _text(old?['sourceItemId']) ?? _text(old?['id']);
  final oldSource = _text(old?['sourceItemId']) ?? _text(old?['id']);
  if (progress &&
      oldSource != null &&
      source != null &&
      (oldSource.startsWith('todo-list-') &&
          !source.startsWith('todo-list-'))) {
    chosenSource = oldSource;
  }
  final display = old?['id'] ?? chosenSource ?? 'turn:$turn|kind:plan';
  final body = delta
      ? '${old?['text'] ?? ''}$incomingBody'
      : incomingBody.trim().isNotEmpty
      ? incomingBody
      : desktopPlanBody(old ?? {});
  final row = <String, dynamic>{
    ...?old,
    ...item,
    'id': display,
    'threadId': thread,
    'turnId': turn,
    'type': 'plan',
    'text': body,
    if (chosenSource != null && chosenSource != display)
      'sourceItemId': chosenSource,
    'explanation': ?explanation,
    if (snapshot || incoming.containsKey('plan'))
      'plan': [
        for (final step in steps)
          {...step, if (completed) 'status': 'completed'},
      ],
    'planPresentation': progress
        ? 'progress'
        : completed && finishing && !replay
        ? 'resultReady'
        : closed || replay
        ? 'resultClosed'
        : finishing
        ? 'resultCompletedItem'
        : 'resultStreaming',
    'isStreaming': !closed && !replay && !finishing,
  };
  if (chosenSource == display) row.remove('sourceItemId');
  return row;
}

RemoteJson desktopClosedPlan(
  RemoteJson row, {
  required bool completed,
  bool allowReady = true,
}) {
  final plan = DesktopPlan(row);
  return {
    ...row,
    'isStreaming': false,
    if (plan.progress && completed)
      'plan': [
        for (final step in plan.steps) {...step, 'status': 'completed'},
      ],
    if (!plan.progress)
      'planPresentation':
          completed &&
              allowReady &&
              {'resultCompletedItem', 'resultReady'}.contains(plan.presentation)
          ? 'resultReady'
          : plan.presentation == 'resultReady' && !allowReady
          ? 'resultReady'
          : 'resultClosed',
  };
}

RemoteJson? desktopHistoryPlanItem(RemoteJson item, {required bool completed}) {
  final plan = DesktopPlan(item);
  if (!plan.meaningful) return null;
  final progress = plan.progress || _text(item['id']) == null;
  return {
    ...item,
    'type': 'plan',
    'text': plan.body,
    'explanation': ?plan.explanation,
    'plan': [
      for (final step in plan.steps)
        {...step, if (completed) 'status': 'completed'},
    ],
    'planPresentation': progress
        ? 'progress'
        : completed
        ? 'resultReady'
        : 'resultClosed',
    'isStreaming': false,
  };
}
