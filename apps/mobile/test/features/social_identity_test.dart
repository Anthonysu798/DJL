import 'dart:async';
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in_platform_interface/google_sign_in_platform_interface.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/auth/data/social_identity.dart';
import 'package:djl_mobile/features/auth/presentation/auth_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

class NativeGoogleBoundary extends GoogleSignInPlatform {
  final initializations = <InitParameters>[];
  int acquisitions = 0, signOuts = 0, disconnects = 0;
  Completer<AuthenticationResults>? pending;
  GoogleSignInException? failure;
  String? token = 'google-provider-token';
  @override
  Future<void> init(InitParameters params) async => initializations.add(params);
  @override
  bool supportsAuthenticate() => true;
  @override
  Future<AuthenticationResults> authenticate(
    AuthenticateParameters params,
  ) async {
    acquisitions++;
    if (failure != null) throw failure!;
    return pending?.future ??
        AuthenticationResults(
          user: const GoogleSignInUserData(
            email: 'qa@example.test',
            id: 'qa-user',
          ),
          authenticationTokens: AuthenticationTokenData(idToken: token),
        );
  }

  @override
  Future<void> signOut(SignOutParams params) async => signOuts++;
  @override
  Future<void> disconnect(DisconnectParams params) async => disconnects++;
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw StateError('Unexpected Google API ${invocation.memberName}');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const configChannel = MethodChannel('djl.mobile/social-config');
  const appleChannel = MethodChannel(
    'com.aboutyou.dart_packages.sign_in_with_apple',
  );
  final google = NativeGoogleBoundary();
  final appleCalls = <MethodCall>[];
  final hashes = <String>[];
  List<Object?> schemes = ['com.googleusercontent.apps.123456-iosclient'];
  bool cancelApple = false;
  String? appleToken = 'apple-provider-token';
  Object? configFailure;
  setUpAll(() => GoogleSignInPlatform.instance = google);
  setUp(() {
    appleCalls.clear();
    hashes.clear();
    schemes = ['com.googleusercontent.apps.123456-iosclient'];
    configFailure = null;
    cancelApple = false;
    appleToken = 'apple-provider-token';
    google.failure = null;
    google.pending = null;
    google.token = 'google-provider-token';
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(configChannel, (call) async {
          expect(call.method, 'callbackSchemes');
          if (configFailure != null) throw configFailure!;
          return schemes;
        });
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(appleChannel, (call) async {
          appleCalls.add(call);
          if (call.method == 'isAvailable') return true;
          expect(call.method, 'performAuthorizationRequest');
          if (cancelApple) {
            throw PlatformException(
              code: 'authorization-error/canceled',
              message: 'sensitive provider URL',
            );
          }
          final request = (call.arguments as List).single as Map;
          expect(request['scopes'], ['email', 'fullName']);
          hashes.add(request['nonce'] as String);
          return {
            'type': 'appleid',
            'userIdentifier': 'apple-user',
            'identityToken': appleToken,
            'authorizationCode': 'unused-code',
          };
        });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(configChannel, null);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(appleChannel, null);
  });

  PluginSocialIdentitySource ios({
    bool apple = false,
    String client = '123456-iosclient.apps.googleusercontent.com',
    String server = '123456-serverclient.apps.googleusercontent.com',
  }) => PluginSocialIdentitySource(
    targetPlatform: TargetPlatform.iOS,
    appleEnabled: apple,
    googleIosClientId: client,
    googleServerClientId: server,
  );

  test(
    'empty defaults and malformed IDs never initialize or acquire Google',
    () async {
      final baseline = google.initializations.length;
      expect(
        await PluginSocialIdentitySource(
          targetPlatform: TargetPlatform.iOS,
        ).isAvailable(SocialProvider.apple),
        isFalse,
      );
      for (final id in [
        '',
        '   ',
        r'$(UNRESOLVED)',
        'not-a-client',
        '123-invalid.apps.googleusercontent.com?token=secret',
      ]) {
        expect(
          await ios(client: id).isAvailable(SocialProvider.google),
          isFalse,
        );
        expect(
          await ios(server: id).isAvailable(SocialProvider.google),
          isFalse,
        );
        await expectLater(
          ios(client: id).acquire(SocialProvider.google),
          throwsA(isA<SocialIdentityFailure>()),
        );
      }
      expect(google.initializations, hasLength(baseline));
      expect(appleCalls, isEmpty);
    },
  );

  test(
    'iOS Google requires the actual matching declared callback scheme',
    () async {
      final source = ios();
      for (final invalid in [
        <Object?>[],
        <Object?>['djl'],
        <Object?>[42],
        <Object?>[r'$(GOOGLE_SCHEME)'],
      ]) {
        schemes = invalid;
        expect(await source.isAvailable(SocialProvider.google), isFalse);
        await expectLater(
          source.acquire(SocialProvider.google),
          throwsA(isA<SocialIdentityFailure>()),
        );
      }
      configFailure = PlatformException(
        code: 'missing',
        message: 'private URL',
      );
      expect(await source.isAvailable(SocialProvider.google), isFalse);
      expect(google.acquisitions, 0);
    },
  );

  test(
    'Apple hashes the exact fresh request nonce once and returns that same hash for Cloud',
    () async {
      final source = PluginSocialIdentitySource(
        targetPlatform: TargetPlatform.iOS,
        appleEnabled: true,
        randomBytes: (length) => List.filled(length, 0),
      );
      final identity = await source.acquire(SocialProvider.apple);
      expect(
        hashes.single,
        '0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a',
      );
      expect(identity?.nonce, hashes.single);
      expect(identity?.token, 'apple-provider-token');
      final random = ios(apple: true);
      await random.acquire(SocialProvider.apple);
      await random.acquire(SocialProvider.apple);
      expect(hashes[1], matches(RegExp(r'^[0-9a-f]{64}$')));
      expect(hashes[1], isNot(hashes[2]));
    },
  );

  test(
    'Apple cancellation is quiet and missing native token is rejected safely',
    () async {
      cancelApple = true;
      expect(await ios(apple: true).acquire(SocialProvider.apple), isNull);
      cancelApple = false;
      appleToken = null;
      await expectLater(
        ios(apple: true).acquire(SocialProvider.apple),
        throwsA(isA<SocialIdentityFailure>()),
      );
    },
  );

  test(
    'real Apple plugin adapter and actual controller send the same one-time hash to Cloud',
    () async {
      final source = PluginSocialIdentitySource(
        targetPlatform: TargetPlatform.iOS,
        appleEnabled: true,
        randomBytes: (length) => List.filled(length, 0),
      );
      final store = TestCredentials();
      final wire = <http.Request>[];
      final cloud = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: store,
        client: MockClient((request) async {
          if (request.url.path == '/v1/client-config') {
            return http.Response('{"auth":{"apple":true,"google":false}}', 200);
          }
          if (request.url.path == '/v1/auth/sign-in/social') {
            wire.add(request);
            return http.Response('{"token":"djl-session"}', 200);
          }
          if (request.url.path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          return http.Response('{"user":{"id":"qa"}}', 200);
        }),
      );
      final auth = AuthController(cloud, socialIdentity: source);
      addTearDown(auth.dispose);
      addTearDown(cloud.close);
      await auth.loadSocialProviders();
      expect(await auth.signInWithSocial(SocialProvider.apple), isTrue);
      expect(hashes, [
        '0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a',
      ]);
      expect(jsonDecode(wire.single.body), {
        'provider': 'apple',
        'idToken': {
          'token': 'apple-provider-token',
          'nonce':
              '0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a',
        },
      });
      expect(store.values, {'cloud.session': 'djl-session'});
    },
  );

  test(
    'Google initializes once with iOS and server IDs, no fixed nonce, and uses explicit authenticate',
    () async {
      final source = ios();
      expect(await source.isAvailable(SocialProvider.google), isTrue);
      expect(
        (await source.acquire(SocialProvider.google))?.token,
        'google-provider-token',
      );
      await source.acquire(SocialProvider.google);
      expect(google.initializations, hasLength(1));
      final params = google.initializations.single;
      expect(params.clientId, '123456-iosclient.apps.googleusercontent.com');
      expect(
        params.serverClientId,
        '123456-serverclient.apps.googleusercontent.com',
      );
      expect(params.nonce, isNull);
    },
  );

  test(
    'Google quiet cancel, missing token and raw native details never leak',
    () async {
      google.failure = const GoogleSignInException(
        code: GoogleSignInExceptionCode.canceled,
        description: 'https://private/?token=secret',
      );
      expect(await ios().acquire(SocialProvider.google), isNull);
      google.failure = const GoogleSignInException(
        code: GoogleSignInExceptionCode.clientConfigurationError,
        description: 'https://private/?token=secret',
      );
      try {
        await ios().acquire(SocialProvider.google);
        fail('Must reject native configuration failure');
      } on SocialIdentityFailure catch (error) {
        expect(error.toString(), isNot(contains('secret')));
        expect(error.toString(), isNot(contains('https://')));
      }
      google.failure = null;
      google.token = '';
      await expectLater(
        ios().acquire(SocialProvider.google),
        throwsA(isA<SocialIdentityFailure>()),
      );
    },
  );

  test(
    'a different Google configuration cannot reinitialize the process singleton',
    () async {
      await expectLater(
        ios(
          server: '999999-otherclient.apps.googleusercontent.com',
        ).acquire(SocialProvider.google),
        throwsA(isA<SocialIdentityFailure>()),
      );
      expect(google.initializations, hasLength(1));
    },
  );

  test(
    'physical acquisition guard persists across source instances until native completion',
    () async {
      google.pending = Completer();
      final source = ios();
      final first = source.acquire(SocialProvider.google);
      await Future<void>.delayed(Duration.zero);
      await expectLater(
        ios().acquire(SocialProvider.apple),
        throwsA(isA<SocialIdentityFailure>()),
      );
      final clearing = source.signOut();
      await Future<void>.delayed(Duration.zero);
      expect(google.signOuts, 0);
      google.pending!.complete(
        const AuthenticationResults(
          user: GoogleSignInUserData(email: 'qa@example.test', id: 'u'),
          authenticationTokens: AuthenticationTokenData(idToken: 'late-token'),
        ),
      );
      expect((await first)?.token, 'late-token');
      google.pending = null;
      await clearing;
      expect(google.signOuts, 1);
      expect(google.disconnects, 0);
    },
  );

  test('Android Apple is unavailable even when opted in', () async {
    final source = PluginSocialIdentitySource(
      targetPlatform: TargetPlatform.android,
      appleEnabled: true,
      googleServerClientId: '123456-serverclient.apps.googleusercontent.com',
    );
    expect(await source.isAvailable(SocialProvider.apple), isFalse);
    expect(await source.isAvailable(SocialProvider.google), isTrue);
    expect(appleCalls, isEmpty);
  });
}
