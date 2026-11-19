import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_new_chat_draft_test.dart'
    show
        DraftTransport,
        draftDesktop,
        finishDraft,
        requests,
        acknowledgeOverviewSetup;
import 'desktop_root_routing_test.dart' show savedPair;

class QuickTransport extends DraftTransport {
  QuickTransport(super.pairings);
  int revision = 0;
  @override
  int get connectionRevision => revision;
}

Future<(DraftTransport, DesktopController)> quickOverview(
  WidgetTester tester,
) async {
  final remote = QuickTransport(PairingRepository(TestCredentials()));
  final desktop = await draftDesktop(remote);
  await tester.pumpWidget(MaterialApp(home: PairingPage(controller: desktop)));
  await tester.pumpAndSettle();
  acknowledgeOverviewSetup(remote);
  return (remote, desktop);
}

Future<void> quickMenu(WidgetTester tester) async {
  await tester.tap(find.byTooltip('More actions'));
  await tester.pumpAndSettle();
  expect(find.text('Quick Chat'), findsOneWidget);
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets('Quick Chat is unavailable while the desktop is disconnected', (
    tester,
  ) async {
    final (remote, desktop) = await quickOverview(tester);
    remote.online = false;
    desktop.state = 'disconnected';
    desktop.notifyListeners();
    await tester.pumpAndSettle();
    await quickMenu(tester);
    final entry = find.ancestor(
      of: find.text('Quick Chat'),
      matching: find.byType(PopupMenuItem<String>),
    );
    expect(tester.widget<PopupMenuItem<String>>(entry).enabled, isFalse);
    await tester.tap(find.text('Quick Chat'));
    await tester.pumpAndSettle();
    expect(requests(remote, 'thread/start'), isEmpty);
    expect(desktop.newChatDraft, isNull);
    await finishDraft(tester, desktop);
  });
  testWidgets(
    'Quick Chat creates one Studio chat immediately without sending or a draft',
    (tester) async {
      final (remote, desktop) = await quickOverview(tester);
      await quickMenu(tester);
      await tester.tap(find.text('Quick Chat'));
      await tester.pumpAndSettle();
      final starts = requests(remote, 'thread/start');
      expect(starts, hasLength(1));
      expect(starts.single['params'], containsPair('djlScope', 'studio'));
      expect(starts.single['params'], isNot(contains('cwd')));
      expect(requests(remote, 'turn/start'), isEmpty);
      expect(desktop.newChatDraft, isNull);
      expect(desktop.thread?['id'], 'created-1');
      expect(find.byType(DesktopChatPage), findsOneWidget);
      await finishDraft(tester, desktop);
    },
  );
  testWidgets(
    'failed Quick Chat stays on overview and an explicit retry starts once more',
    (tester) async {
      final (remote, desktop) = await quickOverview(tester);
      remote.failCreation = true;
      await quickMenu(tester);
      await tester.tap(find.text('Quick Chat'));
      await tester.pumpAndSettle();
      expect(find.byType(DesktopChatPage), findsNothing);
      expect(find.textContaining('Creation failed'), findsOneWidget);
      expect(desktop.newChatDraft, isNull);
      expect(requests(remote, 'thread/start'), hasLength(1));
      remote.failCreation = false;
      await quickMenu(tester);
      await tester.tap(find.text('Quick Chat'));
      await tester.pumpAndSettle();
      expect(requests(remote, 'thread/start'), hasLength(2));
      expect(desktop.thread?['id'], 'created-2');
      expect(requests(remote, 'turn/start'), isEmpty);
      await finishDraft(tester, desktop);
    },
  );
  testWidgets(
    'a repeated Quick Chat selection during creation does not duplicate the request',
    (tester) async {
      final (remote, desktop) = await quickOverview(tester);
      remote.creation = Completer<RemoteJson>();
      await quickMenu(tester);
      await tester.tap(find.text('Quick Chat'));
      await tester.pumpAndSettle();
      await quickMenu(tester);
      await tester.tap(find.text('Quick Chat'));
      await tester.pumpAndSettle();
      expect(requests(remote, 'thread/start'), hasLength(1));
      remote.creation!.complete({
        'thread': {'id': 'quick-created', 'cwd': '/studio'},
      });
      await tester.pumpAndSettle();
      expect(desktop.thread?['id'], 'quick-created');
      expect(find.byType(DesktopChatPage), findsOneWidget);
      await finishDraft(tester, desktop);
    },
  );
  for (final change in [
    'mac',
    'pin',
    'selection',
    'cache',
    'connection',
    'dispose',
  ]) {
    testWidgets('late Quick Chat cannot replace a changed $change owner', (
      tester,
    ) async {
      final (remote, desktop) = await quickOverview(tester);
      remote.creation = Completer<RemoteJson>();
      await quickMenu(tester);
      await tester.tap(find.text('Quick Chat'));
      await tester.pumpAndSettle();
      if (change == 'mac') desktop.active = savedPair('mac-b');
      if (change == 'pin') {
        desktop.active = Pairing({
          ...desktop.active!.data,
          'macIdentityPublicKey': 'changed-public-pin',
        });
      }
      if (change == 'selection') {
        await desktop.openThread({'id': 'other-selection'});
      }
      if (change == 'cache') await desktop.threadList.attach('another-cache');
      if (change == 'connection') (remote as QuickTransport).revision++;
      if (change == 'dispose') await tester.pumpWidget(const SizedBox.shrink());
      remote.creation!.complete({
        'thread': {'id': 'late-quick', 'cwd': '/studio'},
      });
      await tester.pumpAndSettle();
      expect(desktop.thread?['id'], isNot('late-quick'));
      expect(find.byType(DesktopChatPage), findsNothing);
      expect(requests(remote, 'thread/start'), hasLength(1));
      expect(requests(remote, 'turn/start'), isEmpty);
      expect(tester.takeException(), isNull);
      await finishDraft(tester, desktop);
    });
  }
}
