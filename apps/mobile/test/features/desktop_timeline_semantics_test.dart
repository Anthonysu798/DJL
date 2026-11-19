import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_focus_timeline.dart';

int? rowIndex(SemanticsNode node) {
  while (node.indexInParent == null && node.parent != null) {
    node = node.parent!;
  }
  return node.indexInParent;
}

void main() {
  for (final pivot in [0, 2, 4]) {
    testWidgets(
      'split timeline exposes chronological row indexes at pivot $pivot',
      (tester) async {
        final semantics = tester.ensureSemantics();
        try {
          await tester.pumpWidget(
            MaterialApp(
              home: Scaffold(
                body: DesktopFocusTimeline(
                  count: 5,
                  tailAnchor: pivot,
                  itemBuilder: (_, index) => Semantics(
                    container: true,
                    label: 'Row $index',
                    button: true,
                    onTap: () {},
                    child: const SizedBox(height: 44),
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          final indices = [
            for (var i = 0; i < 5; i++)
              rowIndex(tester.getSemantics(find.bySemanticsLabel('Row $i'))),
          ];
          expect(indices, [0, 1, 2, 3, 4]);
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          semantics.dispose();
        }
      },
    );
  }
  testWidgets('timeline exports its total accessible row count', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    try {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: DesktopFocusTimeline(
              count: 5,
              itemBuilder: (_, index) => Semantics(
                label: 'Row $index',
                child: const SizedBox(height: 44),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final counts = <int>[];
      void visit(SemanticsNode node) {
        final count = node.getSemanticsData().scrollChildCount;
        if (count != null) counts.add(count);
        node.visitChildren((child) {
          visit(child);
          return true;
        });
      }

      visit(
        tester
            .binding
            .renderViews
            .first
            .owner!
            .semanticsOwner!
            .rootSemanticsNode!,
      );
      expect(counts, [5]);
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      semantics.dispose();
    }
  });
}
