import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/auth/data/social_identity.dart';
import 'package:djl_mobile/features/auth/presentation/auth_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

class ControlledSocialIdentity implements SocialIdentitySource {
  Set<SocialProvider> providers = SocialProvider.values.toSet();
  final acquisitions = <SocialProvider>[];
  final requests = <SocialProvider>[];
  Completer<SocialIdentity?>? pending;
  SocialIdentity? result = const SocialIdentity(
    SocialProvider.google,
    'provider-token',
  );
  Object? failure;
  int signOuts = 0;
  Completer<void>? signOutPending;
  @override
  Future<bool> isAvailable(SocialProvider provider) async {
    requests.add(provider);
    return providers.contains(provider);
  }

  @override
  Future<SocialIdentity?> acquire(SocialProvider provider) async {
    acquisitions.add(provider);
    if (failure != null) throw failure!;
    return pending != null ? pending!.future : result;
  }

  @override
  Future<void> signOut() async {
    signOuts++;
    await signOutPending?.future;
  }
}

class SlowSocialCredentials extends TestCredentials {
  final started = Completer<void>(), release = Completer<void>();
  bool fail = false;
  @override
  Future<void> write(String key, String? value) async {
    if (key == 'cloud.session' && value == 'header-session') {
      started.complete();
      await release.future;
      if (fail) throw StateError('Synthetic secure write failure');
    }
    await super.write(key, value);
  }
}

void main() {
  late TestCredentials store;
  late ControlledSocialIdentity native;
  late List<http.Request> requests;
  late AuthController auth;
  late CloudClient cloud;
  http.Response config = http.Response(
    '{"auth":{"apple":true,"google":true}}',
    200,
  );
  http.Response response = http.Response(
    '{"token":"body-session"}',
    200,
    headers: {'set-auth-token': 'header-session'},
  );
  Completer<http.Response>? exchange;
  Completer<http.Response>? accountResponse;

  setUp(() {
    store = TestCredentials()
      ..values.addAll({
        'desktop.identity': 'preserved-phone',
        'desktop.trusted': 'preserved-mac',
        'ssh.profiles': 'preserved-ssh',
        'codex.gpt.pendingLoginState': 'preserved-login',
      });
    native = ControlledSocialIdentity();
    requests = [];
    config = http.Response('{"auth":{"apple":true,"google":true}}', 200);
    response = http.Response(
      '{"token":"body-session"}',
      200,
      headers: {'set-auth-token': 'header-session'},
    );
    exchange = null;
    accountResponse = null;
    cloud = CloudClient(
      baseUrl: Uri.parse('https://example.test'),
      credentials: store,
      client: MockClient((request) async {
        requests.add(request);
        if (request.url.path == '/v1/client-config') return config;
        if (request.url.path == '/v1/auth/sign-in/social' ||
            request.url.path == '/v1/auth/sign-in/email') {
          return exchange?.future ?? response;
        }
        if (request.url.path == '/v1/auth/token') {
          return http.Response('{"token":"jwt"}', 200);
        }
        if (request.url.path == '/v1/me' && accountResponse != null) {
          return accountResponse!.future;
        }
        return http.Response('{"user":{"id":"qa"}}', 200);
      }),
    );
    auth = AuthController(cloud, socialIdentity: native);
  });
  tearDown(() {
    auth.dispose();
    cloud.close();
  });

  List<http.Request> socialRequests() =>
      requests.where((r) => r.url.path == '/v1/auth/sign-in/social').toList();
  void expectOtherCredentialsPreserved() {
    expect(store.values['desktop.identity'], 'preserved-phone');
    expect(store.values['desktop.trusted'], 'preserved-mac');
    expect(store.values['ssh.profiles'], 'preserved-ssh');
    expect(store.values['codex.gpt.pendingLoginState'], 'preserved-login');
  }

  test(
    'unsigned backend flags intersect native config without invoking disabled providers',
    () async {
      config = http.Response('{"auth":{"apple":false,"google":true}}', 200);
      native.providers = {SocialProvider.apple};
      await auth.loadSocialProviders();
      expect(auth.socialProviders, isEmpty);
      expect(native.requests, [SocialProvider.google]);
      expect(requests.single.headers.containsKey('Authorization'), isFalse);
      expect(await auth.signInWithSocial(SocialProvider.google), isFalse);
      expect(native.acquisitions, isEmpty);
    },
  );

  test(
    'malformed and offline capabilities stay closed until explicit retry',
    () async {
      for (final value in [
        http.Response('{"auth":42}', 200),
        http.Response('{}', 503),
      ]) {
        config = value;
        await auth.loadSocialProviders();
        expect(auth.socialProviders, isEmpty);
        expect(auth.socialConfigurationError, isNotNull);
        expect(native.requests, isEmpty);
      }
      config = http.Response('{"auth":{"google":true}}', 200);
      await auth.loadSocialProviders();
      expect(auth.socialProviders, {SocialProvider.google});
      expect(auth.socialConfigurationError, isNull);
    },
  );

  for (final provider in SocialProvider.values) {
    test(
      '${provider.name} sends only request-bound ID token fields and commits header session',
      () async {
        native.result = SocialIdentity(
          provider,
          'provider-token',
          nonce: provider == SocialProvider.apple ? 'request-hash' : null,
        );
        await auth.loadSocialProviders();
        expect(await auth.signInWithSocial(provider), isTrue);
        expect(jsonDecode(socialRequests().single.body), {
          'provider': provider.name,
          'idToken': {
            'token': 'provider-token',
            if (provider == SocialProvider.apple) 'nonce': 'request-hash',
          },
        });
        expect(
          socialRequests().single.headers.containsKey('Authorization'),
          isFalse,
        );
        expect(socialRequests().single.headers.containsKey('cookie'), isFalse);
        expect(store.values['cloud.session'], 'header-session');
        expect(auth.signedIn, isTrue);
        expect(auth.account?['user']?['id'], 'qa');
        expectOtherCredentialsPreserved();
      },
    );
  }

  test(
    'body session fallback works but tokenless social success never becomes email verification',
    () async {
      await auth.loadSocialProviders();
      response = http.Response('{"token":"body-only"}', 200);
      expect(await auth.signInWithSocial(SocialProvider.google), isTrue);
      expect(store.values['cloud.session'], 'body-only');
      await auth.signOut();
      response = http.Response('{}', 200);
      expect(await auth.signInWithSocial(SocialProvider.google), isFalse);
      expect(auth.signedIn, isFalse);
      expect(auth.notice, isNull);
      expect(auth.error, isNotNull);
      expect(store.values['cloud.session'], isNull);
    },
  );

  test('native cancel is quiet and never calls Cloud or retries', () async {
    native.result = null;
    await auth.loadSocialProviders();
    expect(await auth.signInWithSocial(SocialProvider.google), isFalse);
    expect(auth.error, isNull);
    expect(socialRequests(), isEmpty);
    expect(store.values.containsKey('cloud.session'), isFalse);
    expect(native.acquisitions, [SocialProvider.google]);
  });

  test(
    'native and server failures never expose token details or clear an unrelated session',
    () async {
      store.values['cloud.session'] = 'existing-session';
      await auth.loadSocialProviders();
      native.failure = StateError(
        'provider-token https://provider.invalid/?code=secret',
      );
      expect(await auth.signInWithSocial(SocialProvider.google), isFalse);
      expect(auth.error, isNot(contains('provider-token')));
      expect(auth.error, isNot(contains('https://')));
      native.failure = null;
      response = http.Response('{"message":"provider-token secret"}', 401);
      expect(await auth.signInWithSocial(SocialProvider.google), isFalse);
      expect(auth.error, isNot(contains('provider-token')));
      expect(store.values['cloud.session'], 'existing-session');
      expectOtherCredentialsPreserved();
    },
  );

  test(
    'one native prompt survives inactive privacy shielding then completes only when unlocked',
    () async {
      native.pending = Completer();
      await auth.loadSocialProviders();
      final result = auth.signInWithSocial(SocialProvider.google);
      await Future<void>.delayed(Duration.zero);
      expect(await auth.signInWithSocial(SocialProvider.google), isFalse);
      auth.setSocialAllowed(false);
      native.pending!.complete(native.result);
      await Future<void>.delayed(Duration.zero);
      expect(socialRequests(), isEmpty);
      expect(auth.busy, isTrue);
      auth.setSocialAllowed(true);
      expect(await result, isTrue);
      expect(native.acquisitions, [SocialProvider.google]);
      expect(socialRequests(), hasLength(1));
    },
  );

  test(
    'privacy becoming locked during HTTP response defers durable session installation',
    () async {
      exchange = Completer();
      await auth.loadSocialProviders();
      final pending = auth.signInWithSocial(SocialProvider.google);
      await Future<void>.delayed(Duration.zero);
      expect(socialRequests(), hasLength(1));
      auth.setSocialAllowed(false);
      exchange!.complete(response);
      await Future<void>.delayed(Duration.zero);
      expect(store.values.containsKey('cloud.session'), isFalse);
      auth.setSocialAllowed(true);
      expect(await pending, isTrue);
    },
  );

  for (final cancel in ['navigation', 'sign-out', 'dispose', 'new session']) {
    test(
      '$cancel invalidates late provider completion without signing in',
      () async {
        native.pending = Completer();
        await auth.loadSocialProviders();
        final pending = auth.signInWithSocial(SocialProvider.google);
        await Future<void>.delayed(Duration.zero);
        if (cancel == 'navigation') auth.cancelSocialSignIn();
        if (cancel == 'sign-out') await auth.signOut();
        if (cancel == 'dispose') auth.dispose();
        if (cancel == 'new session') await cloud.setSession('other-session');
        native.pending!.complete(native.result);
        expect(await pending, isFalse);
        expect(socialRequests(), isEmpty);
        expect(
          store.values['cloud.session'],
          cancel == 'new session' ? 'other-session' : null,
        );
        if (cancel == 'dispose') {
          auth = AuthController(cloud, socialIdentity: native);
        }
      },
    );
  }

  test(
    'sign-out during HTTP exchange rejects its late session and clears SDK state once',
    () async {
      exchange = Completer();
      await auth.loadSocialProviders();
      final pending = auth.signInWithSocial(SocialProvider.google);
      await Future<void>.delayed(Duration.zero);
      await auth.signOut();
      exchange!.complete(response);
      expect(await pending, isFalse);
      expect(auth.signedIn, isFalse);
      expect(store.values['cloud.session'], isNull);
      expect(native.signOuts, 1);
      expectOtherCredentialsPreserved();
    },
  );

  for (final action in [
    'sign-out',
    'navigation',
    'dispose',
    'storage failure',
  ]) {
    test(
      '$action during durable social session write cannot install a late session',
      () async {
        auth.dispose();
        cloud.close();
        final delayed = SlowSocialCredentials()
          ..values['cloud.session'] = 'previous-session';
        store = delayed;
        cloud = CloudClient(
          baseUrl: Uri.parse('https://example.test'),
          credentials: delayed,
          client: MockClient((request) async {
            if (request.url.path == '/v1/client-config') return config;
            return response;
          }),
        );
        auth = AuthController(cloud, socialIdentity: native);
        await auth.loadSocialProviders();
        final pending = auth.signInWithSocial(SocialProvider.google);
        await delayed.started.future;
        Future<void>? signingOut;
        if (action == 'sign-out') signingOut = auth.signOut();
        if (action == 'navigation') auth.cancelSocialSignIn();
        if (action == 'dispose') auth.dispose();
        if (action == 'storage failure') delayed.fail = true;
        await Future<void>.delayed(Duration.zero);
        delayed.release.complete();
        expect(await pending, isFalse);
        await signingOut;
        expect(
          store.values['cloud.session'],
          action == 'sign-out' ? null : 'previous-session',
        );
        expect(auth.signedIn, isFalse);
        if (action == 'storage failure') expect(auth.error, isNotNull);
        if (action == 'dispose') {
          auth = AuthController(cloud, socialIdentity: native);
        }
      },
    );
  }

  test(
    'email sign-in also rejects its late HTTP success after sign-out',
    () async {
      exchange = Completer();
      final pending = auth.submit('sign-in/email', {
        'email': 'qa@example.test',
        'password': 'test-only',
      });
      await Future<void>.delayed(Duration.zero);
      await auth.signOut();
      exchange!.complete(response);
      expect(await pending, isFalse);
      expect(auth.signedIn, isFalse);
      expect(store.values['cloud.session'], isNull);
    },
  );

  test(
    'durable sign-in is published before the independent account lookup finishes',
    () async {
      accountResponse = Completer();
      await auth.loadSocialProviders();
      final observed = <bool>[];
      auth.addListener(() => observed.add(auth.signedIn));
      final pending = auth.signInWithSocial(SocialProvider.google);
      await Future<void>.delayed(Duration.zero);
      final published = observed.contains(true);
      accountResponse!.complete(http.Response('{"user":{"id":"qa"}}', 200));
      await pending;
      expect(published, isTrue);
    },
  );

  test(
    'explicit sign-out blocks a new prompt until SDK cleanup finishes',
    () async {
      await auth.loadSocialProviders();
      native.signOutPending = Completer();
      final signingOut = auth.signOut();
      await Future<void>.delayed(Duration.zero);
      final clearingBusy = auth.busy;
      final accepted = await auth.signInWithSocial(SocialProvider.google);
      native.signOutPending!.complete();
      await signingOut;
      expect(clearingBusy, isTrue);
      expect(accepted, isFalse);
      expect(native.acquisitions, isEmpty);
      expect(auth.busy, isFalse);
    },
  );

  test(
    'malformed social session responses preserve the previous session',
    () async {
      store.values['cloud.session'] = 'previous-session';
      await auth.loadSocialProviders();
      for (final malformed in [
        http.Response('{"token":" "}', 200),
        http.Response('{}', 200, headers: {'set-auth-token': ' '}),
        http.Response('{"token":42}', 200),
        http.Response('not JSON', 200),
      ]) {
        response = malformed;
        expect(await auth.signInWithSocial(SocialProvider.google), isFalse);
        expect(store.values['cloud.session'], 'previous-session');
        expect(auth.signedIn, isFalse);
        expect(auth.notice, isNull);
      }
      expectOtherCredentialsPreserved();
    },
  );
}
