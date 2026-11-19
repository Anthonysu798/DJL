import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/goals/data/goal_repository.dart';
import 'package:djl_mobile/features/goals/domain/thread_goal.dart';
import 'package:djl_mobile/features/goals/presentation/goal_controller.dart';
import 'package:djl_mobile/features/goals/presentation/goal_page.dart';
import 'goal_controller_test.dart' show GoalTransport, goal;

void main() {
  testWidgets(
    'opening goal management does not notify an existing chat listener during route build',
    (tester) async {
      final transport = GoalTransport()..response = {'goal': goal('paused')};
      final controller = GoalController(
        GoalRepository(transport, threadId: 't1'),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => ListenableBuilder(
              listenable: controller,
              builder: (_, _) => Scaffold(
                body: TextButton(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute<void>(
                      builder: (_) => GoalPage(
                        controller: controller,
                        isRunning: () => false,
                      ),
                    ),
                  ),
                  child: const Text('Open goal'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open goal'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      controller.dispose();
    },
  );
  testWidgets(
    'editing a paused goal keeps status and clearing the budget sends explicit null',
    (tester) async {
      final transport = GoalTransport()..response = {'goal': goal('paused')};
      final controller = GoalController(
        GoalRepository(transport, threadId: 't1'),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: GoalPage(controller: controller, isRunning: () => false),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Edit objective'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('goal_objective')),
        'Refined objective',
      );
      await tester.enterText(find.byKey(const Key('goal_budget')), '');
      await tester.ensureVisible(find.text('Save goal'));
      await tester.tap(find.text('Save goal'));
      await tester.pumpAndSettle();
      final params = transport.calls.last['params'] as Map;
      expect(params['objective'], 'Refined objective');
      expect(params.containsKey('status'), isFalse);
      expect(params.containsKey('tokenBudget'), isTrue);
      expect(params['tokenBudget'], isNull);
      await tester.pumpWidget(const SizedBox());
      controller.dispose();
    },
  );
  testWidgets(
    'replacing an unfinished goal and clearing it each require their explicit confirmation',
    (tester) async {
      final transport = GoalTransport()..response = {'goal': goal('paused')};
      final controller = GoalController(
        GoalRepository(transport, threadId: 't1'),
        goal: ThreadGoal.fromJson(goal('paused')),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: GoalPage(
            controller: controller,
            isRunning: () => false,
            initialDraft: 'New objective',
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Start goal'));
      await tester.tap(find.text('Start goal'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((c) => c['method'] == 'thread/goal/set'),
        isEmpty,
      );
      await tester.tap(find.text('Start goal'));
      await tester.pumpAndSettle();
      transport.response = {'goal': goal('active', updated: 2)};
      await tester.tap(find.text('Replace goal'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((c) => c['method'] == 'thread/goal/set'),
        hasLength(1),
      );
      expect(
        transport.calls.where((c) => c['method'] == 'thread/goal/clear'),
        isEmpty,
      );
      await tester.ensureVisible(find.text('Clear goal'));
      await tester.tap(find.text('Clear goal'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((c) => c['method'] == 'thread/goal/clear'),
        isEmpty,
      );
      await tester.tap(find.text('Clear goal'));
      await tester.pumpAndSettle();
      transport.response = {'cleared': true};
      await tester.tap(find.widgetWithText(FilledButton, 'Clear goal'));
      await tester.pumpAndSettle();
      expect(controller.goal, isNull);
      expect(
        transport.calls.where((c) => c['method'] == 'thread/goal/clear'),
        hasLength(1),
      );
      await tester.pumpWidget(const SizedBox());
      controller.dispose();
    },
  );
}
