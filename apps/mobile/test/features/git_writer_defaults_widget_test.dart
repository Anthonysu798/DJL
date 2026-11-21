import 'package:djl_mobile/core/presentation/djl_glass_menu.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/git/presentation/git_page.dart';
import 'package:djl_mobile/features/git/data/git_repository.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_requests_test.dart' show TestTransport;
import '../core/cloud_client_test.dart' show TestCredentials;

class WriterTransport extends TestTransport {
  WriterTransport(super.pairings);
  int generation = 0;
  @override
  String? get macDeviceId => 'mac-a';
  @override
  String? get sessionId => 'writer-session';
  @override
  int get connectionRevision => generation;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': Map.of(params)});
    return switch (method) {
      'git/status' => {
        'isRepo': true,
        'branch': 'qa',
        'dirty': true,
        'files': [],
      },
      'git/branches' => {
        'branches': ['qa'],
        'default': 'qa',
      },
      'git/generatePullRequestDraft' => {
        'title': 'Draft title',
        'body': 'Draft body',
      },
      'git/generateCommitMessage' => {'fullMessage': 'Generated message'},
      _ => {},
    };
  }
}

void main() {
  testWidgets('Git connection replacement blocks an open branch confirmation', (
    tester,
  ) async {
    final transport = WriterTransport(PairingRepository(TestCredentials()));
    await tester.pumpWidget(
      MaterialApp(
        home: GitPage(
          repository: GitRepository(transport, cwd: '/test'),
          onOpenWorktree: (_) {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DjlGlassMenuButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Create branch'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'stale-git-qa');
    await tester.pump();
    transport.generation++;
    await tester.tap(find.widgetWithText(FilledButton, 'Create'));
    await tester.pumpAndSettle();
    expect(
      transport.calls.where((call) => call['method'] == 'git/createBranch'),
      isEmpty,
    );
    expect(find.textContaining('Close and reopen'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Connected desktop changed'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    await transport.dispose();
  });

  testWidgets(
    'Git writer starts with mini fallback rather than an implicit desktop default',
    (tester) async {
      final transport = WriterTransport(PairingRepository(TestCredentials()));
      await tester.pumpWidget(
        MaterialApp(
          home: GitPage(
            repository: GitRepository(transport, cwd: '/test'),
            writerModels: const ['gpt-5.5', 'gpt-5.4-mini'],
            onOpenWorktree: (_) {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      final picker = find.byType(DropdownButton<String>).last;
      expect(
        tester.widget<DropdownButton<String>>(picker).value,
        'gpt-5.4-mini',
      );
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );
  testWidgets(
    'Git requests use the saved raw writer and retain an explicit operation override',
    (tester) async {
      final transport = WriterTransport(PairingRepository(TestCredentials()));
      await tester.pumpWidget(
        MaterialApp(
          home: GitPage(
            repository: GitRepository(transport, cwd: '/test'),
            writerModels: const ['gpt-5.5', 'gpt-5.4-mini'],
            initialWriter: 'gpt-5.5',
            onOpenWorktree: (_) {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      final picker = find.byKey(const Key('git-operation-writer'));
      expect(tester.widget<DropdownButton<String>>(picker).value, 'gpt-5.5');
      await tester.tap(find.byType(DjlGlassMenuButton<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Generate PR draft'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.firstWhere(
          (c) => c['method'] == 'git/generatePullRequestDraft',
        )['params'],
        {'cwd': '/test', 'model': 'gpt-5.5', 'baseBranch': 'qa'},
      );
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(picker);
      await tester.tap(picker);
      await tester.pumpAndSettle();
      await tester.tap(find.text('gpt-5.4-mini').last);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Commit changes'));
      await tester.tap(find.text('Commit changes'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Generate message'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.firstWhere(
          (c) => c['method'] == 'git/generateCommitMessage',
        )['params'],
        {'cwd': '/test', 'model': 'gpt-5.4-mini'},
      );
      expect(find.text('Generated message'), findsOneWidget);
      expect(
        transport.calls.where(
          (c) => {
            'git/commit',
            'git/push',
            'git/runStackedAction',
          }.contains(c['method']),
        ),
        isEmpty,
      );
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );
  for (final action in [
    'Create branch',
    'Transfer changes to workspace',
    'Commit changes',
    'Commit and push',
  ]) {
    testWidgets(
      'missing Git writer still permits manual $action without enabling AI drafting',
      (tester) async {
        final transport = WriterTransport(PairingRepository(TestCredentials()));
        await tester.pumpWidget(
          MaterialApp(
            home: GitPage(
              repository: GitRepository(transport, cwd: '/test'),
              onOpenWorktree: (_) {},
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byType(DjlGlassMenuButton<String>));
        await tester.pumpAndSettle();
        for (final label in [
          'Generate PR draft',
          'Create pull request',
          'Commit, push and create PR',
        ]) {
          final item = tester.widget<PopupMenuItem<String>>(
            find.ancestor(
              of: find.text(label),
              matching: find.byType(PopupMenuItem<String>),
            ),
          );
          expect(item.enabled, false);
        }
        if (action == 'Commit changes') {
          await tester.tapAt(const Offset(10, 400));
          await tester.pumpAndSettle();
          await tester.tap(find.text(action));
        } else {
          await tester.ensureVisible(find.text(action));
          await tester.tap(find.text(action));
        }
        await tester.pumpAndSettle();
        final input = action == 'Transfer changes to workspace'
            ? '/target'
            : action == 'Create branch'
            ? 'new-branch'
            : 'Manual message';
        await tester.enterText(find.byType(TextField), input);
        await tester.pump();
        final proceed = find.widgetWithText(
          FilledButton,
          action == 'Create branch' ? 'Create' : 'Continue',
        );
        expect(tester.widget<FilledButton>(proceed).onPressed, isNotNull);
        if (action == 'Commit changes' || action == 'Commit and push') {
          expect(
            tester
                .widget<TextButton>(
                  find.widgetWithText(TextButton, 'Generate message'),
                )
                .onPressed,
            isNull,
          );
        }
        await tester.tap(proceed);
        await tester.pumpAndSettle();
        if (action == 'Create branch') {
          await tester.tap(find.text('Carry to New Branch'));
          await tester.pumpAndSettle();
        }
        if (action == 'Commit and push') {
          await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
          await tester.pumpAndSettle();
        }
        final method = switch (action) {
          'Create branch' => 'git/createBranch',
          'Transfer changes to workspace' => 'git/transferManagedHandoff',
          'Commit changes' => 'git/commit',
          _ => 'git/runStackedAction',
        };
        final params =
            transport.calls.singleWhere(
                  (call) => call['method'] == method,
                )['params']
                as Map;
        expect(params['cwd'], '/test');
        switch (action) {
          case 'Create branch':
            expect(params['name'], 'djl/new-branch');
          case 'Transfer changes to workspace':
            expect(params['targetPath'], '/target');
          case 'Commit changes':
            expect(params['message'], 'Manual message');
          default:
            expect(params['action'], 'commit_push');
            expect(params['commitMessage'], 'Manual message');
        }
        expect(
          transport.calls.where(
            (call) => {
              'git/generateCommitMessage',
              'git/generatePullRequestDraft',
            }.contains(call['method']),
          ),
          isEmpty,
        );
        await tester.pumpWidget(const SizedBox());
        await transport.dispose();
      },
    );
  }
}
