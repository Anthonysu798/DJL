import 'dart:ui' show SemanticsAction;
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_navigation_menu.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:flutter/cupertino.dart' show CupertinoIcons;
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_phone_drawer_root_test.dart' show PhoneMemoryStore;
import 'desktop_root_routing_test.dart' show savedPair;
import 'desktop_new_chat_draft_test.dart'
    show DraftTransport, draftDesktop, finishDraft, qaModels;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final last in [false, true]) {
    testWidgets(
      'pin menu anchors to the ${last ? 'scrolled last' : 'first'} chat row',
      (tester) async {
        tester.view.physicalSize = const Size(402, 874);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final remote = DraftTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        for (var i = 1; i <= 12; i++) {
          desktop.threadList.data.upsert({
            'id': 'menu-$i',
            'title': 'Chat ${i.toString().padLeft(2, '0')}',
            'createdAt': 1700000000 - i,
          });
        }
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(Brightness.light),
            home: Scaffold(
              body: Align(
                alignment: Alignment.centerLeft,
                child: SizedBox(
                  width: 402 * .7,
                  child: DesktopNavigationMenu(
                    controller: desktop,
                    onThread: (_) {},
                    onNewChat: () {},
                    onRemote: () {},
                    isCurrent: () => true,
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final row = find.byKey(
          ValueKey('navigation.thread.menu-${last ? 12 : 1}'),
        );
        if (last) {
          await tester.scrollUntilVisible(
            row,
            200,
            scrollable: find.descendant(
              of: find.byKey(const Key('navigation.list')),
              matching: find.byType(Scrollable),
            ),
          );
          await tester.pumpAndSettle();
        }
        final anchor = tester.getRect(row);
        final calls = remote.calls.length;
        await tester.longPress(row);
        await tester.pumpAndSettle();
        final action = tester.getRect(find.text('Pin chat'));
        final distance = math.min(
          (action.top - anchor.bottom).abs(),
          (action.bottom - anchor.top).abs(),
        );
        expect(
          distance,
          lessThanOrEqualTo(40),
          reason:
              'The menu must follow the pressed row, including after scrolling.',
        );
        await tester.tapAt(const Offset(390, 400));
        await tester.pumpAndSettle();
        expect(find.text('Pin chat'), findsNothing);
        expect(
          desktop.threadList.data.isPinned('menu-${last ? 12 : 1}'),
          isFalse,
        );
        expect(remote.calls.length, calls);
        await finishDraft(tester, desktop);
      },
    );
  }
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    for (final brightness in Brightness.values) {
      testWidgets(
        'pin/unpin uses only the selected local chat on $platform $brightness',
        (tester) async {
          final f = await mountPinMenu(
            tester,
            platform: platform,
            brightness: brightness,
          );
          final calls = f.remote.calls.length;
          final row = find.byKey(const Key('navigation.thread.pin-owned'));
          await tester.longPress(row);
          await tester.pumpAndSettle();
          expect(
            tester.getSize(find.byKey(const Key('navigation.pin-menu'))),
            const Size(250, 62),
          );
          expect(find.byIcon(CupertinoIcons.pin), findsOneWidget);
          await tester.tap(find.text('Pin chat'));
          await tester.pumpAndSettle();
          expect(f.desktop.threadList.data.isPinned('pin-owned'), isTrue);
          final saved = await f.desktop.threadList.store.load(
            f.desktop.active!.macDeviceId,
          );
          expect(
            ThreadLocalState.fromJson(saved).isPinned('pin-owned'),
            isTrue,
          );
          await tester.longPress(row);
          await tester.pumpAndSettle();
          expect(find.byIcon(CupertinoIcons.pin_slash), findsOneWidget);
          await tester.tap(find.text('Unpin chat'));
          await tester.pumpAndSettle();
          expect(f.desktop.threadList.data.isPinned('pin-owned'), isFalse);
          expect(f.remote.calls.length, calls);
          await finishDraft(tester, f.desktop);
        },
      );
    }
  }
  testWidgets('dismissal and replacement owner do not pin the old chat', (
    tester,
  ) async {
    var current = true;
    final f = await mountPinMenu(tester, current: () => current);
    final row = find.byKey(const Key('navigation.thread.pin-owned'));
    await tester.longPress(row);
    await tester.pumpAndSettle();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Pin chat'), findsNothing);
    expect(f.desktop.threadList.data.isPinned('pin-owned'), isFalse);
    await tester.longPress(row);
    await tester.pumpAndSettle();
    current = false;
    await tester.tap(find.text('Pin chat'));
    await tester.pumpAndSettle();
    expect(f.desktop.threadList.data.isPinned('pin-owned'), isFalse);
    await finishDraft(tester, f.desktop);
  });
  testWidgets(
    'large text menu remains inside keyboard and physical safe insets',
    (tester) async {
      final f = await mountPinMenu(
        tester,
        size: const Size(320, 700),
        scale: 3,
        insets: const EdgeInsets.only(bottom: 240),
      );
      final row = find.byKey(const Key('navigation.thread.pin-owned'));
      final list = tester.getRect(find.byKey(const Key('navigation.list')));
      // The floating header covers the list center at 3x text; drag its
      // exposed strip above the footer, as a user would.
      for (var i = 0; i < 50 && row.hitTestable().evaluate().isEmpty; i++) {
        await tester.dragFrom(
          Offset(list.center.dx, list.bottom - 100),
          const Offset(0, -200),
        );
        await tester.pumpAndSettle();
      }
      await tester.pumpAndSettle();
      await tester.longPress(row);
      await tester.pumpAndSettle();
      final menu = tester.getRect(find.byKey(const Key('navigation.pin-menu')));
      expect(menu.left, greaterThanOrEqualTo(18));
      expect(menu.right, lessThanOrEqualTo(302));
      expect(menu.top, greaterThanOrEqualTo(42));
      expect(menu.bottom, lessThanOrEqualTo(450));
      expect(find.text('Pin chat').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tapAt(const Offset(310, 500));
      await tester.pumpAndSettle();
      expect(f.desktop.threadList.data.isPinned('pin-owned'), isFalse);
      await finishDraft(tester, f.desktop);
    },
  );
  testWidgets('drawer chat row exposes a button and long-press action', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    final f = await mountPinMenu(tester);
    try {
      final data = tester
          .getSemantics(find.byKey(const Key('navigation.thread.pin-owned')))
          .getSemanticsData();
      expect(data.flagsCollection.isButton, isTrue);
      expect(data.hasAction(SemanticsAction.longPress), isTrue);
      expect(data.identifier, 'navigation.thread.pin-owned');
    } finally {
      semantics.dispose();
      await finishDraft(tester, f.desktop);
    }
  });
}

Future<({DesktopController desktop, DraftTransport remote})> mountPinMenu(
  WidgetTester tester, {
  Brightness brightness = Brightness.light,
  TargetPlatform platform = TargetPlatform.iOS,
  Size size = const Size(402, 874),
  double scale = 1,
  EdgeInsets insets = EdgeInsets.zero,
  bool Function()? current,
  VoidCallback? onNewChat,
  String? selectedThreadId,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final remote = DraftTransport(PairingRepository(TestCredentials()));
  final pair = savedPair('mac-a');
  final desktop =
      DesktopController(
          remote.pairings,
          connection: remote,
          localStore: PhoneMemoryStore(),
        )
        ..active = pair
        ..trusted = [pair]
        ..state = 'connected'
        ..models = List.of(qaModels);
  await desktop.threadList.attach('mac-a');
  desktop.threadList.data.upsert({'id': 'pin-owned', 'title': 'Owned chat'});
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(brightness).copyWith(platform: platform),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(scale),
          viewPadding: const EdgeInsets.fromLTRB(8, 32, 8, 24),
          viewInsets: insets,
        ),
        child: child!,
      ),
      home: Scaffold(
        body: Align(
          alignment: Alignment.centerLeft,
          child: SizedBox(
            width: size.width * .7,
            child: DesktopNavigationMenu(
              controller: desktop,
              selectedThreadId: selectedThreadId,
              onThread: (_) {},
              onNewChat: onNewChat ?? () {},
              onRemote: () {},
              isCurrent: current ?? () => true,
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (desktop: desktop, remote: remote);
}
