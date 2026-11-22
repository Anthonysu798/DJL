import 'package:djl_mobile/core/presentation/djl_glass_menu.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/git/presentation/git_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'git_branch_picker_widget_test.dart'
    show openBranchPickerForTest, branchRow, exposePicker;
import 'desktop_conversation_fidelity_test.dart' show showConversation;
import 'desktop_new_chat_draft_test.dart'
    show DraftTransport, draftDesktop, finishDraft;

class DraftGitTransport extends DraftTransport {
  DraftGitTransport(super.pairings);
  String? otherWorktree;

  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'git/status' || method == 'git/branches') {
      calls.add({'method': method, 'params': Map.of(params)});
      return method == 'git/status'
          ? {'isRepo': true, 'branch': 'draft-qa', 'files': []}
          : {
              'branches': [
                'draft-qa',
                if (otherWorktree != null) 'other-worktree',
              ],
              'default': 'draft-qa',
              if (otherWorktree != null) ...{
                'branchesCheckedOutElsewhere': ['other-worktree'],
                'worktreePathByBranch': {'other-worktree': otherWorktree},
              },
            };
    }
    return super.request(method, params, timeout: timeout);
  }
}

Future<void> openDraftGitTools(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Thread actions'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Branches & worktrees'));
  await tester.pumpAndSettle();
}

void main() {
  for (final menuOpened in [false, true]) {
    testWidgets(
      'draft Git callbacks retain the presented draft menu=$menuOpened',
      (tester) async {
        final remote = DraftGitTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        var presented = desktop.beginNewChatDraft(cwd: '/repo/First owner')!;
        late StateSetter update;
        await tester.pumpWidget(
          MaterialApp(
            home: StatefulBuilder(
              builder: (_, set) {
                update = set;
                return DesktopChatPage(controller: desktop, draft: presented);
              },
            ),
          ),
        );
        await tester.pumpAndSettle();
        final oldGit = tester
            .widget<IconButton>(
              find.byWidgetPredicate(
                (widget) =>
                    widget is IconButton && widget.tooltip == 'Git actions',
              ),
            )
            .onPressed!;
        if (menuOpened) {
          await tester.tap(find.byTooltip('Thread actions'));
          await tester.pumpAndSettle();
        }
        final replacement = desktop.beginNewChatDraft(
          cwd: '/repo/Replacement owner',
        )!;
        update(() => presented = replacement);
        await tester.pumpAndSettle();
        if (menuOpened) {
          await tester.tap(find.text('Branches & worktrees'));
        } else {
          oldGit();
        }
        await tester.pumpAndSettle();
        expect(find.byType(GitPage), findsNothing);
        expect(
          remote.calls.where(
            (call) => (call['method'] as String).startsWith('git/'),
          ),
          isEmpty,
        );
        expect(desktop.newChatDraft, same(replacement));
        expect(remote.starts, 0);
        await finishDraft(tester, desktop);
      },
    );
  }

  for (final gate in ['rootless', 'offline', 'busy']) {
    testWidgets('draft Git stays unavailable for $gate', (tester) async {
      final remote = DraftGitTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      final draft = desktop.beginNewChatDraft(
        cwd: gate == 'rootless' ? null : '/repo/Chosen folder',
      )!;
      if (gate == 'offline') remote.online = false;
      if (gate == 'busy') desktop.busy = true;
      await showConversation(tester, desktop, draft: draft);
      if (gate == 'rootless') {
        expect(find.byTooltip('Git actions'), findsNothing);
      } else {
        final git = tester.widget<IconButton>(
          find.byWidgetPredicate(
            (w) => w is IconButton && w.tooltip == 'Git actions',
          ),
        );
        expect(git.onPressed, isNull);
        final actions = tester.widget<DjlGlassMenuButton<String>>(
          find.byWidgetPredicate(
            (w) =>
                w is DjlGlassMenuButton<String> &&
                w.tooltip == 'Thread actions',
          ),
        );
        expect(actions.enabled, isFalse);
      }
      expect(remote.calls, isEmpty);
      expect(remote.starts, 0);
      await finishDraft(tester, desktop);
    });
  }

  testWidgets('a stale draft Git callback cannot open its replacement', (
    tester,
  ) async {
    final remote = DraftGitTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    final draft = desktop.beginNewChatDraft(cwd: '/repo/Chosen folder')!;
    await showConversation(tester, desktop, draft: draft);
    final openGit = tester
        .widget<IconButton>(
          find.byWidgetPredicate(
            (w) => w is IconButton && w.tooltip == 'Git actions',
          ),
        )
        .onPressed!;
    final replacement = desktop.beginNewChatDraft(cwd: '/repo/New owner')!;
    await tester.pumpAndSettle();
    openGit();
    await tester.pumpAndSettle();
    expect(find.byType(GitPage), findsNothing);
    expect(desktop.newChatDraft, same(replacement));
    expect(replacement.cwd, '/repo/New owner');
    expect(remote.calls, isEmpty);
    expect(remote.starts, 0);
    await finishDraft(tester, desktop);
  });

  testWidgets(
    'a draft Git callback cannot read its old folder after a chat switch',
    (tester) async {
      final remote = DraftGitTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      final draft = desktop.beginNewChatDraft(cwd: '/repo/Chosen folder')!;
      await showConversation(tester, desktop, draft: draft);
      final openGit = tester
          .widget<IconButton>(
            find.byWidgetPredicate(
              (w) => w is IconButton && w.tooltip == 'Git actions',
            ),
          )
          .onPressed!;
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Create the real chat',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pumpAndSettle();
      expect(remote.starts, 1);
      expect(desktop.newChatDraft, isNull);
      expect(desktop.thread?['cwd'], '/repo/Chosen folder');
      await desktop.openThread({
        'id': 'other-chat',
        'cwd': '/repo/Other folder',
      });
      await tester.pumpAndSettle();
      expect(desktop.thread?['id'], 'other-chat');
      expect(desktop.thread?['cwd'], '/repo/Other folder');
      openGit();
      await tester.pumpAndSettle();
      expect(find.byType(GitPage), findsNothing);
      expect(
        remote.calls.where((c) => (c['method'] as String).startsWith('git/')),
        isEmpty,
      );
      await finishDraft(tester, desktop);
    },
  );

  testWidgets('worktree return cannot navigate over a replacement draft', (
    tester,
  ) async {
    final remote = DraftGitTransport(PairingRepository(TestCredentials()))
      ..otherWorktree = '/repo/Other worktree';
    final desktop = await draftDesktop(remote);
    final draft = desktop.beginNewChatDraft(cwd: '/repo/Chosen folder')!;
    await showConversation(tester, desktop, draft: draft);
    await openDraftGitTools(tester);
    final oldOpen = tester.widget<GitPage>(find.byType(GitPage)).onOpenWorktree;
    final replacement = desktop.beginNewChatDraft(cwd: '/repo/New owner')!;
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('git.current-branch')), findsNothing);
    oldOpen('/repo/Other worktree');
    await tester.pumpAndSettle();
    expect(find.byType(GitPage), findsOneWidget);
    expect(desktop.newChatDraft, same(replacement));
    expect(replacement.cwd, '/repo/New owner');
    expect(remote.starts, 0);
    expect(remote.calls.map((call) => call['method']), [
      'git/status',
      'git/branches',
    ]);
    await finishDraft(tester, desktop);
  });

  testWidgets('saved chat Git keeps exact cwd and supported writer models', (
    tester,
  ) async {
    final remote = DraftGitTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    desktop.thread = {'id': 'saved-chat', 'cwd': '/repo/Saved folder/'};
    desktop.models = [
      {'id': 'gpt-5.4-mini', 'model': 'gpt-5.4-mini', 'djlProvider': 'codex'},
      {'id': 'vendor-chat', 'model': 'vendor-chat', 'djlProvider': 'vendor'},
    ];
    await showConversation(tester, desktop);
    await tester.tap(find.byTooltip('Git actions'));
    await tester.pumpAndSettle();
    final page = tester.widget<GitPage>(find.byType(GitPage));
    expect(page.writerModels, ['gpt-5.4-mini']);
    expect(page.initialWriter, 'gpt-5.4-mini');
    final reads = remote.calls.where(
      (call) => (call['method'] as String).startsWith('git/'),
    );
    expect(reads.map((call) => call['method']), ['git/status', 'git/branches']);
    for (final call in reads) {
      expect(call['params'], {'cwd': '/repo/Saved folder/'});
    }
    expect(desktop.thread?['id'], 'saved-chat');
    expect(remote.starts, 0);
    await finishDraft(tester, desktop);
  });

  testWidgets(
    'explicit created-worktree Open chat changes only the local unsent draft folder',
    (tester) async {
      final remote = DraftGitTransport(PairingRepository(TestCredentials()))
        ..otherWorktree = '/repo/Other worktree';
      final desktop = await draftDesktop(remote);
      final draft = desktop.beginNewChatDraft(cwd: '/repo/Chosen folder')!;
      await showConversation(tester, desktop, draft: draft);
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Keep my worktree draft',
      );
      await openDraftGitTools(tester);
      tester
          .widget<GitPage>(find.byType(GitPage))
          .onOpenWorktree('/repo/Other worktree');
      await tester.pumpAndSettle();
      expect(find.byType(GitPage), findsNothing);
      expect(desktop.newChatDraft, same(draft));
      expect(draft.cwd, '/repo/Other worktree');
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        'Keep my worktree draft',
      );
      expect(remote.starts, 0);
      expect(desktop.thread, isNull);
      expect(remote.calls.map((call) => call['method']), [
        'git/status',
        'git/branches',
      ]);
      await finishDraft(tester, desktop);
    },
  );
  testWidgets(
    'a checked-out branch cannot silently move the unsent draft folder',
    (tester) async {
      final remote = DraftGitTransport(PairingRepository(TestCredentials()))
        ..otherWorktree = '/repo/Other worktree';
      final desktop = await draftDesktop(remote);
      final draft = desktop.beginNewChatDraft(cwd: '/repo/Chosen folder')!;
      await showConversation(tester, desktop, draft: draft);
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Keep this draft here',
      );
      await openDraftGitTools(tester);
      await openBranchPickerForTest(tester);
      await exposePicker(tester, branchRow('other-worktree'));
      await tester.tap(branchRow('other-worktree'));
      await tester.pumpAndSettle();
      expect(draft.cwd, '/repo/Chosen folder');
      expect(find.text('Branch Switch Failed'), findsOneWidget);
      expect(
        remote.calls.where(
          (call) => {
            'thread/start',
            'thread/fork',
            'git/checkout',
          }.contains(call['method']),
        ),
        isEmpty,
      );
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        'Keep this draft here',
      );
      await finishDraft(tester, desktop);
    },
  );
  testWidgets(
    'folder draft opens Git with exact cwd and retains unsent input',
    (tester) async {
      final remote = DraftGitTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      final draft = desktop.beginNewChatDraft(cwd: '/repo/Chosen folder')!;
      await showConversation(tester, desktop, draft: draft);
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Unsent Git review',
      );
      await tester.tap(find.byTooltip('Git actions'));
      await tester.pumpAndSettle();
      expect(find.byType(GitPage), findsOneWidget);
      expect(remote.calls.map((call) => call['method']), [
        'git/status',
        'git/branches',
      ]);
      for (final call in remote.calls) {
        expect(call['params'], {'cwd': '/repo/Chosen folder'});
      }
      expect(remote.starts, 0);
      expect(desktop.thread, isNull);
      expect(identical(desktop.newChatDraft, draft), isTrue);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        'Unsent Git review',
      );
      expect(draft.source, DesktopDraftSource.folderChat);
      expect(desktop.thread, isNull);
      expect(remote.starts, 0);
      await finishDraft(tester, desktop);
    },
  );
}
