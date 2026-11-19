import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/core/security/credential_store.dart';

class TestCredentials implements CredentialStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String? value) async {
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }
}

void main() {
  test(
    'uses session for exchange, caches JWT, and never sends cookies',
    () async {
      final store = TestCredentials();
      await store.write('cloud.session', 'session');
      var exchanges = 0;
      final client = CloudClient(
        baseUrl: Uri.parse('https://api.example.test'),
        credentials: store,
        client: MockClient((request) async {
          expect(request.headers.containsKey('cookie'), isFalse);
          if (request.url.path == '/v1/auth/token') {
            exchanges++;
            expect(request.headers['Authorization'], 'Bearer session');
            return http.Response(
              jsonEncode({'token': 'jwt', 'expiresAt': '2099-01-01T00:00:00Z'}),
              200,
            );
          }
          expect(request.headers['Authorization'], 'Bearer jwt');
          return http.Response('{}', 200);
        }),
      );
      await Future.wait([
        client.request('GET', 'v1/me'),
        client.request('GET', 'v1/models'),
      ]);
      expect(exchanges, 1);
    },
  );
  test(
    'refreshes once on 401 and clears only Cloud credential on session revocation',
    () async {
      final store = TestCredentials();
      await store.write('cloud.session', 'session');
      await store.write('desktop.identity', 'keep');
      var exchanges = 0;
      var calls = 0;
      final client = CloudClient(
        baseUrl: Uri.parse('https://api.example.test'),
        credentials: store,
        client: MockClient((request) async {
          if (request.url.path == '/v1/auth/token') {
            exchanges++;
            return http.Response('{"token":"jwt"}', 200);
          }
          calls++;
          return http.Response(
            calls == 1
                ? '{"error":{"code":"invalid_token","message":"expired"}}'
                : '{"error":{"code":"session_revoked","message":"revoked"}}',
            401,
          );
        }),
      );
      await expectLater(
        client.request('GET', 'v1/me'),
        throwsA(
          isA<CloudFailure>().having(
            (e) => e.unauthorized,
            'unauthorized',
            true,
          ),
        ),
      );
      expect(exchanges, 2);
      expect(await store.read('cloud.session'), isNull);
      expect(await store.read('desktop.identity'), 'keep');
    },
  );
  test(
    'invalid login is a credential error and does not revoke existing session',
    () async {
      final store = TestCredentials();
      await store.write('cloud.session', 'old');
      final client = CloudClient(
        baseUrl: Uri.parse('https://api.example.test'),
        credentials: store,
        client: MockClient(
          (request) async => http.Response(
            '{"code":"INVALID_EMAIL_OR_PASSWORD","message":"Wrong credentials"}',
            401,
          ),
        ),
      );
      await expectLater(
        client.authenticate('sign-in/email', {
          'email': 'a@b.c',
          'password': 'wrong',
        }),
        throwsA(
          isA<CloudFailure>().having(
            (e) => e.unauthorized,
            'unauthorized',
            false,
          ),
        ),
      );
      expect(await store.read('cloud.session'), 'old');
    },
  );
  test('authentication accepts set-auth-token before response body', () async {
    final store = TestCredentials();
    final client = CloudClient(
      baseUrl: Uri.parse('https://api.example.test'),
      credentials: store,
      client: MockClient(
        (request) async => http.Response(
          '{"token":"body"}',
          200,
          headers: {'set-auth-token': 'header'},
        ),
      ),
    );
    expect(await client.authenticate('sign-in/email', {}), 'header');
  });
}
