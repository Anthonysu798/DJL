import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/design/djl_icons.dart';
import 'package:djl_mobile/core/design/djl_tokens.dart';
import 'package:djl_mobile/core/presentation/djl_glass_menu.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final picks = <String?>[];

  Future<void> open(WidgetTester tester, Brightness brightness) async {
    picks.clear();
    await tester.pumpWidget(
      MaterialApp(
        theme: djlTheme(brightness),
        home: Scaffold(
          body: Align(
            alignment: Alignment.topRight,
            child: Builder(
              builder: (context) => IconButton(
                tooltip: 'More',
                icon: const Icon(DjlIcons.more),
                onPressed: () async {
                  final box = context.findRenderObject()! as RenderBox;
                  final picked = await showDjlGlassMenu<String>(
                    context,
                    anchor: box.localToGlobal(Offset.zero) & box.size,
                    sections: const [
                      [
                        DjlMenuItem('chat', 'New Chat', DjlIcons.compose),
                        DjlMenuItem(
                          'project',
                          'New Project',
                          DjlIcons.folderAdd,
                          enabled: false,
                        ),
                      ],
                      [],
                      [
                        DjlMenuItem(
                          'disconnect',
                          'Disconnect',
                          DjlIcons.power,
                          destructive: true,
                        ),
                      ],
                    ],
                  );
                  picks.add(picked);
                },
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.byTooltip('More'));
    await tester.pumpAndSettle();
  }

  testWidgets('a picked row closes the menu and returns its value', (
    tester,
  ) async {
    await open(tester, Brightness.light);
    expect(find.text('New Chat'), findsOneWidget);
    await tester.tap(find.text('Disconnect'));
    await tester.pumpAndSettle();
    expect(find.text('New Chat'), findsNothing);
    expect(picks, ['disconnect']);
  });

  testWidgets('disabled rows ignore taps and destructive rows are red', (
    tester,
  ) async {
    await open(tester, Brightness.dark);
    await tester.tap(find.text('New Project'));
    await tester.pumpAndSettle();
    expect(find.text('New Project'), findsOneWidget);
    expect(picks, isEmpty);
    final red = tester.widget<Text>(find.text('Disconnect'));
    expect(red.style?.color, DjlColors.dark.danger);
    final faint = tester.widget<Text>(find.text('New Project'));
    expect(faint.style?.color, DjlColors.dark.inkFaint);
  });

  testWidgets('the menu stays inside a narrow screen', (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await open(tester, Brightness.light);
    final rect = tester.getRect(find.byType(Column).last);
    expect(rect.left, greaterThanOrEqualTo(0));
    expect(rect.right, lessThanOrEqualTo(320));
  });
}
