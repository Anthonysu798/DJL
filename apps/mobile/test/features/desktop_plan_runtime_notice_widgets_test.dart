import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'desktop_history_reconciliation_test.dart' show historyDesktop;
import 'desktop_plan_widgets_test.dart' show PlanActionTransport;
import 'desktop_plan_runtime_fallback_test.dart' show planRuntimeNotice;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets(
    'runtime downgrade notice is visible without an activity disclosure',
    (tester) async {
      final d = (await tester.runAsync(
        () => historyDesktop(PlanActionTransport(), [
          {
            'id': 'djl-plan-mode-local-1',
            'type': 'systemMessage',
            'turnId': 'ended',
            'text': planRuntimeNotice,
          },
        ]),
      ))!;
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        d.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: d)),
      );
      await tester.pumpAndSettle();
      expect(find.text(planRuntimeNotice), findsOneWidget);
      expect(find.byType(ExpansionTile), findsNothing);
      expect(find.text('systemMessage'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
