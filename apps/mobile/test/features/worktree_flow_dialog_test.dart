import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/presentation/worktree_flow_controller.dart';
import 'package:djl_mobile/features/git/presentation/worktree_flow_dialog.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_project_rebind_test.dart' show rebindDesktop;
import 'worktree_flow_test.dart' show WorktreeTransport, waitForRequest;

Future<void> reviewApp(
  WidgetTester tester,
  WorktreeFlowController flow, {
  Brightness brightness = Brightness.light,
  double scale = 1,
  double keyboard = 0,
  double safeTop = 0,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(brightness),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(scale),
          viewInsets: EdgeInsets.only(bottom: keyboard),
          padding: EdgeInsets.only(top: safeTop),
          viewPadding: EdgeInsets.only(top: safeTop),
        ),
        child: child!,
      ),
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () =>
                showWorktreeFlowDialog(context: context, controller: flow),
            child: const Text('Open worktree review'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open worktree review'));
  await tester.pumpAndSettle();
}

Finder get branchField => find.byKey(const Key('worktree.branch'));
Finder get baseField => find.byKey(const Key('worktree.base'));
Finder submit(WorktreeFlowMode mode) => find.widgetWithText(
  FilledButton,
  mode == WorktreeFlowMode.handoff ? 'Hand off' : 'Fork',
);

void main() {
  for (final mode in WorktreeFlowMode.values) {
    testWidgets(
      'source $mode review stays below the camera/status inset with keyboard',
      (tester) async {
        tester.view.physicalSize = const Size(360, 640);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final remote = WorktreeTransport(PairingRepository(TestCredentials()));
        final desktop = await rebindDesktop(remote);
        final flow = WorktreeFlowController(desktop, mode: mode);
        await reviewApp(tester, flow, safeTop: 60, keyboard: 260);
        final surface = find.descendant(
          of: find.byType(WorktreeFlowDialog),
          matching: find.byWidgetPredicate(
            (widget) =>
                widget is DecoratedBox &&
                widget.decoration is BoxDecoration &&
                (widget.decoration as BoxDecoration).boxShadow != null,
          ),
        );
        expect(surface, findsOneWidget);
        expect(tester.getTopLeft(surface).dy, greaterThanOrEqualTo(60));
        expect(tester.getBottomRight(surface).dy, lessThanOrEqualTo(380));
        expect(tester.takeException(), isNull);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        await tester.pumpWidget(const SizedBox());
        flow.dispose();
        desktop.dispose();
      },
    );
  }
  for (final mode in WorktreeFlowMode.values) {
    testWidgets(
      'source $mode review validates normalized branch/base and cancels without writes',
      (tester) async {
        final remote = WorktreeTransport(PairingRepository(TestCredentials()));
        final desktop = await rebindDesktop(remote);
        final flow = WorktreeFlowController(desktop, mode: mode);
        await reviewApp(tester, flow);
        expect(
          find.text(
            mode == WorktreeFlowMode.handoff
                ? 'Hand off thread to worktree'
                : 'Fork thread into new worktree',
          ),
          findsOneWidget,
        );
        expect(tester.widget<TextField>(branchField).autofocus, isTrue);
        expect(tester.widget<TextField>(baseField).controller!.text, 'main');
        expect(tester.widget<FilledButton>(submit(mode)).onPressed, isNull);
        await tester.enterText(branchField, 'djl/');
        await tester.pumpAndSettle();
        expect(tester.widget<FilledButton>(submit(mode)).onPressed, isNull);
        await tester.enterText(branchField, ' qa feature ');
        await tester.pumpAndSettle();
        expect(find.text('djl/qa feature'), findsOneWidget);
        expect(tester.widget<FilledButton>(submit(mode)).onPressed, isNotNull);
        await tester.enterText(baseField, ' ');
        await tester.pumpAndSettle();
        expect(tester.widget<FilledButton>(submit(mode)).onPressed, isNull);
        await tester.tap(find.byTooltip('Close worktree review'));
        await tester.pumpAndSettle();
        expect(remote.calls.map((c) => c['method']), [
          'git/status',
          'git/branches',
        ]);
        await tester.pumpWidget(const SizedBox());
        flow.dispose();
        desktop.dispose();
      },
    );
  }

  for (final dismissal in ['back', 'outside']) {
    testWidgets('source review $dismissal dismisses only its own route', (
      tester,
    ) async {
      final remote = WorktreeTransport(PairingRepository(TestCredentials()));
      final desktop = await rebindDesktop(remote);
      final flow = WorktreeFlowController(
        desktop,
        mode: WorktreeFlowMode.handoff,
      );
      await reviewApp(tester, flow);
      if (dismissal == 'back') {
        await tester.binding.handlePopRoute();
      } else {
        await tester.tapAt(const Offset(3, 3));
      }
      await tester.pumpAndSettle();
      expect(find.byType(WorktreeFlowDialog), findsNothing);
      expect(find.text('Open worktree review'), findsOneWidget);
      expect(remote.calls, hasLength(2));
      await tester.pumpWidget(const SizedBox());
      flow.dispose();
      desktop.dispose();
    });
  }

  testWidgets('a new run closes an idle review without a write', (
    tester,
  ) async {
    final remote = WorktreeTransport(PairingRepository(TestCredentials()));
    final desktop = await rebindDesktop(remote);
    final flow = WorktreeFlowController(
      desktop,
      mode: WorktreeFlowMode.handoff,
    );
    await reviewApp(tester, flow);
    desktop.turnId = 'started-elsewhere';
    desktop.setModel('qa');
    await tester.pumpAndSettle();
    expect(find.byType(WorktreeFlowDialog), findsNothing);
    expect(remote.calls, hasLength(2));
    await tester.pumpWidget(const SizedBox());
    flow.dispose();
    desktop.dispose();
  });

  testWidgets(
    'covered Submit and Close callbacks cannot affect a foreign review',
    (tester) async {
      final remote = WorktreeTransport(PairingRepository(TestCredentials()));
      final desktop = await rebindDesktop(remote);
      final flow = WorktreeFlowController(
        desktop,
        mode: WorktreeFlowMode.handoff,
      );
      await reviewApp(tester, flow);
      await tester.enterText(branchField, 'qa-feature');
      await tester.pumpAndSettle();
      final send = tester.widget<FilledButton>(submit(flow.mode)).onPressed!;
      final close = tester
          .widget<IconButton>(
            find.byWidgetPredicate(
              (w) => w is IconButton && w.tooltip == 'Close worktree review',
            ),
          )
          .onPressed!;
      final context = tester.element(find.byType(WorktreeFlowDialog));
      showDialog<void>(
        context: context,
        builder: (_) => const AlertDialog(title: Text('Foreign review')),
      );
      await tester.pumpAndSettle();
      send();
      close();
      await tester.pumpAndSettle();
      expect(find.text('Foreign review'), findsOneWidget);
      expect(remote.calls, hasLength(2));
      await tester.pumpWidget(const SizedBox());
      flow.dispose();
      desktop.dispose();
    },
  );

  testWidgets(
    'Close during an accepted handoff keeps its operation alive until settlement',
    (tester) async {
      final remote = WorktreeTransport(PairingRepository(TestCredentials()));
      final gate = remote.creationGate = Completer<void>();
      final desktop = await rebindDesktop(remote);
      final flow = WorktreeFlowController(
        desktop,
        mode: WorktreeFlowMode.handoff,
      );
      await reviewApp(tester, flow);
      await tester.enterText(branchField, 'qa-feature');
      await tester.pumpAndSettle();
      await tester.tap(submit(flow.mode));
      await tester.pump(const Duration(milliseconds: 100));
      await waitForRequest(remote, 'git/createWorktree');
      var settled = false;
      final finished = flow.settled.then((_) => settled = true);
      expect(settled, isFalse);
      await tester.tap(find.byTooltip('Close worktree review'));
      await tester.pumpAndSettle();
      expect(find.byType(WorktreeFlowDialog), findsNothing);
      gate.complete();
      await finished;
      await tester.pumpAndSettle();
      expect(flow.completed, isTrue, reason: flow.error);
      expect(desktop.thread?['id'], 'same-chat');
      expect(remote.calls.where((c) => c['method'] == 'thread/fork'), isEmpty);
      await tester.pumpWidget(const SizedBox());
      flow.dispose();
      desktop.dispose();
    },
  );

  for (final brightness in Brightness.values) {
    for (final landscape in [false, true]) {
      testWidgets(
        'worktree review scrolls with large text/keyboard $brightness landscape=$landscape',
        (tester) async {
          tester.view.physicalSize = landscape
              ? const Size(700, 360)
              : const Size(360, 640);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final remote = WorktreeTransport(
            PairingRepository(TestCredentials()),
          );
          final desktop = await rebindDesktop(remote);
          final flow = WorktreeFlowController(
            desktop,
            mode: WorktreeFlowMode.handoff,
          );
          await reviewApp(
            tester,
            flow,
            brightness: brightness,
            scale: 2.2,
            keyboard: landscape ? 120 : 260,
          );
          expect(tester.takeException(), isNull);
          await tester.drag(
            find.byType(SingleChildScrollView),
            const Offset(0, -500),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          final viewport = tester.view.physicalSize;
          final button = tester.getRect(submit(flow.mode));
          expect(
            button.bottom,
            lessThanOrEqualTo(viewport.height - (landscape ? 120 : 260)),
          );
          await tester.binding.handlePopRoute();
          await tester.pumpAndSettle();
          await tester.pumpWidget(const SizedBox());
          flow.dispose();
          desktop.dispose();
        },
      );
    }
  }
}
