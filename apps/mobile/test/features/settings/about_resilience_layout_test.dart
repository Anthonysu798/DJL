import 'package:djl_mobile/features/settings/presentation/about_djl_page.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_test/flutter_test.dart';
import 'about_source_layout_test.dart' show showGuide;

void main() {
  const reconnect = 'Automatic reconnect uses bounded backoff.';
  const replay =
      'Encrypted replay cursors help recover missed events. '
      'Uncertain actions are not silently resent after a disconnect.';
  const runtime =
      'The runtime can keep working through a transient phone connection drop.';
  const shutdown =
      'The bridge handles clean shutdown on `SIGINT` and `SIGTERM`.';
  final rows = <String, IconData>{
    reconnect: CupertinoIcons.arrow_clockwise,
    replay: CupertinoIcons.envelope_badge_fill,
    runtime: Icons.memory,
    shutdown: CupertinoIcons.power,
  };
  for (final brightness in Brightness.values) {
    for (final scale in [1.0, 2.2]) {
      testWidgets(
        'resilience guide uses source icon rows in $brightness/$scale',
        (tester) async {
          final semantics = tester.ensureSemantics();
          try {
            await showGuide(tester, brightness, scale);
            for (final entry in rows.entries) {
              final text = find.byWidgetPredicate(
                (w) => w is MarkdownBody && w.data == entry.key,
              );
              await tester.scrollUntilVisible(text, 200, maxScrolls: 80);
              await tester.pumpAndSettle();
              final row = find
                  .ancestor(of: text, matching: find.byType(Row))
                  .first;
              final icon = find.descendant(
                of: row,
                matching: find.byIcon(entry.value),
              );
              expect(icon, findsOneWidget);
              final tile = find
                  .ancestor(of: icon, matching: find.byType(Container))
                  .first;
              expect(tester.getSize(tile), const Size(22, 22));
              expect(tester.getRect(text).left, 54);
              expect(
                tester.getRect(text).left - tester.getRect(tile).right,
                12,
              );
              expect(tester.getRect(text).right, lessThanOrEqualTo(300));
              expect(
                tester.getSemantics(text).flagsCollection.isButton,
                isFalse,
              );
              expect(tester.takeException(), isNull);
            }
            await tester.scrollUntilVisible(
              find.text('MIT License'),
              200,
              maxScrolls: 20,
            );
            await tester.pumpAndSettle();
            expect(find.text('MIT License').hitTestable(), findsOneWidget);
            expect(find.byType(AboutDjlPage), findsOneWidget);
            expect(tester.takeException(), isNull);
          } finally {
            semantics.dispose();
          }
        },
      );
    }
  }
}
