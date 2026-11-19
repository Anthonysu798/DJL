import 'package:djl_mobile/features/git/presentation/git_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_conversation_fidelity_test.dart' show showConversation;
import 'desktop_draft_git_test.dart' show DraftGitTransport;
import 'desktop_new_chat_draft_test.dart' show draftDesktop, finishDraft;

class UninitializedDraftGit extends DraftGitTransport {
  UninitializedDraftGit(super.pairings);
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'git/status') {
      calls.add({'method': method, 'params': Map.of(params)});
      return {'isRepo': false, 'state': 'not_initialized'};
    }
    return super.request(method, params, timeout: timeout);
  }
}

class ChangingDraftGit extends DraftGitTransport {
  ChangingDraftGit(super.pairings);
  String state = 'up_to_date';
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'git/status') {
      calls.add({'method': method, 'params': Map.of(params)});
      return {
        'isRepo': true,
        'state': state,
        'branch': 'draft-qa',
        'files': [],
      };
    }
    return super.request(method, params, timeout: timeout);
  }
}

void main() {
  testWidgets(
    'advanced Git metadata refreshes the same folder toolbar status',
    (tester) async {
      final remote = ChangingDraftGit(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      final draft = desktop.beginNewChatDraft(cwd: '/repo/Status folder')!;
      await showConversation(tester, desktop, draft: draft);
      final semantics = tester.ensureSemantics();
      await tester.tap(find.byTooltip('Git actions'));
      await tester.pumpAndSettle();
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(
        tester
            .getSemantics(find.byTooltip('Git actions'))
            .getSemanticsData()
            .value,
        'Repository up to date',
      );
      remote.state = 'behind_only';
      await tester.tap(find.byTooltip('Thread actions'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Branches & worktrees'));
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(
        tester
            .getSemantics(find.byTooltip('Git actions'))
            .getSemanticsData()
            .value,
        'Remote branch ahead of local branch',
      );
      expect(remote.calls.map((call) => call['method']), [
        'git/status',
        'git/branches',
        'git/status',
        'git/branches',
      ]);
      semantics.dispose();
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'Git toolbar announces live status and drops it when its folder changes',
    (tester) async {
      final remote = UninitializedDraftGit(
        PairingRepository(TestCredentials()),
      );
      final desktop = await draftDesktop(remote);
      final draft = desktop.beginNewChatDraft(cwd: '/repo/First folder')!;
      await showConversation(tester, desktop, draft: draft);
      final semantics = tester.ensureSemantics();
      expect(
        tester
            .getSemantics(find.byTooltip('Git actions'))
            .getSemanticsData()
            .label,
        'Git actions',
      );
      expect(
        tester
            .getSemantics(find.byTooltip('Git actions'))
            .getSemanticsData()
            .value,
        'Repository status unavailable',
      );
      expect(find.byKey(const Key('git.toolbar.status-dot')), findsNothing);
      await tester.tap(find.byTooltip('Git actions'));
      await tester.pumpAndSettle();
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(
        tester
            .getSemantics(find.byTooltip('Git actions'))
            .getSemanticsData()
            .value,
        'Git is not initialized',
      );
      final dot = tester.widget<Container>(
        find.byKey(const Key('git.toolbar.status-dot')),
      );
      expect(
        (dot.decoration as BoxDecoration).color?.toARGB32(),
        CupertinoColors.systemOrange.color.toARGB32(),
      );
      desktop.updateNewChatDraftCwd(draft, '/repo/Second folder');
      await tester.pumpAndSettle();
      expect(
        tester
            .getSemantics(find.byTooltip('Git actions'))
            .getSemanticsData()
            .value,
        'Repository status unavailable',
      );
      expect(find.byKey(const Key('git.toolbar.status-dot')), findsNothing);
      expect(remote.calls.map((call) => call['method']), ['git/status']);
      semantics.dispose();
      await finishDraft(tester, desktop);
    },
  );

  testWidgets('draft Git opens directly and returns to the same unsent text', (
    tester,
  ) async {
    final remote = DraftGitTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    final draft = desktop.beginNewChatDraft(cwd: '/repo/Chosen folder/')!;
    await showConversation(tester, desktop, draft: draft);
    expect(
      tester.getSize(find.byTooltip('Open navigation')),
      const Size(44, 44),
    );
    await tester.enterText(
      find.byKey(const Key('desktop_composer')),
      'Keep this unsent review',
    );
    expect(find.byTooltip('Continue on desktop'), findsNothing);
    expect(find.byTooltip('Refresh from desktop'), findsNothing);
    await tester.tap(find.byTooltip('Git actions'));
    await tester.pumpAndSettle();
    expect(find.byType(GitPage), findsOneWidget);
    expect(remote.calls.map((c) => c['method']), [
      'git/status',
      'git/branches',
    ]);
    for (final call in remote.calls) {
      expect(call['params'], {'cwd': '/repo/Chosen folder/'});
    }
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('desktop_composer')))
          .controller!
          .text,
      'Keep this unsent review',
    );
    expect(desktop.newChatDraft, same(draft));
    expect(desktop.thread, isNull);
    expect(remote.starts, 0);
    await finishDraft(tester, desktop);
  });

  testWidgets('draft Thread actions exposes Git tools without terminal', (
    tester,
  ) async {
    final remote = DraftGitTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    final draft = desktop.beginNewChatDraft(cwd: '/repo/Chosen folder')!;
    await showConversation(tester, desktop, draft: draft);
    final semantics = tester.ensureSemantics();
    final actions = tester
        .getSemantics(find.byTooltip('Thread actions'))
        .getSemanticsData();
    expect(actions.flagsCollection.isButton, isTrue);
    expect(actions.hasAction(SemanticsAction.tap), isTrue);
    semantics.dispose();
    await tester.tap(find.byTooltip('Thread actions'));
    await tester.pumpAndSettle();
    expect(find.text('Open Terminal Here'), findsNothing);
    expect(find.text('Branches & worktrees'), findsOneWidget);
    expect(remote.calls, isEmpty);
    expect(remote.starts, 0);
    await finishDraft(tester, desktop);
  });
}
