import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_project_controls.dart';
import 'package:djl_mobile/features/git/presentation/git_branch_picker.dart';
import 'package:djl_mobile/features/git/presentation/git_page.dart';
import 'package:djl_mobile/features/git/presentation/worktree_flow_dialog.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_conversation_fidelity_test.dart' show showConversation;
import 'desktop_new_chat_draft_test.dart' show draftDesktop, finishDraft;
import 'desktop_project_rebind_test.dart'
    show rebindDesktop, localCwd, worktreeCwd;
import 'git_branch_picker_widget_test.dart' show branchRow;
import 'worktree_flow_test.dart' show WorktreeTransport;

class ProjectControlTransport extends WorktreeTransport {
  ProjectControlTransport(super.pairings);
  Completer<RemoteJson>? checkout;
  Completer<RemoteJson>? statusReply;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'git/status' && statusReply != null) {
      calls.add({'method': method, 'params': Map.of(params)});
      return statusReply!.future;
    }
    if (method == 'git/checkout') {
      calls.add({'method': method, 'params': Map.of(params)});
      return checkout?.future ?? {};
    }
    return super.request(method, params, timeout: timeout);
  }
}

Future<void> expandProject(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Expand project controls'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'Root project controls fit short landscape with keyboard and large text',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(700, 430);
      tester.view.viewPadding = const FakeViewPadding(top: 44, bottom: 34);
      tester.view.padding = const FakeViewPadding(top: 44);
      tester.view.viewInsets = const FakeViewPadding(bottom: 200);
      addTearDown(tester.view.reset);
      final remote = ProjectControlTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await rebindDesktop(remote);
      await showConversation(tester, desktop, scale: 2.2, keyboard: 200);
      expect(tester.takeException(), isNull);
      final field = find.byKey(const Key('desktop_composer'));
      await tester.enterText(field, 'Large text landscape draft');
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byTooltip('Send to desktop'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Send to desktop').hitTestable(), findsOneWidget);
      await tester.ensureVisible(find.byTooltip('Expand project controls'));
      await tester.pumpAndSettle();
      await expandProject(tester);
      await tester.ensureVisible(find.byTooltip('Current Branch'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Current Branch').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
      expect(
        tester.widget<TextField>(field).controller!.text,
        'Large text landscape draft',
      );
      await finishDraft(tester, desktop);
    },
  );

  for (final draftMode in [false, true]) {
    testWidgets(
      'Root project branch controls keep exact draft and input identity draft=$draftMode',
      (tester) async {
        final remote = ProjectControlTransport(
          PairingRepository(TestCredentials()),
        );
        final desktop = draftMode
            ? await draftDesktop(remote)
            : await rebindDesktop(remote);
        final draft = draftMode
            ? desktop.beginNewChatDraft(cwd: localCwd)!
            : null;
        await showConversation(tester, desktop, draft: draft);
        final field = find.byKey(const Key('desktop_composer'));
        await tester.enterText(field, 'Exact unsent project draft');
        await tester.pumpAndSettle();
        final editable = tester.state<EditableTextState>(
          find.byType(EditableText),
        );
        final before = tester.getRect(field);
        remote.calls.clear();
        await expandProject(tester);
        expect(find.byTooltip('Current Branch').hitTestable(), findsOneWidget);
        expect(tester.getRect(field), before);
        expect(
          tester.state<EditableTextState>(find.byType(EditableText)),
          same(editable),
        );
        expect(editable.widget.focusNode.hasFocus, isTrue);
        await tester.tap(find.byTooltip('Current Branch'));
        await tester.pumpAndSettle();
        expect(find.byType(GitBranchPicker), findsOneWidget);
        expect(desktop.projectMoveBusy, isTrue);
        await tester.tap(find.byTooltip('Close branch picker'));
        await tester.pumpAndSettle();
        expect(desktop.projectMoveBusy, isFalse);
        expect(editable.widget.focusNode.hasFocus, isTrue);
        expect(
          tester.widget<TextField>(field).controller!.text,
          'Exact unsent project draft',
        );
        expect(
          tester.state<EditableTextState>(find.byType(EditableText)),
          same(editable),
        );
        expect(
          remote.calls
              .where((c) => (c['method'] as String).startsWith('git/'))
              .map((c) => c['method']),
          ['git/status', 'git/status', 'git/branches'],
        );
        for (final call in remote.calls.where(
          (c) => !(c['method'] as String).startsWith('git/'),
        )) {
          expect(call['method'], 'thread/goal/get');
          expect(call['params'], {'threadId': 'same-chat'});
        }
        expect(desktop.thread == null, draftMode);
        await finishDraft(tester, desktop);
      },
    );
  }

  testWidgets(
    'Root floating runtime opens the existing saved-chat handoff review',
    (tester) async {
      final remote = ProjectControlTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await rebindDesktop(remote);
      await showConversation(tester, desktop);
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Keep saved chat draft',
      );
      remote.calls.clear();
      await expandProject(tester);
      await tester.tap(find.byTooltip('Runtime'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Hand off to Worktree'));
      await tester.pumpAndSettle();
      expect(find.byType(WorktreeFlowDialog), findsOneWidget);
      await tester.tap(find.byTooltip('Close worktree review'));
      await tester.pumpAndSettle();
      expect(desktop.thread?['id'], 'same-chat');
      expect(desktop.thread?['cwd'], localCwd);
      expect(remote.calls.map((c) => c['method']), [
        'git/status',
        'git/status',
        'git/branches',
      ]);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        'Keep saved chat draft',
      );
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'Root new worktree changes only the current unsent draft folder',
    (tester) async {
      final remote = ProjectControlTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await draftDesktop(remote);
      final draft = desktop.beginNewChatDraft(cwd: localCwd)!;
      await showConversation(tester, desktop, draft: draft);
      final field = find.byKey(const Key('desktop_composer'));
      await tester.enterText(field, 'Keep new-worktree draft');
      await tester.pumpAndSettle();
      final editable = tester.state<EditableTextState>(
        find.byType(EditableText),
      );
      remote.calls.clear();
      await expandProject(tester);
      await tester.tap(find.byTooltip('Runtime'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('New worktree'));
      await tester.pumpAndSettle();
      expect(find.text('Create worktree'), findsOneWidget);
      final name = find.descendant(
        of: find.byType(AlertDialog),
        matching: find.byType(TextField),
      );
      await tester.enterText(name, 'draft-route');
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Create'));
      await tester.pumpAndSettle();
      expect(find.byType(GitPage), findsNothing);
      expect(desktop.thread, isNull);
      expect(desktop.newChatDraft, same(draft));
      expect(draft.cwd, worktreeCwd);
      expect(desktop.projectMoveBusy, isFalse);
      expect(
        tester.widget<TextField>(field).controller!.text,
        'Keep new-worktree draft',
      );
      expect(
        tester.state<EditableTextState>(find.byType(EditableText)),
        same(editable),
      );
      expect(editable.widget.focusNode.hasFocus, isTrue);
      expect(
        remote.calls.where(
          (c) =>
              c['method'] == 'thread/start' ||
              c['method'] == 'thread/fork' ||
              c['method'] == 'thread/resume',
        ),
        isEmpty,
      );
      expect(
        remote.calls.where((c) => c['method'] == 'git/createWorktree'),
        hasLength(1),
      );
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'Root retains the routing reservation until accepted checkout settles',
    (tester) async {
      final remote = ProjectControlTransport(
        PairingRepository(TestCredentials()),
      );
      final gate = remote.checkout = Completer<RemoteJson>();
      final desktop = await rebindDesktop(remote);
      await showConversation(tester, desktop);
      await expandProject(tester);
      await tester.tap(find.byTooltip('Current Branch'));
      await tester.pumpAndSettle();
      await tester.tap(branchRow('other'));
      await tester.pump(const Duration(milliseconds: 30));
      expect(
        remote.calls.where((c) => c['method'] == 'git/checkout'),
        hasLength(1),
      );
      Navigator.of(tester.element(find.byType(GitPage))).pop();
      await tester.pumpAndSettle();
      expect(desktop.projectMoveBusy, isTrue);
      expect(desktop.beginNewChatDraft(cwd: '/qa/blocked'), isNull);
      gate.complete({});
      await tester.pumpAndSettle();
      expect(desktop.projectMoveBusy, isFalse);
      expect(desktop.runtimeReady, isTrue);
      expect(
        remote.calls.where((c) => c['method'] == 'git/checkout'),
        hasLength(1),
      );
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'choosing a folder adds project controls without replacing the focused input',
    (tester) async {
      final remote = ProjectControlTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await draftDesktop(remote);
      final draft = desktop.beginNewChatDraft()!;
      await showConversation(tester, desktop, draft: draft);
      final field = find.byKey(const Key('desktop_composer'));
      await tester.enterText(field, 'Exact rootless draft');
      await tester.pumpAndSettle();
      final editable = tester.state<EditableTextState>(
        find.byType(EditableText),
      );
      expect(find.byTooltip('Expand project controls'), findsNothing);
      desktop.updateNewChatDraftCwd(draft, localCwd);
      await tester.pumpAndSettle();
      expect(find.byTooltip('Expand project controls'), findsOneWidget);
      expect(
        tester.state<EditableTextState>(find.byType(EditableText)),
        same(editable),
      );
      expect(editable.widget.focusNode.hasFocus, isTrue);
      expect(
        tester.widget<TextField>(field).controller!.text,
        'Exact rootless draft',
      );
      await finishDraft(tester, desktop);
    },
  );

  testWidgets('late composer metadata cannot cross a session replacement', (
    tester,
  ) async {
    final remote = ProjectControlTransport(
      PairingRepository(TestCredentials()),
    );
    final desktop = await rebindDesktop(remote);
    await showConversation(tester, desktop);
    final gate = remote.statusReply = Completer<RemoteJson>();
    await tester.tap(find.byTooltip('Expand project controls'));
    await tester.pump(const Duration(milliseconds: 30));
    final old = tester
        .widget<DesktopProjectControls>(find.byType(DesktopProjectControls))
        .onBranch;
    remote.session = 'new-project-session';
    desktop.threadList.filter(search: '');
    await tester.pump(const Duration(milliseconds: 30));
    gate.complete({'isRepo': true, 'branch': 'wrong-old-session', 'files': []});
    await tester.pumpAndSettle();
    old(tester.element(find.byType(DesktopChatPage)));
    await tester.pumpAndSettle();
    expect(find.byType(GitPage), findsNothing);
    expect(find.text('wrong-old-session'), findsNothing);
    expect(find.byTooltip('Expand project controls'), findsOneWidget);
    remote.statusReply = null;
    await expandProject(tester);
    expect(find.byTooltip('Current Branch'), findsOneWidget);
    expect(find.text('main'), findsOneWidget);
    await finishDraft(tester, desktop);
  });

  testWidgets(
    'an intervening run permanently invalidates an open composer branch choice',
    (tester) async {
      final remote = ProjectControlTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await rebindDesktop(remote);
      await showConversation(tester, desktop);
      await expandProject(tester);
      await tester.tap(find.byTooltip('Current Branch'));
      await tester.pumpAndSettle();
      final choose = tester.widget<InkWell>(branchRow('other')).onTap!;
      desktop.turnId = 'external-running-turn';
      desktop.threadList.filter(search: '');
      await tester.pump();
      desktop.turnId = null;
      desktop.threadList.filter(search: '');
      await tester.pumpAndSettle();
      choose();
      await tester.pumpAndSettle();
      expect(remote.calls.where((c) => c['method'] == 'git/checkout'), isEmpty);
      expect(find.textContaining('Thread or desktop changed'), findsOneWidget);
      await tester.tap(find.byTooltip('Close branch picker'));
      await tester.pumpAndSettle();
      expect(desktop.projectMoveBusy, isFalse);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'late worktree creation cannot redirect a draft whose folder changed',
    (tester) async {
      final remote = ProjectControlTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await draftDesktop(remote);
      final draft = desktop.beginNewChatDraft(cwd: localCwd)!;
      await showConversation(tester, desktop, draft: draft);
      final field = find.byKey(const Key('desktop_composer'));
      await tester.enterText(field, 'Retained replacement folder draft');
      await tester.pumpAndSettle();
      await expandProject(tester);
      await tester.tap(find.byTooltip('Runtime'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('New worktree'));
      await tester.pumpAndSettle();
      final gate = remote.creationGate = Completer<void>();
      await tester.enterText(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.byType(TextField),
        ),
        'late-created',
      );
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Create'));
      for (
        var frame = 0;
        frame < 15 &&
            !remote.calls.any((c) => c['method'] == 'git/createWorktree');
        frame++
      ) {
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(
        remote.calls.where((c) => c['method'] == 'git/createWorktree'),
        hasLength(1),
      );
      desktop.updateNewChatDraftCwd(draft, '/qa/replacement-folder');
      await tester.pump();
      gate.complete();
      await tester.pumpAndSettle();
      expect(draft.cwd, '/qa/replacement-folder');
      expect(desktop.thread, isNull);
      expect(desktop.projectMoveBusy, isFalse);
      expect(
        tester.widget<TextField>(field).controller!.text,
        'Retained replacement folder draft',
      );
      expect(
        remote.calls.where((c) => c['method'] == 'git/createWorktree'),
        hasLength(1),
      );
      expect(
        remote.calls.where((c) => c['method'] == 'git/removeWorktree'),
        isEmpty,
      );
      await finishDraft(tester, desktop);
    },
  );
}
