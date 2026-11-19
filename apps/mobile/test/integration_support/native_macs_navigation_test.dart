import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import '../../integration_test/threads_test.dart'
    show macs, reveal, securePairingEntry;
import '../core/cloud_client_test.dart' show TestCredentials;
import '../features/desktop_subagents_test.dart' show SubagentTransport;
import '../features/desktop_activity_test.dart' show ActivityCacheStore;
import '../features/desktop_offline_test.dart' show savedPair;
import '../features/desktop_recovery_test.dart' show RecoveringTransport;
import '../features/settings/app_lock_controller_test.dart' show FakeOwnerAuth;
import '../features/desktop_new_chat_draft_test.dart'
    show DraftTransport, qaModels, finishDraft;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final entry in [
    (
      'local QA fixture',
      'desktop-qa-existing',
      'ws://127.0.0.1:8896/relay',
      true,
    ),
    ('other identity', 'existing-mac', 'ws://127.0.0.1:8896/relay', false),
    (
      'nonlocal relay',
      'desktop-qa-existing',
      'wss://relay.example.test/relay',
      false,
    ),
  ]) {
    testWidgets(
      'native manual pairing preserves saved trust for ${entry.$1}',
      (tester) async {
        tester.view.physicalSize = const Size(1206, 2622);
        tester.view.devicePixelRatio = 3;
        addTearDown(tester.view.reset);
        final credentials = TestCredentials();
        final pairings = PairingRepository(credentials);
        final pair = Pairing({
          ...savedPair().data,
          'macDeviceId': entry.$2,
          'relay': entry.$3,
        });
        await pairings.trust(pair);
        final saved = credentials.values['desktop.trusted'];
        final remote = DraftTransport(pairings)..host = pair.macDeviceId;
        final desktop =
            DesktopController(
                pairings,
                connection: remote,
                localStore: ActivityCacheStore(),
              )
              ..active = pair
              ..trusted = [pair]
              ..state = 'connected'
              ..models = List.of(qaModels);
        await desktop.threadList.attach(pair.macDeviceId);
        try {
          await tester.pumpWidget(
            MaterialApp(home: PairingPage(controller: desktop)),
          );
          await tester.pumpAndSettle();
          expect(desktop.connected, isTrue);
          expect(desktop.canEnterManualPairing, isTrue);
          if (entry.$4) {
            expect(await securePairingEntry(tester), same(desktop));
            expect(desktop.connected, isFalse);
            final field = find.byKey(const Key('pairing_payload'));
            expect(field.hitTestable(), findsOneWidget);
            expect(tester.widget<TextField>(field).enabled, isTrue);
          } else {
            await expectLater(
              () => securePairingEntry(tester),
              throwsA(
                isA<TestFailure>().having(
                  (error) => error.toString(),
                  'scope fence',
                  contains('local desktop QA fixture'),
                ),
              ),
            );
            expect(desktop.connected, isTrue);
          }
          expect(desktop.active, same(pair));
          expect(desktop.trusted, [pair]);
          expect(credentials.values['desktop.trusted'], saved);
          expect(remote.starts, 0);
          expect(
            remote.calls.where((c) => c['method'] == 'turn/start'),
            isEmpty,
          );
          expect(tester.takeException(), isNull);
        } finally {
          await finishDraft(tester, desktop);
        }
      },
      variant: TargetPlatformVariant.only(TargetPlatform.iOS),
    );
  }
  for (final initiallyTrusted in [true, false]) {
    testWidgets(
      'native pairing preflight reaches the actual form after forgetting the last Mac from ${initiallyTrusted ? 'restored trust' : 'explicit My Macs'}',
      (tester) async {
        final credentials = TestCredentials();
        final pairings = PairingRepository(credentials);
        final pair = savedPair();
        if (initiallyTrusted) await pairings.trust(pair);
        final transport = RecoveringTransport(pairings)
          ..failure = StateError('Offline host fixture');
        final desktop = DesktopController(
          pairings,
          connection: transport,
          localStore: ActivityCacheStore(),
        );
        final owner = FakeOwnerAuth();
        final lock = AppLockController(owner);
        final cloud = CloudClient(
          baseUrl: Uri.parse('https://example.test'),
          credentials: credentials,
          client: MockClient((_) async => http.Response('{}', 200)),
        );
        await tester.pumpWidget(
          DjlApp(
            client: cloud,
            desktop: desktop,
            appLock: lock,
            initialLink: Future.value(null),
            linkStream: const Stream.empty(),
          ),
        );
        try {
          await tester.pumpAndSettle();
          if (initiallyTrusted) {
            expect(find.byType(PairingPage), findsOneWidget);
            expect(owner.calls, 0);
            expect(lock.requiresUnlock, isFalse);
          } else {
            expect(find.text('Connect to DJL Desktop'), findsOneWidget);
          }
          expect(await macs(tester), same(desktop));
          if (!initiallyTrusted) {
            await pairings.trust(pair);
            await desktop.restore();
            await tester.pumpAndSettle();
          }
          expect(desktop.trusted.single.macDeviceId, pair.macDeviceId);
          expect(desktop.trusted.single.publicKey, pair.publicKey);
          for (final saved in List.of(desktop.trusted)) {
            if (saved.macDeviceId == pair.macDeviceId) {
              await desktop.forget(saved);
            }
          }
          await tester.pumpAndSettle();
          expect(desktop.trusted, isEmpty);
          expect(desktop.active, isNull);
          if (initiallyTrusted) {
            expect(find.byType(PairingPage), findsOneWidget);
            expect(find.text('Connect to DJL Desktop'), findsOneWidget);
          } else {
            expect(find.byType(PairingPage), findsOneWidget);
          }
          expect(await macs(tester), same(desktop));
          expect(await securePairingEntry(tester), same(desktop));
          final field = find.byKey(const Key('pairing_payload'));
          await reveal(tester, field);
          expect(find.byType(PairingPage), findsOneWidget);
          expect(field.hitTestable(), findsOneWidget);
          expect(tester.takeException(), isNull);
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          await tester.pumpAndSettle();
        }
      },
    );
  }
  for (final entry in ['already visible', 'Welcome', 'Settings']) {
    testWidgets('native My Macs helper accepts $entry entry', (tester) async {
      final transport = SubagentTransport();
      final desktop = DesktopController(
        transport.pairings,
        connection: transport,
        localStore: ActivityCacheStore(),
      );
      Widget pairing() => PairingPage(controller: desktop);
      void open(BuildContext context, Widget page) => Navigator.of(
        context,
      ).push(MaterialPageRoute<void>(builder: (_) => page));
      Widget welcome() => Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => open(context, pairing()),
            child: const Text('Pair with a Mac'),
          ),
        ),
      );
      Widget settings() => Builder(
        builder: (context) => Scaffold(
          appBar: AppBar(
            actions: [
              IconButton(
                tooltip: 'Settings',
                icon: const Icon(Icons.settings),
                onPressed: () => open(
                  context,
                  Builder(
                    builder: (context) => Scaffold(
                      body: TextButton(
                        onPressed: () => open(context, pairing()),
                        child: const Text('My Macs'),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: switch (entry) {
            'already visible' => pairing(),
            'Welcome' => welcome(),
            _ => settings(),
          },
        ),
      );
      await tester.pumpAndSettle();
      expect(await macs(tester), same(desktop));
      expect(find.byType(PairingPage), findsOneWidget);
      expect(transport.calls, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      await tester.pump();
      expect(tester.takeException(), isNull);
    });
  }
}
