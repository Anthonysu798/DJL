import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/git/presentation/git_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_conversation_fidelity_test.dart' show showConversation;
import 'desktop_draft_git_test.dart' show DraftGitTransport;
import 'desktop_new_chat_draft_test.dart' show draftDesktop, finishDraft;
import 'desktop_root_routing_test.dart' show savedPair;
import 'git_branch_picker_widget_test.dart'
    show openBranchPickerForTest, branchRow, exposePicker;

class SavedToolbarTransport extends DraftGitTransport {
  SavedToolbarTransport(super.pairings);
  String session = 'toolbar-session';
  @override
  String? get sessionId => session;

  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'account/status/read') {
      calls.add({'method': method, 'params': Map.of(params)});
      return {
        'status': 'authenticated',
        'authMethod': 'chatgpt',
        'tokenReady': true,
        'hostPlatform': 'macos',
        'bridgeVersion': '1.0',
        'bridgeLatestVersion': '2.0',
        'hostCapabilities': {
          'desktopHandoff': true,
          'displayWake': true,
          'keepAwake': true,
          'bridgeUpdate': true,
        },
      };
    }
    return super.request(method, params, timeout: timeout);
  }
}

class SavedWorktreeTransport extends SavedToolbarTransport {
  SavedWorktreeTransport(super.pairings);
  final chats = <String, RemoteJson>{};
  bool failRead = false;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'thread/fork') {
      calls.add({'method': method, 'params': Map.of(params)});
      return {
        'thread': {
          'id': 'unexpected-fork',
          'cwd': '/repo/Other worktree',
          'turns': [],
        },
      };
    }
    if (method == 'thread/read' || method == 'thread/resume') {
      calls.add({'method': method, 'params': Map.of(params)});
      if (failRead) throw StateError('QA target read failed');
      final id = params['threadId'] as String;
      return {
        'thread': {...?chats[id], 'id': id, 'turns': []},
      };
    }
    return super.request(method, params, timeout: timeout);
  }
}

Future<void> openSavedGitTools(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Thread actions'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('More actions'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Branches & worktrees'));
  await tester.pumpAndSettle();
}

Future<
  ({
    SavedWorktreeTransport remote,
    DesktopController desktop,
    int beforeSelection,
  })
>
worktreeAlertApp(
  WidgetTester tester, {
  List<RemoteJson> targets = const [],
  String sourceCwd = '/repo/Saved folder/',
  String sourceText = '',
}) async {
  final remote = SavedWorktreeTransport(PairingRepository(TestCredentials()))
    ..otherWorktree = '/repo/Other worktree';
  final desktop = await draftDesktop(remote);
  desktop.thread = {'id': 'saved', 'cwd': sourceCwd};
  for (final target in targets) {
    desktop.threadList.data.upsert(target);
    remote.chats[target['id'] as String] = target;
  }
  await showConversation(tester, desktop);
  if (sourceText.isNotEmpty) {
    await tester.enterText(
      find.byKey(const Key('desktop_composer')),
      sourceText,
    );
  }
  await openSavedGitTools(tester);
  await openBranchPickerForTest(tester);
  await exposePicker(tester, branchRow('other-worktree'));
  final beforeSelection = remote.calls.length;
  await tester.tap(branchRow('other-worktree'));
  await tester.pumpAndSettle();
  return (remote: remote, desktop: desktop, beforeSelection: beforeSelection);
}

const existingWorktreeChat = <String, dynamic>{
  'id': 'worktree-chat',
  'cwd': '/repo/Other worktree',
  'updatedAt': 200,
  'model': 'qa',
  'modelProvider': 'codex',
  'name': 'Existing worktree chat',
};

void main() {
  testWidgets(
    'covered existing-worktree Open Chat callback cannot dismiss a foreign review',
    (tester) async {
      final state = await worktreeAlertApp(
        tester,
        targets: [existingWorktreeChat],
      );
      final open = tester
          .widget<TextButton>(find.widgetWithText(TextButton, 'Open Chat'))
          .onPressed!;
      final context = tester.element(find.byType(AlertDialog));
      showDialog<void>(
        context: context,
        builder: (_) => const AlertDialog(title: Text('Foreign review')),
      );
      await tester.pumpAndSettle();
      open();
      await tester.pumpAndSettle();
      expect(find.text('Foreign review'), findsOneWidget);
      expect(
        state.remote.calls.where(
          (call) => {
            'thread/read',
            'thread/fork',
            'thread/start',
            'git/checkout',
          }.contains(call['method']),
        ),
        isEmpty,
      );
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
      await finishDraft(tester, state.desktop);
    },
  );

  testWidgets(
    'Open Chat reuses newest eligible worktree chat read-only and saves source input',
    (tester) async {
      final state = await worktreeAlertApp(
        tester,
        targets: [
          {
            'id': 'old-worktree-chat',
            'cwd': '/repo/Other worktree/',
            'updatedAt': 100,
          },
          existingWorktreeChat,
        ],
        sourceText: 'Keep source input',
      );
      state.desktop.threadList.data.pinned.add('old-worktree-chat');
      await tester.tap(find.text('Open Chat'));
      await tester.pumpAndSettle();
      expect(state.desktop.thread?['id'], 'worktree-chat');
      expect(
        state.desktop.threadList.data.drafts['saved'],
        'Keep source input',
      );
      final read = state.remote.calls
          .where((call) => call['method'] == 'thread/read')
          .single;
      expect(read['params'], {
        'threadId': 'worktree-chat',
        'includeTurns': true,
      });
      expect(
        state.remote.calls.where(
          (call) => {
            'thread/fork',
            'thread/start',
            'git/checkout',
            'thread/resume',
            'djl/thread/runtimeMode/set',
          }.contains(call['method']),
        ),
        isEmpty,
      );
      expect(find.byType(GitPage), findsNothing);
      await finishDraft(tester, state.desktop);
    },
  );

  testWidgets('archived captured worktree target cannot retarget Open Chat', (
    tester,
  ) async {
    final state = await worktreeAlertApp(
      tester,
      targets: [existingWorktreeChat],
    );
    state.desktop.threadList.data.archiveOverrides['worktree-chat'] = true;
    await tester.tap(find.text('Open Chat'));
    await tester.pumpAndSettle();
    expect(state.desktop.thread?['id'], 'saved');
    expect(
      state.remote.calls.where(
        (call) => {
          'thread/read',
          'thread/fork',
          'thread/start',
          'git/checkout',
        }.contains(call['method']),
      ),
      isEmpty,
    );
    expect(find.textContaining('no longer available'), findsOneWidget);
    await finishDraft(tester, state.desktop);
  });

  testWidgets(
    'old worktree alert cannot navigate a replacement pairing session',
    (tester) async {
      final state = await worktreeAlertApp(
        tester,
        targets: [existingWorktreeChat],
      );
      final open = tester
          .widget<TextButton>(find.widgetWithText(TextButton, 'Open Chat'))
          .onPressed!;
      state.remote.session = 'replacement-session';
      open();
      await tester.pumpAndSettle();
      expect(state.desktop.thread?['id'], 'saved');
      expect(
        state.remote.calls.where(
          (call) => {
            'thread/read',
            'thread/fork',
            'thread/start',
            'git/checkout',
          }.contains(call['method']),
        ),
        isEmpty,
      );
      await finishDraft(tester, state.desktop);
    },
  );

  testWidgets('newer navigation intent wins over an old Open Chat alert', (
    tester,
  ) async {
    final state = await worktreeAlertApp(
      tester,
      targets: [existingWorktreeChat],
    );
    state.desktop.queueNavigation(const DesktopLinkTarget('newer-intent'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Open Chat'));
    await tester.pumpAndSettle();
    expect(state.desktop.navigationTarget?.thread, 'newer-intent');
    expect(state.desktop.thread?['id'], 'saved');
    expect(
      state.remote.calls.where(
        (call) => {
          'thread/read',
          'thread/fork',
          'thread/start',
          'git/checkout',
        }.contains(call['method']),
      ),
      isEmpty,
    );
    await finishDraft(tester, state.desktop);
  });

  testWidgets(
    'worktree target equal to current path is a nonnavigating no-op',
    (tester) async {
      final state = await worktreeAlertApp(
        tester,
        sourceCwd: '/repo/Other worktree/./',
      );
      expect(find.text('Branch already open elsewhere'), findsNothing);
      expect(state.desktop.thread?['id'], 'saved');
      expect(state.remote.calls.skip(state.beforeSelection), isEmpty);
      await finishDraft(tester, state.desktop);
    },
  );

  testWidgets(
    'failed existing worktree history read is visible without an unhandled failure or fork',
    (tester) async {
      final state = await worktreeAlertApp(
        tester,
        targets: [existingWorktreeChat],
      );
      state.remote.failRead = true;
      await tester.tap(find.text('Open Chat'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.textContaining('QA target read failed'), findsOneWidget);
      expect(
        state.remote.calls.where((call) => call['method'] == 'thread/read'),
        hasLength(1),
      );
      expect(
        state.remote.calls.where(
          (call) => {
            'thread/fork',
            'thread/start',
            'git/checkout',
          }.contains(call['method']),
        ),
        isEmpty,
      );
      await finishDraft(tester, state.desktop);
    },
  );

  for (final existing in [false, true]) {
    testWidgets(
      'mapped checked-out branch offers only existing chat, existing=$existing',
      (tester) async {
        final remote = SavedWorktreeTransport(
          PairingRepository(TestCredentials()),
        )..otherWorktree = '/repo/Other worktree';
        final desktop = await draftDesktop(remote);
        desktop.thread = {'id': 'saved', 'cwd': '/repo/Saved folder/'};
        if (existing) {
          final target = <String, dynamic>{
            'id': 'worktree-chat',
            'cwd': '/repo/Other worktree',
            'updatedAt': 100,
          };
          desktop.threadList.data.upsert(target);
          remote.chats['worktree-chat'] = target;
        }
        await showConversation(tester, desktop);
        await openSavedGitTools(tester);
        await openBranchPickerForTest(tester);
        await exposePicker(tester, branchRow('other-worktree'));
        await tester.tap(branchRow('other-worktree'));
        await tester.pumpAndSettle();
        expect(
          remote.calls.where(
            (call) => {
              'thread/fork',
              'thread/start',
              'git/checkout',
            }.contains(call['method']),
          ),
          isEmpty,
        );
        expect(find.text('Branch already open elsewhere'), findsOneWidget);
        expect(
          find.text('Open Chat'),
          existing ? findsOneWidget : findsNothing,
        );
        await tester.tap(find.text('Close'));
        await tester.pumpAndSettle();
        await finishDraft(tester, desktop);
      },
    );
  }

  for (final running in ['busy', 'active-turn']) {
    testWidgets('saved advanced Git disables branch routing for $running', (
      tester,
    ) async {
      final remote = SavedToolbarTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'saved', 'cwd': '/repo/Saved folder/'};
      if (running == 'busy') desktop.busy = true;
      if (running == 'active-turn') desktop.turnId = 'running-qa';
      await showConversation(tester, desktop);
      await tester.tap(find.byTooltip('Thread actions'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('More actions'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Branches & worktrees'));
      await tester.pumpAndSettle();
      expect(find.byType(GitPage), findsOneWidget);
      expect(
        tester
            .widget<TextButton>(find.byKey(const Key('git.current-branch')))
            .onPressed,
        isNull,
      );
      await tester.tap(find.byTooltip('Show menu'));
      await tester.pumpAndSettle();
      for (final label in [
        'Create branch',
        'Create worktree',
        'Create managed worktree',
      ]) {
        expect(
          tester
              .widget<PopupMenuItem<String>>(
                find.widgetWithText(PopupMenuItem<String>, label),
              )
              .enabled,
          isFalse,
        );
      }
      expect(
        remote.calls
            .where((call) => (call['method'] as String).startsWith('git/'))
            .map((call) => call['method']),
        ['git/status', 'git/branches'],
      );
      await finishDraft(tester, desktop);
    });

    testWidgets('saved repository Git review remains available for $running', (
      tester,
    ) async {
      final remote = SavedToolbarTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'saved', 'cwd': '/repo/Saved folder/'};
      if (running == 'busy') desktop.busy = true;
      if (running == 'active-turn') desktop.turnId = 'running-qa';
      await showConversation(tester, desktop);
      await tester.tap(find.byTooltip('Git actions'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('git.menu.action.commit')));
      await tester.pumpAndSettle();
      expect(find.text('Commit all current changes'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(
        remote.calls
            .where((call) => (call['method'] as String).startsWith('git/'))
            .map((call) => call['method']),
        ['git/status', 'git/branches'],
      );
      await finishDraft(tester, desktop);
    });
  }

  for (final state in ['wrong-socket', 'untrusted']) {
    testWidgets('saved Git requires the active verified transport $state', (
      tester,
    ) async {
      final remote = SavedToolbarTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'saved', 'cwd': '/repo/Saved folder/'};
      if (state == 'wrong-socket') remote.host = 'mac-b';
      if (state == 'untrusted') desktop.trusted = [];
      await showConversation(tester, desktop);
      await tester.tap(find.byTooltip('Git actions'));
      await tester.pumpAndSettle();
      expect(find.byType(GitPage), findsNothing);
      expect(
        remote.calls.where(
          (call) => (call['method'] as String).startsWith('git/'),
        ),
        isEmpty,
      );
      await finishDraft(tester, desktop);
    });
  }

  testWidgets('saved Git opens the source popup before advanced tools', (
    tester,
  ) async {
    final remote = SavedToolbarTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    desktop.thread = {'id': 'saved', 'cwd': '/repo/Saved folder/'};
    await showConversation(tester, desktop);
    expect(
      remote.calls.where(
        (call) => (call['method'] as String).startsWith('git/'),
      ),
      isEmpty,
    );
    await tester.tap(find.byTooltip('Git actions'));
    await tester.pumpAndSettle();
    expect(tester.widget<GitPage>(find.byType(GitPage)).toolbarMenu, isTrue);
    expect(find.text('Write'), findsOneWidget);
    expect(find.byKey(const Key('git.menu.action.commit')), findsOneWidget);
    expect(
      remote.calls
          .where((call) => (call['method'] as String).startsWith('git/'))
          .map((call) => call['method']),
      ['git/status', 'git/branches'],
    );
    await finishDraft(tester, desktop);
  });

  testWidgets('saved Thread handoff confirms the exact current chat', (
    tester,
  ) async {
    final remote = SavedToolbarTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    desktop.thread = {'id': 'saved', 'cwd': '/repo/Saved folder/'};
    desktop.host.bind(
      device: 'mac-a',
      session: remote.session,
      connected: true,
      trusted: true,
    );
    await desktop.host.refresh();
    await showConversation(tester, desktop);
    await tester.tap(find.byTooltip('Thread actions'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Hand off to Desktop'));
    await tester.pumpAndSettle();
    expect(find.text('Continue on desktop?'), findsOneWidget);
    expect(
      remote.calls.where(
        (call) => call['method'] == 'desktop/continueOnDesktop',
      ),
      isEmpty,
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    final handoffs = remote.calls.where(
      (call) => call['method'] == 'desktop/continueOnDesktop',
    );
    expect(handoffs, hasLength(1));
    expect(handoffs.single['params'], {'threadId': 'saved'});
    expect(desktop.thread?['id'], 'saved');
    await finishDraft(tester, desktop);
  });

  testWidgets(
    'a handoff confirmation cannot act after its saved chat changes',
    (tester) async {
      final remote = SavedToolbarTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'saved', 'cwd': '/repo/Saved folder/'};
      desktop.host.bind(
        device: 'mac-a',
        session: remote.session,
        connected: true,
        trusted: true,
      );
      await desktop.host.refresh();
      await showConversation(tester, desktop);
      await tester.tap(find.byTooltip('Thread actions'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Hand off to Desktop'));
      await tester.pumpAndSettle();
      expect(find.text('Continue on desktop?'), findsOneWidget);
      await desktop.openThread({'id': 'different', 'cwd': '/repo/Other'});
      await tester.pumpAndSettle();
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(
        remote.calls.where(
          (call) => call['method'] == 'desktop/continueOnDesktop',
        ),
        isEmpty,
      );
      expect(desktop.thread?['id'], 'different');
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'saved direct Git preserves exact cwd and unsent composer on Back',
    (tester) async {
      final remote = SavedToolbarTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'saved', 'cwd': '/repo/Saved folder/'};
      await showConversation(tester, desktop);
      final before = remote.calls.length;
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Keep this saved-chat draft',
      );
      await tester.tap(find.byTooltip('Git actions'));
      await tester.pumpAndSettle();
      expect(find.byType(GitPage), findsOneWidget);
      expect(remote.calls.skip(before).map((call) => call['method']), [
        'git/status',
        'git/branches',
      ]);
      for (final call in remote.calls.skip(before)) {
        expect(call['params'], {'cwd': '/repo/Saved folder/'});
      }
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        'Keep this saved-chat draft',
      );
      expect(desktop.thread?['id'], 'saved');
      expect(remote.starts, 0);
      await finishDraft(tester, desktop);
    },
  );

  for (final change in ['thread', 'host', 'session']) {
    testWidgets('captured saved Git ignores a replaced $change owner', (
      tester,
    ) async {
      final remote = SavedToolbarTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'saved', 'cwd': '/repo/Saved folder/'};
      await showConversation(tester, desktop);
      final callback = tester
          .widget<IconButton>(
            find.byWidgetPredicate(
              (w) => w is IconButton && w.tooltip == 'Git actions',
            ),
          )
          .onPressed!;
      if (change == 'thread') {
        await desktop.openThread({'id': 'other', 'cwd': '/repo/Other'});
      } else if (change == 'host') {
        desktop.active = savedPair('mac-b');
        remote.host = 'mac-b';
      } else {
        remote.session = 'replacement-session';
      }
      final before = remote.calls.length;
      callback();
      await tester.pumpAndSettle();
      expect(find.byType(GitPage), findsNothing);
      expect(remote.calls, hasLength(before));
      expect(remote.starts, 0);
      await finishDraft(tester, desktop);
    });
  }

  for (final gate in ['rootless', 'offline']) {
    testWidgets('saved direct Git does not read for $gate chat', (
      tester,
    ) async {
      final remote = SavedToolbarTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await draftDesktop(remote);
      desktop.thread = {
        'id': 'saved',
        if (gate != 'rootless') 'cwd': '/repo/Saved folder/',
      };
      if (gate == 'offline') remote.online = false;
      await showConversation(tester, desktop);
      if (gate == 'rootless') {
        expect(find.byTooltip('Git actions'), findsNothing);
      } else {
        final button = tester.widget<IconButton>(
          find.byWidgetPredicate(
            (w) => w is IconButton && w.tooltip == 'Git actions',
          ),
        );
        expect(button.onPressed, isNull);
      }
      expect(
        remote.calls.where(
          (call) => (call['method'] as String).startsWith('git/'),
        ),
        isEmpty,
      );
      expect(
        remote.calls.where((call) => call['method'] == 'turn/start'),
        isEmpty,
      );
      await finishDraft(tester, desktop);
    });
  }

  testWidgets(
    'saved Thread New chat preserves its folder without creating a run',
    (tester) async {
      final remote = SavedToolbarTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'saved', 'cwd': '/repo/Saved folder/'};
      await showConversation(tester, desktop);
      final before = remote.calls.length;
      await tester.tap(find.byTooltip('Thread actions'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('New chat'));
      await tester.pumpAndSettle();
      expect(desktop.thread, isNull);
      expect(desktop.newChatDraft?.cwd, '/repo/Saved folder/');
      expect(remote.calls, hasLength(before));
      expect(remote.starts, 0);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets('captured Thread refresh cannot read a different chat', (
    tester,
  ) async {
    final remote = SavedToolbarTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    desktop.thread = {'id': 'saved', 'cwd': '/repo/Saved folder/'};
    await showConversation(tester, desktop);
    final callback = tester
        .widget<PopupMenuButton<String>>(
          find.byWidgetPredicate(
            (w) =>
                w is PopupMenuButton<String> && w.tooltip == 'Thread actions',
          ),
        )
        .onSelected!;
    await desktop.openThread({'id': 'different', 'cwd': '/repo/Other'});
    await tester.pumpAndSettle();
    final before = remote.calls.length;
    callback('refresh');
    await tester.pumpAndSettle();
    expect(remote.calls, hasLength(before));
    expect(desktop.thread?['id'], 'different');
    await finishDraft(tester, desktop);
  });

  testWidgets('saved Thread actions retains explicit read-only refresh', (
    tester,
  ) async {
    final remote = SavedToolbarTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    desktop.thread = {'id': 'saved', 'cwd': '/repo/Saved folder/'};
    await showConversation(tester, desktop);
    final before = remote.calls.length;
    await tester.tap(find.byTooltip('Thread actions'));
    await tester.pumpAndSettle();
    expect(find.text('Hand off to Desktop'), findsOneWidget);
    expect(find.text('Open Terminal Here'), findsNothing);
    expect(find.text('Goal'), findsNothing);
    await tester.tap(find.text('More actions'));
    await tester.pumpAndSettle();
    expect(find.text('Goal'), findsOneWidget);
    expect(remote.calls, hasLength(before));
    await tester.tap(find.text('Refresh from desktop'));
    await tester.pumpAndSettle();
    final reads = remote.calls.where((call) => call['method'] == 'thread/read');
    expect(reads, hasLength(1));
    expect(reads.single['params'], {'threadId': 'saved', 'includeTurns': true});
    expect(
      remote.calls.where((call) => call['method'] == 'thread/resume'),
      isEmpty,
    );
    expect(remote.starts, 0);
    await finishDraft(tester, desktop);
  });

  testWidgets('an open secondary menu cannot refresh a replacement chat', (
    tester,
  ) async {
    final remote = SavedToolbarTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    desktop.thread = {'id': 'saved', 'cwd': '/repo/Saved folder/'};
    await showConversation(tester, desktop);
    await tester.tap(find.byTooltip('Thread actions'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('More actions'));
    await tester.pumpAndSettle();
    expect(find.text('Refresh from desktop'), findsOneWidget);
    await desktop.openThread({'id': 'different', 'cwd': '/repo/Other'});
    await tester.pumpAndSettle();
    final before = remote.calls.length;
    await tester.tap(find.text('Refresh from desktop'));
    await tester.pumpAndSettle();
    expect(remote.calls, hasLength(before));
    expect(desktop.thread?['id'], 'different');
    await finishDraft(tester, desktop);
  });
}
