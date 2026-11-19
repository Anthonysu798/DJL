import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:djl_mobile/main.dart' as application;
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/goals/domain/thread_goal.dart';
import 'package:djl_mobile/features/goals/presentation/goal_page.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/features/workspace/presentation/project_picker_page.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_overview.dart';
import 'package:djl_mobile/core/design/djl_icons.dart';
import 'cloud_test.dart' show waitFor;

Future<void> type(WidgetTester tester, Finder field, String value) async {
  await reveal(tester, field);
  await tester.tap(field);
  await tester.pumpAndSettle();
  await tester.enterText(field, value);
  await tester.pumpAndSettle();
  expect(tester.widget<TextField>(field).controller!.text, value);
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
}

Future<void> tool(WidgetTester tester, String label) async {
  await tester.tap(find.byTooltip('Workspace tools'));
  await tester.pumpAndSettle();
  await reveal(tester, find.text(label));
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

Future<DesktopController> macs(WidgetTester tester) async {
  await waitFor(
    tester,
    () =>
        find.byType(PairingPage).evaluate().isNotEmpty ||
        find.text('Pair with a Mac').evaluate().isNotEmpty ||
        find.byTooltip('Settings').evaluate().isNotEmpty ||
        find.byTooltip('Open navigation').hitTestable().evaluate().isNotEmpty,
  );
  if (find.byType(PairingPage).evaluate().isNotEmpty) {
    return tester.widget<PairingPage>(find.byType(PairingPage)).controller;
  }
  if (find.byTooltip('Settings').evaluate().isNotEmpty) {
    await tester.tap(find.byTooltip('Settings'));
    await tester.pumpAndSettle();
    await reveal(
      tester,
      find.textContaining(RegExp(r'^(My Macs|Remote access)$')),
    );
    await tester.tap(find.textContaining(RegExp(r'^(My Macs|Remote access)$')));
  } else if (find
      .byTooltip('Open navigation')
      .hitTestable()
      .evaluate()
      .isNotEmpty) {
    await tester.tap(find.byTooltip('Open navigation').hitTestable());
    await tester.pumpAndSettle();
    final remote = find.text('Remote').hitTestable();
    await waitFor(tester, () => remote.evaluate().isNotEmpty);
    await tester.tap(remote);
  } else {
    await tester.tap(find.text('Pair with a Mac'));
  }
  await waitFor(tester, () => find.byType(PairingPage).evaluate().isNotEmpty);
  return tester.widget<PairingPage>(find.byType(PairingPage)).controller;
}

// Explicit secondary entry: generic reveal remains a scroll-only helper.
Future<DesktopController> securePairingEntry(WidgetTester tester) async {
  final desktop = await macs(tester);
  if (desktop.connected) {
    final pair = desktop.active;
    expect(
      pair != null &&
          pair.macDeviceId.startsWith('desktop-qa-') &&
          {
            'localhost',
            '127.0.0.1',
            '10.0.2.2',
            '::1',
          }.contains(pair.relay.host),
      isTrue,
      reason:
          'Native pairing preflight may disconnect only a local desktop QA fixture.',
    );
    await overviewAction(tester, 'Disconnect desktop');
  }
  await waitFor(tester, () => desktop.canEnterManualPairing);
  await tester.tap(find.byTooltip('More actions'));
  await tester.pumpAndSettle();
  final entry = find.text('Secure pairing details');
  await reveal(tester, entry);
  await tester.tap(entry);
  await waitFor(tester, () {
    final field = find.byKey(const Key('pairing_payload'));
    return field.hitTestable().evaluate().length == 1 &&
        tester.widget<TextField>(field).enabled != false;
  });
  return desktop;
}

Future<Map<String, dynamic>> state() async =>
    jsonDecode(
          (await http.get(Uri.parse('http://127.0.0.1:8852/qa/state'))).body,
        )
        as Map<String, dynamic>;
Future<void> reveal(WidgetTester tester, Finder finder) async {
  if (finder.evaluate().isEmpty) {
    final page = find
        .byWidgetPredicate(
          (widget) =>
              widget is ScrollView && widget.scrollDirection == Axis.vertical,
        )
        .last;
    final scrollable = find
        .descendant(of: page, matching: find.byType(Scrollable))
        .first;
    expect(scrollable.evaluate().length, 1);
    try {
      await tester.scrollUntilVisible(
        finder,
        -400,
        scrollable: scrollable,
        maxScrolls: 50,
      );
    } on StateError catch (error) {
      if (error.message != 'No element' ||
          finder.evaluate().isNotEmpty ||
          scrollable.evaluate().length != 1) {
        rethrow;
      }
      // Retrace the reverse pass and retain the original forward search range.
      await tester.scrollUntilVisible(
        finder,
        400,
        scrollable: scrollable,
        maxScrolls: 100,
      );
    }
  }
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
}

Future<void> overviewAction(WidgetTester tester, String label) async {
  await reveal(tester, find.byTooltip('More actions'));
  await tester.tap(find.byTooltip('More actions'));
  await tester.pumpAndSettle();
  await reveal(tester, find.text(label));
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

// Folder drafts belong to the existing project's compose control. New Project
// creates a saved conversation immediately.
Future<void> projectDraftPicker(WidgetTester tester, String cwd) async {
  expect(cwd, isNotEmpty);
  await reveal(tester, find.text('Projects'));
  await tester.tap(find.text('Projects'));
  await tester.pumpAndSettle();
  final folder = desktopConversationPathLabel(cwd);
  final compose = find.byTooltip('New chat in $folder');
  await reveal(tester, compose);
  await tester.tap(compose);
  await waitFor(
    tester,
    () => find.byType(DesktopChatPage).evaluate().isNotEmpty,
  );
  final title = find.bySemanticsLabel('New thread, $folder');
  await reveal(tester, title);
  await tester.tap(title);
  await waitFor(
    tester,
    () => find.byType(ProjectPickerPage).evaluate().isNotEmpty,
  );
}

Future<Finder> overviewThread(
  WidgetTester tester,
  DesktopController desktop,
  String id,
) async {
  final thread = desktop.threadList.data.find(id)!;
  final folder = desktopConversationFolder(
    thread,
    projectlessRoots: desktop.threadList.data.projectlessChatRoots,
  );
  final studio =
      thread['djlScope'] == 'studio' ||
      thread['djlScope'] != 'project' && folder == null;
  final scope = find.text(studio ? 'Studio' : 'Projects');
  await reveal(tester, scope);
  await tester.tap(scope);
  await tester.pumpAndSettle();
  if (!studio && !desktop.threadList.data.isPinned(id)) {
    final path = desktopConversationPath(thread['cwd']);
    final key = 'project:${path ?? ''}';
    if (desktop.threadList.data.overviewCollapsedProjects.contains(key)) {
      final expand = find.bySemanticsLabel(
        'Expand project ${folder ?? 'No Project'}',
      );
      await reveal(tester, expand);
      await tester.tap(expand);
      await tester.pumpAndSettle();
    }
  }
  final parents = <Map<String, dynamic>>[], visited = <String>{id};
  var parentId = thread['parentThreadId'];
  while (parentId is String && visited.add(parentId)) {
    final parent = desktop.threadList.data.find(parentId);
    if (parent == null) {
      break;
    }
    parents.insert(0, parent);
    parentId = parent['parentThreadId'];
  }
  for (final parent in parents) {
    await reveal(
      tester,
      find.byKey(ValueKey('desktop.thread.${parent['id']}')),
    );
    final expand = find.byTooltip(
      'Expand child chats for ${desktop.titleOf(parent)}',
    );
    if (expand.evaluate().isNotEmpty) {
      await reveal(tester, expand);
      await tester.tap(expand);
      await tester.pumpAndSettle();
    }
  }
  final row = find.byKey(ValueKey('desktop.thread.$id'));
  await reveal(tester, row);
  return row;
}

Future<void> selectChat(
  WidgetTester tester,
  DesktopController desktop,
  String id,
) async {
  await waitFor(tester, () => desktop.threads.any((t) => t['id'] == id));
  await tester.tap(await overviewThread(tester, desktop, id));
  await waitFor(
    tester,
    () =>
        find.byType(DesktopChatPage).evaluate().isNotEmpty &&
        desktop.thread?['id'] == id,
  );
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  const restoreOnly = bool.fromEnvironment('DJL_QA_RESTORE_ONLY');
  testWidgets(
    restoreOnly
        ? 'native cold-process encrypted history/draft restore and trusted reconnect'
        : 'native chat rename/pin/archive/fork and goal lifecycle',
    (tester) async {
      application.main();
      if (Platform.isAndroid) {
        await binding.convertFlutterSurfaceToImage();
      }
      if (restoreOnly) {
        final response = await http.get(
          Uri.parse(
            'http://127.0.0.1:8852/qa/restore-fixture?platform=${Platform.operatingSystem}',
          ),
        );
        final expected = jsonDecode(response.body) as Map<String, dynamic>;
        final desktop = await macs(tester);
        await waitFor(
          tester,
          () =>
              desktop.active?.macDeviceId == expected['macDeviceId'] &&
              desktop.threads.any((t) => t['id'] == expected['threadId']),
        );
        expect(desktop.connected, isFalse);
        expect(desktop.threadList.data.pinned, contains(expected['threadId']));
        expect(
          desktop.threadList.data.deleted,
          contains(expected['removedThreadId']),
        );
        await selectChat(tester, desktop, expected['threadId'] as String);
        expect(
          desktop.timeline.any(
            (item) =>
                item['text']?.toString().contains(
                  'Saved native conversation history',
                ) ==
                true,
          ),
          isTrue,
        );
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('desktop_composer')))
              .controller!
              .text,
          expected['draft'],
        );
        expect(
          tester
              .widget<IconButton>(
                find.widgetWithIcon(IconButton, DjlIcons.arrowUp),
              )
              .onPressed,
          isNull,
        );
        await binding.takeScreenshot('threads-cold-offline-history');
        final before = await state();
        expect(before['turnStartCount'], expected['turnStartCount']);
        await tester.tap(find.text('Reconnect'));
        await waitFor(tester, () => desktop.runtimeReady);
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('desktop_composer')))
              .controller!
              .text,
          expected['draft'],
        );
        expect((await state())['turnStartCount'], before['turnStartCount']);
        await binding.takeScreenshot('threads-cold-reconnected');
        desktop.threadList.data.drafts.remove(expected['threadId']);
        await desktop.threadList.saveNow();
        await desktop.forget(desktop.active!);
        expect(tester.takeException(), isNull);
        return;
      }
      final desktop = await macs(tester);
      final expectedPair =
          jsonDecode(
                utf8.decode(
                  base64Decode(
                    const String.fromEnvironment('DJL_QA_PAIRING_BASE64'),
                  ),
                ),
              )
              as Map<String, dynamic>;
      final freshPair =
          jsonDecode(
                (await http.get(
                  Uri.parse('http://127.0.0.1:8852/qa/pairing'),
                )).body,
              )
              as Map<String, dynamic>;
      expect(freshPair['macDeviceId'], expectedPair['macDeviceId']);
      expect(
        freshPair['macIdentityPublicKey'],
        expectedPair['macIdentityPublicKey'],
      );
      final payload = jsonEncode(freshPair);
      const cwd = String.fromEnvironment('DJL_QA_DESKTOP_CWD');
      await desktop.restore();
      for (final pairing in List.of(desktop.trusted)) {
        if (pairing.macDeviceId == expectedPair['macDeviceId']) {
          await desktop.forget(pairing);
        }
      }
      await tester.pumpAndSettle();
      expect(await securePairingEntry(tester), same(desktop));
      await type(tester, find.byKey(const Key('pairing_payload')), payload);
      await reveal(tester, find.text('Pair securely'));
      await tester.tap(find.text('Pair securely'));
      await waitFor(
        tester,
        () => desktop.runtimeReady && desktop.models.isNotEmpty,
      );
      await projectDraftPicker(tester, cwd);
      await waitFor(
        tester,
        () =>
            find.byType(ProjectPickerPage).evaluate().isNotEmpty &&
            find.text(cwd).evaluate().isNotEmpty,
      );
      await tester.tap(find.text('Use'));
      await waitFor(
        tester,
        () =>
            find.byType(DesktopChatPage).evaluate().isNotEmpty &&
            desktop.newChatDraft?.cwd == cwd &&
            desktop.thread == null,
      );
      expect(desktop.newChatDraft?.source.name, 'folderChat');
      final title =
          'Native history ${Platform.operatingSystem} ${DateTime.now().millisecondsSinceEpoch}';
      await type(
        tester,
        find.byKey(const Key('desktop_composer')),
        '[echo] $title',
      );
      await tester.tap(find.byTooltip('Send to desktop'));
      await waitFor(
        tester,
        () =>
            desktop.turnId == null &&
            desktop.timeline.any(
              (i) =>
                  i['text']?.toString().contains(
                    'Saved native conversation history',
                  ) ==
                  true,
            ),
      );
      expect(desktop.thread?['cwd'], cwd);
      final originalId = desktop.thread!['id'] as String;
      expect(originalId, isNotEmpty);
      await tool(tester, 'Rename chat');
      await type(tester, find.byKey(const Key('desktop_chat_name')), title);
      await tester.tap(find.text('Save name'));
      await waitFor(tester, () => desktop.titleOf(desktop.thread!) == title);
      final backend = await desktop.transport.request('thread/read', {
        'threadId': originalId,
        'includeTurns': false,
      });
      expect((backend['thread'] as Map)['name'], title);
      await tool(tester, 'Pin chat');
      await waitFor(tester, () => desktop.threadList.data.isPinned(originalId));
      await binding.takeScreenshot('threads-renamed-pinned');
      final objective =
          'Complete native goal acceptance ${Platform.operatingSystem}';
      await type(
        tester,
        find.byKey(const Key('desktop_composer')),
        '/goal $objective',
      );
      await tester.tap(find.byTooltip('Send to desktop'));
      await waitFor(tester, () => find.byType(GoalPage).evaluate().isNotEmpty);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('goal_objective')))
            .controller!
            .text,
        objective,
      );
      await type(tester, find.byKey(const Key('goal_budget')), '20000');
      await reveal(tester, find.text('Start goal'));
      await tester.tap(find.text('Start goal'));
      final goalController = tester
          .widget<GoalPage>(find.byType(GoalPage))
          .controller;
      await waitFor(
        tester,
        () =>
            !goalController.busy &&
            goalController.goal?.status == GoalStatus.active,
      );
      expect(goalController.goal?.tokenBudget, 20000);
      await reveal(tester, find.text('Pause goal'));
      await tester.tap(find.text('Pause goal'));
      await waitFor(
        tester,
        () =>
            !goalController.busy &&
            goalController.goal?.status == GoalStatus.paused,
      );
      expect(goalController.goal?.tokenBudget, 20000);
      await binding.takeScreenshot('threads-goal-paused');
      await tester.tap(find.text('Edit objective'));
      await tester.pumpAndSettle();
      await type(
        tester,
        find.byKey(const Key('goal_objective')),
        'Refined $objective',
      );
      await type(tester, find.byKey(const Key('goal_budget')), '');
      await reveal(tester, find.text('Save goal'));
      await tester.tap(find.text('Save goal'));
      await waitFor(
        tester,
        () =>
            !goalController.busy &&
            goalController.goal?.objective == 'Refined $objective',
      );
      expect(goalController.goal?.status, GoalStatus.paused);
      expect(goalController.goal?.tokenBudget, isNull);
      await tester.tap(find.text('Resume goal'));
      await waitFor(
        tester,
        () =>
            !goalController.busy &&
            goalController.goal?.status == GoalStatus.active,
      );
      await reveal(tester, find.text('Clear goal'));
      await tester.tap(find.text('Clear goal'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(goalController.goal, isNotNull);
      await tester.tap(find.text('Clear goal'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Clear goal'));
      await waitFor(
        tester,
        () => !goalController.busy && goalController.goal == null,
      );
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        isEmpty,
      );
      final draft = 'Unsent private draft ${Platform.operatingSystem}';
      await type(tester, find.byKey(const Key('desktop_composer')), draft);
      await tool(tester, 'Fork this chat');
      await waitFor(
        tester,
        () => desktop.thread?['id'] != originalId && !desktop.busy,
      );
      final firstFork = desktop.thread!['id'] as String;
      expect(desktop.thread?['forkedFromThreadId'], originalId);
      expect(
        desktop.timeline.any(
          (i) =>
              i['text']?.toString().contains(
                'Saved native conversation history',
              ) ==
              true,
        ),
        isTrue,
      );
      expect(desktop.threadList.data.isPinned(firstFork), isFalse);
      await binding.takeScreenshot('threads-fork-history');
      await tool(tester, 'Fork into another folder');
      await waitFor(
        tester,
        () =>
            find.byType(ProjectPickerPage).evaluate().isNotEmpty &&
            find.text('fork-target').evaluate().isNotEmpty,
      );
      await tester.tap(find.text('fork-target'));
      await waitFor(
        tester,
        () => find.text('$cwd/fork-target').evaluate().isNotEmpty,
      );
      await tester.tap(find.text('Use'));
      await waitFor(
        tester,
        () =>
            desktop.thread?['id'] != firstFork &&
            !desktop.busy &&
            desktop.thread?['cwd'] == '$cwd/fork-target',
      );
      final removedId = desktop.thread!['id'] as String;
      expect(desktop.thread?['forkedFromThreadId'], firstFork);
      await tool(tester, 'Archive chat');
      await waitFor(
        tester,
        () =>
            find.byType(PairingPage).evaluate().isNotEmpty &&
            desktop.threadList.data.isArchived(removedId),
      );
      expect(desktop.threadList.data.isPinned(originalId), isTrue);
      await overviewAction(tester, 'Show archived desktop chats');
      final row = await overviewThread(tester, desktop, removedId);
      await reveal(tester, row);
      await tester.tap(
        find.descendant(
          of: row,
          matching: find.byTooltip('Desktop chat actions'),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Unarchive chat'));
      await tester.pumpAndSettle();
      await waitFor(
        tester,
        () => !desktop.threadList.data.isArchived(removedId),
      );
      await overviewAction(tester, 'Show active desktop chats');
      await selectChat(tester, desktop, removedId);
      await tool(tester, 'Archive chat');
      await waitFor(
        tester,
        () => find.byType(PairingPage).evaluate().isNotEmpty,
      );
      await overviewAction(tester, 'Show archived desktop chats');
      final beforeRemove = await state();
      final archivedRow = await overviewThread(tester, desktop, removedId);
      await reveal(tester, archivedRow);
      await tester.tap(
        find.descendant(
          of: archivedRow,
          matching: find.byTooltip('Desktop chat actions'),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Remove from this device'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Remove chat'));
      await waitFor(
        tester,
        () => desktop.threadList.data.deleted.contains(removedId),
      );
      expect((await state())['archiveCount'], beforeRemove['archiveCount']);
      await overviewAction(tester, 'Show active desktop chats');
      await selectChat(tester, desktop, originalId);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        draft,
      );
      await desktop.threadList.saveNow();
      await desktop.threadList.store.flush();
      final support = await getApplicationSupportDirectory();
      final files = await Directory('${support.path}/desktop-cache-v1')
          .list()
          .where((f) => f is File && f.path.endsWith('.json'))
          .cast<File>()
          .toList();
      expect(files, isNotEmpty);
      for (final file in files) {
        final encrypted = await file.readAsString();
        expect(encrypted, isNot(contains(title)));
        expect(encrypted, isNot(contains(draft)));
      }
      final counts = await state();
      final saved = await http.post(
        Uri.parse('http://127.0.0.1:8852/qa/restore-fixture'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'platform': Platform.operatingSystem,
          'expected': {
            'threadId': originalId,
            'removedThreadId': removedId,
            'title': title,
            'draft': draft,
            'macDeviceId': desktop.active!.macDeviceId,
            'turnStartCount': counts['turnStartCount'],
          },
        }),
      );
      expect(saved.statusCode, 200);
      await desktop.disconnect();
      await desktop.threadList.store.flush();
      await binding.takeScreenshot('threads-offline-before-process-exit');
      expect(tester.takeException(), isNull);
    },
    timeout: const Timeout(Duration(minutes: 8)),
  );
}
