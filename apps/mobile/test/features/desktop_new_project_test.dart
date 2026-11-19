import 'dart:async';
import 'package:flutter/material.dart' show BottomSheet;
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/workspace/presentation/project_picker_page.dart';
import 'desktop_new_chat_draft_test.dart'
    show finishDraft, requests, projectPath;
import 'desktop_quick_chat_test.dart' show quickOverview, QuickTransport;
import 'desktop_root_routing_test.dart' show savedPair;

Future<void> newProject(WidgetTester tester) async {
  await tester.tap(find.byTooltip('More actions'));
  await tester.pumpAndSettle();
  expect(find.text('New Project'), findsOneWidget);
  expect(find.text('New chat in a project'), findsNothing);
  await tester.tap(find.text('New Project'));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets(
    'New Project selects a folder then creates one saved project chat without sending',
    (tester) async {
      final (remote, desktop) = await quickOverview(tester);
      await newProject(tester);
      expect(find.byType(ProjectPickerPage), findsOneWidget);
      expect(find.byType(BottomSheet), findsOneWidget);
      expect(desktop.newChatDraft, isNull);
      expect(requests(remote, 'thread/start'), isEmpty);
      await tester.tap(find.text('Use'));
      await tester.pumpAndSettle();
      expect(find.byType(DesktopChatPage), findsOneWidget);
      expect(desktop.newChatDraft, isNull);
      expect(desktop.thread?['id'], 'created-1');
      expect(desktop.thread?['cwd'], projectPath);
      final starts = requests(remote, 'thread/start');
      expect(starts, hasLength(1));
      expect(starts.single['params'], containsPair('cwd', projectPath));
      expect(starts.single['params'], containsPair('djlScope', 'project'));
      expect(requests(remote, 'turn/start'), isEmpty);
      await finishDraft(tester, desktop);
    },
  );
  testWidgets(
    'New Project Cancel keeps the existing selection and creates nothing',
    (tester) async {
      final (remote, desktop) = await quickOverview(tester);
      desktop.thread = {'id': 'retained', 'cwd': projectPath};
      await newProject(tester);
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
      expect(desktop.thread?['id'], 'retained');
      expect(desktop.newChatDraft, isNull);
      expect(requests(remote, 'thread/start'), isEmpty);
      expect(find.byType(DesktopChatPage), findsNothing);
      await finishDraft(tester, desktop);
    },
  );
  testWidgets(
    'New Project error stays on overview and can be explicitly retried',
    (tester) async {
      final (remote, desktop) = await quickOverview(tester);
      remote.failCreation = true;
      await newProject(tester);
      await tester.tap(find.text('Use'));
      await tester.pumpAndSettle();
      expect(find.byType(DesktopChatPage), findsNothing);
      expect(find.textContaining('Creation failed'), findsOneWidget);
      expect(desktop.newChatDraft, isNull);
      expect(requests(remote, 'thread/start'), hasLength(1));
      remote.failCreation = false;
      await newProject(tester);
      await tester.tap(find.text('Use'));
      await tester.pumpAndSettle();
      expect(requests(remote, 'thread/start'), hasLength(2));
      expect(desktop.thread?['id'], 'created-2');
      expect(requests(remote, 'turn/start'), isEmpty);
      await finishDraft(tester, desktop);
    },
  );
  for (final change in ['mac', 'pin', 'selection', 'cache', 'connection']) {
    testWidgets(
      'New Project refuses a folder result after $change ownership changes',
      (tester) async {
        final (remote, desktop) = await quickOverview(tester);
        await newProject(tester);
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
        if (change == 'cache') {
          await desktop.threadList.attach('another-cache');
        }
        if (change == 'connection') {
          (remote as QuickTransport).revision++;
        }
        await tester.tap(find.text('Use'));
        await tester.pumpAndSettle();
        expect(requests(remote, 'thread/start'), isEmpty);
        expect(find.byType(DesktopChatPage), findsNothing);
        expect(desktop.newChatDraft, isNull);
        expect(tester.takeException(), isNull);
        await finishDraft(tester, desktop);
      },
    );
  }
  testWidgets(
    'New Project cannot reopen its picker or create twice during a held start',
    (tester) async {
      final (remote, desktop) = await quickOverview(tester);
      remote.creation = Completer<RemoteJson>();
      await newProject(tester);
      await tester.tap(find.text('Use'));
      await tester.pumpAndSettle();
      await newProject(tester);
      expect(find.byType(ProjectPickerPage), findsNothing);
      expect(requests(remote, 'thread/start'), hasLength(1));
      remote.creation!.complete({
        'thread': {'id': 'project-created', 'cwd': projectPath},
      });
      await tester.pumpAndSettle();
      expect(desktop.thread?['id'], 'project-created');
      expect(find.byType(DesktopChatPage), findsOneWidget);
      await finishDraft(tester, desktop);
    },
  );
}
