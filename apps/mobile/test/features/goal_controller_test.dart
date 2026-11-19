import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/goals/data/goal_repository.dart';
import 'package:djl_mobile/features/goals/domain/thread_goal.dart';
import 'package:djl_mobile/features/goals/presentation/goal_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'workspace_repository_test.dart' show WorkspaceTransport;

class GoalTransport extends WorkspaceTransport {
  Completer<RemoteJson>? read;
  Completer<RemoteJson>? mutation;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': params});
    if (method == 'thread/goal/get' && read != null) return read!.future;
    if (method == 'thread/goal/set' && mutation != null) {
      return mutation!.future;
    }
    return response;
  }
}

RemoteJson goal(String status, {int updated = 1}) => {
  'threadId': 't1',
  'objective': 'A real objective',
  'status': status,
  'tokenBudget': 2000,
  'tokensUsed': 100,
  'timeUsedSeconds': 79,
  'createdAt': 1,
  'updatedAt': updated,
};
void main() {
  for (final cleared in [true, false]) {
    test(
      'newer ${cleared ? 'clear' : 'equal timestamp update'} beats a delayed mutation',
      () async {
        final transport = GoalTransport()..mutation = Completer<RemoteJson>();
        final mirrors = <ThreadGoal?>[];
        final controller = GoalController(
          GoalRepository(transport, threadId: 't1'),
          goal: ThreadGoal.fromJson(goal('active')),
          onChange: mirrors.add,
        );
        final pending = controller.pause();
        transport.events.add({
          'method': cleared ? 'thread/goal/cleared' : 'thread/goal/updated',
          'params': cleared ? {'threadId': 't1'} : {'goal': goal('active')},
        });
        transport.mutation!.complete({'goal': goal('paused')});
        expect(await pending, isTrue);
        expect(controller.goal?.status, cleared ? null : GoalStatus.active);
        expect(mirrors, isEmpty);
        controller.dispose();
      },
    );
  }
  test(
    'a live update invalidates an older goal read even when server timestamps are equal',
    () async {
      final transport = GoalTransport()..read = Completer<RemoteJson>();
      final controller = GoalController(
        GoalRepository(transport, threadId: 't1'),
      );
      final loading = controller.refresh();
      transport.events.add({
        'method': 'thread/goal/updated',
        'params': {'goal': goal('paused')},
      });
      transport.read!.complete({'goal': goal('active')});
      await loading;
      expect(controller.goal?.status, GoalStatus.paused);
      controller.dispose();
    },
  );
  test(
    'live goal events win over an older read and pause preserves objective/budget fields',
    () async {
      final transport = GoalTransport()..read = Completer<RemoteJson>();
      final controller = GoalController(
        GoalRepository(transport, threadId: 't1'),
      );
      final refresh = controller.refresh();
      transport.events.add({
        'method': 'thread/goal/updated',
        'params': {'goal': goal('paused', updated: 2)},
      });
      transport.read!.complete({'goal': goal('active')});
      await refresh;
      expect(controller.goal?.status, GoalStatus.paused);
      transport.read = null;
      transport.response = {'goal': goal('active', updated: 3)};
      await controller.resume();
      expect(transport.calls.last['params'], {
        'threadId': 't1',
        'status': 'active',
      });
      transport.response = {'goal': goal('paused', updated: 4)};
      await controller.pause();
      expect(transport.calls.last['params'], {
        'threadId': 't1',
        'status': 'paused',
      });
      controller.dispose();
    },
  );
  test(
    'goal clear waits for confirmation in UI and removes its mirror only after server success',
    () async {
      final transport = GoalTransport()..response = {'goal': goal('active')};
      final controller = GoalController(
        GoalRepository(transport, threadId: 't1'),
      );
      await controller.refresh();
      transport.response = {'cleared': true};
      await controller.clear();
      expect(controller.goal, isNull);
      controller.dispose();
    },
  );
}
