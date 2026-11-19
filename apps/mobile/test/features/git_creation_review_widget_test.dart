import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/git/data/git_repository.dart';
import 'package:djl_mobile/features/git/presentation/git_page.dart';
import 'package:djl_mobile/features/git/presentation/git_new_branch_dialog.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'git_writer_defaults_widget_test.dart' show WriterTransport;

class CreationGitTransport extends WriterTransport {
  CreationGitTransport(super.pairings);
  RemoteJson status = {
    'isRepo': true,
    'branch': 'main',
    'dirty': false,
    'localOnlyCommitCount': 0,
    'files': [],
  };
  bool failNextStatus = false, commitFails = false;
  Completer<RemoteJson>? heldCommit;
  VoidCallback? onCommit;
  final branches = <String>['main', 'feature'];
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': Map.of(params)});
    if (method == 'git/status' && failNextStatus) {
      failNextStatus = false;
      throw StateError('QA status unavailable');
    }
    if (method == 'git/commit') {
      onCommit?.call();
      if (commitFails) throw StateError('QA commit failed');
      final result =
          await (heldCommit?.future ??
              Future.value({'summary': 'Committed QA WIP'}));
      status = {...status, 'dirty': false, 'files': []};
      return result;
    }
    if (method == 'git/createBranch') {
      status = {...status, 'branch': params['name']};
      branches.add(params['name'] as String);
      return {'branch': params['name'], 'status': Map.of(status)};
    }
    return switch (method) {
      'git/status' => Map.of(status),
      'git/branches' => {'branches': List.of(branches), 'default': 'main'},
      'git/createWorktree' => {'worktreePath': '/qa/worktree'},
      _ => {},
    };
  }
}

Future<void> creationApp(
  WidgetTester tester,
  CreationGitTransport transport, {
  ValueNotifier<bool>? idle,
  Listenable? scopeChanges,
  double scale = 1,
  double keyboard = 0,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(Brightness.light),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(scale),
          viewInsets: EdgeInsets.only(bottom: keyboard),
        ),
        child: child!,
      ),
      home: GitPage(
        repository: GitRepository(transport, cwd: '/qa/creation-review'),
        canChangeBranch: idle == null ? null : () => idle.value,
        scopeChanges: Listenable.merge([idle, scopeChanges]),
        onOpenWorktree: (_) {},
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> reviewedBranch(WidgetTester tester) async {
  await creationAction(tester, 'Create branch');
  expect(find.text('New branch'), findsOneWidget);
  await tester.enterText(find.byType(TextField), 'feature');
  await tester.pump();
  await tester.tap(find.widgetWithText(FilledButton, 'Create'));
  await tester.pumpAndSettle();
}

Future<void> creationAction(WidgetTester tester, String label) async {
  await tester.tap(find.byType(PopupMenuButton<String>));
  await tester.pumpAndSettle();
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

Future<void> newBranchDialogApp(
  WidgetTester tester,
  ValueNotifier<bool> current,
  List<String?> results, {
  double scale = 1,
  double keyboard = 0,
  Brightness brightness = Brightness.light,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(brightness),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(scale),
          viewInsets: EdgeInsets.only(bottom: keyboard),
        ),
        child: child!,
      ),
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () async {
              results.add(
                await showDialog<String>(
                  context: context,
                  builder: (_) => GitNewBranchDialog(
                    isCurrent: () => current.value,
                    scopeChanges: current,
                  ),
                ),
              );
            },
            child: const Text('Open branch'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open branch'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('worktree naming opens its keyboard without an extra focus tap', (
    tester,
  ) async {
    final transport = CreationGitTransport(
      PairingRepository(TestCredentials()),
    );
    await creationApp(tester, transport);
    await creationAction(tester, 'Create worktree');
    expect(tester.testTextInput.isVisible, isTrue);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    await tester.pumpWidget(const SizedBox());
    await transport.dispose();
  });

  for (final landscape in [false, true]) {
    testWidgets(
      'worktree preview/base/transfer stays scroll-safe with large text landscape=$landscape',
      (tester) async {
        tester.view.physicalSize = landscape
            ? const Size(700, 360)
            : const Size(360, 640);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final transport = CreationGitTransport(
          PairingRepository(TestCredentials()),
        );
        await creationApp(
          tester,
          transport,
          scale: 2.2,
          keyboard: landscape ? 120 : 260,
        );
        await creationAction(tester, 'Create worktree');
        await tester.enterText(find.byType(TextField), 'source-preview');
        await tester.pumpAndSettle();
        expect(find.text('djl/source-preview'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        await transport.dispose();
      },
    );
  }

  testWidgets(
    'owner replacement during WIP commit cannot continue on another connection',
    (tester) async {
      final transport =
          CreationGitTransport(PairingRepository(TestCredentials()))
            ..status['dirty'] = true
            ..heldCommit = Completer<RemoteJson>();
      await creationApp(tester, transport);
      await reviewedBranch(tester);
      await tester.tap(find.text('Commit, Create & Switch'));
      await tester.pump(const Duration(milliseconds: 300));
      transport.generation++;
      transport.heldCommit!.complete({'summary': 'Committed QA WIP'});
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((call) => call['method'] == 'git/commit'),
        hasLength(1),
      );
      expect(
        transport.calls.where((call) => call['method'] == 'git/createBranch'),
        isEmpty,
      );
      expect(find.textContaining('Connected desktop changed'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets(
    'metadata failure after WIP commit cannot silently create or retry',
    (tester) async {
      final transport = CreationGitTransport(
        PairingRepository(TestCredentials()),
      )..status['dirty'] = true;
      transport.onCommit = () => transport.failNextStatus = true;
      await creationApp(tester, transport);
      await reviewedBranch(tester);
      await tester.tap(find.text('Commit, Create & Switch'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((call) => call['method'] == 'git/commit'),
        hasLength(1),
      );
      expect(
        transport.calls.where((call) => call['method'] == 'git/createBranch'),
        isEmpty,
      );
      expect(find.textContaining('QA status unavailable'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets(
    'Leave changes here forwards none without a dirty-base transfer warning',
    (tester) async {
      final transport =
          CreationGitTransport(PairingRepository(TestCredentials()))
            ..status['branch'] = 'feature'
            ..status['dirty'] = true;
      await creationApp(tester, transport);
      await creationAction(tester, 'Create worktree');
      await tester.enterText(find.byType(TextField), 'new-worktree');
      await tester.pump();
      final transfer = find
          .descendant(
            of: find.byType(AlertDialog),
            matching: find.byType(DropdownButton<String>),
          )
          .last;
      await tester.tap(transfer);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Leave changes here').last);
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Create'));
      await tester.pumpAndSettle();
      final write = transport.calls
          .where((call) => call['method'] == 'git/createWorktree')
          .single;
      expect(write['params'], {
        'name': 'djl/new-worktree',
        'baseBranch': 'main',
        'changeTransfer': 'none',
        'cwd': '/qa/creation-review',
      });
      expect(
        find.text('Move local changes from the current branch'),
        findsNothing,
      );
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets(
    'Carry creates only the normalized local branch after explicit review',
    (tester) async {
      final transport = CreationGitTransport(
        PairingRepository(TestCredentials()),
      )..status['dirty'] = true;
      await creationApp(tester, transport);
      await reviewedBranch(tester);
      await tester.tap(find.text('Carry to New Branch'));
      await tester.pumpAndSettle();
      final write = transport.calls
          .where((call) => call['method'] == 'git/createBranch')
          .single;
      expect(write['params'], {
        'name': 'djl/feature',
        'cwd': '/qa/creation-review',
      });
      expect(
        transport.calls.where(
          (call) => {
            'git/commit',
            'git/push',
            'git/runStackedAction',
            'git/generateCommitMessage',
          }.contains(call['method']),
        ),
        isEmpty,
      );
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets(
    'commit-first uses source WIP then creates once across own scope notifications',
    (tester) async {
      final scope = ValueNotifier(0);
      final transport =
          CreationGitTransport(PairingRepository(TestCredentials()))
            ..status['dirty'] = true
            ..onCommit = () => scope.value++;
      await creationApp(tester, transport, scopeChanges: scope);
      await reviewedBranch(tester);
      await tester.tap(find.text('Commit, Create & Switch'));
      await tester.pumpAndSettle();
      final writes = transport.calls
          .where(
            (call) =>
                {'git/commit', 'git/createBranch'}.contains(call['method']),
          )
          .toList();
      expect(writes.map((call) => call['method']), [
        'git/commit',
        'git/createBranch',
      ]);
      expect(writes.first['params'], {
        'message': 'WIP before switching branches',
        'cwd': '/qa/creation-review',
      });
      expect(writes.last['params'], {
        'name': 'djl/feature',
        'cwd': '/qa/creation-review',
      });
      expect(
        transport.calls.where(
          (call) => {
            'git/generateCommitMessage',
            'git/push',
            'git/runStackedAction',
          }.contains(call['method']),
        ),
        isEmpty,
      );
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
      scope.dispose();
    },
  );

  testWidgets('failed WIP commit cannot create a branch or retry the commit', (
    tester,
  ) async {
    final transport = CreationGitTransport(PairingRepository(TestCredentials()))
      ..status['dirty'] = true
      ..commitFails = true;
    await creationApp(tester, transport);
    await reviewedBranch(tester);
    await tester.tap(find.text('Commit, Create & Switch'));
    await tester.pumpAndSettle();
    expect(
      transport.calls.where((call) => call['method'] == 'git/commit'),
      hasLength(1),
    );
    expect(
      transport.calls.where((call) => call['method'] == 'git/createBranch'),
      isEmpty,
    );
    expect(find.textContaining('QA commit failed'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await transport.dispose();
  });

  testWidgets('an intervening run during WIP commit cannot create afterward', (
    tester,
  ) async {
    final idle = ValueNotifier(true);
    final transport = CreationGitTransport(PairingRepository(TestCredentials()))
      ..status['dirty'] = true
      ..heldCommit = Completer<RemoteJson>();
    await creationApp(tester, transport, idle: idle);
    await reviewedBranch(tester);
    await tester.tap(find.text('Commit, Create & Switch'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(
      transport.calls.where((call) => call['method'] == 'git/commit'),
      hasLength(1),
    );
    idle.value = false;
    await tester.pump();
    idle.value = true;
    await tester.pump();
    transport.heldCommit!.complete({'summary': 'Committed QA WIP'});
    await tester.pumpAndSettle();
    expect(
      transport.calls.where((call) => call['method'] == 'git/createBranch'),
      isEmpty,
    );
    expect(
      find.text(
        'Thread activity changed. Reopen this branch or worktree action.',
      ),
      findsOneWidget,
    );
    await tester.pumpWidget(const SizedBox());
    await transport.dispose();
    idle.dispose();
  });

  for (final failure in ['read', 'removed-repository']) {
    testWidgets(
      'fresh creation metadata $failure blocks stale cached success',
      (tester) async {
        final transport = CreationGitTransport(
          PairingRepository(TestCredentials()),
        );
        await creationApp(tester, transport);
        await creationAction(tester, 'Create branch');
        await tester.enterText(find.byType(TextField), 'feature');
        await tester.pump();
        if (failure == 'read') {
          transport.failNextStatus = true;
        } else {
          transport.status['isRepo'] = false;
        }
        await tester.tap(find.widgetWithText(FilledButton, 'Create'));
        await tester.pumpAndSettle();
        expect(
          transport.calls.where((call) => call['method'] == 'git/createBranch'),
          isEmpty,
        );
        expect(
          find.textContaining(
            failure == 'read'
                ? 'QA status unavailable'
                : 'no longer a Git repository',
          ),
          findsOneWidget,
        );
        await tester.pumpWidget(const SizedBox());
        await transport.dispose();
      },
    );
  }

  testWidgets(
    'worktree preview validates empty and prefix-only names before a read',
    (tester) async {
      final transport = CreationGitTransport(
        PairingRepository(TestCredentials()),
      );
      await creationApp(tester, transport);
      await creationAction(tester, 'Create worktree');
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Create'))
            .onPressed,
        isNull,
      );
      await tester.enterText(find.byType(TextField), 'djl/');
      await tester.pump();
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Create'))
            .onPressed,
        isNull,
      );
      await tester.enterText(find.byType(TextField), ' feature ');
      await tester.pump();
      expect(find.text('djl/feature'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Create'))
            .onPressed,
        isNotNull,
      );
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(transport.calls.map((call) => call['method']), [
        'git/status',
        'git/branches',
      ]);
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets('managed worktree also blocks dirty transfer from another base', (
    tester,
  ) async {
    final transport = CreationGitTransport(PairingRepository(TestCredentials()))
      ..status['branch'] = 'feature'
      ..status['dirty'] = true;
    await creationApp(tester, transport);
    await creationAction(tester, 'Create managed worktree');
    await tester.tap(find.widgetWithText(FilledButton, 'Create'));
    await tester.pumpAndSettle();
    expect(
      find.text('Move local changes from the current branch'),
      findsOneWidget,
    );
    expect(find.textContaining('Creating a managed worktree'), findsOneWidget);
    expect(
      transport.calls.where(
        (call) => call['method'] == 'git/createManagedWorktree',
      ),
      isEmpty,
    );
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    await tester.pumpWidget(const SizedBox());
    await transport.dispose();
  });

  testWidgets(
    'source New branch validates empty/prefix and returns normalized name',
    (tester) async {
      final current = ValueNotifier(true), results = <String?>[];
      await newBranchDialogApp(tester, current, results);
      expect(find.text('New branch'), findsOneWidget);
      expect(
        find.text(
          'Branch will be created locally and checked out. Uncommitted changes stay with this working copy.',
        ),
        findsOneWidget,
      );
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'djl/',
      );
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Create'))
            .onPressed,
        isNull,
      );
      for (final invalid in ['', ' \n', 'djl/']) {
        await tester.enterText(find.byType(TextField), invalid);
        await tester.pump();
        expect(
          tester
              .widget<FilledButton>(find.widgetWithText(FilledButton, 'Create'))
              .onPressed,
          isNull,
        );
      }
      await tester.enterText(find.byType(TextField), ' feature ');
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Create'));
      await tester.pumpAndSettle();
      expect(results, ['djl/feature']);
      expect(tester.takeException(), isNull);
      current.dispose();
    },
  );

  testWidgets('New branch keeps an existing prefix and has normal Cancel', (
    tester,
  ) async {
    final current = ValueNotifier(true), results = <String?>[];
    await newBranchDialogApp(tester, current, results);
    await tester.enterText(find.byType(TextField), 'djl/kept');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Create'));
    await tester.pumpAndSettle();
    expect(results, ['djl/kept']);
    await tester.tap(find.text('Open branch'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'cancel-only');
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(results, ['djl/kept', null]);
    expect(tester.takeException(), isNull);
    current.dispose();
  });

  testWidgets(
    'New branch owner changes disable submission and preserve Cancel',
    (tester) async {
      final current = ValueNotifier(true), results = <String?>[];
      await newBranchDialogApp(tester, current, results);
      await tester.enterText(find.byType(TextField), 'typed');
      current.value = false;
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Create'))
            .onPressed,
        isNull,
      );
      expect(find.textContaining('Close and reopen'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(results, [null]);
      current.dispose();
    },
  );

  testWidgets('covered New branch Create cannot dismiss a foreign route', (
    tester,
  ) async {
    final current = ValueNotifier(true), results = <String?>[];
    await newBranchDialogApp(tester, current, results);
    await tester.enterText(find.byType(TextField), 'typed');
    await tester.pump();
    final create = tester
        .widget<FilledButton>(find.widgetWithText(FilledButton, 'Create'))
        .onPressed!;
    final context = tester.element(find.byType(GitNewBranchDialog));
    showDialog<void>(
      context: context,
      builder: (_) => const AlertDialog(title: Text('Foreign review')),
    );
    await tester.pumpAndSettle();
    create();
    await tester.pumpAndSettle();
    expect(find.text('Foreign review'), findsOneWidget);
    expect(results, isEmpty);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(results, [null]);
    current.dispose();
  });

  for (final brightness in Brightness.values) {
    for (final landscape in [false, true]) {
      testWidgets(
        'New branch keyboard/large text $brightness landscape=$landscape',
        (tester) async {
          tester.view.physicalSize = landscape
              ? const Size(700, 360)
              : const Size(360, 640);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final current = ValueNotifier(true), results = <String?>[];
          await newBranchDialogApp(
            tester,
            current,
            results,
            scale: 2.2,
            keyboard: landscape ? 120 : 260,
            brightness: brightness,
          );
          await tester.enterText(find.byType(TextField), 'qa-keyboard');
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          await tester.tap(find.text('Cancel'));
          await tester.pumpAndSettle();
          expect(results, [null]);
          expect(tester.takeException(), isNull);
          current.dispose();
        },
      );
    }
  }

  testWidgets(
    'dirty branch creation reviews carry or commit before any write',
    (tester) async {
      final transport =
          CreationGitTransport(PairingRepository(TestCredentials()))
            ..status['dirty'] = true
            ..status['files'] = [
              {'path': 'qa.dart', 'status': 'M'},
            ];
      await creationApp(tester, transport);
      await creationAction(tester, 'Create branch');
      expect(find.text('New branch'), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'feature');
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Create'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((call) => call['method'] == 'git/createBranch'),
        isEmpty,
      );
      expect(
        find.text("Bring local changes to 'djl/feature'?"),
        findsOneWidget,
      );
      expect(find.text('Carry to New Branch'), findsOneWidget);
      expect(find.text('Commit, Create & Switch'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((call) => call['method'] == 'git/createBranch'),
        isEmpty,
      );
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets(
    'default local commits require Create Anyway review before writing',
    (tester) async {
      final transport = CreationGitTransport(
        PairingRepository(TestCredentials()),
      )..status['localOnlyCommitCount'] = 2;
      await creationApp(tester, transport);
      await creationAction(tester, 'Create branch');
      await tester.enterText(find.byType(TextField), 'feature');
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Create'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((call) => call['method'] == 'git/createBranch'),
        isEmpty,
      );
      expect(find.text('Local commits stay on main'), findsOneWidget);
      expect(find.text('Create Anyway'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((call) => call['method'] == 'git/createBranch'),
        isEmpty,
      );
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets('dirty worktree creation blocks transfer from a different base', (
    tester,
  ) async {
    final transport = CreationGitTransport(PairingRepository(TestCredentials()))
      ..status['branch'] = 'feature'
      ..status['dirty'] = true;
    await creationApp(tester, transport);
    await creationAction(tester, 'Create worktree');
    await tester.enterText(find.byType(TextField), 'new-worktree');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Create'));
    await tester.pumpAndSettle();
    expect(
      transport.calls.where((call) => call['method'] == 'git/createWorktree'),
      isEmpty,
    );
    expect(
      find.text('Move local changes from the current branch'),
      findsOneWidget,
    );
    await tester.pumpWidget(const SizedBox());
    await transport.dispose();
  });
}
