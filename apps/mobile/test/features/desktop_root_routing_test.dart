import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'cloud_deep_links_test.dart' show client;
import 'desktop_subagents_test.dart' show SubagentTransport, emitSubagent;
import 'desktop_activity_test.dart' show ActivityCacheStore;
import 'desktop_connected_switch_test.dart'
    show SwitchPairings, SwitchTransport, SwitchStore;
import 'settings/app_lock_controller_test.dart' show FakeOwnerAuth;

class RoutingDesktop extends DesktopController {
  RoutingDesktop(
    this.remote, {
    PairingRepository? repository,
    ActivityCacheStore? cache,
  }) : super(
         repository ?? remote.pairings,
         connection: remote,
         localStore: cache ?? ActivityCacheStore(),
       );
  final SubagentTransport remote;
  int connections = 0;
  bool connects = true;
  @override
  Future<void> connect(
    Pairing pair, {
    bool bootstrap = false,
    bool resolve = true,
  }) async {
    connections++;
    active = pair;
    state = connects ? 'connected' : 'disconnected';
    remote.online = connects;
    notifyListeners();
  }
}

class SlowRoutingCache extends ActivityCacheStore {
  final gate = Completer<RemoteJson>();
  @override
  Future<RemoteJson> load(String mac) => gate.future;
}

class LockedSelectionCredentials extends TestCredentials {
  bool unavailable = true;
  @override
  Future<String?> read(String key) async {
    if (unavailable && key == 'desktop.active') {
      throw StateError('Synthetic secure selection unavailable');
    }
    return super.read(key);
  }
}

Pairing savedPair(String id) => Pairing({
  'v': 2,
  'macDeviceId': id,
  'sessionId': 's-$id',
  'macIdentityPublicKey': base64Encode(List.filled(32, 3)),
  'relay': 'wss://relay.example.test/relay',
  'expiresAt': 1,
});
void main() {
  testWidgets(
    'manual pairing pause suppresses root launch and lifecycle reconnect while retaining the saved selection',
    (tester) async {
      final credentials = TestCredentials(), pair = savedPair('mac-a');
      credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
      credentials.values['desktop.active'] = 'mac-a';
      final transport = SubagentTransport()..online = false;
      (transport.pairings.credentials as TestCredentials).values.addAll(
        credentials.values,
      );
      final desktop = RoutingDesktop(transport)
        ..active = pair
        ..trusted = [pair];
      await desktop.threadList.attach('mac-a');
      desktop.pauseForManualPairing();
      final lock = AppLockController(FakeOwnerAuth()..result = true);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(Uri.parse('djl://thread/paused')),
        ),
      );
      await tester.pumpAndSettle();
      expect(desktop.connections, 0);
      for (final state in [
        AppLifecycleState.inactive,
        AppLifecycleState.hidden,
        AppLifecycleState.paused,
      ]) {
        tester.binding.handleAppLifecycleStateChanged(state);
        await tester.pump();
      }
      for (final state in [
        AppLifecycleState.hidden,
        AppLifecycleState.inactive,
        AppLifecycleState.resumed,
      ]) {
        tester.binding.handleAppLifecycleStateChanged(state);
        await tester.pump();
      }
      await tester.pumpAndSettle();
      expect(desktop.connections, 0);
      expect(
        transport.calls.where((call) => call['method'] == 'thread/read'),
        isEmpty,
      );
      expect(desktop.active?.macDeviceId, 'mac-a');
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      lock.dispose();
    },
  );

  testWidgets(
    'warm connected B exposes real saved A tile for qualified status without new pairing or automatic target read',
    (tester) async {
      final credentials = TestCredentials();
      final a = Pairing({
            ...savedPair('mac-a').data,
            'displayName': 'Saved Mac A',
          }),
          b = Pairing({
            ...savedPair('mac-b').data,
            'displayName': 'Saved Mac B',
          });
      credentials.values['desktop.trusted'] = jsonEncode([b.data, a.data]);
      credentials.values['desktop.active'] = 'mac-b';
      final pairs = SwitchPairings(credentials);
      final remote = SwitchTransport(pairs);
      remote.histories['same-id'] = {
        'id': 'same-id',
        'turns': [
          {
            'id': 't',
            'items': [
              {
                'id': 'exact',
                'type': 'userMessage',
                'content': [
                  {'type': 'text', 'text': 'A exact focused row'},
                ],
              },
            ],
          },
        ],
      };
      final desktop = DesktopController(
        pairs,
        connection: remote,
        localStore: SwitchStore(),
      );
      await desktop.connect(b);
      await desktop.loadDevicePreferences();
      remote.connects.clear();
      remote.calls.clear();
      final links = StreamController<Uri>.broadcast(sync: true),
          lock = AppLockController(FakeOwnerAuth()..result = true);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          appLock: lock,
          linkStream: links.stream,
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      expect(desktop.connected, true);
      expect(remote.connects, isEmpty);
      remote.calls.clear();
      final target = DesktopLinkTarget.statusUri(
        'same-id',
        'mac-a',
        DesktopLinkTarget.keyFingerprint(a.publicKey)!,
      )!;
      links.add(Uri.parse('$target&message=exact'));
      await tester.pumpAndSettle();
      expect(desktop.navigationNeedsHost, true);
      expect(desktop.active?.macDeviceId, 'mac-b');
      expect(remote.connects, isEmpty);
      expect(remote.calls, isEmpty);
      final savedA = find.widgetWithText(ListTile, 'Saved Mac A');
      await tester.scrollUntilVisible(
        savedA,
        200,
        scrollable: find
            .descendant(
              of: find.byType(PairingPage),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      expect(savedA, findsOneWidget);
      expect(find.byKey(const Key('pairing_payload')), findsNothing);
      expect(find.text('Pair a Mac'), findsNothing);
      await tester.ensureVisible(savedA);
      await tester.tap(savedA);
      await tester.pumpAndSettle();
      expect(remote.connects, ['mac-a']);
      expect(desktop.active?.macDeviceId, 'mac-a');
      expect(remote.macDeviceId, 'mac-a');
      expect(find.text('A exact focused row'), findsOneWidget);
      expect(remote.calls.where((c) => c.method == 'thread/read').length, 1);
      expect(
        remote.calls.where(
          (c) => !{
            'initialize',
            'initialized',
            'thread/list',
            'model/list',
            'account/status/read',
            'thread/read',
            'thread/goal/get',
            'project/projectlessRoots',
          }.contains(c.method),
        ),
        isEmpty,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      lock.dispose();
      await links.close();
    },
  );
  testWidgets(
    'cold qualified A status while B selected requires explicit exact A choice without app authentication',
    (tester) async {
      final credentials = TestCredentials(),
          a = savedPair('mac-a'),
          b = savedPair('mac-b');
      credentials.values['desktop.trusted'] = jsonEncode([b.data, a.data]);
      credentials.values['desktop.active'] = 'mac-b';
      final remote = SubagentTransport()
        ..mac = 'mac-b'
        ..online = false;
      remote.histories['same-id'] = {
        'id': 'same-id',
        'turns': [
          {
            'id': 't',
            'items': [
              {
                'id': 'message',
                'type': 'userMessage',
                'content': [
                  {'type': 'text', 'text': 'Exact A linked message'},
                ],
              },
            ],
          },
        ],
      };
      final desktop = RoutingDesktop(
        remote,
        repository: PairingRepository(credentials),
      );
      final owner = FakeOwnerAuth()..result = false;
      final lock = AppLockController(owner);
      final target = DesktopLinkTarget.statusUri(
        'same-id',
        'mac-a',
        DesktopLinkTarget.keyFingerprint(a.publicKey)!,
      )!;
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(Uri.parse('$target&message=message')),
        ),
      );
      await tester.pumpAndSettle();
      expect(lock.shielded, false);
      expect(owner.calls, 0);
      expect(remote.calls, isEmpty);
      expect(desktop.connections, 0);
      expect(desktop.navigationNeedsHost, true);
      expect(desktop.navigationTarget?.macId, 'mac-a');
      expect(remote.calls, isEmpty);
      expect(desktop.connections, 0);
      await desktop.selectSaved(b);
      await tester.pumpAndSettle();
      expect(desktop.active?.macDeviceId, 'mac-b');
      expect(remote.calls, isEmpty);
      remote.mac = 'mac-a';
      await desktop.selectSaved(a);
      await tester.pumpAndSettle();
      expect(desktop.active?.macDeviceId, 'mac-a');
      expect(find.text('Exact A linked message'), findsOneWidget);
      expect(
        remote.calls.where((c) => c['method'] == 'thread/resume'),
        isEmpty,
      );
      expect(remote.calls.where((c) => c['method'] == 'thread/read').length, 1);
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      lock.dispose();
    },
  );
  for (final selection in ['Q', 'child']) {
    testWidgets(
      'consumed link T reopens after explicit $selection selection while current duplicates stay coalesced',
      (tester) async {
        final credentials = TestCredentials(), pair = savedPair('mac-a');
        credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
        credentials.values['desktop.active'] = 'mac-a';
        final transport = SubagentTransport();
        (transport.pairings.credentials as TestCredentials).values.addAll(
          credentials.values,
        );
        transport.histories['T'] = {
          'id': 'T',
          'title': 'Linked T',
          'turns': [
            {
              'id': 'turn',
              'items': [
                {
                  'id': 'target-message',
                  'type': 'userMessage',
                  'content': [
                    {'type': 'text', 'text': 'Reopened exact T'},
                  ],
                },
              ],
            },
          ],
        };
        final desktop = RoutingDesktop(transport)
          ..active = pair
          ..trusted = [pair];
        await desktop.threadList.attach('mac-a');
        final links = StreamController<Uri>.broadcast(sync: true),
            lock = AppLockController(FakeOwnerAuth()..result = true),
            target = Uri.parse('djl://thread/T?message=target-message');
        await tester.pumpWidget(
          DjlApp(
            client: client(credentials, []),
            desktop: desktop,
            appLock: lock,
            linkStream: links.stream,
            initialLink: Future.value(target),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Reopened exact T'), findsOneWidget);
        if (selection == 'Q') {
          await desktop.openThread({'id': 'Q'});
        } else {
          emitSubagent(transport, parent: 'T', known: true);
          await tester.pumpAndSettle();
          final action = desktop.subagents.items.values.single;
          await desktop.openSubagent(action, action.children.single);
        }
        await tester.pumpAndSettle();
        expect(desktop.thread?['id'], selection);
        links.add(target);
        await tester.pumpAndSettle();
        expect(desktop.thread?['id'], 'T');
        expect(find.text('Reopened exact T'), findsOneWidget);
        links.add(target);
        await tester.pumpAndSettle();
        expect(
          transport.calls
              .where(
                (call) =>
                    call['method'] == 'thread/read' &&
                    (call['params'] as Map)['threadId'] == 'T',
              )
              .length,
          2,
        );
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.byType(DesktopChatPage), findsNothing);
        await tester.pumpWidget(const SizedBox.shrink());
        desktop.dispose();
        lock.dispose();
        await links.close();
      },
    );
  }
  testWidgets(
    'same-host lifecycle reconnect retains in-flight intent and retries fresh read',
    (tester) async {
      final credentials = TestCredentials(), pair = savedPair('mac-a');
      credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
      credentials.values['desktop.active'] = 'mac-a';
      final transport = SubagentTransport()..gates['recover'] = Completer();
      (transport.pairings.credentials as TestCredentials).values.addAll(
        credentials.values,
      );
      final desktop = RoutingDesktop(transport)
        ..active = pair
        ..trusted = [pair];
      await desktop.threadList.attach('mac-a');
      final lock = AppLockController(FakeOwnerAuth()..result = true);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(Uri.parse('djl://thread/recover')),
        ),
      );
      await tester.pumpAndSettle();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      transport.gates['recover']!.complete({
        'thread': {'id': 'recover', 'turns': []},
      });
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((call) => call['method'] == 'thread/read').length,
        2,
      );
      expect(find.byType(DesktopChatPage), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      lock.dispose();
    },
  );

  testWidgets(
    'cold linked offline history waits for actual saved cache instead of replacing it',
    (tester) async {
      final credentials = TestCredentials(), pair = savedPair('mac-a');
      credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
      credentials.values['desktop.active'] = 'mac-a';
      final transport = SubagentTransport()..online = false;
      (transport.pairings.credentials as TestCredentials).values.addAll(
        credentials.values,
      );
      final desktop = RoutingDesktop(transport, cache: SlowRoutingCache());
      // A single root-owned restore must retain this exact delayed store.
      final delayed = desktop.threadList.store as SlowRoutingCache;
      final lock = AppLockController(FakeOwnerAuth()..result = true);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(
            Uri.parse('djl://thread/cached?message=saved'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(DesktopChatPage), findsNothing);
      expect(desktop.connections, 0);
      desktop.connects = false;
      delayed.gate.complete({
        'threads': [
          {'id': 'cached', 'title': 'Saved linked chat'},
        ],
        'timelines': {
          'cached': [
            {
              'id': 'saved',
              'type': 'userMessage',
              'text': 'Preserved offline target',
            },
          ],
        },
      });
      await tester.pumpAndSettle();
      expect(find.text('Preserved offline target'), findsOneWidget);
      expect(desktop.connections, 1);
      expect(
        transport.calls.where((call) => call['method'] == 'thread/read'),
        isEmpty,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      lock.dispose();
    },
  );

  testWidgets(
    'new Cloud link cannot be overtaken by an older desktop history response',
    (tester) async {
      final credentials = TestCredentials()
            ..values['cloud.session'] = 'session',
          pair = savedPair('mac-a');
      credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
      credentials.values['desktop.active'] = 'mac-a';
      final transport = SubagentTransport()..gates['desktop'] = Completer();
      (transport.pairings.credentials as TestCredentials).values.addAll(
        credentials.values,
      );
      final desktop = RoutingDesktop(transport)
        ..active = pair
        ..trusted = [pair];
      await desktop.threadList.attach('mac-a');
      final links = StreamController<Uri>.broadcast(sync: true),
          lock = AppLockController(FakeOwnerAuth()..result = true);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          appLock: lock,
          linkStream: links.stream,
          initialLink: Future.value(Uri.parse('djl://thread/desktop')),
        ),
      );
      await tester.pumpAndSettle();
      links.add(Uri.parse('djl://cloud/c/latest-cloud'));
      await tester.pumpAndSettle();
      expect(find.byType(ChatPage), findsOneWidget);
      transport.gates['desktop']!.complete({
        'thread': {'id': 'desktop', 'turns': []},
      });
      await tester.pumpAndSettle();
      expect(find.byType(ChatPage), findsOneWidget);
      expect(find.byType(DesktopChatPage), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      lock.dispose();
      await links.close();
    },
  );
  testWidgets(
    'new desktop intent stays visible when an older Cloud account read settles',
    (tester) async {
      final credentials = TestCredentials()
            ..values['cloud.session'] = 'session',
          pair = savedPair('mac-a');
      credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
      credentials.values['desktop.active'] = 'mac-a';
      final transport = SubagentTransport();
      (transport.pairings.credentials as TestCredentials).values.addAll(
        credentials.values,
      );
      final desktop = RoutingDesktop(transport)
        ..active = pair
        ..trusted = [pair];
      await desktop.threadList.attach('mac-a');
      final account = Completer<http.Response>();
      final cloud = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: credentials,
        client: MockClient((request) async {
          final path = request.url.path;
          if (path == '/v1/me') return account.future;
          return http.Response(
            jsonEncode(
              path == '/v1/auth/token'
                  ? {'token': 'jwt'}
                  : path == '/v1/conversations'
                  ? {'conversations': []}
                  : path.startsWith('/v1/conversations/')
                  ? {
                      'conversation': {'id': 'old-cloud'},
                      'messages': [],
                    }
                  : {},
            ),
            200,
          );
        }),
      );
      final links = StreamController<Uri>.broadcast(sync: true),
          lock = AppLockController(FakeOwnerAuth()..result = true);
      await tester.pumpWidget(
        DjlApp(
          client: cloud,
          desktop: desktop,
          appLock: lock,
          linkStream: links.stream,
          initialLink: Future.value(Uri.parse('djl://cloud/c/old-cloud')),
        ),
      );
      await tester.pumpAndSettle();
      links.add(Uri.parse('djl://thread/new-desktop'));
      await tester.pumpAndSettle();
      expect(find.byType(DesktopChatPage), findsOneWidget);
      account.complete(
        http.Response('{"user":{"id":"u1"},"activeOrgId":"o1"}', 200),
      );
      await tester.pumpAndSettle();
      expect(find.byType(DesktopChatPage), findsOneWidget);
      expect(find.byType(ChatPage), findsNothing);
      await cloud.setSession(null);
      cloud.onSessionEnded?.call();
      await tester.pumpAndSettle();
      expect(find.byType(DesktopChatPage), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      lock.dispose();
      await links.close();
    },
  );

  testWidgets(
    'explicit retry reopens cached offline target after returning to host list',
    (tester) async {
      final credentials = TestCredentials(), pair = savedPair('mac-a');
      credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
      credentials.values['desktop.active'] = 'mac-a';
      final transport = SubagentTransport()..online = false;
      (transport.pairings.credentials as TestCredentials).values.addAll(
        credentials.values,
      );
      final desktop = RoutingDesktop(transport)..connects = false;
      final lock = AppLockController(FakeOwnerAuth()..result = true);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(Uri.parse('djl://thread/offline')),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(DesktopChatPage), findsOneWidget);
      expect(desktop.navigationTarget?.thread, 'offline');
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Retry desktop link'));
      await tester.pumpAndSettle();
      expect(find.byType(DesktopChatPage), findsOneWidget);
      expect(
        transport.calls.where((call) => call['method'] == 'thread/read'),
        isEmpty,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      lock.dispose();
    },
  );

  testWidgets(
    'secure selection failure holds cold link and retries original selected identity without app authentication',
    (tester) async {
      final credentials = LockedSelectionCredentials(),
          a = savedPair('mac-a'),
          b = savedPair('mac-b');
      credentials.values['desktop.trusted'] = jsonEncode([b.data, a.data]);
      credentials.values['desktop.active'] = 'mac-a';
      final transport = SubagentTransport()..online = false;
      final desktop = RoutingDesktop(
        transport,
        repository: PairingRepository(credentials),
      );
      final owner = FakeOwnerAuth()..result = false;
      final controlled = AppLockController(owner);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          appLock: controlled,
          linkStream: const Stream.empty(),
          initialLink: Future.value(Uri.parse('djl://thread/secure-linked')),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Retry startup'), findsOneWidget);
      expect(controlled.ready, isFalse);
      expect(desktop.connections, 0);
      expect(transport.calls, isEmpty);
      credentials.unavailable = false;
      await tester.tap(find.text('Retry startup'));
      await tester.pumpAndSettle();
      expect(controlled.shielded, isFalse);
      expect(owner.calls, 0);
      expect(desktop.active?.macDeviceId, 'mac-a');
      expect(desktop.connections, 1);
      expect(desktop.thread?['id'], 'secure-linked');
      expect(find.byType(DesktopChatPage), findsOneWidget);
      expect(
        transport.calls.where((call) => call['method'] == 'thread/read').length,
        1,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      controlled.dispose();
    },
  );

  testWidgets(
    'explicit Cloud choice stays Welcome after signout but cold automatic returns to saved host',
    (tester) async {
      final credentials = TestCredentials(), pair = savedPair('mac-a');
      credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
      credentials.values['desktop.active'] = 'mac-a';
      final transport = SubagentTransport();
      (transport.pairings.credentials as TestCredentials).values.addAll(
        credentials.values,
      );
      final desktop = RoutingDesktop(transport)
        ..active = pair
        ..trusted = [pair];
      await desktop.threadList.attach('mac-a');
      final cloud = client(credentials, []),
          lock = AppLockController(FakeOwnerAuth()..result = true);
      await tester.pumpWidget(
        DjlApp(
          client: cloud,
          desktop: desktop,
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(PairingPage), findsOneWidget);
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cloud chat').hitTestable());
      await tester.pumpAndSettle();
      expect(find.text('Welcome to DJL'), findsOneWidget);
      await tester.tap(find.text('Continue with email'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Password'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('email')),
        'fixture@example.test',
      );
      await tester.enterText(
        find.byKey(const Key('password')),
        'fixture-password',
      );
      await tester.pump();
      final submit = find.byKey(const Key('auth_primary'));
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(find.text('Welcome to DJL'), findsNothing);
      expect(find.byType(PairingPage), findsNothing);
      await cloud.setSession(null);
      cloud.onSessionEnded?.call();
      await tester.pumpAndSettle();
      expect(find.text('Welcome to DJL'), findsOneWidget);
      expect(desktop.active?.macDeviceId, 'mac-a');
      await tester.pumpWidget(const SizedBox.shrink());
      lock.dispose();
      desktop.dispose();
      final next = RoutingDesktop(transport)
        ..active = pair
        ..trusted = [pair];
      await next.threadList.attach('mac-a');
      final nextLock = AppLockController(FakeOwnerAuth()..result = true);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: next,
          appLock: nextLock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(PairingPage), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      next.dispose();
      nextLock.dispose();
    },
  );
  testWidgets(
    'explicit host choice binds an unselected target and cancel never reads it',
    (tester) async {
      final credentials = TestCredentials(),
          a = savedPair('mac-a'),
          b = savedPair('mac-b');
      credentials.values['desktop.trusted'] = jsonEncode([a.data, b.data]);
      final pairs = SwitchPairings(credentials);
      final transport = SwitchTransport(pairs);
      final desktop = DesktopController(
            pairs,
            connection: transport,
            localStore: SwitchStore(),
          ),
          links = StreamController<Uri>.broadcast(sync: true),
          lock = AppLockController(FakeOwnerAuth()..result = true);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          appLock: lock,
          linkStream: links.stream,
          initialLink: Future.value(Uri.parse('djl://thread/chosen')),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((call) => call.method == 'thread/read'),
        isEmpty,
      );
      await desktop.selectSaved(b);
      await tester.pumpAndSettle();
      expect(desktop.active?.macDeviceId, 'mac-b');
      expect(desktop.thread?['id'], 'chosen');
      expect(find.byType(DesktopChatPage), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      links.add(Uri.parse('djl://thread/cancel-me'));
      desktop.cancelNavigation();
      await tester.pumpAndSettle();
      // The queued receipt itself is still newer than the explicit controller cancellation;
      // root must honor the cancellation epoch before it can issue a read.
      expect(
        transport.calls.where((call) => call.params['threadId'] == 'cancel-me'),
        isEmpty,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      lock.dispose();
      await links.close();
    },
  );

  testWidgets(
    'receipt before a host switch never redirects the thread to the new Mac',
    (tester) async {
      final credentials = TestCredentials(),
          a = savedPair('mac-a'),
          b = savedPair('mac-b');
      credentials.values['desktop.trusted'] = jsonEncode([a.data, b.data]);
      credentials.values['desktop.active'] = 'mac-a';
      final pairs = SwitchPairings(credentials);
      final transport = SwitchTransport(pairs);
      final desktop = DesktopController(
        pairs,
        connection: transport,
        localStore: SwitchStore(),
      );
      await desktop.connect(a);
      await desktop.loadDevicePreferences();
      transport.calls.clear();
      final links = StreamController<Uri>.broadcast(sync: true),
          lock = AppLockController(FakeOwnerAuth()..result = true);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          appLock: lock,
          linkStream: links.stream,
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      links.add(Uri.parse('djl://thread/original-host-only'));
      await desktop.selectSaved(b);
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((call) => call.method == 'thread/read'),
        isEmpty,
      );
      expect(find.byType(DesktopChatPage), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      lock.dispose();
      await links.close();
    },
  );

  for (final mode in ['cold', 'warm', 'delayed-initial']) {
    testWidgets(
      '$mode paired link reveals real message once while Cloud is independent',
      (tester) async {
        final credentials = TestCredentials()
          ..values['cloud.session'] = 'cloud-session';
        final pair = savedPair('mac-a');
        credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
        credentials.values['desktop.active'] = 'mac-a';
        final transport = SubagentTransport();
        (transport.pairings.credentials as TestCredentials).values.addAll(
          credentials.values,
        );
        final desktop = RoutingDesktop(transport)
          ..active = pair
          ..trusted = [pair];
        await desktop.threadList.attach('mac-a');
        transport.histories['new'] = {
          'id': 'new',
          'title': 'Exact linked chat',
          'runtimeMode': 'approval-required',
          'turns': [
            {
              'id': 'turn',
              'items': List.generate(
                150,
                (index) => {
                  'id': 'message-$index',
                  'type': 'userMessage',
                  'content': [
                    {'type': 'text', 'text': 'Linked real row $index'},
                  ],
                },
              ),
            },
          ],
        };
        final links = StreamController<Uri>.broadcast(sync: true),
            initial = Completer<Uri?>();
        final target = Uri.parse('djl://thread/new?message=message-140');
        final lock = AppLockController(FakeOwnerAuth()..result = true);
        final calls = <String>[];
        if (mode == 'cold') {
          initial.complete(target);
        } else if (mode == 'warm') {
          initial.complete(null);
        }
        await tester.pumpWidget(
          DjlApp(
            client: client(credentials, calls),
            desktop: desktop,
            appLock: lock,
            linkStream: links.stream,
            initialLink: initial.future,
          ),
        );
        await tester.pumpAndSettle();
        if (mode != 'cold') {
          links.add(target);
          await tester.pumpAndSettle();
        }
        if (mode == 'delayed-initial') {
          initial.complete(Uri.parse('djl://thread/stale'));
          await tester.pumpAndSettle();
        }
        expect(find.byType(DesktopChatPage), findsOneWidget);
        expect(desktop.thread?['id'], 'new');
        expect(find.text('Linked real row 140'), findsOneWidget);
        expect(
          tester
              .getRect(find.text('Linked real row 140'))
              .overlaps(const Rect.fromLTWH(0, 0, 800, 600)),
          isTrue,
        );
        links.add(target);
        await tester.pumpAndSettle();
        expect(
          transport.calls
              .where((call) => call['method'] == 'thread/read')
              .length,
          1,
        );
        expect(
          transport.calls.where((call) => call['method'] == 'thread/resume'),
          isEmpty,
        );
        expect(
          calls.where((call) => call.startsWith('POST /v1/conversations/')),
          isEmpty,
        );
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.byType(DesktopChatPage), findsNothing);
        await tester.pumpWidget(const SizedBox.shrink());
        desktop.dispose();
        lock.dispose();
        await links.close();
      },
    );
  }

  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets(
    'cold signed-out selected host routes directly and connects once without app authentication',
    (tester) async {
      final credentials = TestCredentials();
      final pair = savedPair('mac-a');
      credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
      credentials.values['desktop.active'] = pair.macDeviceId;
      final transport = SubagentTransport()..online = false;
      final desktop = RoutingDesktop(
        transport,
      ); // root restores the supplied secure store below
      (transport.pairings.credentials as TestCredentials).values.addAll(
        credentials.values,
      );
      desktop.trusted = [pair];
      final owner = FakeOwnerAuth()..result = false;
      final lock = AppLockController(owner);
      // No injected source is allowed to bypass the root secure startup read.
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(PairingPage), findsOneWidget);
      expect(find.text('Welcome to DJL'), findsNothing);
      expect(desktop.connections, 1);
      expect(owner.calls, 0);
      expect(
        transport.calls.where(
          (call) => (call['method'] as String).startsWith('thread/'),
        ),
        isEmpty,
      );
      await tester.pump();
      expect(desktop.connections, 1);
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      lock.dispose();
    },
  );
  testWidgets(
    'unselected desktop link shows host choice and retains latest intent without Cloud auth',
    (tester) async {
      final credentials = TestCredentials();
      credentials.values['desktop.trusted'] = jsonEncode([
        savedPair('mac-a').data,
        savedPair('mac-b').data,
      ]);
      final desktop = RoutingDesktop(SubagentTransport());
      (desktop.pairings.credentials as TestCredentials).values.addAll(
        credentials.values,
      );
      final links = StreamController<Uri>.broadcast(sync: true);
      final lock = AppLockController(FakeOwnerAuth()..result = true);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          appLock: lock,
          linkStream: links.stream,
          initialLink: Future.value(Uri.parse('djl://thread/old')),
        ),
      );
      await tester.pumpAndSettle();
      links.add(Uri.parse('djl://thread/new?message=m'));
      await tester.pumpAndSettle();
      expect(find.byType(PairingPage), findsOneWidget);
      expect(find.byType(DesktopChatPage), findsNothing);
      expect(desktop.navigationNeedsHost, isTrue);
      expect(desktop.navigationTarget?.thread, 'new');
      expect(desktop.connections, 0);
      expect(find.textContaining('Choose a saved Mac'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      lock.dispose();
      await links.close();
    },
  );
}
