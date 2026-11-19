import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_contract.dart';

void main() {
  test('permission and command approvals preserve Swift wire shapes', () {
    expect(
      approvalResult(
        'item/commandExecution/requestApproval',
        {},
        accept: true,
        forSession: true,
      ),
      {'decision': 'acceptForSession'},
    );
    expect(
      approvalResult(
        'item/fileChange/requestApproval',
        {},
        accept: true,
        forSession: true,
      ),
      {'decision': 'accept'},
    );
    final permissions = {
      'network': {'enabled': true},
    };
    expect(
      approvalResult('item/permissions/requestApproval', {
        'permissions': permissions,
      }, accept: true),
      {'permissions': permissions, 'scope': 'turn'},
    );
    expect(
      approvalResult('item/permissions/requestApproval', {
        'permissions': permissions,
      }, accept: false),
      {'permissions': {}, 'scope': 'turn'},
    );
    expect(
      () => approvalResult('item/tool/requestUserInput', {}, accept: true),
      throwsArgumentError,
    );
  });
  test(
    'structured questions and unsupported requests never classify as approvals',
    () {
      expect(
        serverRequestKind('tool/requestUserInput'),
        ServerRequestKind.userInput,
      );
      expect(
        serverRequestKind('future/unknown'),
        ServerRequestKind.unsupported,
      );
      expect(
        userInputResult({
          'q1': ['  A  ', '', '   ', 'B'],
        }),
        {
          'answers': {
            'q1': {
              'answers': ['A', 'B'],
            },
          },
        },
      );
    },
  );
  test('model wire identifier, provider, plan and access stay distinct', () {
    final runtime = DesktopRuntime(
      model: {'id': 'codex:gpt-5', 'model': 'gpt-5', 'djlProvider': 'codex'},
      effort: 'high',
      plan: true,
    );
    final params = runtime.parameters(forTurn: true);
    expect(params['model'], 'gpt-5');
    expect(params['djlProvider'], 'codex');
    expect((params['collaborationMode'] as Map)['settings'], {
      'model': 'gpt-5',
      'reasoning_effort': 'high',
      'developer_instructions': null,
    });
    expect(params['approvalPolicy'], 'on-request');
    expect(params['approvalsReviewer'], 'user');
    expect(params['sandboxPolicy'], {
      'type': 'workspaceWrite',
      'networkAccess': true,
    });
  });
  test(
    'applied runtime settings reject mismatches and missing automatic reviewer',
    () {
      const auto = DesktopRuntime(access: 'auto-review');
      expect(
        () => auto.validateApplied({}, context: 'turn/start'),
        throwsStateError,
      );
      expect(
        () => auto.validateApplied({
          'runtimeMode': 'full-access',
        }, context: 'turn/start'),
        throwsStateError,
      );
      expect(
        () => auto.validateApplied({
          'approvalsReviewer': 'user',
        }, context: 'turn/start'),
        throwsStateError,
      );
      expect(
        () => auto.validateApplied({
          'approvalsReviewer': 'auto_review',
          'approvalPolicy': 'never',
        }, context: 'turn/start'),
        throwsStateError,
      );
      expect(
        () => auto.validateApplied({
          'approvalsReviewer': 'guardian_subagent',
          'sandbox': {'type': 'dangerFullAccess'},
        }, context: 'turn/start'),
        throwsStateError,
      );
      auto.validateApplied({
        'approvalsReviewer': 'guardian_subagent',
        'approvalPolicy': 'onRequest',
        'sandbox': {'type': 'workspaceWrite', 'networkAccess': true},
      }, context: 'turn/start');
      auto.validateApplied({
        'runtimeMode': 'auto-approval',
      }, context: 'turn/start');
      auto.validateApplied({
        'djlDesktopIpcMirror': true,
      }, context: 'thread/resume');
      const DesktopRuntime().validateApplied({}, context: 'thread/start');
    },
  );
  test('legacy snake-case command approvals remain supported', () {
    expect(
      serverRequestKind('item/command_execution/request_approval'),
      ServerRequestKind.approval,
    );
  });
}
