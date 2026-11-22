import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'desktop_activity_test.dart' show ActivityCacheStore;
import 'pairing_presentation_test.dart'
    show PairingWrites, ObservedPairingTransport, finish;

Future<DesktopController> mountHome(
  WidgetTester tester, {
  Size size = const Size(402, 874),
  double textScale = 1,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
  addTearDown(tester.view.reset);
  final pairs = PairingRepository(PairingWrites());
  final desktop = DesktopController(
    pairs,
    connection: ObservedPairingTransport(pairs),
    localStore: ActivityCacheStore(),
  );
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(Brightness.light),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: PairingPage(controller: desktop),
    ),
  );
  await tester.pumpAndSettle();
  return desktop;
}

void main() {
  testWidgets('the floating bar switches between Chats, Groups and Attention', (
    tester,
  ) async {
    final desktop = await mountHome(tester);
    expect(find.text('Search conversations'), findsOneWidget);
    expect(find.byTooltip('New chat'), findsOneWidget);

    await tester.tap(find.byKey(const Key('home.tab.groups')));
    await tester.pumpAndSettle();
    expect(find.text('Connect to your Mac'), findsOneWidget);
    expect(find.text('Search conversations'), findsNothing);
    expect(find.byTooltip('New group'), findsOneWidget);
    expect(find.byTooltip('New chat'), findsNothing);

    await tester.tap(find.byKey(const Key('home.tab.attention')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('home.attention')), findsOneWidget);
    expect(find.byTooltip('New group'), findsNothing);
    expect(find.byTooltip('New chat'), findsNothing);

    await tester.tap(find.byKey(const Key('home.tab.chats')));
    await tester.pumpAndSettle();
    expect(find.text('Search conversations'), findsOneWidget);
    expect(find.byTooltip('New chat'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await finish(tester, desktop);
  });

  testWidgets('the tabs report their selection to screen readers', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    final desktop = await mountHome(tester);
    expect(
      tester.getSemantics(find.byKey(const Key('home.tab.chats'))),
      matchesSemantics(
        label: 'Chats',
        isButton: true,
        isSelected: true,
        hasSelectedState: true,
        hasTapAction: true,
      ),
    );
    expect(
      tester.getSemantics(find.byKey(const Key('home.tab.groups'))),
      matchesSemantics(
        label: 'Groups',
        isButton: true,
        hasSelectedState: true,
        hasTapAction: true,
      ),
    );
    semantics.dispose();
    await finish(tester, desktop);
  });

  testWidgets('the bar fits a small phone at double text size', (tester) async {
    final desktop = await mountHome(
      tester,
      size: const Size(320, 568),
      textScale: 2,
    );
    expect(tester.takeException(), isNull);
    final chats = tester.getRect(find.byKey(const Key('home.tab.chats')));
    final chat = tester.getRect(find.byTooltip('New chat'));
    expect(chats.left, greaterThanOrEqualTo(0));
    expect(chat.right, lessThanOrEqualTo(320));
    await tester.tap(find.byKey(const Key('home.tab.attention')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await finish(tester, desktop);
  });
}
