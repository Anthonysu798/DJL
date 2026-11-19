import '../support/native_text_search.dart'
    show useAsciiNativeSearch, clearNativeSearchFixture;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_navigation_menu.dart';
import 'desktop_attention_projection_test.dart' show approval;
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, ReasoningPairings, reasoningDesktop;
import 'desktop_root_routing_test.dart' show savedPair;
import 'desktop_new_chat_draft_test.dart' show finishDraft;

Future<DesktopController> attentionDesktop(
  WidgetTester tester,
  ReasoningTransport transport,
) async {
  (transport.pairings as ReasoningPairings).pair = savedPair('mac-a');
  final desktop = await reasoningDesktop(transport);
  addTearDown(() => finishDraft(tester, desktop));
  return desktop;
}

Widget menu(
  DesktopController desktop, {
  bool Function()? owns,
  double scale = 1,
  double width = 320,
}) => MaterialApp(
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
    child: child!,
  ),
  home: Scaffold(
    body: SizedBox(
      width: width,
      child: DesktopNavigationMenu(
        controller: desktop,
        isCurrent: owns ?? () => true,
        onThread: (_) {},
        onNewChat: () {},
        onRemote: () {},
      ),
    ),
  ),
);

void main() {
  setUp(useAsciiNativeSearch);
  tearDown(clearNativeSearchFixture);
  testWidgets(
    'Attention opens a page and Back preserves the original drawer without service calls',
    (tester) async {
      final transport = ReasoningTransport();
      final desktop = await attentionDesktop(tester, transport);
      await tester.pumpWidget(menu(desktop));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Search chats'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('navigation.search')),
        'retained',
      );
      await tester.pumpAndSettle();
      final before = transport.calls.length;
      await tester.tap(find.text('Attention'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('attention.back')), findsOneWidget);
      expect(find.text("You're all caught up"), findsOneWidget);
      expect(find.text('Pinned'), findsNothing);
      await tester.enterText(
        find.byKey(const Key('attention.search')),
        'missing',
      );
      await tester.pumpAndSettle();
      expect(find.text('No matching attention items'), findsOneWidget);
      await tester.tap(find.byKey(const Key('attention.back')));
      await tester.pumpAndSettle();
      expect(find.text('Pinned'), findsOneWidget);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('navigation.search')))
            .controller!
            .text,
        'retained',
      );
      expect(transport.calls, hasLength(before));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'an actual Attention card queues the exact qualified review target without a mutation',
    (tester) async {
      final transport = ReasoningTransport();
      final desktop = await attentionDesktop(tester, transport);
      desktop.threadList.data.upsert({
        'id': 'approval',
        'name': 'Review the patch',
        'cwd': '/workspace/Alpha',
      });
      transport.events.add(approval('request', 'approval'));
      await tester.pumpWidget(menu(desktop));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Attention'));
      await tester.pumpAndSettle();
      expect(find.text('NEEDS YOU'), findsOneWidget);
      expect(find.text('Approval needed'), findsOneWidget);
      expect(find.text('Review the patch'), findsOneWidget);
      final before = transport.calls.length;
      final sentBefore = transport.sent.length;
      await tester.ensureVisible(find.text('Approval needed'));
      await tester.tap(find.text('Approval needed'));
      await tester.pumpAndSettle();
      expect(desktop.navigationTarget?.thread, 'approval');
      expect(desktop.navigationTarget?.turn, 'approval-turn');
      expect(desktop.navigationTarget?.item, 'approval-item');
      expect(desktop.navigationTarget?.request, 'request');
      expect(desktop.navigationTarget?.qualified, isTrue);
      expect(transport.calls, hasLength(before));
      expect(transport.sent, hasLength(sentBefore));
      expect(tester.takeException(), isNull);
    },
  );

  for (final resolved in [true, false]) {
    testWidgets(
      'captured Attention callback ignores ${resolved ? 'resolved request' : 'replaced cache'}',
      (tester) async {
        final transport = ReasoningTransport();
        final desktop = await attentionDesktop(tester, transport);
        desktop.threadList.data.upsert({'id': 'approval'});
        transport.events.add(approval('request', 'approval'));
        await tester.pumpWidget(menu(desktop));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Attention'));
        await tester.pumpAndSettle();
        final card = find
            .ancestor(
              of: find.text('Approval needed'),
              matching: find.byType(TextButton),
            )
            .first;
        final callback = tester.widget<TextButton>(card).onPressed!;
        if (resolved) {
          transport.events.add({
            'method': 'serverRequest/resolved',
            'params': {'requestId': 'request'},
          });
        } else {
          await desktop.threadList.attach('different-mac');
        }
        await tester.pumpAndSettle();
        final before = transport.calls.length;
        final sentBefore = transport.sent.length;
        callback();
        await tester.pumpAndSettle();
        expect(desktop.navigationTarget, isNull);
        expect(transport.calls, hasLength(before));
        expect(transport.sent, hasLength(sentBefore));
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final dismissed in [true, false]) {
    testWidgets(
      'Attention callback ignores a ${dismissed ? 'dismissed' : 'covered'} page',
      (tester) async {
        final transport = ReasoningTransport();
        final desktop = await attentionDesktop(tester, transport);
        desktop.threadList.data.upsert({'id': 'approval'});
        transport.events.add(approval('request', 'approval'));
        await tester.pumpWidget(menu(desktop));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Attention'));
        await tester.pumpAndSettle();
        final card = find
            .ancestor(
              of: find.text('Approval needed'),
              matching: find.byType(TextButton),
            )
            .first;
        final callback = tester.widget<TextButton>(card).onPressed!;
        if (dismissed) {
          await tester.tap(find.byKey(const Key('attention.back')));
        } else {
          Navigator.of(tester.element(card)).push(
            MaterialPageRoute<void>(
              builder: (_) => const Scaffold(body: Text('Other page')),
            ),
          );
        }
        await tester.pumpAndSettle();
        final before = transport.calls.length,
            sentBefore = transport.sent.length;
        callback();
        await tester.pumpAndSettle();
        expect(desktop.navigationTarget, isNull);
        expect(transport.calls, hasLength(before));
        expect(transport.sent, hasLength(sentBefore));
        expect(find.text(dismissed ? 'Pinned' : 'Other page'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('Attention remains scroll-safe at narrow width and 3x text', (
    tester,
  ) async {
    final transport = ReasoningTransport();
    final desktop = await attentionDesktop(tester, transport);
    tester.view.physicalSize = const Size(224, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(menu(desktop, scale: 3, width: 224));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('Attention'),
      200,
      scrollable: find
          .descendant(
            of: find.byKey(const Key('navigation.list')),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Attention'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text("You're all caught up"),
      200,
      scrollable: find
          .descendant(
            of: find.byKey(const Key('attention.list')),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    expect(find.text("You're all caught up"), findsOneWidget);
    expect(find.byKey(const Key('attention.back')), findsOneWidget);
    await tester.tap(find.byKey(const Key('attention.back')));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Settings'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
