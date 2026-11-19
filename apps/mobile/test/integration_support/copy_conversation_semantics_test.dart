import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/copy_conversation_render_app.dart';

SemanticsNode? hitSemantics(SemanticsNode node, Offset point, Matrix4 parent) {
  final transform = parent.clone();
  if (node.transform != null) transform.multiply(node.transform!);
  if (!MatrixUtils.transformRect(transform, node.rect).contains(point)) {
    return null;
  }
  for (final child
      in node
          .debugListChildrenInOrder(DebugSemanticsDumpOrder.inverseHitTest)
          .reversed) {
    final hit = hitSemantics(child, point, transform);
    if (hit != null) return hit;
  }
  final data = node.getSemanticsData();
  final scrolling =
      ui.SemanticsAction.scrollUp.index |
      ui.SemanticsAction.scrollDown.index |
      ui.SemanticsAction.scrollLeft.index |
      ui.SemanticsAction.scrollRight.index;
  final focusable =
      (data.flagsCollection.hasImplicitScrolling &&
          data.flagsCollection.isHidden) ||
      data.label.isNotEmpty ||
      data.value.isNotEmpty ||
      data.hint.isNotEmpty ||
      data.actions & ~scrolling != 0;
  return focusable ? node : null;
}

void main() {
  for (final keyboard in [0.0, 308.0]) {
    testWidgets(
      'actual conversation Copy hit order survives refresh $keyboard',
      (tester) async {
        final semantics = tester.ensureSemantics();
        final copied = <String>[];
        tester.view.physicalSize = const Size(402, 874);
        tester.view.devicePixelRatio = 1;
        tester.view.viewInsets = FakeViewPadding(bottom: keyboard);
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.view.resetViewInsets);
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          (call) async {
            if (call.method == 'Clipboard.setData') {
              copied.add((call.arguments as Map)['text'] as String);
            }
            return null;
          },
        );
        try {
          await tester.pumpWidget(const PublicCopyConversationRender());
          await tester.pumpAndSettle();
          for (var revision = 0; revision < 2; revision++) {
            final control = find.byTooltip('Copy response').last;
            var root = tester.getSemantics(control);
            while (root.parent != null) {
              root = root.parent!;
            }
            final hit = hitSemantics(
              root,
              tester.getCenter(control),
              Matrix4.identity(),
            );
            expect(hit?.getSemanticsData().label, 'Copy response');
            tester.semantics.performAction(
              find.semantics.byLabel('Copy response').last,
              ui.SemanticsAction.tap,
            );
            await tester.pump();
            expect(copied.length, revision + 1);
            expect(copied.last, 'Known public response134 🧑‍💻');
            if (revision == 0) {
              await tester.pump(const Duration(milliseconds: 1600));
              await tester.pumpAndSettle();
              await tester.tap(find.byTooltip('Refresh public view'));
              await tester.pumpAndSettle();
              expect(find.text('Public view 1'), findsOneWidget);
            }
          }
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          semantics.dispose();
          tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
            SystemChannels.platform,
            null,
          );
        }
      },
    );
  }
}
