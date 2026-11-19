import '../../pairing/data/pairing_repository.dart';

const guardianLiveReason =
    'Retry approvals are available only during the live session.';
const guardianExpiredReason =
    'This retry is no longer available. Wait for Codex to request the action again.';
const guardianDesktopReason = 'Approve this retry in Codex Desktop.';
const guardianUnsafeReason =
    'This action cannot be retried safely here. Approve it in Codex.';

RemoteJson? _object(Object? value) =>
    value is Map && value.keys.every((key) => key is String)
    ? Map<String, dynamic>.from(value)
    : null;
String? _string(Object? value) => value is String ? value : null;
String? _identifier(Object? value) =>
    value is String && value.trim().isNotEmpty ? value : null;
int? _timestamp(Object? value) =>
    value is num && value.isFinite ? value.toInt() : null;
String _snake(String value) => value.replaceAllMapped(
  RegExp('[A-Z]'),
  (m) =>
      '${m.start == 0 || value[m.start - 1] == '_' ? '' : '_'}${m[0]!.toLowerCase()}',
);
List<String>? _strings(Object? value) =>
    value is List && value.every((v) => v is String)
    ? List<String>.from(value)
    : null;

// Reconstruct every accepted action instead of forwarding unreviewed map fields.
RemoteJson? guardianCoreAction(Object? value) {
  final action = _object(value);
  if (action == null) return null;
  RemoteJson? fields(String type, List<String> names) {
    if (names.any((name) => action[name] is! String)) return null;
    return {
      'type': type,
      for (final name in names)
        name: name == 'source' || name == 'protocol'
            ? _snake(action[name] as String)
            : action[name],
    };
  }

  switch (action['type']) {
    case 'command':
      return fields('command', ['source', 'command', 'cwd']);
    case 'execve':
      final result = fields('execve', ['source', 'program', 'cwd']),
          argv = _strings(action['argv']);
      return result == null || argv == null ? null : {...result, 'argv': argv};
    case 'applyPatch':
      final files = _strings(action['files']);
      return action['cwd'] is! String || files == null
          ? null
          : {'type': 'apply_patch', 'cwd': action['cwd'], 'files': files};
    case 'networkAccess':
      final result = fields('network_access', ['target', 'host', 'protocol']);
      return result == null || action['port'] is! int
          ? null
          : {...result, 'port': action['port']};
    case 'mcpToolCall':
      final result = fields('mcp_tool_call', ['server']);
      if (result == null || action['toolName'] is! String) return null;
      result['tool_name'] = action['toolName'];
      for (final key in ['connectorId', 'connectorName', 'toolTitle']) {
        if (action.containsKey(key) &&
            (action[key] == null || action[key] is String)) {
          result[_snake(key)] = action[key];
        }
      }
      return result;
    case 'requestPermissions':
      final permissions = _permissions(action['permissions']);
      if (permissions == null) return null;
      return {
        'type': 'request_permissions',
        'permissions': permissions,
        if (action.containsKey('reason') &&
            (action['reason'] == null || action['reason'] is String))
          'reason': action['reason'],
      };
    default:
      return null;
  }
}

RemoteJson? _permissions(Object? value) {
  final profile = _object(value);
  if (profile == null ||
      profile.keys.any((key) => !{'network', 'fileSystem'}.contains(key))) {
    return null;
  }
  final result = <String, dynamic>{};
  if (profile.containsKey('network')) {
    final network = _object(profile['network']);
    if (profile['network'] != null &&
        (network == null ||
            network.keys.any((key) => key != 'enabled') ||
            network['enabled'] is! bool)) {
      return null;
    }
    result['network'] = network == null
        ? null
        : {'enabled': network['enabled']};
  }
  if (!profile.containsKey('fileSystem')) return result;
  if (profile['fileSystem'] == null) return {...result, 'file_system': null};
  final fs = _object(profile['fileSystem']);
  if (fs == null ||
      fs.keys.any(
        (key) =>
            !{'entries', 'read', 'write', 'globScanMaxDepth'}.contains(key),
      )) {
    return null;
  }
  final depth = fs['globScanMaxDepth'];
  if (depth != null && depth is! int) return null;
  final mapped = <String, dynamic>{};
  if (fs['entries'] != null) {
    if (fs['entries'] is! List) return null;
    final entries = <RemoteJson>[];
    for (final raw in fs['entries'] as List) {
      final entry = _object(raw), path = _object(_object(raw)?['path']);
      if (entry == null ||
          path == null ||
          entry.keys.any((key) => !{'path', 'access'}.contains(key)) ||
          !{'read', 'write'}.contains(entry['access'])) {
        return null;
      }
      RemoteJson converted;
      if (path['type'] == 'path' &&
          path['path'] is String &&
          path.keys.every((key) => {'type', 'path'}.contains(key))) {
        converted = {'type': 'path', 'path': path['path']};
      } else if (path['type'] == 'special' &&
          path.keys.every((key) => {'type', 'value'}.contains(key))) {
        final special = _object(path['value']);
        if (special == null ||
            special['kind'] is! String ||
            special.keys.any((key) => !{'kind', 'subpath'}.contains(key)) ||
            (special['subpath'] != null && special['subpath'] is! String)) {
          return null;
        }
        converted = {
          'type': 'special',
          'value': {
            'kind': special['kind'],
            if (special.containsKey('subpath')) 'subpath': special['subpath'],
          },
        };
      } else {
        return null;
      }
      entries.add({'path': converted, 'access': entry['access']});
    }
    mapped['entries'] = entries;
  } else {
    final entries = <RemoteJson>[];
    for (final access in ['read', 'write']) {
      if (fs[access] == null) continue;
      final paths = _strings(fs[access]);
      if (paths == null) return null;
      if (depth == null) {
        mapped[access] = paths;
      } else {
        entries.addAll(
          paths.map(
            (path) => {
              'path': {'type': 'path', 'path': path},
              'access': access,
            },
          ),
        );
      }
    }
    if (depth != null) mapped['entries'] = entries;
  }
  if (depth != null) mapped['glob_scan_max_depth'] = depth;
  return {...result, 'file_system': mapped};
}

String _actionSummary(Object? value) {
  final a = _object(value);
  if (a == null) return 'Requested action';
  switch (a['type']) {
    case 'command':
      return _string(a['command']) ?? 'Run command';
    case 'execve':
      String quote(String value) =>
          RegExp(r'^[a-zA-Z0-9_./-]*$').hasMatch(value)
          ? value
          : "'${value.replaceAll("'", "'\\''")}'";
      final argv = _strings(a['argv']);
      return argv?.isNotEmpty == true
          ? argv!.map(quote).join(' ')
          : quote(_string(a['program']) ?? 'Run command');
    case 'applyPatch':
      final files = _strings(a['files']) ?? [];
      return files.isEmpty
          ? 'Apply file changes'
          : files.length == 1
          ? 'Edit ${files.first}'
          : 'Edit ${files.length} files: ${files.join(', ')}';
    case 'networkAccess':
      final host = _string(a['host']) ?? _string(a['target']);
      return host == null
          ? 'Access the network'
          : 'Access $host${a['port'] is int ? ':${a['port']}' : ''}';
    case 'mcpToolCall':
      return [
        _string(a['server']),
        _string(a['toolTitle']) ?? _string(a['toolName']),
      ].whereType<String>().join('.');
    case 'requestPermissions':
      final p = _object(a['permissions']);
      final requested = [
        if (p?['network'] != null) 'network',
        if (p?['fileSystem'] != null) 'file access',
      ];
      return _string(a['reason']) ??
          (requested.isEmpty
              ? 'Request additional permissions'
              : 'Request ${requested.join(' and ')}');
    default:
      return 'Requested action';
  }
}

class GuardianReview {
  GuardianReview({
    required this.reviewId,
    required this.turnId,
    required this.status,
    required this.summary,
    required this.startedAtMs,
    this.completedAtMs,
    this.targetItemId,
    this.riskLevel,
    this.userAuthorization,
    this.rationale,
    this.decisionSource,
    this.coreDeniedEvent,
    this.retryUnavailableReason,
    this.retryApproved = false,
    this.submitting = false,
  });
  final String reviewId, turnId, status, summary;
  final int startedAtMs;
  final int? completedAtMs;
  final String? targetItemId,
      riskLevel,
      userAuthorization,
      rationale,
      decisionSource;
  final RemoteJson? coreDeniedEvent;
  bool retryApproved, submitting;
  String? retryUnavailableReason;
  bool get isTerminal => status != 'inProgress';
  String get statusLabel => switch (status) {
    'inProgress' => 'Reviewing',
    'approved' => 'Approved',
    'denied' => 'Denied',
    'timedOut' => 'Timed out',
    'aborted' => 'Stopped',
    _ => 'Updated ($status)',
  };
  static GuardianReview? decode(RemoteJson params) {
    final id = _identifier(params['reviewId']),
        turn = _identifier(params['turnId']),
        thread = _identifier(params['threadId']);
    final review = _object(params['review']),
        status = _identifier(_object(params['review'])?['status']);
    if (id == null ||
        turn == null ||
        thread == null ||
        review == null ||
        status == null ||
        !params.containsKey('action')) {
      return null;
    }
    final action = guardianCoreAction(params['action']);
    final start = _timestamp(params['startedAtMs']) ?? 0,
        end = _timestamp(params['completedAtMs']);
    final optional = <String, String>{};
    for (final key in ['riskLevel', 'userAuthorization', 'rationale']) {
      if (review[key] is String) optional[_snake(key)] = review[key] as String;
    }
    if (params['decisionSource'] is String) {
      optional['decision_source'] = _snake(params['decisionSource'] as String);
    }
    final event = status == 'denied' && action != null
        ? <String, dynamic>{
            'id': id,
            'turn_id': turn,
            'started_at_ms': start,
            'status': 'denied',
            'action': action,
            'completed_at_ms': ?end,
            if (params['targetItemId'] is String)
              'target_item_id': params['targetItemId'],
            ...optional,
          }
        : null;
    return GuardianReview(
      reviewId: id,
      turnId: turn,
      status: status,
      summary: _actionSummary(params['action']),
      startedAtMs: start,
      completedAtMs: end,
      targetItemId: _string(params['targetItemId']),
      riskLevel: _string(review['riskLevel']),
      userAuthorization: _string(review['userAuthorization']),
      rationale: _string(review['rationale']),
      decisionSource: _string(params['decisionSource']),
      coreDeniedEvent: event,
      retryUnavailableReason:
          params['djlGuardianRetrySupported'] == false ||
              params['djlDesktopIpcMirror'] == true
          ? guardianDesktopReason
          : status == 'denied' && event == null
          ? guardianUnsafeReason
          : null,
    );
  }

  RemoteJson toRow(String threadId, {bool forStorage = false}) => {
    'type': 'automaticApprovalReview',
    'id': 'auto-approval-review:$reviewId',
    'threadId': threadId,
    'turnId': turnId,
    'guardianReview': {
      'reviewId': reviewId,
      'turnId': turnId,
      'status': status,
      'summary': summary,
      'startedAtMs': startedAtMs,
      'completedAtMs': completedAtMs,
      'targetItemId': targetItemId,
      'riskLevel': riskLevel,
      'userAuthorization': userAuthorization,
      'rationale': rationale,
      'decisionSource': decisionSource,
      'retryApproved': retryApproved,
      'submitting': forStorage ? false : submitting,
      'retryUnavailableReason':
          retryUnavailableReason ??
          (forStorage && status == 'denied' && !retryApproved
              ? guardianLiveReason
              : null),
    },
  };
  static GuardianReview? fromRow(RemoteJson row) {
    final r = _object(row['guardianReview']);
    if (r == null ||
        _identifier(r['reviewId']) == null ||
        _identifier(r['turnId']) == null ||
        _identifier(r['status']) == null) {
      return null;
    }
    return GuardianReview(
      reviewId: r['reviewId'],
      turnId: r['turnId'],
      status: r['status'],
      summary: _string(r['summary']) ?? 'Requested action',
      startedAtMs: _timestamp(r['startedAtMs']) ?? 0,
      completedAtMs: _timestamp(r['completedAtMs']),
      targetItemId: _string(r['targetItemId']),
      riskLevel: _string(r['riskLevel']),
      userAuthorization: _string(r['userAuthorization']),
      rationale: _string(r['rationale']),
      decisionSource: _string(r['decisionSource']),
      retryApproved: r['retryApproved'] == true,
      submitting: r['submitting'] == true,
      retryUnavailableReason: _string(r['retryUnavailableReason']),
    );
  }
}

bool isGuardianRow(RemoteJson row) =>
    row['type']?.toString().toLowerCase() == 'automaticapprovalreview';
RemoteJson sanitizedGuardianRow(RemoteJson row, String threadId) {
  if (!isGuardianRow(row)) return row;
  final review =
      GuardianReview.fromRow(row) ??
      GuardianReview.decode({...row, 'threadId': threadId});
  return review?.toRow(threadId, forStorage: true) ??
      {
        'type': 'automaticApprovalReview',
        'id': _string(row['id']),
        'text': 'Review details unavailable.',
      };
}

// Snapshots can retain legacy turn history as well as the separately cached timeline.
RemoteJson sanitizedGuardianThread(RemoteJson thread) => {
  ...thread,
  if (thread['turns'] is List)
    'turns': [
      for (final rawTurn in thread['turns'] as List)
        if (rawTurn is Map)
          {
            ...Map<String, dynamic>.from(rawTurn),
            if (rawTurn['items'] is List)
              'items': [
                for (final rawItem in rawTurn['items'] as List)
                  if (rawItem is Map &&
                      isGuardianRow(Map<String, dynamic>.from(rawItem)))
                    sanitizedGuardianRow({
                      ...Map<String, dynamic>.from(rawItem),
                      'turnId': rawItem['turnId'] ?? rawTurn['id'],
                    }, _string(thread['id']) ?? '')
                  else
                    rawItem,
              ],
          }
        else
          rawTurn,
    ],
};
