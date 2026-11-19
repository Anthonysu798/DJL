import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/git/data/git_repository.dart';
import 'package:djl_mobile/features/git/presentation/git_branch_picker.dart';
import 'package:djl_mobile/features/git/presentation/git_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'git_branch_picker_widget_test.dart' show branchRow;
import 'git_creation_review_widget_test.dart' show CreationGitTransport;

class ComposerGitTransport extends CreationGitTransport {
  ComposerGitTransport(super.pairings);
  Completer<RemoteJson>? checkout;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'git/checkout') {
      calls.add({'method': method, 'params': Map.of(params)});
      final result =
          await (checkout?.future ?? Future.value(<String, dynamic>{}));
      status = {...status, 'branch': params['branch']};
      return result;
    }
    return super.request(method, params, timeout: timeout);
  }
}

Future<GlobalKey<NavigatorState>> composerEntry(
  WidgetTester tester,
  ComposerGitTransport remote,
  ValueNotifier<bool> current, {
  GitComposerAction action = GitComposerAction.branch,
  required List<String> paths,
  required List<Future<void>> operations,
}) async {
  final navigator = GlobalKey<NavigatorState>();
  await tester.pumpWidget(
    MaterialApp(
      navigatorKey: navigator,
      home: Scaffold(
        body: Align(
          alignment: Alignment.bottomLeft,
          child: Builder(
            builder: (context) => TextButton(
              onPressed: () {
                final child = GitPage(
                  composerAction: action,
                  repository: GitRepository(
                    remote,
                    cwd: '/qa/composer',
                    isCurrent: () => current.value,
                  ),
                  canChangeBranch: () => current.value,
                  scopeChanges: current,
                  onOpenWorktree: paths.add,
                  onRoutingOperation: operations.add,
                );
                if (action == GitComposerAction.branch) {
                  showGitBranchSurface<void>(context: context, child: child);
                } else {
                  showDialog<void>(context: context, builder: (_) => child);
                }
              },
              child: const Text('Open composer project action'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open composer project action'));
  await tester.pumpAndSettle();
  return navigator;
}

void main() {
  testWidgets(
    'composer branch entry opens the real picker and closes with reads only',
    (tester) async {
      final remote = ComposerGitTransport(PairingRepository(TestCredentials()));
      final current = ValueNotifier(true),
          paths = <String>[],
          operations = <Future<void>>[];
      await composerEntry(
        tester,
        remote,
        current,
        paths: paths,
        operations: operations,
      );
      expect(find.byType(GitBranchPicker), findsOneWidget);
      expect(find.text('Git'), findsNothing);
      await tester.tap(find.byTooltip('Close branch picker'));
      await tester.pumpAndSettle();
      expect(find.byType(GitPage), findsNothing);
      expect(remote.calls.map((c) => c['method']), [
        'git/status',
        'git/branches',
      ]);
      expect(operations, isEmpty);
      expect(paths, isEmpty);
      await tester.pumpWidget(const SizedBox());
      await remote.dispose();
      current.dispose();
    },
  );

  testWidgets(
    'composer checkout owns its accepted operation after forced route removal',
    (tester) async {
      final remote = ComposerGitTransport(PairingRepository(TestCredentials()));
      final gate = remote.checkout = Completer<RemoteJson>();
      final current = ValueNotifier(true),
          paths = <String>[],
          operations = <Future<void>>[];
      final navigator = await composerEntry(
        tester,
        remote,
        current,
        paths: paths,
        operations: operations,
      );
      await tester.tap(branchRow('feature'));
      await tester.pump(const Duration(milliseconds: 20));
      expect(
        remote.calls.where((c) => c['method'] == 'git/checkout'),
        hasLength(1),
      );
      expect(operations, hasLength(1));
      var settled = false;
      operations.single.then((_) => settled = true);
      await tester.binding.handlePopRoute();
      await tester.pump(const Duration(milliseconds: 200));
      expect(find.byType(GitPage), findsOneWidget);
      navigator.currentState!.pop();
      await tester.pumpAndSettle();
      expect(find.byType(GitPage), findsNothing);
      expect(settled, isFalse);
      gate.complete({});
      await tester.pumpAndSettle();
      expect(settled, isTrue);
      expect(
        remote.calls.where((c) => c['method'] == 'git/checkout'),
        hasLength(1),
      );
      expect(paths, isEmpty);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await remote.dispose();
      current.dispose();
    },
  );

  testWidgets('composer picker refuses a stale routing choice', (tester) async {
    final remote = ComposerGitTransport(PairingRepository(TestCredentials()));
    final current = ValueNotifier(true),
        paths = <String>[],
        operations = <Future<void>>[];
    await composerEntry(
      tester,
      remote,
      current,
      paths: paths,
      operations: operations,
    );
    current.value = false;
    await tester.pumpAndSettle();
    expect(find.textContaining('Thread or desktop changed'), findsOneWidget);
    expect(remote.calls.where((c) => c['method'] == 'git/checkout'), isEmpty);
    expect(operations, isEmpty);
    await tester.tap(find.byTooltip('Close branch picker'));
    await tester.pumpAndSettle();
    await tester.pumpWidget(const SizedBox());
    await remote.dispose();
    current.dispose();
  });

  for (final create in [false, true]) {
    testWidgets(
      'draft composer worktree entry create=$create uses the existing naming flow',
      (tester) async {
        final remote = ComposerGitTransport(
          PairingRepository(TestCredentials()),
        );
        final current = ValueNotifier(true),
            paths = <String>[],
            operations = <Future<void>>[];
        await composerEntry(
          tester,
          remote,
          current,
          action: GitComposerAction.worktree,
          paths: paths,
          operations: operations,
        );
        expect(find.text('Create worktree'), findsOneWidget);
        expect(
          remote.calls.where((c) => c['method'] == 'git/createWorktree'),
          isEmpty,
        );
        if (create) {
          await tester.enterText(find.byType(TextField), 'composer-feature');
          await tester.pump();
          await tester.tap(find.widgetWithText(FilledButton, 'Create'));
        } else {
          await tester.tap(find.text('Cancel'));
        }
        await tester.pumpAndSettle();
        expect(
          find.byType(GitPage),
          findsNothing,
          reason:
              '${find.byType(Text).evaluate().map((e) => (e.widget as Text).data).toList()} ${remote.calls}',
        );
        expect(paths, create ? ['/qa/worktree'] : isEmpty);
        final mutations = remote.calls
            .where((c) => c['method'] == 'git/createWorktree')
            .toList();
        expect(mutations, hasLength(create ? 1 : 0));
        if (create) {
          expect(mutations.single['params'], {
            'name': 'djl/composer-feature',
            'baseBranch': 'main',
            'changeTransfer': 'move',
            'cwd': '/qa/composer',
          });
        }
        await tester.pumpWidget(const SizedBox());
        await remote.dispose();
        current.dispose();
      },
    );
  }
}
