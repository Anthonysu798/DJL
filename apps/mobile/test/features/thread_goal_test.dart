import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/goals/data/goal_repository.dart';
import 'package:djl_mobile/features/goals/domain/thread_goal.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'workspace_repository_test.dart' show WorkspaceTransport;

void main() {
  test(
    'goal updates preserve omitted, cleared and integer budgets and objective edits omit status',
    () async {
      final transport = WorkspaceTransport()
        ..response = {
          'goal': {
            'threadId': 't1',
            'objective': 'Do the work',
            'status': 'paused',
            'tokensUsed': 100,
            'timeUsedSeconds': 79,
            'tokenBudget': 2000,
          },
        };
      final goals = GoalRepository(transport, threadId: 't1');
      await goals.set(
        objective: 'Edited',
        budget: const GoalBudgetUpdate.keep(),
      );
      expect(transport.calls.last['params'], {
        'threadId': 't1',
        'objective': 'Edited',
      });
      await goals.set(status: GoalStatus.active);
      expect(transport.calls.last['params'], {
        'threadId': 't1',
        'status': 'active',
      });
      await goals.set(budget: const GoalBudgetUpdate.clear());
      expect(
        (transport.calls.last['params'] as Map).containsKey('tokenBudget'),
        isTrue,
      );
      expect((transport.calls.last['params'] as Map)['tokenBudget'], isNull);
      final goal = await goals.set(budget: const GoalBudgetUpdate.set(2000));
      expect((transport.calls.last['params'] as Map)['tokenBudget'], 2000);
      expect(goal.remainingTokens, 1900);
      expect(goal.status.isResumable, isTrue);
      expect(ThreadGoal.formatElapsed(11839), '3h 17m 19s');
      await expectLater(
        goals.set(budget: const GoalBudgetUpdate.set(0)),
        throwsFormatException,
      );
    },
  );
  test(
    'unsupported and ephemeral goals preserve actionable error semantics',
    () async {
      final transport = WorkspaceTransport();
      expect(
        goalError(const RemoteRpcException(-32601, 'Method not found', null)),
        isA<GoalsUnsupported>(),
      );
      expect(
        goalError(
          const RemoteRpcException(
            -32600,
            'ephemeral thread does not support goals',
            null,
          ),
        ),
        isA<EphemeralGoal>(),
      );
      final original = StateError('Network interrupted');
      expect(goalError(original), same(original));
      final goals = GoalRepository(transport, threadId: 't1');
      transport.mac = 'other';
      await expectLater(goals.get(), throwsStateError);
    },
  );
}
