import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/git/domain/repository_diff.dart';
import 'package:djl_mobile/features/git/presentation/repository_diff_sheet.dart';

const patch = '''diff --git a/src/qa.dart b/src/qa.dart
--- a/src/qa.dart
+++ b/src/qa.dart
@@ -3,2 +3,2 @@
-before
+after
 context
@@ -10 +10 @@
-old second
+new second
''';

Future<void> sheetApp(
  WidgetTester tester, {
  String raw = patch,
  double scale = 1,
  double keyboard = 0,
  Brightness brightness = Brightness.light,
  bool Function()? isCurrent,
  Listenable? scopeChanges,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(brightness),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(scale),
          viewInsets: EdgeInsets.only(bottom: keyboard),
        ),
        child: child!,
      ),
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => showModalBottomSheet<void>(
              context: context,
              isScrollControlled: true,
              useSafeArea: true,
              builder: (_) => RepositoryDiffSheet(
                diff: RepositoryDiff.parse(raw),
                isCurrent: isCurrent,
                scopeChanges: scopeChanges,
              ),
            ),
            child: const Text('Open diff'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open diff'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('file counts and arrow align to the trailing card edge', (
    tester,
  ) async {
    await sheetApp(tester);
    final file = find
        .ancestor(of: find.text('qa.dart'), matching: find.byType(Material))
        .first;
    final right = tester.getRect(file).right;
    expect(
      tester.getRect(find.byIcon(Icons.north_east)).right,
      closeTo(right - 12, .5),
    );
  });

  testWidgets('hunk counts align to the trailing card edge', (tester) async {
    await sheetApp(tester);
    final file = find
        .ancestor(of: find.text('qa.dart'), matching: find.byType(Material))
        .first;
    final row = find
        .ancestor(of: find.text('Lines 3-4'), matching: find.byType(Row))
        .first;
    final count = find.descendant(of: row, matching: find.text('-1'));
    expect(
      tester.getRect(count).right,
      closeTo(tester.getRect(file).right - 12, .5),
    );
  });

  testWidgets('Repository Changes uses the centered source navigation title', (
    tester,
  ) async {
    await sheetApp(tester);
    final title = find.text('Repository Changes');
    expect(
      tester.getCenter(title).dx,
      closeTo(tester.getCenter(find.byType(RepositoryDiffSheet)).dx, .5),
    );
    expect(tester.widget<Text>(title).style?.fontSize, 17);
  });

  testWidgets('individual hunk controls have a usable mobile touch target', (
    tester,
  ) async {
    await sheetApp(tester);
    final control = find
        .ancestor(of: find.text('Lines 3-4'), matching: find.byType(InkWell))
        .first;
    expect(tester.getSize(control).height, greaterThanOrEqualTo(44));
  });

  testWidgets('source diff sheet shows file cards, counts and numbered rows', (
    tester,
  ) async {
    await sheetApp(tester);
    for (final label in [
      'Repository Changes',
      'Done',
      '1 file changed',
      'qa.dart',
      'src',
      'Collapse All',
      'Lines 3-4',
      'Line 10',
    ]) {
      expect(find.text(label), findsOneWidget);
    }
    expect(find.text('+2'), findsNWidgets(2));
    expect(find.text('-2'), findsNWidgets(2));
    expect(find.byType(SelectableText), findsNWidgets(5));
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
    expect(find.text('Repository Changes'), findsNothing);
    expect(find.text('Open diff'), findsOneWidget);
  });

  testWidgets('individual and global collapse preserve the complete patch', (
    tester,
  ) async {
    await sheetApp(tester);
    await tester.tap(find.text('Lines 3-4'));
    await tester.pumpAndSettle();
    expect(find.text('after'), findsNothing);
    expect(find.text('new second'), findsOneWidget);
    await tester.tap(find.text('Collapse All'));
    await tester.pumpAndSettle();
    expect(find.text('new second'), findsNothing);
    expect(find.text('Expand All'), findsOneWidget);
    await tester.tap(find.text('Expand All'));
    await tester.pumpAndSettle();
    expect(find.text('after'), findsOneWidget);
    expect(find.text('new second'), findsOneWidget);
  });

  testWidgets('unparsed response retains raw text without fake file totals', (
    tester,
  ) async {
    await sheetApp(tester, raw: 'Raw diff fallback\n+unstructured');
    expect(find.text('Raw diff fallback\n+unstructured'), findsOneWidget);
    expect(find.textContaining('file changed'), findsNothing);
    expect(find.text('Collapse All'), findsNothing);
  });

  testWidgets('binary metadata remains inspectable without synthetic hunks', (
    tester,
  ) async {
    await sheetApp(
      tester,
      raw:
          'diff --git a/photo.png b/photo.png\nindex 123..456\nBinary files a/photo.png and b/photo.png differ\n',
    );
    expect(find.text('photo.png'), findsOneWidget);
    expect(find.textContaining('Binary files'), findsOneWidget);
    expect(find.text('Patch'), findsNothing);
  });

  for (final brightness in Brightness.values) {
    testWidgets(
      'diff is scroll-safe with large text, keyboard and $brightness',
      (tester) async {
        tester.view.physicalSize = const Size(360, 640);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await sheetApp(
          tester,
          scale: 2.2,
          keyboard: 260,
          brightness: brightness,
          raw: patch.replaceFirst('+after', '+${'long line ' * 35}'),
        );
        expect(tester.takeException(), isNull);
        await tester.drag(find.byType(ListView), const Offset(0, -350));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.tap(find.text('Done'));
        await tester.pumpAndSettle();
        expect(find.text('Open diff'), findsOneWidget);
      },
    );
  }

  testWidgets('changed owner hides the old diff while keeping Done usable', (
    tester,
  ) async {
    final scope = ValueNotifier(0);
    var current = true;
    await sheetApp(tester, isCurrent: () => current, scopeChanges: scope);
    expect(find.text('after'), findsOneWidget);
    current = false;
    scope.value++;
    await tester.pumpAndSettle();
    expect(find.text('after'), findsNothing);
    expect(find.textContaining('Connected desktop changed'), findsOneWidget);
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
    expect(find.text('Open diff'), findsOneWidget);
    scope.dispose();
  });

  testWidgets('a covered Done callback cannot dismiss another route', (
    tester,
  ) async {
    await sheetApp(tester);
    final done = tester
        .widget<TextButton>(find.widgetWithText(TextButton, 'Done'))
        .onPressed!;
    final context = tester.element(find.byType(RepositoryDiffSheet));
    showDialog<void>(
      context: context,
      builder: (_) => const AlertDialog(title: Text('Foreign review')),
    );
    await tester.pumpAndSettle();
    done();
    await tester.pumpAndSettle();
    expect(find.text('Foreign review'), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Repository Changes'), findsOneWidget);
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
    expect(find.text('Open diff'), findsOneWidget);
  });

  testWidgets('multiple synthetic hunks use source Patch N of total labels', (
    tester,
  ) async {
    await sheetApp(
      tester,
      raw: 'diff --git a/a b/a\n+first\n@@ invalid @@\n+second\n',
    );
    expect(find.text('Patch 1 of 2'), findsOneWidget);
    expect(find.text('Patch 2 of 2'), findsOneWidget);
    expect(find.text('first'), findsOneWidget);
    expect(find.text('second'), findsOneWidget);
  });
}
