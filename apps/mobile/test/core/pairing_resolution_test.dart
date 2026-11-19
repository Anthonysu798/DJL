import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/security/remote_crypto.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'cloud_client_test.dart' show TestCredentials;

void main() {
  final pairing = Pairing({
    'macDeviceId': 'mac',
    'sessionId': 'session',
    'relay': 'wss://relay.test/relay',
    'macIdentityPublicKey': base64Encode(List.filled(32, 7)),
  });
  final malformedErrors = <String, Object>{
    'object': {'message': 'Untrusted nested detail'},
    'list': ['Untrusted nested detail'],
    'number': 42,
    'boolean': false,
  };
  for (final entry in malformedErrors.entries) {
    for (final status in [200, 401, 403]) {
      test(
        'HTTP $status rejection with ${entry.key} error remains a safe security failure',
        () async {
          final repository = PairingRepository(
            TestCredentials(),
            client: MockClient(
              (_) async => http.Response(
                jsonEncode({
                  'ok': false,
                  'code': 'resolve_request_rejected',
                  'error': entry.value,
                }),
                status,
              ),
            ),
          );
          await expectLater(
            repository.resolveTrusted(pairing),
            throwsA(
              isA<RemoteSecurityException>().having(
                (e) => e.toString(),
                'message',
                'The desktop pairing service is unavailable.',
              ),
            ),
          );
        },
      );
    }
    for (final code in ['mac_offline', 'session_unavailable', 'host_offline']) {
      test('offline $code with ${entry.key} error stays retryable', () async {
        final repository = PairingRepository(
          TestCredentials(),
          client: MockClient(
            (_) async => http.Response(
              jsonEncode({'ok': false, 'code': code, 'error': entry.value}),
              404,
            ),
          ),
        );
        await expectLater(
          repository.resolveTrusted(pairing),
          throwsA(
            isA<RemoteRelayUnavailable>().having(
              (e) => e.toString(),
              'message',
              'The trusted computer is offline.',
            ),
          ),
        );
      });
    }
  }
  test(
    'network loss during trusted resolution is transient, not an identity rejection',
    () async {
      var calls = 0;
      final repository = PairingRepository(
        TestCredentials(),
        client: MockClient((request) async {
          calls++;
          throw http.ClientException(
            'Connection closed before headers',
            request.url,
          );
        }),
      );
      await expectLater(
        repository.resolveTrusted(pairing),
        throwsA(isA<RemoteRelayUnavailable>()),
      );
      expect(calls, 1);
    },
  );
  for (final status in [408, 429, 500, 503]) {
    test(
      'temporary relay HTTP $status remains retryable even without JSON',
      () async {
        final repository = PairingRepository(
          TestCredentials(),
          client: MockClient(
            (_) async => http.Response('temporarily unavailable', status),
          ),
        );
        await expectLater(
          repository.resolveTrusted(pairing),
          throwsA(isA<RemoteRelayUnavailable>()),
        );
      },
    );
  }
  for (final code in ['mac_offline', 'session_unavailable', 'host_offline']) {
    test(
      'reference relay $code error preserves its readable retryable meaning',
      () async {
        final repository = PairingRepository(
          TestCredentials(),
          client: MockClient(
            (_) async => http.Response(
              jsonEncode({
                'ok': false,
                'code': code,
                'error': 'The trusted computer is offline.',
              }),
              404,
            ),
          ),
        );
        await expectLater(
          repository.resolveTrusted(pairing),
          throwsA(
            isA<RemoteRelayUnavailable>().having(
              (e) => e.toString(),
              'message',
              'The trusted computer is offline.',
            ),
          ),
        );
      },
    );
  }
  for (final status in [401, 403]) {
    test('HTTP $status cannot be downgraded by an offline body code', () async {
      final repository = PairingRepository(
        TestCredentials(),
        client: MockClient(
          (_) async => http.Response(
            '{"ok":false,"code":"mac_offline","error":"offline"}',
            status,
          ),
        ),
      );
      await expectLater(
        repository.resolveTrusted(pairing),
        throwsA(isA<RemoteSecurityException>()),
      );
    });
    test(
      'reference relay HTTP $status authentication rejection remains fatal',
      () async {
        final repository = PairingRepository(
          TestCredentials(),
          client: MockClient(
            (_) async => http.Response(
              jsonEncode({
                'ok': false,
                'code': 'resolve_request_rejected',
                'error': 'The trusted reconnect request was rejected.',
              }),
              status,
            ),
          ),
        );
        await expectLater(
          repository.resolveTrusted(pairing),
          throwsA(
            isA<RemoteSecurityException>().having(
              (e) => e.toString(),
              'message',
              'The trusted reconnect request was rejected.',
            ),
          ),
        );
      },
    );
  }
  test(
    'only a missing route falls back and the signed resolve body stays unchanged',
    () async {
      final bodies = <String>[];
      final repository = PairingRepository(
        TestCredentials(),
        client: MockClient((request) async {
          bodies.add(request.body);
          return request.url.path.startsWith('/prefix/')
              ? http.Response(
                  '{"ok":false,"code":"not_found","error":"Route not found."}',
                  404,
                )
              : http.Response(
                  jsonEncode({
                    'ok': true,
                    'macDeviceId': 'mac',
                    'sessionId': 'new-session',
                    'macIdentityPublicKey': pairing.publicKey,
                  }),
                  200,
                );
        }),
      );
      final resolved = await repository.resolveTrusted(
        Pairing({...pairing.data, 'relay': 'wss://relay.test/prefix/relay'}),
      );
      expect(resolved.sessionId, 'new-session');
      expect(bodies, hasLength(2));
      expect(bodies.toSet(), hasLength(1));
    },
  );
}
