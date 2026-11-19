import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'cloud_account_confirmation_test.dart' show AccountFixture;

void main() {
  testWidgets('Account usage periods have separate labeled progress values', (
    tester,
  ) async {
    final f = AccountFixture();
    final semantics = tester.ensureSemantics();
    try {
      await tester.pumpWidget(f.page());
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Weekly limit'),
        180,
        scrollable: find.byType(Scrollable).last,
      );
      final five = tester.getSemantics(find.text('5-hour limit'));
      final week = tester.getSemantics(find.text('Weekly limit'));
      expect(five.id, isNot(week.id));
      expect(five.getSemanticsData().label, contains('5-hour limit'));
      expect(five.getSemanticsData().label, contains('56% used'));
      expect(five.getSemanticsData().value, isEmpty);
      expect(week.getSemanticsData().label, contains('Weekly limit'));
      expect(week.getSemanticsData().label, contains('34% used'));
      expect(week.getSemanticsData().value, isEmpty);
      expect(tester.takeException(), isNull);
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      semantics.dispose();
    }
  });
  testWidgets('Usage footer is readable text and does not own account controls', (
    tester,
  ) async {
    final f = AccountFixture();
    final semantics = tester.ensureSemantics();
    const copy =
        'A banked reset starts both limits over and restarts your week. Banks expire 90 days after they\'re granted.';
    try {
      await tester.pumpWidget(f.page());
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text(copy),
        180,
        scrollable: find.byType(Scrollable).last,
      );
      final node = tester.getSemantics(find.text(copy));
      var controls = 0;
      void visit(SemanticsNode parent) {
        parent.visitChildren((child) {
          if (child.flagsCollection.isButton) controls++;
          visit(child);
          return true;
        });
      }

      visit(node);
      expect(node.getSemanticsData().label, copy);
      expect(controls, 0);
      expect(tester.takeException(), isNull);
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      semantics.dispose();
    }
  });
}
