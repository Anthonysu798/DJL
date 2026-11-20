import 'dart:async';
import 'dart:convert';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_new_chat_draft_test.dart'
    show DraftTransport, draftDesktop, finishDraft, requests;
import 'desktop_root_routing_test.dart' show savedPair;

class OverviewTransport extends DraftTransport {
  OverviewTransport(super.pairings);
  final roots = <String, List<String>>{
    'mac-a': ['/custom/chats'],
  };
  final heldRoots = <String, Completer<RemoteJson>>{};
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'project/projectlessRoots') {
      calls.add({'method': method, 'params': params, 'host': host});
      return heldRoots[host]?.future ?? {'roots': roots[host] ?? []};
    }
    return super.request(method, params, timeout: timeout);
  }
}

void seedOverview(DesktopController desktop) {
  for (final row in <RemoteJson>[
    {'id': 'studio', 'name': 'Studio thread', 'cwd': '/h/.codex/threads/one'},
    {'id': 'custom', 'name': 'Custom Studio', 'cwd': '/custom/chats/one'},
    {
      'id': 'alpha',
      'name': 'Alpha parent',
      'cwd': '/work/Alpha',
      'updatedAt': 30,
      'djlScope': 'project',
    },
    {
      'id': 'child',
      'name': 'Alpha child',
      'cwd': '/work/Alpha',
      'parentThreadId': 'alpha',
      'updatedAt': 20,
    },
    {'id': 'beta', 'name': 'Beta thread', 'cwd': '/work/Beta', 'updatedAt': 10},
    {
      'id': 'explicit',
      'name': 'Explicit project',
      'cwd': '/custom/chats/project',
      'djlScope': 'project',
    },
  ]) {
    desktop.threadList.data.upsert(row);
  }
}

Future<void> showOverview(
  WidgetTester tester,
  DesktopController desktop, {
  bool settle = true,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(Brightness.light),
      home: PairingPage(controller: desktop),
    ),
  );
  if (settle) await tester.pumpAndSettle();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  for (final change in ['current', 'session', 'identity', 'cache']) {
    testWidgets(
      'overview rename confirmation retains its captured owner after $change',
      (tester) async {
        final remote = OverviewTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        seedOverview(desktop);
        desktop.host.bind(
          device: 'mac-a',
          session: 'overview-original',
          connected: true,
          trusted: true,
        );
        await showOverview(tester, desktop);
        final row = find.byKey(const ValueKey('desktop.thread.studio'));
        await tester.tap(
          find.descendant(
            of: row,
            matching: find.byTooltip('Desktop chat actions'),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Rename chat'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('desktop_chat_name')),
          'Reviewed Studio name',
        );
        if (change == 'session') {
          desktop.host.bind(
            device: 'mac-a',
            session: 'overview-reconnected',
            connected: true,
            trusted: true,
          );
        } else if (change == 'identity') {
          final next = Pairing({
            ...desktop.active!.data,
            'macIdentityPublicKey': base64Encode(List.filled(32, 9)),
          });
          desktop.active = next;
          desktop.trusted = [next];
        } else if (change == 'cache') {
          desktop.threadList.data = ThreadLocalState.fromJson(
            desktop.threadList.data.toJson(),
          );
        }
        desktop.notifyListeners();
        await tester.pumpAndSettle();
        await tester.tap(find.text('Save name'));
        await tester.pumpAndSettle();
        expect(
          desktop.threadList.data.renames['studio'],
          change == 'current' ? 'Reviewed Studio name' : isNull,
        );
        final renames = requests(remote, 'thread/name/set');
        if (change != 'current') {
          expect(renames, isEmpty);
          expect(find.text('Workspaces'), findsNothing);
          expect(find.byTooltip('SSH terminals'), findsNothing);
          expect(requests(remote, 'djl/workspaces/terminals'), isEmpty);
          expect(find.text('Studio thread'), findsOneWidget);
        } else {
          expect(renames, hasLength(1));
          expect(renames.single['params'], {
            'thread_id': 'studio',
            'name': 'Reviewed Studio name',
          });
          expect(find.text('Reviewed Studio name'), findsOneWidget);
        }
        expect(requests(remote, 'thread/start'), isEmpty);
        await finishDraft(tester, desktop);
      },
    );
  }

  for (final change in ['current', 'session', 'cache']) {
    testWidgets(
      'overview removal confirmation retains its captured owner after $change',
      (tester) async {
        final remote = OverviewTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        seedOverview(desktop);
        desktop.host.bind(
          device: 'mac-a',
          session: 'overview-original',
          connected: true,
          trusted: true,
        );
        await showOverview(tester, desktop);
        final row = find.byKey(const ValueKey('desktop.thread.studio'));
        await tester.tap(
          find.descendant(
            of: row,
            matching: find.byTooltip('Desktop chat actions'),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Remove from this device'));
        await tester.pumpAndSettle();
        expect(find.text('Remove this chat from this device?'), findsOneWidget);
        if (change == 'session') {
          desktop.host.bind(
            device: 'mac-a',
            session: 'overview-reconnected',
            connected: true,
            trusted: true,
          );
        } else if (change == 'cache') {
          desktop.threadList.data = ThreadLocalState.fromJson(
            desktop.threadList.data.toJson(),
          );
        }
        desktop.notifyListeners();
        await tester.pumpAndSettle();
        await tester.tap(find.text('Remove chat'));
        await tester.pumpAndSettle();
        expect(
          desktop.threadList.data.deleted.contains('studio'),
          change == 'current',
        );
        expect(
          requests(remote, 'thread/archive'),
          hasLength(change == 'current' ? 1 : 0),
        );
        expect(requests(remote, 'thread/start'), isEmpty);
        await finishDraft(tester, desktop);
      },
    );
  }

  testWidgets('overview starts in Studio with compact search and chat scopes', (
    tester,
  ) async {
    final remote = OverviewTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    seedOverview(desktop);
    await showOverview(tester, desktop);
    for (final label in ['Studio', 'Projects']) {
      expect(find.text(label), findsOneWidget);
    }
    expect(
      find.widgetWithText(TextField, 'Search conversations'),
      findsOneWidget,
    );
    expect(find.text('Studio thread'), findsOneWidget);
    expect(find.text('Custom Studio'), findsOneWidget);
    expect(find.text('Alpha parent'), findsNothing);
    expect(find.text('Explicit project'), findsNothing);
    expect(find.text('Desktop status'), findsNothing);
    expect(find.bySemanticsLabel('New chat'), findsOneWidget);
    expect(requests(remote, 'thread/start'), isEmpty);
    await finishDraft(tester, desktop);
  });

  testWidgets('project grouping pins subtrees and persists folder collapse', (
    tester,
  ) async {
    final remote = OverviewTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    seedOverview(desktop);
    desktop.threadList.data.pin('alpha', true);
    await showOverview(tester, desktop);
    await tester.tap(find.text('Projects'));
    await tester.pumpAndSettle();
    expect(find.text('Pinned'), findsOneWidget);
    expect(find.text('Alpha parent'), findsOneWidget);
    expect(find.text('Alpha child'), findsNothing);
    expect(find.text('Studio thread'), findsNothing);
    expect(find.text('Explicit project'), findsOneWidget);
    await tester.tap(
      find.bySemanticsLabel('Expand child chats for Alpha parent'),
    );
    await tester.pumpAndSettle();
    expect(find.text('Alpha child'), findsOneWidget);
    await tester.tap(find.bySemanticsLabel('Collapse project Beta'));
    await tester.pumpAndSettle();
    expect(find.text('Beta thread'), findsNothing);
    final saved = desktop.threadList.data.toJson();
    await tester.pumpWidget(const SizedBox.shrink());
    desktop.threadList.data = ThreadLocalState.fromJson(saved);
    await showOverview(tester, desktop);
    await tester.tap(find.text('Projects'));
    await tester.pumpAndSettle();
    expect(find.text('Beta thread'), findsNothing);
    await tester.tap(find.bySemanticsLabel('Expand project Beta'));
    await tester.pumpAndSettle();
    expect(find.text('Beta thread'), findsOneWidget);
    expect(requests(remote, 'thread/start'), isEmpty);
    await finishDraft(tester, desktop);
  });

  testWidgets('bottom Studio Chat opens a local rootless draft', (
    tester,
  ) async {
    final remote = OverviewTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    seedOverview(desktop);
    await showOverview(tester, desktop);
    await tester.tap(find.bySemanticsLabel('New chat'));
    await tester.pumpAndSettle();
    expect(find.byType(DesktopChatPage), findsOneWidget);
    expect(desktop.newChatDraft?.cwd, isNull);
    expect(desktop.newChatDraft?.source, DesktopDraftSource.generalChat);
    expect(requests(remote, 'thread/start'), isEmpty);
    await finishDraft(tester, desktop);
  });

  testWidgets(
    'Projects Chat uses recent project while retaining general draft',
    (tester) async {
      final remote = OverviewTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      seedOverview(desktop);
      await showOverview(tester, desktop);
      await tester.tap(find.text('Projects'));
      await tester.pumpAndSettle();
      await tester.tap(find.bySemanticsLabel('New chat'));
      await tester.pumpAndSettle();
      expect(desktop.newChatDraft?.cwd, '/work/Alpha');
      expect(desktop.newChatDraft?.source, DesktopDraftSource.generalChat);
      expect(find.text('What should we work on?'), findsOneWidget);
      expect(requests(remote, 'thread/start'), isEmpty);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets('project Chat remains recent across pins and a search filter', (
    tester,
  ) async {
    final remote = OverviewTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    seedOverview(desktop);
    desktop.threadList.data.pin('beta', true);
    await showOverview(tester, desktop);
    await tester.tap(find.text('Projects'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Search conversations'),
      'Beta',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.bySemanticsLabel('New chat'));
    await tester.pumpAndSettle();
    expect(desktop.newChatDraft?.cwd, '/work/Alpha');
    expect(desktop.newChatDraft?.source, DesktopDraftSource.generalChat);
    expect(requests(remote, 'thread/start'), isEmpty);
    await finishDraft(tester, desktop);
  });

  for (final sameMac in [false, true]) {
    testWidgets(
      'old folder action is fenced after identity change sameMac=$sameMac',
      (tester) async {
        final remote = OverviewTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        seedOverview(desktop);
        await showOverview(tester, desktop);
        await tester.tap(find.text('Projects'));
        await tester.pumpAndSettle();
        final oldCompose = tester
            .widget<IconButton>(
              find.byWidgetPredicate(
                (widget) =>
                    widget is IconButton &&
                    widget.tooltip == 'New chat in Beta',
              ),
            )
            .onPressed!;
        final next = Pairing({
          ...savedPair(sameMac ? 'mac-a' : 'mac-b').data,
          'macIdentityPublicKey': base64Encode(List.filled(32, 9)),
        });
        remote.host = next.macDeviceId;
        desktop.active = next;
        desktop.trusted = [next];
        await desktop.threadList.attach(next.macDeviceId);
        desktop.notifyListeners();
        oldCompose();
        await tester.pumpAndSettle();
        expect(desktop.newChatDraft, isNull);
        expect(find.byType(DesktopChatPage), findsNothing);
        expect(requests(remote, 'thread/start'), isEmpty);
        await finishDraft(tester, desktop);
      },
    );
  }

  testWidgets(
    'late projectless roots from the old Mac cannot reclassify new chats',
    (tester) async {
      final remote = OverviewTransport(PairingRepository(TestCredentials()));
      final old = remote.heldRoots['mac-a'] = Completer<RemoteJson>();
      remote.roots['mac-b'] = ['/root-b'];
      final desktop = await draftDesktop(remote);
      await showOverview(tester, desktop, settle: false);
      await tester.pump();
      expect(requests(remote, 'project/projectlessRoots'), hasLength(1));
      remote.host = 'mac-b';
      desktop.active = savedPair('mac-b');
      await desktop.threadList.attach('mac-b');
      desktop.threadList.data.upsert({
        'id': 'b-project',
        'name': 'B project',
        'cwd': '/root-a/project',
      });
      desktop.notifyListeners();
      await tester.pumpAndSettle();
      old.complete({
        'roots': ['/root-a'],
      });
      await tester.pumpAndSettle();
      expect(find.text('B project'), findsNothing);
      await tester.tap(find.text('Projects'));
      await tester.pumpAndSettle();
      expect(find.text('B project'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await finishDraft(tester, desktop);
    },
  );

  for (final layout in [
    (const Size(360, 780), 300.0, 2.2),
    (const Size(780, 360), 180.0, 1.0),
  ]) {
    testWidgets('overview remains usable with keyboard at $layout', (
      tester,
    ) async {
      await tester.binding.setSurfaceSize(layout.$1);
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final remote = OverviewTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      seedOverview(desktop);
      await tester.pumpWidget(
        MaterialApp(
          theme: djlTheme(Brightness.light),
          home: Builder(
            builder: (context) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: TextScaler.linear(layout.$3),
                viewInsets: EdgeInsets.only(bottom: layout.$2),
              ),
              child: PairingPage(controller: desktop),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final search = find.widgetWithText(TextField, 'Search conversations');
      await tester.ensureVisible(search);
      await tester.tap(search);
      await tester.enterText(search, 'Custom');
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('Custom Studio'), findsOneWidget);
      await finishDraft(tester, desktop);
    });
  }
}
