import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/structured_question_card.dart';
import 'desktop_history_reconciliation_test.dart' show historyDesktop;
import 'desktop_plan_runtime_fallback_test.dart' show PlanFallbackTransport;
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';

const legacyQuestionText = '''A few quick questions:

1. Which rollout path should we take?
- Ship it now
- Stage it

Once you answer, I will finalize the plan.''';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets(
    'legacy progress sheet keeps explanation and submits owned answers',
    (tester) async {
      final t = PlanFallbackTransport();
      final d = (await tester.runAsync(
        () => historyDesktop(t, [
          {
            'id': 'legacy-plan',
            'type': 'plan',
            'turnId': 'live',
            'text': '1. Which path?\n- A\n- B',
            'explanation': 'Needed before finalizing',
            'plan': [
              {'step': 'Clarify the path', 'status': 'pending'},
            ],
          },
        ], running: true),
      ))!;
      d.models = [
        {'id': 'qa', 'model': 'provider-model'},
      ];
      d.model = 'qa';
      d.threadList.data.planSessions['thread'] = {
        'identityPin': d.active!.data['macIdentityPublicKey'],
        'source': 'compatibilityFallback',
      };
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        d.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: d)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Open active plan'));
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.text('Needed before finalizing'), findsOneWidget);
      expect(find.text('Send'), findsOneWidget);
      expect(find.text('ESC'), findsNothing);
      await tester.ensureVisible(find.text('A'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('A'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Send'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextButton>(find.widgetWithText(TextButton, 'Send'))
            .onPressed,
        isNotNull,
        reason:
            'enabled=${tester.widget<InferredPlanQuestionCard>(find.byType(InferredPlanQuestionCard)).enabled}; ready=${d.runtimeReady}; routeCurrent=${ModalRoute.of(tester.element(find.byType(InferredPlanQuestionCard)))?.isCurrent}',
      );
      await tester.runAsync(() async {
        await tester.tap(find.text('Send'));
      });
      await tester.pumpAndSettle();
      expect(
        t.actions,
        hasLength(1),
        reason: 'error=${d.error}; turn=${d.turnId}; calls=${t.calls}',
      );
      expect(t.actions.single['expectedTurnId'], 'live');
      expect(find.text('Response sent'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  for (final source in <String?>[
    null,
    'native',
    'requested',
    'compatibilityFallback',
  ]) {
    testWidgets(
      'only saved legacy compatibility renders inferred answers: $source',
      (tester) async {
        final t = PlanFallbackTransport();
        final d = (await tester.runAsync(
          () => historyDesktop(t, [
            {
              'id': 'a',
              'type': 'agentMessage',
              'turnId': 'ended',
              'text': legacyQuestionText,
            },
          ]),
        ))!;
        if (source != null) {
          d.threadList.data.planSessions['thread'] = {
            'identityPin': d.active!.data['macIdentityPublicKey'],
            'source': source,
          };
        } else {
          d.setPlan(true);
        }
        d.models = [
          {'id': 'qa', 'model': 'provider-model'},
        ];
        d.model = 'qa';
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox());
          d.dispose();
        });
        await tester.pumpWidget(
          MaterialApp(home: DesktopChatPage(controller: d)),
        );
        await tester.pumpAndSettle();
        if (source == 'compatibilityFallback') {
          expect(find.text('Send'), findsOneWidget);
          expect(find.text('ESC'), findsNothing);
          await tester.tap(find.text('Ship it now'));
          await tester.pumpAndSettle();
          await tester.runAsync(() async {
            await tester.tap(find.text('Send'));
          });
          await tester.pumpAndSettle();
          expect(t.actions, hasLength(1));
          expect(t.actions.single['input'], [
            {
              'type': 'text',
              'text':
                  'Answers:\n\n1. Which rollout path should we take?\nShip it now',
            },
          ]);
          expect(
            (t.actions.single['collaborationMode'] as Map)['mode'],
            'plan',
          );
          expect(t.actions.single['approvalsReviewer'], 'user');
          expect(
            d.threadList.data.planSessions['thread']?['source'],
            'compatibilityFallback',
          );
          expect(find.text('Response sent'), findsOneWidget);
        } else {
          expect(find.text('Send'), findsNothing);
          expect(t.actions, isEmpty);
        }
        expect(tester.takeException(), isNull);
      },
    );
  }
}
