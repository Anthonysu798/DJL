import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/git/presentation/worktree_flow_dialog.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_conversation_fidelity_test.dart' show showConversation;
import 'desktop_project_rebind_test.dart';
import 'worktree_flow_test.dart' show WorktreeTransport, waitForRequest;
import 'worktree_flow_dialog_test.dart' show branchField;

Future<void> openSavedWorktreeReview(
  WidgetTester tester, {
  bool fork = false,
}) async {
  await tester.tap(find.byTooltip('Thread actions'));
  await tester.pumpAndSettle();
  if (fork) {
    await tester.tap(find.text('More actions'));
    await tester.pumpAndSettle();
  }
  await tester.tap(
    find.text(fork ? 'Fork into new worktree' : 'Hand off to Worktree'),
  );
  await tester.pumpAndSettle();
}

void main() {
  for (final fork in [false, true]) {
    testWidgets(
      'saved source worktree review fork=$fork cancels with exact unsent draft and reads only',
      (tester) async {
        final remote = WorktreeTransport(PairingRepository(TestCredentials()));
        final desktop = await rebindDesktop(remote);
        await showConversation(tester, desktop);
        final composer = find.byKey(const Key('desktop_composer'));
        await tester.enterText(composer, 'Exact retained root draft');
        final before = remote.calls.length;
        await openSavedWorktreeReview(tester, fork: fork);
        expect(find.byType(WorktreeFlowDialog), findsOneWidget);
        await tester.tap(find.byTooltip('Close worktree review'));
        await tester.pumpAndSettle();
        expect(
          tester.widget<TextField>(composer).controller!.text,
          'Exact retained root draft',
        );
        expect(remote.calls.skip(before).map((c) => c['method']), [
          'git/status',
          'git/branches',
        ]);
        expect(desktop.thread?['cwd'], localCwd);
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      },
    );
  }

  testWidgets(
    'root retains accepted worktree operation after Close and disables duplicate Send',
    (tester) async {
      final remote = WorktreeTransport(PairingRepository(TestCredentials()));
      final gate = remote.creationGate = Completer<void>();
      final desktop = await rebindDesktop(remote);
      await showConversation(tester, desktop);
      final composer = find.byKey(const Key('desktop_composer'));
      await tester.enterText(composer, 'Root draft stays unsent');
      await tester.pumpAndSettle();
      final oldSend = tester
          .widget<IconButton>(
            find.byWidgetPredicate(
              (w) => w is IconButton && w.tooltip == 'Send to desktop',
            ),
          )
          .onPressed!;
      await openSavedWorktreeReview(tester);
      await tester.enterText(branchField, 'root-feature');
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Hand off'));
      await tester.pump(const Duration(milliseconds: 100));
      await waitForRequest(remote, 'git/createWorktree');
      await tester.tap(find.byTooltip('Close worktree review'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<IconButton>(
              find.byWidgetPredicate(
                (w) => w is IconButton && w.tooltip == 'Send to desktop',
              ),
            )
            .onPressed,
        isNull,
      );
      final before = remote.calls.length;
      oldSend();
      await tester.pump(const Duration(milliseconds: 30));
      expect(remote.calls, hasLength(before));
      gate.complete();
      await tester.pumpAndSettle();
      expect(desktop.thread?['id'], 'same-chat');
      expect(desktop.thread?['cwd'], worktreeCwd);
      expect(desktop.projectMoveBusy, isFalse);
      expect(
        tester.widget<TextField>(composer).controller!.text,
        'Root draft stays unsent',
      );
      expect(
        remote.calls.where(
          (c) => c['method'] == 'turn/start' || c['method'] == 'thread/fork',
        ),
        isEmpty,
      );
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
    },
  );

  testWidgets(
    'a normal root handoff closes only its review and keeps the same chat',
    (tester) async {
      final remote = WorktreeTransport(PairingRepository(TestCredentials()));
      final desktop = await rebindDesktop(remote);
      await showConversation(tester, desktop);
      await openSavedWorktreeReview(tester);
      await tester.enterText(branchField, 'root-feature');
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Hand off'));
      await tester.pumpAndSettle();
      expect(find.byType(WorktreeFlowDialog), findsNothing);
      expect(desktop.thread?['id'], 'same-chat');
      expect(desktop.thread?['cwd'], worktreeCwd);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
    },
  );
}
