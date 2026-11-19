import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import '../../core/cloud_client_test.dart' show TestCredentials;

class HeldCredentials extends TestCredentials {
  final gate = Completer<String?>();
  @override
  Future<String?> read(String key) => gate.future;
}

void main() {
  for (final status in [200, 201, 204]) {
    test('APNs registration requires exact 204, received $status', () async {
      final store = TestCredentials()..values['cloud.session'] = 's';
      final client = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: store,
        client: MockClient((request) async {
          if (request.url.path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          expect(request.method, 'POST');
          expect(request.url.path, '/v1/devices/push-token');
          expect(jsonDecode(request.body), {
            'token': 'a' * 64,
            'environment': 'sandbox',
          });
          return http.Response('', status);
        }),
      );
      final result = client.registerPushToken(
        token: 'a' * 64,
        environment: 'sandbox',
        expectedRevision: 0,
        isCurrent: () => true,
      );
      if (status == 204) {
        await result;
      } else {
        await expectLater(result, throwsA(isA<CloudFailure>()));
      }
      client.close();
    });
  }
  test(
    'account switch during credential preparation prevents registration dispatch',
    () async {
      final gate = Completer<http.Response>();
      final store = TestCredentials()..values['cloud.session'] = 'old';
      var writes = 0;
      final client = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: store,
        client: MockClient((request) async {
          if (request.url.path == '/v1/auth/token') return gate.future;
          writes++;
          return http.Response('', 204);
        }),
      );
      final result = client.registerPushToken(
        token: 'b' * 64,
        environment: 'production',
        expectedRevision: 0,
        isCurrent: () => true,
      );
      final assertion = expectLater(result, throwsA(isA<CloudFailure>()));
      await Future<void>.delayed(Duration.zero);
      await client.setSession('new');
      gate.complete(http.Response('{"token":"old-jwt"}', 200));
      await assertion;
      expect(writes, 0);
      client.close();
    },
  );
  test(
    'owner callback after held secure-storage read prevents POST before dispatch',
    () async {
      final credentials = HeldCredentials();
      var current = true, writes = 0;
      final client = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: credentials,
        client: MockClient((request) async {
          if (request.url.path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          writes++;
          return http.Response('', 204);
        }),
      );
      final result = client.registerPushToken(
        token: 'a' * 64,
        environment: 'sandbox',
        expectedRevision: 0,
        isCurrent: () => current,
      );
      final assertion = expectLater(result, throwsA(isA<CloudFailure>()));
      current = false;
      credentials.gate.complete('session');
      await assertion;
      expect(writes, 0);
      client.close();
    },
  );
  test('late HTTP acknowledgement cannot count for a changed owner', () async {
    final credentials = TestCredentials()..values['cloud.session'] = 's';
    final gate = Completer<http.Response>();
    var current = true;
    final client = CloudClient(
      baseUrl: Uri.parse('https://example.test'),
      credentials: credentials,
      client: MockClient(
        (request) async => request.url.path == '/v1/auth/token'
            ? http.Response('{"token":"jwt"}', 200)
            : gate.future,
      ),
    );
    final result = client.registerPushToken(
      token: 'a' * 64,
      environment: 'sandbox',
      expectedRevision: 0,
      isCurrent: () => current,
    );
    final assertion = expectLater(result, throwsA(isA<CloudFailure>()));
    await Future<void>.delayed(Duration.zero);
    current = false;
    gate.complete(http.Response('', 204));
    await assertion;
    client.close();
  });
}
