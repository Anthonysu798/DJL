import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_conversation_view.dart';
import 'desktop_history_reconciliation_test.dart' show historyDesktop;
import 'desktop_plan_widgets_test.dart' show PlanActionTransport;
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final foreignPin in [false, true]) {
    testWidgets(
      'a plan stays visible without a matching dispatched session foreignPin=$foreignPin',
      (tester) async {
        final t = PlanActionTransport();
        final d = (await tester.runAsync(
          () => historyDesktop(t, [
            {
              'id': 'assistant',
              'type': 'agentMessage',
              'turnId': 'ended',
              'text': '<proposed_plan>Visible proposal</proposed_plan>',
            },
          ]),
        ))!;
        if (foreignPin) {
          d.threadList.data.planSessions['thread'] = {
            'identityPin': 'different-pin',
            'source': 'native',
          };
        } else {
          d.setPlan(true);
        }
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox());
          d.dispose();
        });
        await tester.pumpWidget(
          MaterialApp(home: DesktopChatPage(controller: d)),
        );
        await tester.pumpAndSettle();
        expect(find.text('Proposed plan'), findsOneWidget);
        expect(find.textContaining('Visible proposal'), findsOneWidget);
        expect(find.byTooltip('Copy response'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('native-session streaming prose keeps its existing message row', (
    tester,
  ) async {
    final t = PlanActionTransport();
    final d = (await tester.runAsync(
      () => historyDesktop(t, [
        {
          'id': 'assistant',
          'type': 'agentMessage',
          'turnId': 'live',
          'isStreaming': true,
          'text': '<proposed_plan>Streaming proposal</proposed_plan>',
        },
      ], running: true),
    ))!;
    d.threadList.data.planSessions['thread'] = {
      'identityPin': d.active!.data['macIdentityPublicKey'],
      'source': 'native',
    };
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox());
      d.dispose();
    });
    await tester.pumpWidget(MaterialApp(home: DesktopChatPage(controller: d)));
    await tester.pumpAndSettle();
    expect(find.byType(DesktopConversationMessage), findsOneWidget);
    expect(find.text('Proposed plan'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  for (final prose in [false, true]) {
    testWidgets(
      'restored native plan suppresses its assistant shell prose=$prose',
      (tester) async {
        final t = PlanActionTransport();
        final d = (await tester.runAsync(
          () => historyDesktop(t, [
            {
              'id': 'assistant',
              'type': 'agentMessage',
              'turnId': 'ended',
              'text':
                  '${prose ? 'Outside introduction.\n' : ''}<proposed_plan>Native proposal body</proposed_plan>',
            },
          ]),
        ))!;
        d.threadList.data.planSessions['thread'] = {
          'identityPin': d.active!.data['macIdentityPublicKey'],
          'source': 'native',
        };
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox());
          d.dispose();
        });
        await tester.pumpWidget(
          MaterialApp(home: DesktopChatPage(controller: d)),
        );
        await tester.pumpAndSettle();
        expect(find.text('Proposed plan'), findsNothing);
        expect(find.textContaining('Native proposal body'), findsNothing);
        expect(
          find.byTooltip('Copy response'),
          prose ? findsOneWidget : findsNothing,
        );
        if (prose) {
          expect(find.textContaining('Outside introduction.'), findsOneWidget);
        }
        expect(tester.takeException(), isNull);
      },
    );
  }
}
