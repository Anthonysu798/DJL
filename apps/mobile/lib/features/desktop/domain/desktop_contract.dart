import '../../pairing/data/pairing_repository.dart';

enum ServerRequestKind { approval, permissions, userInput, unsupported }

ServerRequestKind serverRequestKind(String method) {
  if ({
    'item/tool/requestUserInput',
    'tool/requestUserInput',
  }.contains(method)) {
    return ServerRequestKind.userInput;
  }
  if (method == 'item/permissions/requestApproval') {
    return ServerRequestKind.permissions;
  }
  if (method.endsWith('/requestApproval') ||
      method == 'item/command_execution/request_approval') {
    return ServerRequestKind.approval;
  }
  return ServerRequestKind.unsupported;
}

RemoteJson approvalResult(
  String method,
  RemoteJson params, {
  required bool accept,
  bool forSession = false,
}) {
  final kind = serverRequestKind(method);
  if (kind == ServerRequestKind.permissions) {
    return {
      'permissions': accept ? params['permissions'] ?? {} : {},
      'scope': 'turn',
    };
  }
  if (kind != ServerRequestKind.approval) {
    throw ArgumentError('This request is not an approval.');
  }
  final command = {
    'item/commandExecution/requestApproval',
    'item/command_execution/request_approval',
  }.contains(method);
  return {
    'decision': accept
        ? (forSession && command ? 'acceptForSession' : 'accept')
        : 'decline',
  };
}

RemoteJson userInputResult(Map<String, List<String>> values) => {
  'answers': values.map(
    (id, answers) => MapEntry(id, {
      'answers': answers
          .map((a) => a.trim())
          .where((a) => a.isNotEmpty)
          .toList(),
    }),
  ),
};

class DesktopRuntime {
  const DesktopRuntime({
    this.model,
    this.effort,
    this.access = 'on-request',
    this.plan = false,
    this.serviceTier = 'default',
  });
  final RemoteJson? model;
  final String? effort;
  final String access, serviceTier;
  final bool plan;
  String? get modelName =>
      model?['model'] as String? ?? model?['id'] as String?;
  RemoteJson get sandboxPolicy => access == 'full-access'
      ? {'type': 'dangerFullAccess'}
      : {'type': 'workspaceWrite', 'networkAccess': true};
  String get legacySandbox =>
      access == 'full-access' ? 'danger-full-access' : 'workspace-write';
  void validateApplied(RemoteJson result, {required String context}) {
    final mode = result['runtimeMode'];
    final expectedMode = {
      'on-request': 'approval-required',
      'auto-review': 'auto-approval',
      'full-access': 'full-access',
    }[access];
    if ({'approval-required', 'auto-approval', 'full-access'}.contains(mode)) {
      if (mode != expectedMode) {
        throw StateError('$context did not apply the selected access mode.');
      }
      return;
    }
    if (result['djlDesktopIpcMirror'] == true) return;
    final reviewer = result['approvalsReviewer'];
    if (reviewer == null) {
      if (access == 'auto-review') {
        throw StateError(
          'Approve for me is not supported by this runtime. Update Codex on your Mac and retry.',
        );
      }
      return;
    }
    final reviewers = access == 'auto-review'
        ? {'auto_review', 'guardian_subagent'}
        : {'user'};
    if (!reviewers.contains(reviewer)) {
      throw StateError(
        '$context did not apply the selected approval reviewer.',
      );
    }
    final policy = result['approvalPolicy'];
    if (policy is String &&
        policy.toLowerCase().replaceAll(RegExp('[^a-z]'), '') !=
            (access == 'full-access' ? 'never' : 'onrequest')) {
      throw StateError('$context did not apply the selected approval policy.');
    }
    final sandbox = result['sandbox'];
    if (sandbox is Map &&
        (sandbox['type'] != sandboxPolicy['type'] ||
            (sandboxPolicy['networkAccess'] != null &&
                sandbox['networkAccess'] != sandboxPolicy['networkAccess']))) {
      throw StateError(
        '$context did not apply the selected sandbox permissions.',
      );
    }
  }

  RemoteJson parameters({required bool forTurn}) => {
    if (modelName != null) 'model': modelName,
    if (model?['djlProvider'] != null) ...{
      'djlProvider': model!['djlProvider'],
      'serviceTier': serviceTier,
    },
    if (forTurn && effort != null) 'effort': effort,
    'approvalPolicy': access == 'full-access' ? 'never' : 'on-request',
    'approvalsReviewer': access == 'auto-review' ? 'auto_review' : 'user',
    'sandboxPolicy': sandboxPolicy,
    if (forTurn && plan && modelName != null)
      'collaborationMode': {
        'mode': 'plan',
        'settings': {
          'model': modelName,
          'reasoning_effort': effort,
          'developer_instructions': null,
        },
      },
  };
}
