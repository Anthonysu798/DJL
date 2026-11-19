import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_new_chat_draft_test.dart'
    show draftDesktop, finishDraft, requests, acknowledgeOverviewSetup;
import 'desktop_overview_test.dart' show OverviewTransport;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final entry in ['menu', 'Projects', 'Studio']) {
    testWidgets(
      '$entry New Chat uses the source folder default without creating a thread',
      (tester) async {
        final remote = OverviewTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        for (final row in <RemoteJson>[
          {
            'id': 'old',
            'name': 'Pinned older project',
            'cwd': '/work/Older',
            'updatedAt': 1,
          },
          {
            'id': 'recent',
            'name': 'Latest live project',
            'cwd': '/work/Exact opaque folder',
            'updatedAt': 20,
          },
          {
            'id': 'archived',
            'name': 'Archived project',
            'cwd': '/work/Archived',
            'updatedAt': 50,
          },
          {
            'id': 'deleted',
            'name': 'Removed project',
            'cwd': '/work/Deleted',
            'updatedAt': 60,
          },
          {
            'id': 'studio',
            'name': 'Newer Studio',
            'cwd': '/custom/chats/one',
            'updatedAt': 70,
          },
        ]) {
          desktop.threadList.data.upsert(row);
        }
        desktop.threadList.data.pinned.add('old');
        desktop.threadList.data.archive('archived', true);
        desktop.threadList.data.deleted.add('deleted');
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: desktop)),
        );
        await tester.pumpAndSettle();
        acknowledgeOverviewSetup(remote);
        if (entry == 'Projects') {
          await tester.tap(find.text('Projects'));
          await tester.pumpAndSettle();
        }
        await tester.enterText(
          find.widgetWithText(TextField, 'Search conversations'),
          'Pinned older',
        );
        await tester.pumpAndSettle();
        final before = List.of(remote.calls);
        if (entry == 'menu') {
          await tester.tap(find.byTooltip('More actions'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('New Chat'));
        } else {
          await tester.tap(find.bySemanticsLabel('New chat'));
        }
        await tester.pumpAndSettle();
        expect(
          desktop.newChatDraft?.cwd,
          entry == 'Studio' ? null : '/work/Exact opaque folder',
        );
        expect(desktop.newChatDraft?.source, DesktopDraftSource.generalChat);
        expect(remote.calls, before);
        expect(requests(remote, 'thread/start'), isEmpty);
        expect(requests(remote, 'turn/start'), isEmpty);
        await finishDraft(tester, desktop);
      },
    );
  }
}
