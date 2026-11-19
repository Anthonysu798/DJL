import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_focus_timeline.dart';
import '../../integration_test/copy_scroll_render_app.dart';

void main() {
  for (final keyboard in [0.0, 308.0]) {
    for (final mode in ['Timeline', 'Prefix']) {
      for (final label in ['Plain action', 'Copy response']) {
        testWidgets(
          'showOnScreen reveals $mode $label with keyboard $keyboard',
          (tester) async {
            final semantics = tester.ensureSemantics();
            try {
              tester.view.physicalSize = const Size(402, 874);
              tester.view.devicePixelRatio = 1;
              tester.view.viewInsets = FakeViewPadding(bottom: keyboard);
              addTearDown(tester.view.resetPhysicalSize);
              addTearDown(tester.view.resetDevicePixelRatio);
              addTearDown(tester.view.resetViewInsets);
              await tester.pumpWidget(
                const MaterialApp(home: CopyScrollRender()),
              );
              await tester.pumpAndSettle();
              await tester.tap(find.text(mode));
              await tester.pumpAndSettle();
              final button = label == 'Plain action'
                  ? find.widgetWithText(TextButton, label)
                  : find.byTooltip(label);
              final viewport = tester
                  .getRect(
                    find.descendant(
                      of: find.byType(DesktopFocusTimeline),
                      matching: find.byType(Scrollable),
                    ),
                  )
                  .inflate(.5);
              final before = tester.getRect(button);
              tester.semantics.performAction(
                find.semantics.byLabel(label),
                ui.SemanticsAction.showOnScreen,
                checkForAction: false,
              );
              await tester.pumpAndSettle();
              final after = tester.getRect(button);
              expect(viewport.contains(after.topLeft), isTrue);
              expect(viewport.contains(after.bottomRight), isTrue);
              if (viewport.contains(before.topLeft) &&
                  viewport.contains(before.bottomRight)) {
                expect(after, before);
              }
              if (label == 'Plain action') {
                tester.semantics.performAction(
                  find.semantics.byLabel(label),
                  ui.SemanticsAction.tap,
                );
                await tester.pumpAndSettle();
                expect(find.text('$mode · activations: 1'), findsOneWidget);
              }
            } finally {
              await tester.pumpWidget(const SizedBox.shrink());
              semantics.dispose();
            }
          },
        );
      }
    }
  }
}
