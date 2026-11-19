import 'dart:async';
import 'dart:ui' show SemanticsAction;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/core/design/djl_tokens.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/git/data/git_repository.dart';
import 'package:djl_mobile/features/git/domain/git_branch_picker_models.dart';
import 'package:djl_mobile/features/git/presentation/git_branch_picker.dart';
import 'package:djl_mobile/features/git/presentation/git_controller.dart';
import 'package:djl_mobile/features/git/presentation/git_page.dart';
import 'package:djl_mobile/features/git/presentation/git_new_branch_dialog.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/core/design/djl_icons.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_requests_test.dart' show TestTransport;

class PickerTransport extends TestTransport {
  PickerTransport(super.pairings);
  Completer<RemoteJson>? heldBranches;
  bool failBranches = false;
  RemoteJson branchData = {
    'branches': ['other', 'main', 'feature', 'mapped', 'blocked'],
    'current': 'feature',
    'default': 'main',
    'branchesCheckedOutElsewhere': ['mapped', 'blocked'],
    'worktreePathByBranch': {'mapped': '/qa/mapped'},
  };
  @override
  String? get macDeviceId => 'picker-mac';
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': Map.of(params)});
    if (method == 'git/branches') {
      if (failBranches) {
        failBranches = false;
        throw StateError('QA branch reload failed');
      }
      return heldBranches?.future ?? Map.of(branchData);
    }
    return {'isRepo': true, 'branch': branchData['current'], 'files': []};
  }
}

Future<GitController> pickerApp(
  WidgetTester tester,
  PickerTransport remote,
  ValueNotifier<bool> current,
  List<GitBranchChoice?> results, {
  double scale = 1,
  double keyboard = 0,
  Brightness brightness = Brightness.light,
}) async {
  final git = GitController(
    GitRepository(remote, cwd: '/qa/picker', isCurrent: () => current.value),
  );
  await git.refresh();
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
        body: Align(
          alignment: Alignment.bottomRight,
          child: Builder(
            builder: (context) => TextButton(
              onPressed: () async {
                results.add(
                  await showGitBranchPicker(
                    context: context,
                    controller: git,
                    isCurrent: () => current.value,
                    scopeChanges: current,
                  ),
                );
              },
              child: const Text('Open branch picker'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open branch picker'));
  await tester.pumpAndSettle();
  return git;
}

Future<void> finishPicker(
  WidgetTester tester,
  GitController git,
  PickerTransport remote,
  ValueNotifier<bool> current,
) async {
  await tester.pumpWidget(const SizedBox());
  git.dispose();
  await remote.dispose();
  current.dispose();
}

Finder branchRow(String name) => find
    .ancestor(
      of: find.descendant(
        of: find.byType(GitBranchPicker),
        matching: find.text(name),
      ),
      matching: find.byType(InkWell),
    )
    .first;

Future<void> openBranchPickerForTest(WidgetTester tester) async {
  final trigger = find.byKey(const Key('git.current-branch'));
  await tester.ensureVisible(trigger);
  await tester.pumpAndSettle();
  await tester.tap(trigger);
  await tester.pumpAndSettle();
}

Future<void> exposePicker(
  WidgetTester tester,
  Finder target, {
  double delta = 100,
}) async {
  await tester.scrollUntilVisible(
    target,
    delta,
    scrollable: find
        .descendant(
          of: find.byType(GitBranchPicker),
          matching: find.byType(Scrollable),
        )
        .first,
  );
  await tester.pumpAndSettle();
}

void main() {
  for (final brightness in Brightness.values) {
    testWidgets(
      'source branch badges retain visible raised fill in $brightness',
      (tester) async {
        final remote = PickerTransport(PairingRepository(TestCredentials()));
        final current = ValueNotifier(true), results = <GitBranchChoice?>[];
        final git = await pickerApp(
          tester,
          remote,
          current,
          results,
          brightness: brightness,
        );
        for (final label in ['Current', 'Default']) {
          final text = find.text(label);
          final capsule = find
              .ancestor(of: text, matching: find.byType(DecoratedBox))
              .first;
          final decoration =
              tester.widget<DecoratedBox>(capsule).decoration as BoxDecoration;
          final context = tester.element(text);
          final fill = DjlColors.of(context).surfaceRaised;
          expect(decoration.color, fill);
          final row = Theme.of(context).colorScheme.surface;
          expect(Color.alphaBlend(decoration.color!, row), isNot(row));
        }
        await finishPicker(tester, git, remote, current);
      },
    );
  }
  for (final dismissal in ['outside', 'back']) {
    testWidgets(
      'picker $dismissal dismissal returns no action and preserves its parent',
      (tester) async {
        final remote = PickerTransport(PairingRepository(TestCredentials()));
        final current = ValueNotifier(true), results = <GitBranchChoice?>[];
        final git = await pickerApp(tester, remote, current, results);
        if (dismissal == 'outside') {
          await tester.tapAt(const Offset(8, 8));
        } else {
          await tester.binding.handlePopRoute();
        }
        await tester.pumpAndSettle();
        expect(results, [null]);
        expect(find.text('Open branch picker'), findsOneWidget);
        expect(remote.calls, hasLength(2));
        await finishPicker(tester, git, remote, current);
      },
    );
  }

  testWidgets(
    'removed branch cannot activate a captured row after metadata reload',
    (tester) async {
      final remote = PickerTransport(PairingRepository(TestCredentials()));
      final current = ValueNotifier(true), results = <GitBranchChoice?>[];
      final git = await pickerApp(tester, remote, current, results);
      final old = tester.widget<InkWell>(branchRow('feature')).onTap!;
      remote.branchData = {
        'branches': ['main', 'other'],
        'current': 'main',
        'default': 'main',
      };
      await exposePicker(tester, find.text('Reload branch list'));
      await tester.tap(find.text('Reload branch list'));
      await tester.pumpAndSettle();
      old();
      await tester.pumpAndSettle();
      expect(results, isEmpty);
      expect(find.byType(GitBranchPicker), findsOneWidget);
      expect(remote.calls.map((call) => call['method']), [
        'git/status',
        'git/branches',
        'git/status',
        'git/branches',
      ]);
      await finishPicker(tester, git, remote, current);
    },
  );

  for (final target in ['other', 'feature']) {
    testWidgets(
      'real GitPage directly checks out selected source branch $target',
      (tester) async {
        final remote = PickerTransport(PairingRepository(TestCredentials()));
        await tester.pumpWidget(
          MaterialApp(
            home: GitPage(
              repository: GitRepository(remote, cwd: '/qa/picker-page'),
              onOpenWorktree: (_) {},
            ),
          ),
        );
        await tester.pumpAndSettle();
        await openBranchPickerForTest(tester);
        await exposePicker(tester, branchRow(target));
        await tester.tap(branchRow(target));
        await tester.pumpAndSettle();
        final write = remote.calls
            .where((call) => call['method'] == 'git/checkout')
            .single;
        expect(write['params'], {'branch': target, 'cwd': '/qa/picker-page'});
        expect(find.text('Switch branch?'), findsNothing);
        expect(find.byType(GitBranchPicker), findsNothing);
        await tester.pumpWidget(const SizedBox());
        await remote.dispose();
      },
    );
  }

  testWidgets(
    'real GitPage quick creation reuses one source creation pipeline',
    (tester) async {
      final remote = PickerTransport(PairingRepository(TestCredentials()));
      await tester.pumpWidget(
        MaterialApp(
          home: GitPage(
            repository: GitRepository(remote, cwd: '/qa/picker-page'),
            onOpenWorktree: (_) {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      await openBranchPickerForTest(tester);
      await tester.enterText(find.byType(TextField), 'qa-quick');
      await tester.pumpAndSettle();
      await exposePicker(
        tester,
        find.text("Create and checkout 'djl/qa-quick'"),
      );
      await tester.tap(find.text("Create and checkout 'djl/qa-quick'"));
      await tester.pumpAndSettle();
      final write = remote.calls
          .where((call) => call['method'] == 'git/createBranch')
          .single;
      expect(write['params'], {
        'name': 'djl/qa-quick',
        'cwd': '/qa/picker-page',
      });
      expect(find.byType(GitNewBranchDialog), findsNothing);
      expect(
        remote.calls.where(
          (call) => {
            'git/commit',
            'git/push',
            'git/runStackedAction',
            'thread/fork',
            'thread/start',
          }.contains(call['method']),
        ),
        isEmpty,
      );
      await tester.pumpWidget(const SizedBox());
      await remote.dispose();
    },
  );

  testWidgets(
    'picker shows source current/default/worktree badges and selected check',
    (tester) async {
      final semantics = tester.ensureSemantics();
      final remote = PickerTransport(PairingRepository(TestCredentials()));
      final current = ValueNotifier(true), results = <GitBranchChoice?>[];
      final git = await pickerApp(tester, remote, current, results);
      for (final label in [
        'Current Branch',
        'Branches',
        'Current',
        'Default',
        'Open worktree',
        'Open elsewhere',
      ]) {
        expect(find.text(label), findsOneWidget);
      }
      expect(
        tester.getTopLeft(find.text('main')).dy,
        lessThan(tester.getTopLeft(find.text('feature')).dy),
      );
      expect(
        tester.getTopLeft(find.text('feature')).dy,
        lessThan(tester.getTopLeft(find.text('other')).dy),
      );
      expect(find.byIcon(DjlIcons.check), findsOneWidget);
      await exposePicker(tester, find.text('New branch...'));
      expect(find.text('New branch...'), findsOneWidget);
      expect(find.text('Reload branch list'), findsOneWidget);
      await exposePicker(tester, branchRow('blocked'));
      final blocked = tester.getSemantics(
        find.bySemanticsLabel('blocked, Open elsewhere'),
      );
      expect(
        blocked.getSemanticsData().hasAction(SemanticsAction.tap),
        isFalse,
      );
      expect(remote.calls.map((call) => call['method']), [
        'git/status',
        'git/branches',
      ]);
      semantics.dispose();
      await finishPicker(tester, git, remote, current);
    },
  );

  testWidgets(
    'search is local, keeps default row and exposes source no-match/create choices',
    (tester) async {
      final remote = PickerTransport(PairingRepository(TestCredentials()));
      final current = ValueNotifier(true), results = <GitBranchChoice?>[];
      final git = await pickerApp(tester, remote, current, results);
      await tester.enterText(find.byType(TextField), 'qa-search');
      await tester.pumpAndSettle();
      expect(find.text('main'), findsOneWidget);
      expect(find.text('feature'), findsNothing);
      expect(find.text('No branches found'), findsOneWidget);
      expect(
        find.text('Try a different search or refresh the branch list.'),
        findsOneWidget,
      );
      expect(find.text("Create and checkout 'djl/qa-search'"), findsOneWidget);
      expect(remote.calls, hasLength(2));
      await finishPicker(tester, git, remote, current);
    },
  );

  testWidgets(
    'New branch from search pre-fills the named dialog and Cancel preserves search',
    (tester) async {
      final remote = PickerTransport(PairingRepository(TestCredentials()));
      final current = ValueNotifier(true), results = <GitBranchChoice?>[];
      final git = await pickerApp(tester, remote, current, results);
      await tester.enterText(find.byType(TextField), 'qa-new');
      await tester.pumpAndSettle();
      await exposePicker(tester, find.text('New branch...'));
      await tester.tap(find.text('New branch...'));
      await tester.pumpAndSettle();
      final input = find.descendant(
        of: find.byType(GitNewBranchDialog),
        matching: find.byType(TextField),
      );
      expect(tester.widget<TextField>(input).controller!.text, 'djl/qa-new');
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(find.text("Create and checkout 'djl/qa-new'"), findsOneWidget);
      expect(results, isEmpty);
      expect(remote.calls, hasLength(2));
      await finishPicker(tester, git, remote, current);
    },
  );

  testWidgets(
    'quick create returns one explicit typed choice without a mutation',
    (tester) async {
      final remote = PickerTransport(PairingRepository(TestCredentials()));
      final current = ValueNotifier(true), results = <GitBranchChoice?>[];
      final git = await pickerApp(tester, remote, current, results);
      await tester.enterText(find.byType(TextField), 'qa-new');
      await tester.pumpAndSettle();
      await exposePicker(tester, find.text("Create and checkout 'djl/qa-new'"));
      await tester.tap(find.text("Create and checkout 'djl/qa-new'"));
      await tester.pumpAndSettle();
      expect(results, [(branch: 'djl/qa-new', create: true)]);
      expect(remote.calls, hasLength(2));
      await finishPicker(tester, git, remote, current);
    },
  );

  testWidgets(
    'mapped selection returns a branch choice while blocked selection does nothing',
    (tester) async {
      final remote = PickerTransport(PairingRepository(TestCredentials()));
      final current = ValueNotifier(true), results = <GitBranchChoice?>[];
      final git = await pickerApp(tester, remote, current, results);
      await exposePicker(tester, branchRow('blocked'));
      await tester.tap(branchRow('blocked'));
      await tester.pumpAndSettle();
      expect(results, isEmpty);
      await exposePicker(tester, branchRow('mapped'));
      await tester.tap(branchRow('mapped'));
      await tester.pumpAndSettle();
      expect(results, [(branch: 'mapped', create: false)]);
      expect(remote.calls, hasLength(2));
      await finishPicker(tester, git, remote, current);
    },
  );

  testWidgets(
    'reload shows pending metadata and preserves search after success',
    (tester) async {
      final remote = PickerTransport(PairingRepository(TestCredentials()));
      final current = ValueNotifier(true), results = <GitBranchChoice?>[];
      final git = await pickerApp(tester, remote, current, results);
      await tester.enterText(find.byType(TextField), 'new');
      await tester.pumpAndSettle();
      final reply = remote.heldBranches = Completer<RemoteJson>();
      await exposePicker(tester, find.text('Reload branch list'));
      await tester.tap(find.text('Reload branch list'));
      await tester.pump(const Duration(milliseconds: 250));
      expect(find.text('Refreshing...'), findsOneWidget);
      reply.complete({
        'branches': ['main', 'newly-loaded'],
        'default': 'main',
        'current': 'main',
      });
      await tester.pumpAndSettle();
      expect(find.text('newly-loaded'), findsOneWidget);
      await exposePicker(tester, find.byType(TextField), delta: -100);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'new',
      );
      expect(
        remote.calls.where((call) => call['method'] == 'git/branches'),
        hasLength(2),
      );
      await finishPicker(tester, git, remote, current);
    },
  );

  testWidgets(
    'named creation closes its own alert and picker with one typed result',
    (tester) async {
      final remote = PickerTransport(PairingRepository(TestCredentials()));
      final current = ValueNotifier(true), results = <GitBranchChoice?>[];
      final git = await pickerApp(tester, remote, current, results);
      await tester.enterText(find.byType(TextField), 'qa-named');
      await tester.pumpAndSettle();
      await exposePicker(tester, find.text('New branch...'));
      await tester.tap(find.text('New branch...'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Create'));
      await tester.pumpAndSettle();
      expect(results, [(branch: 'djl/qa-named', create: true)]);
      expect(find.byType(GitNewBranchDialog), findsNothing);
      expect(find.byType(GitBranchPicker), findsNothing);
      expect(tester.takeException(), isNull);
      expect(remote.calls, hasLength(2));
      await finishPicker(tester, git, remote, current);
    },
  );

  testWidgets(
    'failed reload stays visible until an explicit successful retry',
    (tester) async {
      final remote = PickerTransport(PairingRepository(TestCredentials()));
      final current = ValueNotifier(true), results = <GitBranchChoice?>[];
      final git = await pickerApp(tester, remote, current, results);
      final old = tester.widget<InkWell>(branchRow('feature')).onTap!;
      remote.failBranches = true;
      await exposePicker(tester, find.text('Reload branch list'));
      await tester.tap(find.text('Reload branch list'));
      await tester.pumpAndSettle();
      expect(find.textContaining('QA branch reload failed'), findsOneWidget);
      old();
      await tester.pumpAndSettle();
      expect(results, isEmpty);
      expect(
        remote.calls.where((call) => call['method'] == 'git/branches'),
        hasLength(2),
      );
      await exposePicker(tester, find.text('Reload branch list'));
      await tester.tap(find.text('Reload branch list'));
      await tester.pumpAndSettle();
      expect(find.textContaining('QA branch reload failed'), findsNothing);
      expect(
        remote.calls.where((call) => call['method'] == 'git/branches'),
        hasLength(3),
      );
      await finishPicker(tester, git, remote, current);
    },
  );

  testWidgets(
    'owner change hides branch data and refuses a captured row callback',
    (tester) async {
      final remote = PickerTransport(PairingRepository(TestCredentials()));
      final current = ValueNotifier(true), results = <GitBranchChoice?>[];
      final git = await pickerApp(tester, remote, current, results);
      final row = tester.widget<InkWell>(branchRow('feature')).onTap!;
      current.value = false;
      await tester.pumpAndSettle();
      row();
      await tester.pumpAndSettle();
      expect(find.text('feature'), findsNothing);
      expect(find.textContaining('changed'), findsOneWidget);
      expect(results, isEmpty);
      expect(remote.calls, hasLength(2));
      await tester.tap(find.byTooltip('Close branch picker'));
      await tester.pumpAndSettle();
      expect(results, [null]);
      await finishPicker(tester, git, remote, current);
    },
  );

  for (final brightness in Brightness.values) {
    for (final landscape in [false, true]) {
      testWidgets(
        'picker scrolls safely with keyboard/large text $brightness landscape=$landscape',
        (tester) async {
          tester.view.physicalSize = landscape
              ? const Size(700, 360)
              : const Size(360, 640);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final remote = PickerTransport(PairingRepository(TestCredentials()));
          final current = ValueNotifier(true), results = <GitBranchChoice?>[];
          final git = await pickerApp(
            tester,
            remote,
            current,
            results,
            scale: 2.2,
            keyboard: landscape ? 120 : 260,
            brightness: brightness,
          );
          expect(tester.takeException(), isNull);
          await tester.drag(find.byType(ListView), const Offset(0, -300));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          await tester.tap(find.byTooltip('Close branch picker'));
          await tester.pumpAndSettle();
          expect(results, [null]);
          await finishPicker(tester, git, remote, current);
        },
      );
    }
  }
}
