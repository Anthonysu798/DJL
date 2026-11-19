import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/git/data/git_repository.dart';
import 'package:djl_mobile/features/git/presentation/git_toolbar_menu.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_requests_test.dart' show TestTransport;

class MenuGitTransport extends TestTransport {
  MenuGitTransport(super.pairings);
  int revision = 0;
  Completer<RemoteJson>? heldStatus;
  Completer<RemoteJson>? heldMessage;
  String diffPatch = 'diff --git a/qa.txt b/qa.txt\n+QA change';
  Object? diffError;
  RemoteJson status = {
    'isRepo': true,
    'branch': 'feature',
    'hasPushRemote': true,
    'hasHeadCommit': true,
    'publishedToRemote': true,
    'state': 'up_to_date',
    'diff': {'additions': 0, 'deletions': 0, 'binaryFiles': 0},
  };
  @override
  String? get macDeviceId => 'mac-a';
  @override
  String? get sessionId => 'menu-session';
  @override
  int get connectionRevision => revision;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': Map.of(params)});
    if (method == 'git/diff' && diffError != null) throw diffError!;
    return switch (method) {
      'git/status' => heldStatus?.future ?? Map.of(status),
      'git/branches' => {
        'default': 'main',
        'branches': ['main', 'feature'],
      },
      'git/diff' => {'patch': diffPatch},
      'git/generateCommitMessage' =>
        heldMessage?.future ?? {'fullMessage': 'Generated QA message'},
      'git/runStackedAction' => {
        'summary': 'QA pull request created',
        'pr': {'url': 'https://example.invalid/qa/pull/1'},
      },
      _ => {},
    };
  }
}

Future<void> menuApp(
  WidgetTester tester,
  MenuGitTransport transport, {
  bool Function()? isCurrent,
  List<String> models = const ['qa-model'],
  double scale = 1,
  double keyboard = 0,
}) async {
  final current = isCurrent ?? () => true;
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
      home: Scaffold(
        body: Align(
          alignment: Alignment.topRight,
          child: Builder(
            builder: (context) => IconButton(
              tooltip: 'Git actions',
              onPressed: () => showGitToolbarMenu(
                context: context,
                repository: GitRepository(transport, cwd: '/qa/menu'),
                isCurrent: current,
                writerModels: models,
                initialWriter: models.firstOrNull,
              ),
              icon: const Icon(Icons.commit),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> openMenu(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Git actions'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Git popup surface starts below its actual button', (
    tester,
  ) async {
    final transport = MenuGitTransport(PairingRepository(TestCredentials()));
    await menuApp(tester, transport);
    final button = tester.getRect(find.byTooltip('Git actions'));
    await openMenu(tester);
    final surface = find
        .ancestor(
          of: find.byKey(const Key('git.menu.action.changes')),
          matching: find.byType(Material),
        )
        .first;
    expect(tester.getRect(surface).top, greaterThanOrEqualTo(button.bottom));
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    await tester.pumpWidget(const SizedBox());
    await transport.dispose();
  });

  testWidgets('Git menu removes its painted surface while review is open', (
    tester,
  ) async {
    final transport = MenuGitTransport(PairingRepository(TestCredentials()));
    await menuApp(tester, transport);
    await openMenu(tester);
    final surface = tester.element(
      find
          .ancestor(
            of: find.byKey(const Key('git.menu.action.changes')),
            matching: find.byType(Material),
          )
          .first,
    );
    await tester.tap(find.byKey(const Key('git.menu.action.commit')));
    await tester.pumpAndSettle();
    expect(find.text('Commit all current changes'), findsOneWidget);
    expect(surface.mounted, isFalse);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(transport.calls.map((call) => call['method']), [
      'git/status',
      'git/branches',
    ]);
    await tester.pumpWidget(const SizedBox());
    await transport.dispose();
  });

  testWidgets(
    'combined PR review prepares a feature branch from the default branch',
    (tester) async {
      final transport = MenuGitTransport(PairingRepository(TestCredentials()))
        ..status['branch'] = 'main'
        ..status['dirty'] = true;
      await menuApp(tester, transport);
      await openMenu(tester);
      await tester.tap(find.byKey(const Key('git.menu.action.commitPushPr')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Reviewed feature work');
      await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
      await tester.pumpAndSettle();
      expect(find.text('Publish this branch?'), findsOneWidget);
      expect(
        transport.calls.where(
          (call) => call['method'] == 'git/runStackedAction',
        ),
        isEmpty,
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Continue'));
      await tester.pumpAndSettle();
      final params =
          transport.calls.singleWhere(
                (call) => call['method'] == 'git/runStackedAction',
              )['params']
              as Map;
      expect(params['cwd'], '/qa/menu');
      expect(params['action'], 'commit_push_pr');
      expect(params['commitMessage'], 'Reviewed feature work');
      expect(params['model'], 'qa-model');
      expect(params['baseBranch'], 'main');
      expect(params['featureBranch'], isTrue);
      expect(find.text('QA pull request created'), findsOneWidget);
      expect(find.text('Open PR'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets(
    'failed Git generation preserves manual text and shows the failure',
    (tester) async {
      final transport = MenuGitTransport(PairingRepository(TestCredentials()));
      final reply = transport.heldMessage = Completer<RemoteJson>();
      await menuApp(tester, transport);
      await openMenu(tester);
      await tester.tap(find.byKey(const Key('git.menu.action.commit')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Keep my manual message');
      await tester.tap(find.text('Generate message'));
      await tester.pump();
      reply.completeError(StateError('QA writer unavailable'));
      await tester.pumpAndSettle();
      expect(find.textContaining('QA writer unavailable'), findsOneWidget);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'Keep my manual message',
      );
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((call) => call['method'] == 'git/commit'),
        isEmpty,
      );
      expect(find.text('Git action completed.'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets(
    'normal Git popup dismissal does not show a changed-owner error',
    (tester) async {
      final transport = MenuGitTransport(PairingRepository(TestCredentials()));
      await menuApp(tester, transport);
      await openMenu(tester);
      await tester.binding.handlePopRoute();
      await tester.pump(const Duration(milliseconds: 16));
      expect(find.textContaining('Connected desktop changed'), findsNothing);
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  for (final layout in [
    (const Size(360, 780), 2.2, 300.0),
    (const Size(780, 360), 1.0, 180.0),
  ]) {
    testWidgets(
      'Git popup keeps its final action above the keyboard at $layout',
      (tester) async {
        await tester.binding.setSurfaceSize(layout.$1);
        addTearDown(() => tester.binding.setSurfaceSize(null));
        final transport = MenuGitTransport(
          PairingRepository(TestCredentials()),
        );
        await menuApp(tester, transport, scale: layout.$2, keyboard: layout.$3);
        await openMenu(tester);
        final update = find.byKey(const Key('git.menu.action.update'));
        await tester.ensureVisible(update);
        await tester.pumpAndSettle();
        expect(
          tester.getRect(update).bottom,
          lessThanOrEqualTo(layout.$1.height - layout.$3),
        );
        expect(tester.takeException(), isNull);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        await tester.pumpWidget(const SizedBox());
        await transport.dispose();
      },
    );
  }

  testWidgets('late generated Git text cannot replace a newer manual edit', (
    tester,
  ) async {
    final transport = MenuGitTransport(PairingRepository(TestCredentials()));
    final reply = transport.heldMessage = Completer<RemoteJson>();
    await menuApp(tester, transport);
    await openMenu(tester);
    await tester.tap(find.byKey(const Key('git.menu.action.commit')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Initial manual draft');
    await tester.tap(find.text('Generate message'));
    await tester.pump();
    await tester.enterText(
      find.byType(TextField),
      'Keep this newer manual edit',
    );
    reply.complete({'fullMessage': 'Late generated replacement'});
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      'Keep this newer manual edit',
    );
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.text('Git action completed.'), findsNothing);
    expect(
      transport.calls.where((call) => call['method'] == 'git/commit'),
      isEmpty,
    );
    await tester.pumpWidget(const SizedBox());
    await transport.dispose();
  });

  testWidgets(
    'generated Git text arriving after cancellation stays dismissed',
    (tester) async {
      final transport = MenuGitTransport(PairingRepository(TestCredentials()));
      final reply = transport.heldMessage = Completer<RemoteJson>();
      await menuApp(tester, transport);
      await openMenu(tester);
      await tester.tap(find.byKey(const Key('git.menu.action.commit')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Generate message'));
      await tester.pump();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      reply.complete({'fullMessage': 'Dismissed generated replacement'});
      await tester.pumpAndSettle();
      expect(find.byType(TextField), findsNothing);
      expect(find.text('Git action completed.'), findsNothing);
      expect(tester.takeException(), isNull);
      expect(
        transport.calls.where((call) => call['method'] == 'git/commit'),
        isEmpty,
      );
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets('a covered Git review callback cannot pop another route', (
    tester,
  ) async {
    final transport = MenuGitTransport(PairingRepository(TestCredentials()));
    await menuApp(tester, transport);
    await openMenu(tester);
    await tester.tap(find.byKey(const Key('git.menu.action.commit')));
    await tester.pumpAndSettle();
    final oldCancel = tester
        .widget<TextButton>(find.widgetWithText(TextButton, 'Cancel'))
        .onPressed!;
    final dialog = tester.element(find.byType(AlertDialog));
    unawaited(
      Navigator.of(dialog).push<void>(
        MaterialPageRoute<void>(
          builder: (_) =>
              Scaffold(appBar: AppBar(title: const Text('Covered route'))),
        ),
      ),
    );
    await tester.pumpAndSettle();
    oldCancel();
    await tester.pumpAndSettle();
    expect(find.text('Covered route'), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(transport.calls.map((call) => call['method']), [
      'git/status',
      'git/branches',
    ]);
    await tester.pumpWidget(const SizedBox());
    await transport.dispose();
  });

  testWidgets(
    'Git popup opens source groups using only explicit metadata reads',
    (tester) async {
      final transport = MenuGitTransport(PairingRepository(TestCredentials()));
      await menuApp(tester, transport);
      expect(transport.calls, isEmpty);
      await openMenu(tester);
      for (final label in [
        'Changes',
        'Write',
        'Update',
        'Commit',
        'Push',
        'Commit & Push',
        'Commit, Push & PR',
        'Create PR',
        'No changes',
      ]) {
        expect(
          find.text(label),
          label == 'Update' ? findsNWidgets(2) : findsOneWidget,
        );
      }
      expect(transport.calls.map((call) => call['method']), [
        'git/status',
        'git/branches',
      ]);
      expect(
        transport.calls.every(
          (call) => (call['params'] as Map)['cwd'] == '/qa/menu',
        ),
        isTrue,
      );
      await tester.tapAt(const Offset(4, 550));
      await tester.pumpAndSettle();
      expect(find.text('Write'), findsNothing);
      expect(transport.calls, hasLength(2));
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets(
    'open Git Changes row replaces loading with actual colored totals',
    (tester) async {
      final transport = MenuGitTransport(PairingRepository(TestCredentials()));
      final reply = transport.heldStatus = Completer<RemoteJson>();
      await menuApp(tester, transport);
      await tester.tap(find.byTooltip('Git actions'));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byKey(const Key('git.menu.changes.loading')), findsOneWidget);
      expect(transport.calls, hasLength(1));
      reply.complete({
        ...transport.status,
        'dirty': true,
        'diff': {'additions': 12, 'deletions': 4, 'binaryFiles': 2},
      });
      await tester.pumpAndSettle();
      for (final text in ['+12', '-4', 'B2']) {
        expect(find.text(text), findsOneWidget);
      }
      expect(find.byKey(const Key('git.menu.changes.loading')), findsNothing);
      await tester.tapAt(const Offset(4, 550));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets(
    'Git menu Changes opens the real diff and Back returns to the chat route',
    (tester) async {
      final transport = MenuGitTransport(PairingRepository(TestCredentials()))
        ..status['diff'] = {'additions': 1};
      await menuApp(tester, transport);
      await openMenu(tester);
      await tester.tap(find.byKey(const Key('git.menu.action.changes')));
      await tester.pumpAndSettle();
      expect(find.text('Repository Changes'), findsOneWidget);
      expect(find.text('QA change'), findsOneWidget);
      expect(
        transport.calls.where((call) => call['method'] == 'git/diff'),
        hasLength(1),
      );
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byTooltip('Git actions'), findsOneWidget);
      expect(find.text('Write'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets(
    'empty repository Changes reports the source error without a sheet',
    (tester) async {
      final transport = MenuGitTransport(PairingRepository(TestCredentials()))
        ..status['diff'] = {'additions': 1}
        ..diffPatch = ' \n';
      await menuApp(tester, transport);
      await openMenu(tester);
      await tester.tap(find.byKey(const Key('git.menu.action.changes')));
      await tester.pumpAndSettle();
      expect(
        find.text('There are no repository changes to show.'),
        findsOneWidget,
      );
      expect(find.text('Git Error'), findsOneWidget);
      expect(find.text('Repository Changes'), findsNothing);
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Git actions'), findsOneWidget);
      expect(
        transport.calls.where((call) => call['method'] == 'git/diff'),
        hasLength(1),
      );
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets(
    'failed repository Changes stays actionable and sends only one read',
    (tester) async {
      final transport = MenuGitTransport(PairingRepository(TestCredentials()))
        ..status['diff'] = {'additions': 1}
        ..diffError = StateError('QA repository diff unavailable');
      await menuApp(tester, transport);
      await openMenu(tester);
      await tester.tap(find.byKey(const Key('git.menu.action.changes')));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('QA repository diff unavailable'),
        findsOneWidget,
      );
      expect(find.text('Repository Changes'), findsNothing);
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Git actions'), findsOneWidget);
      expect(
        transport.calls.where((call) => call['method'] == 'git/diff'),
        hasLength(1),
      );
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets('Git menu manual Commit review and cancellation do not mutate', (
    tester,
  ) async {
    final transport = MenuGitTransport(PairingRepository(TestCredentials()))
      ..status['dirty'] = true;
    await menuApp(tester, transport, models: const []);
    await openMenu(tester);
    await tester.tap(find.byKey(const Key('git.menu.action.commit')));
    await tester.pumpAndSettle();
    expect(find.text('Commit all current changes'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Keep this review manual');
    expect(
      tester
          .widget<TextButton>(
            find.widgetWithText(TextButton, 'Generate message'),
          )
          .onPressed,
      isNull,
    );
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(transport.calls.map((call) => call['method']), [
      'git/status',
      'git/branches',
    ]);
    expect(find.text('Write'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    await transport.dispose();
  });

  testWidgets(
    'uninitialized Git menu reviews Setup without creating a repository',
    (tester) async {
      final transport = MenuGitTransport(PairingRepository(TestCredentials()))
        ..status = {'isRepo': false, 'state': 'not_initialized'};
      await menuApp(tester, transport);
      await openMenu(tester);
      expect(find.text('Setup'), findsOneWidget);
      expect(find.text('Write'), findsNothing);
      await tester.tap(find.byKey(const Key('git.menu.action.initialize')));
      await tester.pumpAndSettle();
      expect(find.text('Initialize Git?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(transport.calls.map((call) => call['method']), ['git/status']);
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets(
    'Update refreshes real status and reviews dirty pull before mutation',
    (tester) async {
      final transport = MenuGitTransport(PairingRepository(TestCredentials()))
        ..status['state'] = 'dirty_and_behind'
        ..status['dirty'] = true
        ..status['behind'] = 1;
      await menuApp(tester, transport);
      await openMenu(tester);
      await tester.tap(find.byKey(const Key('git.menu.action.update')));
      await tester.pumpAndSettle();
      expect(find.text('Local changes need attention'), findsOneWidget);
      expect(find.text('Pull & Rebase'), findsOneWidget);
      expect(
        transport.calls.where((call) => call['method'] == 'git/status'),
        hasLength(2),
      );
      expect(
        transport.calls.where((call) => call['method'] == 'git/pull'),
        isEmpty,
      );
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((call) => call['method'] == 'git/pull'),
        isEmpty,
      );
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );

  testWidgets(
    'a captured Git menu action cannot open a stale workspace review',
    (tester) async {
      var current = true;
      final transport = MenuGitTransport(PairingRepository(TestCredentials()));
      await menuApp(tester, transport, isCurrent: () => current);
      await openMenu(tester);
      current = false;
      await tester.tap(find.byKey(const Key('git.menu.action.commit')));
      await tester.pumpAndSettle();
      expect(find.text('Commit all current changes'), findsNothing);
      expect(transport.calls.map((call) => call['method']), [
        'git/status',
        'git/branches',
      ]);
      await tester.pumpWidget(const SizedBox());
      await transport.dispose();
    },
  );
}
