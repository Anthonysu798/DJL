import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_composer_fidelity_test.dart' show AccessTransport;
import 'desktop_new_chat_draft_test.dart' show draftDesktop, finishDraft;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
    'access opens source rows separately without changing the draft',
    (tester) async {
      final remote = AccessTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.model = 'qa';
      desktop.thread = {'id': 'access-popover'};
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Keep my draft',
      );
      await tester.pumpAndSettle();
      final editable = tester.state<EditableTextState>(
        find.byType(EditableText),
      );
      final selection = editable.widget.controller.selection;
      remote.calls.clear();
      await tester.tap(find.byKey(const Key('composer.access')));
      await tester.pumpAndSettle();
      expect(find.text('Ask for approval'), findsWidgets);
      expect(
        find.text('Always ask to edit external files and use the internet'),
        findsOneWidget,
      );
      expect(
        find.text('Only ask for actions detected as potentially unsafe'),
        findsOneWidget,
      );
      expect(find.text('Full computer access (elevated risk)'), findsOneWidget);
      expect(find.byKey(const Key('desktop_runtime_model')), findsNothing);
      expect(
        tester.getSize(find.byKey(const Key('composer.access.popover'))).width,
        312,
      );
      expect(
        tester.getTopLeft(find.byKey(const Key('composer.access.popover'))).dx,
        10,
      );
      Navigator.of(tester.element(find.text('Full access'))).pop();
      await tester.pumpAndSettle();
      expect(editable.widget.controller.text, 'Keep my draft');
      expect(editable.widget.controller.selection, selection);
      expect(editable.widget.focusNode.hasFocus, isTrue);
      expect(remote.calls, isEmpty);
      await tester.tap(find.byTooltip('Chat controls'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('desktop_runtime_model')), findsOneWidget);
      expect(find.text('Approval mode'), findsNothing);
      await finishDraft(tester, desktop);
    },
  );

  for (final stale in [false, true]) {
    testWidgets(
      'full access confirmation ${stale ? 'rejects replaced owner' : 'can be canceled'}',
      (tester) async {
        final remote = AccessTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        await desktop.connect(desktop.active!, resolve: false);
        desktop.thread = {'id': 'access-owner'};
        await tester.pumpWidget(
          MaterialApp(home: DesktopChatPage(controller: desktop)),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('desktop_composer')));
        await tester.pumpAndSettle();
        remote.calls.clear();
        final original = desktop.access;
        await tester.tap(find.byKey(const Key('composer.access')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Full access'));
        await tester.pumpAndSettle();
        expect(find.text('Allow full desktop access?'), findsOneWidget);
        expect(remote.calls, isEmpty);
        if (stale) {
          desktop.thread = {'id': 'replacement'};
          desktop.threadList.filter(search: '');
          await tester.pump();
        }
        await tester.tap(find.text(stale ? 'Allow full access' : 'Cancel'));
        await tester.pumpAndSettle();
        expect(desktop.access, original);
        expect(
          remote.calls.where(
            (v) => v['method'] == 'djl/thread/runtimeMode/set',
          ),
          isEmpty,
        );
        await finishDraft(tester, desktop);
      },
    );
  }

  for (final stale in ['covered', 'dismissed', 'pin', 'thread']) {
    testWidgets('captured access choice ignores $stale menu', (tester) async {
      final remote = AccessTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'access-owner'};
      final navigator = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: navigator,
          home: DesktopChatPage(controller: desktop),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('desktop_composer')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('composer.access')));
      await tester.pumpAndSettle();
      final captured = tester
          .widget<TextButton>(
            find.byKey(const Key('composer.access.auto-review')),
          )
          .onPressed!;
      final original = desktop.access;
      if (stale == 'covered') {
        navigator.currentState!.push(
          MaterialPageRoute<void>(
            builder: (_) => const Scaffold(body: Text('Cover')),
          ),
        );
      } else if (stale == 'dismissed') {
        navigator.currentState!.pop();
      } else if (stale == 'pin') {
        desktop.active = Pairing({
          ...desktop.active!.data,
          'macIdentityPublicKey': 'replacement-pin',
        });
      } else {
        desktop.thread = {'id': 'replacement'};
      }
      await tester.pumpAndSettle();
      remote.calls.clear();
      captured();
      await tester.pumpAndSettle();
      if (stale == 'covered') expect(find.text('Cover'), findsOneWidget);
      expect(desktop.access, original);
      expect(remote.calls, isEmpty);
      await finishDraft(tester, desktop);
    });
  }

  testWidgets('access remains scrollable above changing keyboard at 3x text', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(360, 800);
    tester.view.padding = const FakeViewPadding(top: 24);
    tester.view.viewPadding = const FakeViewPadding(top: 24, bottom: 24);
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    addTearDown(tester.view.reset);
    final remote = AccessTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    desktop.thread = {'id': 'access-layout'};
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(3)),
          child: child!,
        ),
        home: DesktopChatPage(controller: desktop),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('desktop_composer')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('composer.access')));
    await tester.pumpAndSettle();
    for (final configuration in [
      (const Size(360, 800), 300.0),
      (const Size(640, 480), 120.0),
      (const Size(411, 923), 0.0),
    ]) {
      tester.view.physicalSize = configuration.$1;
      tester.view.viewInsets = FakeViewPadding(bottom: configuration.$2);
      await tester.pumpAndSettle();
      final full = find.text('Full access');
      await tester.ensureVisible(full);
      await tester.pumpAndSettle();
      final popup = tester.getRect(
        find.byKey(const Key('composer.access.popover')),
      );
      expect(popup.top, greaterThanOrEqualTo(34));
      expect(
        popup.bottom,
        lessThanOrEqualTo(configuration.$1.height - configuration.$2),
      );
      expect(popup.left, greaterThanOrEqualTo(10));
      expect(popup.right, lessThanOrEqualTo(configuration.$1.width - 10));
      expect(full.hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
    await finishDraft(tester, desktop);
  });
}
