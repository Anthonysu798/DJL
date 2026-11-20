import 'dart:async';
import 'dart:convert';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../desktop_activity_test.dart' show ActivityCacheStore;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'package:djl_mobile/features/host/data/paired_login_store.dart';
import 'package:djl_mobile/features/host/domain/paired_login.dart';
import 'package:djl_mobile/features/settings/domain/device_owner_auth.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import '../cloud_deep_links_test.dart' show client;
import '../settings/app_lock_controller_test.dart' show FakeOwnerAuth;
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import '../../core/cloud_client_test.dart' show TestCredentials;

class OfflineLifecycleDesktop extends DesktopController {
  OfflineLifecycleDesktop(super.pairings)
    : super(localStore: ActivityCacheStore());
  @override
  Future<void> connect(
    Pairing pair, {
    bool bootstrap = false,
    bool resolve = true,
  }) async {}
}

class FailingTrustedCredentials extends TestCredentials {
  bool fail = true;
  @override
  Future<String?> read(String key) async {
    if (fail && key == 'desktop.trusted') {
      throw StateError('fixture secure store locked');
    }
    return super.read(key);
  }
}

class PrivacyGatedCredentials extends TestCredentials {
  Completer<String?>? loginRead;
  int loginReads = 0;
  @override
  Future<String?> read(String key) async {
    if (key.startsWith('codex.gpt.pendingLoginState.')) {
      loginReads++;
      if (loginRead != null) return loginRead!.future;
    }
    return super.read(key);
  }
}

class LockedLoginOwner implements DeviceOwnerAuth {
  @override
  Future<bool> isSupported() async => true;
  @override
  Future<bool> authenticate() async => false;
  @override
  Future<void> stop() async {}
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets(
    'root inactive and resumed recovers interrupted secure loading on the same pair',
    (tester) async {
      final credentials = PrivacyGatedCredentials();
      final pin = base64Encode(List.filled(32, 0));
      const device = 'a';
      final identity = LoginIdentity(device, pin);
      credentials.values['desktop.active'] = device;
      credentials.values['desktop.trusted'] = jsonEncode([
        {
          'v': 2,
          'macDeviceId': device,
          'sessionId': 's1',
          'macIdentityPublicKey': pin,
          'relay': 'wss://relay.example.test/relay',
          'expiresAt': 1,
        },
      ]);
      final record = LoginRecord(
        pending: PendingLogin(
          'current',
          'https://auth.example/current',
          DateTime.now(),
          null,
        ),
      );
      await PairedLoginStore(credentials).write(identity, record);
      final oldRead = Completer<String?>(), currentRead = Completer<String?>();
      credentials.loginRead = oldRead;
      final owner = FakeOwnerAuth()..result = true;
      final lock = AppLockController(owner);
      final calls = <String>[];
      final desktop = OfflineLifecycleDesktop(PairingRepository(credentials));
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, calls),
          desktop: desktop,
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      expect(lock.shielded, isFalse);
      expect(credentials.loginReads, 1);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pumpAndSettle();
      expect(lock.shielded, isTrue);
      credentials.loginRead = currentRead;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(lock.shielded, isFalse);
      expect(find.byType(PairingPage), findsOneWidget);
      expect(
        tester.widget<PairingPage>(find.byType(PairingPage)).controller,
        same(desktop),
      );
      expect(desktop.active?.macDeviceId, device);
      expect(desktop.pairedLogin.loaded, isFalse);
      oldRead.complete(
        jsonEncode(
          LoginRecord(
            pending: PendingLogin(
              'old',
              'https://auth.example/old',
              DateTime.now(),
              null,
            ),
          ).toJson(),
        ),
      );
      await tester.pumpAndSettle();
      expect(desktop.pairedLogin.loaded, isFalse);
      expect(desktop.pairedLogin.pending, isNull);
      await tester.tap(find.byTooltip('More actions'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Desktop status'));
      await tester.pumpAndSettle();
      expect(find.text('Loading secure sign-in recovery…'), findsOneWidget);
      currentRead.complete(jsonEncode(record.toJson()));
      await tester.pumpAndSettle();
      expect(credentials.loginReads, 2);
      expect(desktop.pairedLogin.loaded, isTrue);
      expect(desktop.pairedLogin.pending?.loginId, 'current');
      expect(find.text('Loading secure sign-in recovery…'), findsNothing);
      expect(find.text('Reopen sign-in on paired Mac'), findsOneWidget);
      expect(desktop.host.session, isNull);
      expect(calls, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      lock.dispose();
      expect(tester.takeException(), isNull);
    },
  );
  for (final mode in ['cold', 'warm', 'secure-store-retry']) {
    final cold = mode != 'warm';
    testWidgets(
      '$mode legacy callback restores original secure pending pair without app authentication or a Cloud sign-in',
      (tester) async {
        final credentials = mode == 'secure-store-retry'
            ? FailingTrustedCredentials()
            : TestCredentials();
        final pin = base64Encode(List.filled(32, 0));
        final identity = LoginIdentity('a', pin);
        final store = PairedLoginStore(credentials);
        credentials.values['desktop.active'] = 'a';
        credentials.values['desktop.trusted'] = jsonEncode([
          {
            'v': 2,
            'macDeviceId': 'a',
            'sessionId': 's1',
            'macIdentityPublicKey': pin,
            'relay': 'wss://relay.example.test/relay',
            'expiresAt': DateTime.now()
                .add(const Duration(days: 1))
                .millisecondsSinceEpoch,
          },
        ]);
        await store.write(
          identity,
          LoginRecord(
            pending: PendingLogin(
              'one',
              'https://auth.example/login',
              DateTime.now(),
              null,
            ),
          ),
        );
        final owner = AppLockController(LockedLoginOwner());
        final links = StreamController<Uri>.broadcast(sync: true),
            calls = <String>[];
        final uri = Uri.parse(
          'djl://auth/gpt/callback?loginId=one&code=fixture',
        );
        await tester.pumpWidget(
          DjlApp(
            client: client(credentials, calls),
            appLock: owner,
            linkStream: links.stream,
            initialLink: Future.value(cold ? uri : null),
          ),
        );
        await tester.pumpAndSettle();
        if (mode == 'secure-store-retry') {
          expect(owner.shielded, isTrue);
          expect(owner.ready, isFalse);
          expect(find.text('Retry startup'), findsOneWidget);
          (credentials as FailingTrustedCredentials).fail = false;
          await tester.tap(find.text('Retry startup'));
          await tester.pumpAndSettle();
        }
        if (!cold) {
          links.add(uri);
          await tester.pumpAndSettle();
        }
        expect(owner.ready, isTrue);
        expect(owner.shielded, isFalse);
        expect(owner.requiresUnlock, isFalse);
        final saved = await store.read(identity);
        expect(saved.callback?.loginId, 'one');
        expect(saved.callback?.url, uri.toString());
        expect(credentials.values['cloud.session'], isNull);
        expect(credentials.values['desktop.active'], 'a');
        expect(find.byType(ChatPage), findsNothing);
        expect(calls, isEmpty);
        final prefs = await SharedPreferences.getInstance();
        expect(prefs.getKeys().where((key) => key.contains('gpt')), isEmpty);
        await tester.pumpWidget(const SizedBox.shrink());
        await links.close();
        owner.dispose();
        expect(tester.takeException(), isNull);
      },
    );
  }
}
