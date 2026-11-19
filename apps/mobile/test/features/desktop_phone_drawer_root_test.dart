import '../support/native_text_search.dart'
    show useAsciiNativeSearch, clearNativeSearchFixture;
import 'dart:async';
import 'dart:io';
import 'package:djl_mobile/features/desktop/data/desktop_local_store.dart';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import 'package:djl_mobile/features/settings/presentation/local_settings_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'cloud_deep_links_test.dart' show client;
import 'desktop_root_routing_test.dart' show savedPair;
import 'desktop_new_chat_draft_test.dart';
import 'desktop_recovery_test.dart' show RecoveryMemoryStore;
import 'package:djl_mobile/features/desktop/presentation/desktop_threads_controller.dart';
import 'settings/app_lock_controller_test.dart' show FakeOwnerAuth;

class PhoneMemoryStore extends RecoveryMemoryStore {
  final saved = <String, RemoteJson>{};
  @override
  Future<void> save(String mac, RemoteJson value) async {
    saved[mac] = jsonDecode(jsonEncode(value)) as RemoteJson;
  }

  @override
  Future<RemoteJson> load(String mac) async => saved[mac] ?? {};
}

class CoveredSelectionTransport extends DraftTransport {
  CoveredSelectionTransport(super.pairings);
  final target = Completer<RemoteJson>();
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) {
    if ((method == 'thread/resume' || method == 'thread/read') &&
        params['threadId'] == 'target') {
      calls.add({'method': method, 'params': params});
      return target.future;
    }
    return super.request(method, params, timeout: timeout);
  }
}

void main() {
  setUp(useAsciiNativeSearch);
  tearDown(clearNativeSearchFixture);
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets(
    'actual root and draft drawers retain their owners across Attention Back',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      for (final draft in [false, true]) {
        if (draft) {
          await tester.tap(find.text('Chat').hitTestable());
          await tester.pumpAndSettle();
          await tester.enterText(
            find.byKey(const Key('desktop_composer')),
            'Retain attention draft',
          );
        }
        final owner = desktop.newChatDraft;
        await tester.tap(find.byTooltip('Open navigation'));
        await tester.pumpAndSettle();
        final before = remote.calls.length;
        await tester.tap(find.text('Attention').hitTestable());
        await tester.pumpAndSettle();
        expect(find.text("You're all caught up"), findsOneWidget);
        expect(
          find.text('Connection changed. Go back to reopen Attention.'),
          findsNothing,
        );
        await tester.tap(find.byKey(const Key('attention.back')));
        await tester.pumpAndSettle();
        expect(find.text('Pinned').hitTestable(), findsOneWidget);
        expect(desktop.newChatDraft, same(owner));
        expect(remote.calls, hasLength(before));
      }
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('Retain attention draft'), findsOneWidget);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'actual root Settings returns to same open drawer and draft; Cloud is explicit',
    (tester) async {
      final credentials = TestCredentials(), pair = savedPair('mac-a');
      credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
      credentials.values['desktop.active'] = pair.macDeviceId;
      final remote = DraftTransport(PairingRepository(credentials));
      final desktop = await draftDesktop(remote);
      final calls = <String>[];
      final lock = AppLockController(FakeOwnerAuth()..result = true);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, calls),
          desktop: desktop,
          appLock: lock,
          initialLink: Future.value(null),
          linkStream: const Stream.empty(),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Chat').hitTestable());
      await tester.pumpAndSettle();
      final owner = desktop.newChatDraft!;
      final page = tester.state(find.byType(DesktopChatPage));
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Survive Settings',
      );
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Search chats').hitTestable());
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('navigation.search')),
        'retained query',
      );
      await tester.pump();
      final beforeRemote = remote.calls.length, beforeCloud = List.of(calls);
      await tester.tap(find.byTooltip('Settings').hitTestable());
      await tester.pumpAndSettle();
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      expect(find.text('retained query').hitTestable(), findsOneWidget);
      expect(tester.state(find.byType(DesktopChatPage)), same(page));
      expect(desktop.newChatDraft, same(owner));
      expect(remote.calls.length, beforeRemote);
      expect(calls, beforeCloud);
      final semantics = tester.ensureSemantics();
      expect(find.bySemanticsLabel('Recent chats'), findsOneWidget);
      lock.lifecycle(AppLifecycleState.inactive);
      await tester.pumpAndSettle();
      expect(lock.shielded, isTrue);
      final tree = tester
          .binding
          .renderViews
          .first
          .owner!
          .semanticsOwner!
          .rootSemanticsNode!
          .toStringDeep();
      expect(tree, isNot(contains('Recent chats')));
      expect(tree, isNot(contains('Survive Settings')));
      lock.lifecycle(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.text('retained query').hitTestable(), findsOneWidget);
      semantics.dispose();

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.text('Survive Settings'), findsOneWidget);
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cloud chat').hitTestable());
      await tester.pumpAndSettle();
      expect(find.byType(DesktopChatPage), findsNothing);
      expect(find.byType(PairingPage), findsNothing);
      expect(desktop.newChatDraft, isNull);
      expect(requests(remote, 'thread/start'), isEmpty);
      await finishDraft(tester, desktop);
      lock.dispose();
    },
  );

  testWidgets(
    'different thread selects once; same thread only closes; pin persists locally',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final store = PhoneMemoryStore();
      final pair = savedPair('mac-a');
      final desktop =
          DesktopController(
              remote.pairings,
              connection: remote,
              localStore: store,
            )
            ..active = pair
            ..trusted = [pair]
            ..state = 'connected'
            ..models = List.of(qaModels);
      await desktop.threadList.attach('mac-a');
      desktop.threadList.data.upsert({'id': 'one', 'name': 'First chat'});
      desktop.threadList.data.upsert({'id': 'two', 'name': 'Second chat'});
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('navigation.thread.one')));
      await tester.pumpAndSettle();
      expect(desktop.thread?['id'], 'one');
      final page = tester.state(find.byType(DesktopChatPage));
      final calls = remote.calls.length;
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('navigation.thread.one')));
      await tester.pumpAndSettle();
      expect(tester.state(find.byType(DesktopChatPage)), same(page));
      expect(remote.calls.length, calls);
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.longPress(find.byKey(const Key('navigation.thread.two')));
      await tester.pumpAndSettle();
      expect(find.text('Archive chat'), findsNothing);
      await tester.tap(find.text('Pin chat'));
      await tester.pumpAndSettle();
      expect(desktop.threadList.data.isPinned('two'), isTrue);
      expect(remote.calls.length, calls);
      final saved = await store.load('mac-a');
      expect(ThreadLocalState.fromJson(saved).isPinned('two'), isTrue);
      await tester.tap(find.byKey(const Key('navigation.thread.two')));
      await tester.pumpAndSettle();
      expect(desktop.thread?['id'], 'two');
      expect(
        requests(
          remote,
          'thread/resume',
        ).where((c) => (c['params'] as Map)['threadId'] == 'two'),
        hasLength(1),
      );
      expect(find.byType(DesktopChatPage), findsOneWidget);
      await finishDraft(tester, desktop);
    },
  );
  test(
    'menu pin action persists through existing encrypted per-Mac store reconstruction',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'djl-task40-pin-',
      );
      final credentials = TestCredentials();
      final remote = DraftTransport(PairingRepository(credentials));
      final store = DesktopLocalStore(credentials, root: directory);
      final chats = DesktopThreadsController(remote, store);
      try {
        await chats.attach('mac-a');
        chats.data.upsert({
          'id': 'private-chat',
          'title': 'Private pin marker',
        });
        await chats.pin('private-chat', true);
        final restored = ThreadLocalState.fromJson(
          await DesktopLocalStore(credentials, root: directory).load('mac-a'),
        );
        expect(restored.isPinned('private-chat'), isTrue);
        expect(await store.load('mac-b'), isEmpty);
        final encoded = await directory
            .list(recursive: true)
            .where((f) => f is File)
            .cast<File>()
            .asyncMap((f) => f.readAsString())
            .join();
        expect(encoded, isNot(contains('Private pin marker')));
        await chats.pin('private-chat', false);
        expect(
          ThreadLocalState.fromJson(
            await store.load('mac-a'),
          ).isPinned('private-chat'),
          isFalse,
        );
      } finally {
        chats.dispose();
        await store.flush();
        await directory.delete(recursive: true);
      }
    },
  );

  for (final replacePin in [false, true]) {
    testWidgets(
      'captured row action is inert after ${replacePin ? 'pin replacement' : 'qualified navigation'}',
      (tester) async {
        final remote = DraftTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        desktop.threadList.data.upsert({
          'id': 'collision',
          'name': 'Original chat',
        });
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: desktop)),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Open navigation'));
        await tester.pumpAndSettle();
        final captured = tester
            .widget<InkWell>(
              find.byKey(const Key('navigation.thread.collision')),
            )
            .onTap!;
        if (replacePin) {
          final replacement = Pairing({
            ...desktop.active!.data,
            'macIdentityPublicKey': base64Encode(List.filled(32, 7)),
          });
          await desktop.connect(replacement, resolve: false);
        } else {
          desktop.queueNavigation(
            DesktopLinkTarget(
              'collision',
              macId: 'other-mac',
              macKeySha256: 'a' * 64,
            ),
            forceHostChoice: true,
          );
        }
        final calls = remote.calls.length;
        captured();
        await tester.pumpAndSettle();
        expect(remote.calls.length, calls);
        expect(find.byType(DesktopChatPage), findsNothing);
        expect(desktop.thread?['id'], isNot('collision'));
        await finishDraft(tester, desktop);
      },
    );
  }
  for (final supersede in [false, true]) {
    testWidgets(
      'delayed drawer selection under Settings ${supersede ? 'yields to newer root navigation' : 'returns a usable exact replacement'}',
      (tester) async {
        final credentials = TestCredentials(), pair = savedPair('mac-a');
        credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
        credentials.values['desktop.active'] = pair.macDeviceId;
        final remote = CoveredSelectionTransport(
          PairingRepository(credentials),
        );
        final desktop = await draftDesktop(remote);
        desktop.threadList.data.upsert({'id': 'target', 'name': 'Target chat'});
        final lock = AppLockController(FakeOwnerAuth()..result = true);
        final links = StreamController<Uri>.broadcast(sync: true);
        await tester.pumpWidget(
          DjlApp(
            client: client(credentials, []),
            desktop: desktop,
            appLock: lock,
            initialLink: Future.value(null),
            linkStream: links.stream,
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Open navigation'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Chat').hitTestable());
        await tester.pumpAndSettle();
        final owner = desktop.newChatDraft!;
        final oldPage = tester.state(find.byType(DesktopChatPage));
        await tester.enterText(
          find.byKey(const Key('desktop_composer')),
          'Retain old draft',
        );
        await tester.pump();
        await tester.tap(find.byTooltip('Open navigation'));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('navigation.thread.target')));
        await tester.pumpAndSettle();
        expect(requests(remote, 'thread/resume'), hasLength(1));
        await tester.tap(find.byTooltip('Open navigation'));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Settings').hitTestable());
        await tester.pumpAndSettle();
        expect(find.text('Done'), findsOneWidget);
        if (supersede) {
          links.add(Uri.parse('djl://thread/newer'));
          await tester.pumpAndSettle();
          expect(desktop.thread?['id'], 'newer');
        }
        remote.target.complete({
          'thread': {'id': 'target', 'name': 'Target loaded', 'turns': []},
        });
        await tester.pumpAndSettle();
        if (!supersede) {
          expect(find.text('Done'), findsOneWidget);
          await tester.tap(find.text('Done'));
          await tester.pumpAndSettle();
          expect(
            tester.state(find.byType(DesktopChatPage)),
            isNot(same(oldPage)),
          );
          expect(desktop.thread?['id'], 'target');
          await tester.enterText(
            find.byKey(const Key('desktop_composer')),
            'Usable replacement',
          );
          await tester.pump();
          expect(
            desktop.threadList.data.composerDraft('target').text,
            'Usable replacement',
          );
          await tester.tap(find.byTooltip('Open navigation'));
          await tester.pumpAndSettle();
          await tester.tap(find.byTooltip('Settings').hitTestable());
          await tester.pumpAndSettle();
          await tester.tap(find.text('Done'));
          await tester.pumpAndSettle();
          await tester.binding.handlePopRoute();
          await tester.pumpAndSettle();
          await tester.tap(find.byTooltip('Send to desktop'));
          await tester.pumpAndSettle();
          expect(requests(remote, 'turn/start'), hasLength(1));
        } else {
          expect(desktop.thread?['id'], 'newer');
          expect(find.text('Done'), findsNothing);
        }
        expect(
          desktop.threadList.data.composerDraft(owner.storageKey).text,
          'Retain old draft',
        );
        expect(requests(remote, 'thread/start'), isEmpty);
        expect(
          requests(
            remote,
            'thread/resume',
          ).where((r) => (r['params'] as Map)['threadId'] == 'target'),
          hasLength(1),
        );
        await finishDraft(tester, desktop);
        lock.dispose();
        await links.close();
      },
    );
  }

  for (final destination in [
    'My Macs',
    'Sign in to DJL Cloud',
    'Open DJL Cloud chat',
  ]) {
    testWidgets(
      'Settings explicit $destination from Desktop reaches root and cancels only its owner',
      (tester) async {
        final credentials = TestCredentials(), pair = savedPair('mac-a');
        credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
        credentials.values['desktop.active'] = pair.macDeviceId;
        if (destination == 'Open DJL Cloud chat') {
          credentials.values['cloud.session'] = 'existing-session';
        }
        final remote = DraftTransport(PairingRepository(credentials));
        final desktop = await draftDesktop(remote);
        final lock = AppLockController(FakeOwnerAuth()..result = true);
        await tester.pumpWidget(
          DjlApp(
            client: client(credentials, []),
            desktop: desktop,
            appLock: lock,
            initialLink: Future.value(
              destination == 'Open DJL Cloud chat'
                  ? Uri.parse('djl://thread/source')
                  : null,
            ),
            linkStream: const Stream.empty(),
          ),
        );
        await tester.pumpAndSettle();
        if (destination != 'Open DJL Cloud chat') {
          await tester.tap(find.byTooltip('Open navigation'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Chat').hitTestable());
          await tester.pumpAndSettle();
        }
        final source = desktop.newChatDraft?.storageKey ?? 'source';
        await tester.enterText(
          find.byKey(const Key('desktop_composer')),
          'Saved before destination',
        );
        await tester.pump();
        await tester.tap(find.byTooltip('Open navigation'));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Settings').hitTestable());
        await tester.pumpAndSettle();
        final oldCover = tester.widget<LocalSettingsPage>(
          find.byType(LocalSettingsPage),
        );
        await tester.ensureVisible(find.text(destination));
        await tester.pumpAndSettle();
        await tester.tap(find.text(destination));
        await tester.pumpAndSettle();
        expect(find.byType(DesktopChatPage), findsNothing);
        expect(find.text('Done'), findsNothing);
        expect(
          find.byType(PairingPage),
          destination == 'My Macs' ? findsOneWidget : findsNothing,
        );
        expect(desktop.newChatDraft, isNull);
        expect(
          desktop.threadList.data.composerDraft(source).text,
          'Saved before destination',
        );
        expect(requests(remote, 'thread/start'), isEmpty);
        if (destination == 'My Macs') {
          await tester.tap(find.byTooltip('Open navigation'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Chat').hitTestable());
          await tester.pumpAndSettle();
          final fresh = desktop.newChatDraft!;
          oldCover.onCloud();
          oldCover.onMyMacs();
          await tester.pumpAndSettle();
          expect(desktop.newChatDraft, same(fresh));
          expect(find.byType(DesktopChatPage), findsOneWidget);
        }
        await finishDraft(tester, desktop);
        lock.dispose();
      },
    );
  }

  testWidgets(
    'Settings delegation survives replacing a root-linked chat with a draft',
    (tester) async {
      final credentials = TestCredentials(), pair = savedPair('mac-a');
      credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
      credentials.values['desktop.active'] = pair.macDeviceId;
      final remote = DraftTransport(PairingRepository(credentials));
      final desktop = await draftDesktop(remote);
      final lock = AppLockController(FakeOwnerAuth()..result = true);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          appLock: lock,
          initialLink: Future.value(Uri.parse('djl://thread/source')),
          linkStream: const Stream.empty(),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Chat').hitTestable());
      await tester.pumpAndSettle();
      final owner = desktop.newChatDraft!;
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Settings').hitTestable());
      await tester.pumpAndSettle();
      expect(find.text('Done'), findsOneWidget);
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      expect(desktop.newChatDraft, same(owner));
      expect(find.text('Recent chats').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
      expect(requests(remote, 'thread/start'), isEmpty);
      await finishDraft(tester, desktop);
      lock.dispose();
    },
  );
}
