import 'dart:convert';

import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  final calls = <MethodCall>[];
  const androidOptions = {
    'encryptedSharedPreferences': 'false',
    'resetOnError': 'false',
    'migrateOnAlgorithmChange': 'true',
    'migrateWithBackup': 'false',
    'enforceBiometrics': 'false',
    'keyCipherAlgorithm': 'RSA_ECB_OAEPwithSHA_256andMGF1Padding',
    'storageCipherAlgorithm': 'AES_GCM_NoPadding',
    'biometricType': 'biometricOrDeviceCredential',
    'sharedPreferencesName': '',
    'preferencesKeyPrefix': '',
    'storageNamespace': '',
    'biometricPromptTitle': 'Authenticate to access',
    'biometricPromptSubtitle': 'Use biometrics or device credentials',
    'biometricPromptNegativeButton': 'Cancel',
  };

  void nativeHandler(Future<Object?> Function(MethodCall) handler) {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return handler(call);
        });
  }

  Matcher storageFailure() => isA<PlatformException>()
      .having((error) => error.code, 'code', 'credential_unavailable')
      .having((error) => error.message, 'message', 'Synthetic storage failure');

  setUp(() {
    calls.clear();
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
    debugDefaultTargetPlatformOverride = null;
  });

  test(
    'Android operations disable destructive reset with existing storage options',
    () async {
      nativeHandler((call) async => call.method == 'read' ? 'sentinel' : null);
      final store = PlatformCredentialStore();

      expect(await store.read('desktop.identity'), 'sentinel');
      await store.write('desktop.identity', 'updated sentinel');
      await store.write('desktop.identity', null);

      expect(calls.map((call) => call.method), ['read', 'write', 'delete']);
      for (final call in calls) {
        expect(call.arguments['key'], 'desktop.identity');
        expect(call.arguments['options'], androidOptions);
      }
      expect(calls[1].arguments['value'], 'updated sentinel');
    },
  );

  for (final operation in ['read', 'write']) {
    test(
      '$operation errors propagate without recovery mutations and allow explicit retry',
      () async {
        var unavailable = true;
        nativeHandler((call) async {
          if (unavailable) {
            throw PlatformException(
              code: 'credential_unavailable',
              message: 'Synthetic storage failure',
            );
          }
          return operation == 'read' ? 'preserved sentinel' : null;
        });
        final store = PlatformCredentialStore();
        Future<Object?> attempt() => operation == 'read'
            ? store.read('desktop.identity')
            : store.write('desktop.identity', 'explicit replacement');

        await expectLater(attempt(), throwsA(storageFailure()));
        expect(calls.map((call) => call.method), [operation]);
        expect(calls.single.arguments['options'], androidOptions);
        unavailable = false;
        expect(
          await attempt(),
          operation == 'read' ? 'preserved sentinel' : null,
        );
        expect(calls.map((call) => call.method), [operation, operation]);
        expect(calls.last.arguments, calls.first.arguments);
      },
    );
  }

  test(
    'identity read failure never creates a replacement and the same repository explicitly retries it',
    () async {
      var unavailable = true;
      final savedIdentity = jsonEncode({
        'phoneDeviceId': 'preserved-test-phone',
        'seed': base64Encode(List.filled(32, 7)),
        'publicKey': base64Encode(List.filled(32, 9)),
      });
      nativeHandler((call) async {
        if (unavailable) {
          throw PlatformException(
            code: 'credential_unavailable',
            message: 'Synthetic storage failure',
          );
        }
        return savedIdentity;
      });
      final store = PlatformCredentialStore();
      final repository = PairingRepository(store);

      await expectLater(repository.identity(), throwsA(storageFailure()));
      expect(calls.map((call) => call.method), ['read']);
      expect(calls.single.arguments['key'], 'desktop.identity');
      unavailable = false;
      final first = repository.identity();
      final second = repository.identity();
      expect(identical(first, second), isTrue);
      final restored = await first;
      expect(identical(await repository.identity(), restored), isTrue);
      expect(restored.deviceId, 'preserved-test-phone');
      expect(restored.seed, List.filled(32, 7));
      expect(restored.publicKey, base64Encode(List.filled(32, 9)));
      expect(calls.map((call) => call.method), ['read', 'read']);
    },
  );

  test(
    'trusted read failure prevents replacement writes and later restores records',
    () async {
      var unavailable = true;
      final pair = Pairing.parse(
        jsonEncode({
          'v': 2,
          'relay': 'wss://relay.example/relay',
          'sessionId': 'preserved-session',
          'macDeviceId': 'preserved-test-mac',
          'macIdentityPublicKey': base64Encode(List.filled(32, 3)),
          'expiresAt': 1,
        }),
        checkExpiry: false,
      );
      nativeHandler((call) async {
        if (unavailable) {
          throw PlatformException(
            code: 'credential_unavailable',
            message: 'Synthetic storage failure',
          );
        }
        return jsonEncode([pair.data]);
      });
      final repository = PairingRepository(PlatformCredentialStore());

      await expectLater(repository.trusted(), throwsA(storageFailure()));
      await expectLater(repository.trust(pair), throwsA(storageFailure()));
      expect(calls.map((call) => call.method), ['read', 'read']);
      expect(calls.map((call) => call.arguments['key']), [
        'desktop.trusted',
        'desktop.trusted',
      ]);
      unavailable = false;
      final restored = await repository.trusted();
      expect(restored.single.macDeviceId, 'preserved-test-mac');
      expect(restored.single.sessionId, 'preserved-session');
      expect(calls.map((call) => call.method), ['read', 'read', 'read']);
    },
  );

  test(
    'iOS retains device-only first-unlock accessibility and service',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      nativeHandler((call) async => call.method == 'read' ? 'sentinel' : null);
      final store = PlatformCredentialStore();

      expect(await store.read('desktop.identity'), 'sentinel');
      await store.write('desktop.identity', 'updated sentinel');
      await store.write('desktop.identity', null);

      expect(calls.map((call) => call.method), ['read', 'write', 'delete']);
      for (final call in calls) {
        expect(call.arguments['key'], 'desktop.identity');
        expect(
          call.arguments['options']['accessibility'],
          'first_unlock_this_device',
        );
        expect(
          call.arguments['options']['accountName'],
          'flutter_secure_storage_service',
        );
        expect(call.arguments['options']['synchronizable'], 'false');
        expect(call.arguments['options'].containsKey('resetOnError'), isFalse);
      }
    },
  );
}
