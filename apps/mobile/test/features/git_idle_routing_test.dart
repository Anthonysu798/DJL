import 'package:djl_mobile/core/presentation/djl_glass_menu.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/git/data/git_repository.dart';
import 'package:djl_mobile/features/git/presentation/git_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'git_writer_defaults_widget_test.dart' show WriterTransport;
import 'package:djl_mobile/features/git/presentation/git_branch_picker.dart';
import 'git_branch_picker_widget_test.dart'
    show openBranchPickerForTest, branchRow;

class IdleGitTransport extends WriterTransport {
  IdleGitTransport(super.pairings);
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'git/branches' ||
        method == 'git/createWorktree' ||
        method == 'git/diff') {
      calls.add({'method': method, 'params': Map.of(params)});
      return switch (method) {
        'git/branches' => {
          'branches': ['qa', 'other'],
          'default': 'qa',
        },
        'git/createWorktree' => {'worktreePath': '/qa/new-worktree'},
        _ => {'patch': 'diff --git a/a b/a\n@@ -0,0 +1 @@\n+QA diff\n'},
      };
    }
    return super.request(method, params, timeout: timeout);
  }
}

Future<void> idleGitApp(
  WidgetTester tester,
  IdleGitTransport transport,
  ValueNotifier<bool> idle, {
  ValueChanged<String>? onOpen,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: GitPage(
        repository: GitRepository(transport, cwd: '/qa/idle-routing'),
        canChangeBranch: () => idle.value,
        scopeChanges: idle,
        onOpenWorktree: onOpen ?? (_) {},
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> openAction(WidgetTester tester, String label) async {
  await tester.tap(find.byType(DjlGlassMenuButton<String>));
  await tester.pumpAndSettle();
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

Future<void> interveningRun(
  WidgetTester tester,
  ValueNotifier<bool> idle,
) async {
  idle.value = false;
  await tester.pumpAndSettle();
  idle.value = true;
  await tester.pumpAndSettle();
}

void main() {
  for (final operation in [
    'branch',
    'worktree',
    'checkout',
    'transfer',
    'remove',
  ]) {
    testWidgets('intervening run invalidates an open $operation review', (
      tester,
    ) async {
      final transport = IdleGitTransport(PairingRepository(TestCredentials()));
      final idle = ValueNotifier(true);
      await idleGitApp(tester, transport, idle);
      VoidCallback? checkout;
      if (operation == 'checkout') {
        await openBranchPickerForTest(tester);
        checkout = tester.widget<InkWell>(branchRow('other')).onTap!;
      } else {
        await openAction(tester, switch (operation) {
          'branch' => 'Create branch',
          'transfer' => 'Transfer changes to workspace',
          'remove' => 'Remove managed worktree',
          _ => 'Create worktree',
        });
        if (operation != 'remove') {
          await tester.enterText(
            find.byType(TextField),
            operation == 'transfer' ? '/qa/target' : 'qa-new',
          );
        }
      }
      await interveningRun(tester, idle);
      if (operation == 'checkout') {
        checkout!();
        await tester.pumpAndSettle();
        expect(
          find.text(
            'Thread or desktop changed. Close and reopen the branch picker.',
          ),
          findsOneWidget,
        );
        await tester.tap(find.byTooltip('Close branch picker'));
      } else if (operation == 'branch') {
        expect(
          tester
              .widget<FilledButton>(find.widgetWithText(FilledButton, 'Create'))
              .onPressed,
          isNull,
        );
        expect(find.textContaining('Close and reopen'), findsOneWidget);
        await tester.tap(find.text('Cancel'));
      } else {
        await tester.tap(
          find.widgetWithText(
            FilledButton,
            operation == 'worktree' ? 'Create' : 'Continue',
          ),
        );
      }
      await tester.pumpAndSettle();
      expect(
        transport.calls.where(
          (call) => {
            'git/createBranch',
            'git/createWorktree',
            'git/checkout',
            'git/transferManagedHandoff',
            'git/removeWorktree',
          }.contains(call['method']),
        ),
        isEmpty,
      );
      if (operation != 'branch' && operation != 'checkout') {
        expect(
          find.text(
            'Thread activity changed. Reopen this branch or worktree action.',
          ),
          findsOneWidget,
        );
      }
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
      idle.dispose();
    });
  }

  for (final callback in ['menu', 'branch-selector']) {
    testWidgets(
      'cached $callback routing callback checks live idle readiness',
      (tester) async {
        final transport = IdleGitTransport(
          PairingRepository(TestCredentials()),
        );
        final idle = ValueNotifier(true);
        await idleGitApp(tester, transport, idle);
        final menu = tester
            .widget<DjlGlassMenuButton<String>>(
              find.byType(DjlGlassMenuButton<String>),
            )
            .onSelected!;
        final selector = tester
            .widget<TextButton>(find.byKey(const Key('git.current-branch')))
            .onPressed!;
        idle.value = false;
        await tester.pumpAndSettle();
        if (callback == 'menu') {
          menu('branch');
        } else {
          selector();
        }
        await tester.pumpAndSettle();
        expect(find.byType(TextField), findsNothing);
        expect(find.byType(GitBranchPicker), findsNothing);
        expect(transport.calls.map((call) => call['method']), [
          'git/status',
          'git/branches',
        ]);
        await tester.pumpWidget(const SizedBox());
        await transport.dispose();
        idle.dispose();
      },
    );
  }

  testWidgets(
    'repository diff remains available while routing is unavailable',
    (tester) async {
      final transport = IdleGitTransport(PairingRepository(TestCredentials()));
      final idle = ValueNotifier(false);
      await idleGitApp(tester, transport, idle);
      await tester.tap(find.text('View diff'));
      await tester.pumpAndSettle();
      expect(find.text('Repository Changes'), findsOneWidget);
      expect(find.text('QA diff'), findsOneWidget);
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      expect(find.text('Git'), findsOneWidget);
      expect(transport.calls.map((call) => call['method']), [
        'git/status',
        'git/branches',
        'git/diff',
      ]);
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
      idle.dispose();
    },
  );

  testWidgets(
    'ordinary idle branch creation keeps source normalization and exact cwd',
    (tester) async {
      final transport = IdleGitTransport(PairingRepository(TestCredentials()));
      final idle = ValueNotifier(true);
      await idleGitApp(tester, transport, idle);
      await openAction(tester, 'Create branch');
      await tester.enterText(find.byType(TextField), 'qa-new');
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Create'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Carry to New Branch'));
      await tester.pumpAndSettle();
      final write = transport.calls
          .where((call) => call['method'] == 'git/createBranch')
          .single;
      expect(write['params'], {
        'name': 'djl/qa-new',
        'cwd': '/qa/idle-routing',
      });
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
      idle.dispose();
    },
  );

  testWidgets('cached worktree Open chat checks current routing readiness', (
    tester,
  ) async {
    final transport = IdleGitTransport(PairingRepository(TestCredentials()));
    final idle = ValueNotifier(true);
    var opens = 0;
    await idleGitApp(tester, transport, idle, onOpen: (_) => opens++);
    await openAction(tester, 'Create worktree');
    await tester.enterText(find.byType(TextField), 'qa-worktree');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Create'));
    await tester.pumpAndSettle();
    final open = tester
        .widget<TextButton>(find.widgetWithText(TextButton, 'Open chat'))
        .onPressed!;
    idle.value = false;
    await tester.pumpAndSettle();
    open();
    await tester.pumpAndSettle();
    expect(opens, 0);
    await tester.pumpWidget(const SizedBox());
    await transport.dispose();
    idle.dispose();
  });
}
