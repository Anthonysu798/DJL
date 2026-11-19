import 'dart:convert';
import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_overview_test.dart'
    show OverviewTransport, seedOverview, showOverview;
import 'desktop_new_chat_draft_test.dart'
    show draftDesktop, finishDraft, requests;

class PendingProjectArchive extends OverviewTransport {
  PendingProjectArchive(super.pairings);
  final started = Completer<void>(), reply = Completer<RemoteJson>();
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) {
    if (method == 'thread/archive' && params['threadId'] == 'alpha') {
      calls.add({'method': method, 'params': params});
      started.complete();
      return reply.future;
    }
    return super.request(method, params, timeout: timeout);
  }
}

Future<(OverviewTransport, DesktopController)> projectOverview(
  WidgetTester tester, {
  bool filtered = false,
  OverviewTransport? wire,
}) async {
  final remote =
      wire ?? OverviewTransport(PairingRepository(TestCredentials()));
  final desktop = await draftDesktop(remote);
  seedOverview(desktop);
  desktop.threadList.data.upsert({
    'id': 'pinned-alpha',
    'name': 'Hidden pinned Alpha',
    'cwd': '/work/Alpha',
  });
  desktop.threadList.data.upsert({
    'id': 'archived-alpha',
    'name': 'Archived Alpha',
    'cwd': '/work/Alpha',
  });
  desktop.threadList.data.archiveOverrides['archived-alpha'] = true;
  desktop.threadList.data.pin('pinned-alpha', true);
  desktop.threadList.data.drafts['child'] = 'exact unsent project draft';
  desktop.thread = Map.of(desktop.threadList.data.find('child')!);
  await showOverview(tester, desktop);
  if (filtered) {
    final search = find.byWidgetPredicate(
      (widget) =>
          widget is TextField &&
          widget.decoration?.hintText == 'Search conversations',
    );
    await tester.ensureVisible(search);
    await tester.pumpAndSettle();
    await tester.enterText(search, 'Alpha parent');
    await tester.pumpAndSettle();
  }
  await tester.ensureVisible(find.text('Projects'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Projects'));
  await tester.pumpAndSettle();
  return (remote, desktop);
}

Future<void> openProjectAction(WidgetTester tester, String action) async {
  final header = find.bySemanticsLabel('Collapse project Alpha');
  await tester.ensureVisible(header);
  await tester.pumpAndSettle();
  await tester.longPress(header);
  await tester.pumpAndSettle();
  expect(find.text('Archive Project'), findsOneWidget);
  expect(find.text('Remove from Phone'), findsOneWidget);
  final removal = tester.element(find.text('Remove from Phone'));
  expect(
    DefaultTextStyle.of(removal).style.color,
    CupertinoColors.destructiveRed.resolveFrom(removal),
  );
  await tester.tap(find.text(action));
  await tester.pumpAndSettle();
}

void main() {
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets(
    'project reviews can be reopened after consecutive cancellations',
    (tester) async {
      final (remote, desktop) = await projectOverview(tester);
      for (final action in [
        'Archive Project',
        'Remove from Phone',
        'Archive Project',
      ]) {
        await openProjectAction(tester, action);
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
      }
      expect(requests(remote, 'thread/archive'), isEmpty);
      expect(desktop.threadList.data.deleted, isEmpty);
      await finishDraft(tester, desktop);
    },
  );
  testWidgets(
    'a removed project header cannot open its retained context action',
    (tester) async {
      final (remote, desktop) = await projectOverview(tester);
      final header = find.bySemanticsLabel('Collapse project Alpha');
      final retained = tester.widget<Semantics>(header).properties.onLongPress!;
      desktop.threadList.data.remove('alpha');
      desktop.notifyListeners();
      await tester.pumpAndSettle();
      expect(header, findsNothing);
      retained();
      await tester.pumpAndSettle();
      expect(find.text('Archive Project'), findsNothing);
      expect(find.byType(CupertinoActionSheet), findsNothing);
      expect(requests(remote, 'thread/archive'), isEmpty);
      expect(tester.takeException(), isNull);
      await finishDraft(tester, desktop);
    },
  );
  testWidgets('project confirmation resolves members added during review', (
    tester,
  ) async {
    final (remote, desktop) = await projectOverview(tester);
    await openProjectAction(tester, 'Archive Project');
    desktop.threadList.data.upsert({'id': 'late-alpha', 'cwd': '/work/Alpha'});
    desktop.notifyListeners();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Archive Project'));
    await tester.pumpAndSettle();
    expect(desktop.threadList.data.isArchived('late-alpha'), isTrue);
    expect(requests(remote, 'thread/archive').map((r) => r['params']), [
      {'threadId': 'alpha'},
      {'threadId': 'late-alpha'},
      {'threadId': 'pinned-alpha'},
    ]);
    await finishDraft(tester, desktop);
  });

  testWidgets(
    'accepted project archive never closes a newly selected other chat',
    (tester) async {
      final remote = PendingProjectArchive(
        PairingRepository(TestCredentials()),
      );
      final (_, desktop) = await projectOverview(tester, wire: remote);
      await openProjectAction(tester, 'Archive Project');
      await tester.tap(find.text('Archive Project'));
      for (var i = 0; i < 20 && !remote.started.isCompleted; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(remote.started.isCompleted, isTrue);
      desktop.thread = Map.of(desktop.threadList.data.find('beta')!);
      desktop.notifyListeners();
      await tester.pump();
      remote.reply.complete({});
      await tester.pumpAndSettle();
      expect(desktop.thread?['id'], 'beta');
      expect(desktop.threadList.data.isArchived('beta'), isFalse);
      expect(requests(remote, 'thread/archive'), hasLength(2));
      await finishDraft(tester, desktop);
    },
  );

  for (final change in ['session', 'pin', 'cache']) {
    testWidgets(
      'an open project menu drops selection after $change replacement',
      (tester) async {
        final (remote, desktop) = await projectOverview(tester);
        await tester.longPress(find.bySemanticsLabel('Collapse project Alpha'));
        await tester.pumpAndSettle();
        expect(find.text('Archive Project'), findsOneWidget);
        if (change == 'session') {
          desktop.host.bind(
            device: 'mac-a',
            session: 'new-menu-session',
            connected: true,
            trusted: true,
          );
        } else if (change == 'pin') {
          final next = Pairing({
            ...desktop.active!.data,
            'macIdentityPublicKey': base64Encode(List.filled(32, 9)),
          });
          desktop.active = next;
          desktop.trusted = [next];
        } else {
          desktop.threadList.data = ThreadLocalState.fromJson(
            desktop.threadList.data.toJson(),
          );
        }
        desktop.notifyListeners();
        await tester.pumpAndSettle();
        if (find.text('Archive Project').evaluate().isNotEmpty) {
          await tester.tap(find.text('Archive Project'));
          await tester.pumpAndSettle();
        }
        expect(find.byType(CupertinoActionSheet), findsNothing);
        expect(desktop.threadList.data.isArchived('alpha'), isFalse);
        expect(desktop.threadList.data.deleted, isEmpty);
        expect(requests(remote, 'thread/archive'), isEmpty);
        await finishDraft(tester, desktop);
      },
    );
  }
  for (final action in ['Archive Project', 'Remove from Phone']) {
    testWidgets('project $action stays above keyboard at large text', (
      tester,
    ) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(360, 780);
      tester.view.viewInsets = const FakeViewPadding(bottom: 260);
      tester.view.viewPadding = const FakeViewPadding(top: 44, bottom: 24);
      tester.view.padding = const FakeViewPadding(top: 44);
      tester.platformDispatcher.textScaleFactorTestValue = 2.2;
      addTearDown(() {
        tester.view.resetDevicePixelRatio();
        tester.view.resetPhysicalSize();
        tester.view.resetViewInsets();
        tester.view.resetViewPadding();
        tester.view.resetPadding();
        tester.platformDispatcher.clearTextScaleFactorTestValue();
      });
      final (remote, desktop) = await projectOverview(tester, filtered: true);
      await openProjectAction(tester, action);
      expect(tester.takeException(), isNull);
      expect(
        tester.getRect(find.text('Cancel')).bottom,
        lessThanOrEqualTo(520),
      );
      expect(tester.getRect(find.text(action)).bottom, lessThanOrEqualTo(520));
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(desktop.threadList.data.isArchived('alpha'), isFalse);
      expect(desktop.threadList.data.deleted, isEmpty);
      expect(requests(remote, 'thread/archive'), isEmpty);
      expect(tester.takeException(), isNull);
      await finishDraft(tester, desktop);
    });
  }
  for (final action in ['Archive Project', 'Remove from Phone']) {
    testWidgets(
      'project $action confirmation Cancel retains the entire group',
      (tester) async {
        final (remote, desktop) = await projectOverview(tester);
        await openProjectAction(tester, action);
        expect(
          find.byType(
            action == 'Archive Project'
                ? CupertinoActionSheet
                : CupertinoAlertDialog,
          ),
          findsOneWidget,
        );
        expect(
          find.text(
            action == 'Archive Project'
                ? 'Archive "Alpha"?'
                : 'Remove "Alpha" from this phone?',
          ),
          findsOneWidget,
        );
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(desktop.threadList.data.deleted, isEmpty);
        expect(desktop.threadList.data.isArchived('alpha'), isFalse);
        expect(
          desktop.threadList.data.drafts['child'],
          'exact unsent project draft',
        );
        expect(desktop.thread?['id'], 'child');
        expect(requests(remote, 'thread/archive'), isEmpty);
        expect(requests(remote, 'thread/start'), isEmpty);
        await finishDraft(tester, desktop);
      },
    );
  }

  testWidgets(
    'filtered project archive includes hidden/pinned roots and closes selected child',
    (tester) async {
      final (remote, desktop) = await projectOverview(tester, filtered: true);
      expect(find.text('Hidden pinned Alpha'), findsNothing);
      await openProjectAction(tester, 'Archive Project');
      expect(
        find.text('All active chats in this project will be archived.'),
        findsOneWidget,
      );
      await tester.tap(find.text('Archive Project'));
      await tester.pumpAndSettle();
      for (final id in ['alpha', 'child', 'pinned-alpha', 'archived-alpha']) {
        expect(desktop.threadList.data.isArchived(id), isTrue);
      }
      expect(desktop.threadList.data.isArchived('beta'), isFalse);
      expect(desktop.threadList.data.isArchived('studio'), isFalse);
      expect(desktop.thread, isNull);
      expect(requests(remote, 'thread/archive').map((r) => r['params']), [
        {'threadId': 'alpha'},
        {'threadId': 'pinned-alpha'},
      ]);
      expect(requests(remote, 'thread/start'), isEmpty);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'project removal is local for archived, pinned and descendant chats',
    (tester) async {
      final (remote, desktop) = await projectOverview(tester, filtered: true);
      await openProjectAction(tester, 'Remove from Phone');
      expect(
        find.text(
          'Chats for this project will be deleted only from DJL on this phone. Nothing is removed from your device or Codex observer.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.text('Remove from Phone'));
      await tester.pumpAndSettle();
      for (final id in ['alpha', 'child', 'pinned-alpha', 'archived-alpha']) {
        expect(desktop.threadList.data.deleted, contains(id));
        expect(desktop.threadList.data.find(id), isNull);
      }
      expect(desktop.threadList.data.drafts.containsKey('child'), isFalse);
      expect(desktop.threadList.data.find('beta'), isNotNull);
      expect(desktop.thread, isNull);
      expect(requests(remote, 'thread/archive'), isEmpty);
      expect(requests(remote, 'thread/unarchive'), isEmpty);
      expect(requests(remote, 'thread/start'), isEmpty);
      await finishDraft(tester, desktop);
    },
  );

  for (final action in ['Archive Project', 'Remove from Phone']) {
    for (final change in ['session', 'pin', 'cache']) {
      testWidgets('project $action confirmation fences a changed $change', (
        tester,
      ) async {
        final (remote, desktop) = await projectOverview(tester);
        await openProjectAction(tester, action);
        final original = desktop.threadList.data;
        if (change == 'session') {
          desktop.host.bind(
            device: 'mac-a',
            session: 'new-session',
            connected: true,
            trusted: true,
          );
        } else if (change == 'pin') {
          final next = Pairing({
            ...desktop.active!.data,
            'macIdentityPublicKey': base64Encode(List.filled(32, 9)),
          });
          desktop.active = next;
          desktop.trusted = [next];
        } else {
          desktop.threadList.data = ThreadLocalState.fromJson(
            original.toJson(),
          );
        }
        desktop.notifyListeners();
        await tester.pumpAndSettle();
        await tester.tap(find.text(action));
        await tester.pumpAndSettle();
        expect(original.isArchived('alpha'), isFalse);
        expect(original.deleted, isEmpty);
        expect(desktop.threadList.data.isArchived('alpha'), isFalse);
        expect(desktop.threadList.data.deleted, isEmpty);
        expect(desktop.thread?['id'], 'child');
        expect(requests(remote, 'thread/archive'), isEmpty);
        await finishDraft(tester, desktop);
      });
    }
  }
}
