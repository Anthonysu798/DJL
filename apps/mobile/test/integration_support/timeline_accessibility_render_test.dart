import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/timeline_accessibility_render_app.dart'
    show TimelineAccessibilityRender;

void main() {
  testWidgets(
    'public native diagnostic dispatches the actual timeline action',
    (tester) async {
      tester.view.physicalSize = const Size(402, 874);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      try {
        await tester.pumpWidget(
          const MaterialApp(home: TimelineAccessibilityRender()),
        );
        await tester.pumpAndSettle(
          const Duration(milliseconds: 100),
          EnginePhase.sendSemanticsUpdate,
          const Duration(seconds: 2),
        );
        expect(find.text('Following latest · rows: 40'), findsOneWidget);
        await tester.tap(find.text('Accessibility earlier'));
        await tester.pumpAndSettle(
          const Duration(milliseconds: 100),
          EnginePhase.sendSemanticsUpdate,
          const Duration(seconds: 2),
        );
        expect(find.text('Reading earlier · rows: 40'), findsOneWidget);
        await tester.tap(find.text('Append public row'));
        await tester.pumpAndSettle(
          const Duration(milliseconds: 100),
          EnginePhase.sendSemanticsUpdate,
          const Duration(seconds: 2),
        );
        expect(find.text('Reading earlier · rows: 41'), findsOneWidget);
        await tester.tap(find.byTooltip('Scroll to latest message'));
        await tester.pumpAndSettle(
          const Duration(milliseconds: 100),
          EnginePhase.sendSemanticsUpdate,
          const Duration(seconds: 2),
        );
        expect(find.text('Following latest · rows: 41'), findsOneWidget);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
      }
    },
  );
}
