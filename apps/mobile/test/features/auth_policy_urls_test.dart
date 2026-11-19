import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/auth/presentation/auth_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

void main() {
  for (final raw in [
    'http://example.test/privacy',
    'https://example.test/privacy',
    'javascript:alert(1)',
    'file:///private/tmp/x',
    '/privacy',
    '//example.test/privacy',
    'https://user:password@example.test/privacy',
  ]) {
    test('policy URL schema validation for ${raw.split(':').first}', () async {
      final auth = AuthController(
        CloudClient(
          baseUrl: Uri.parse('https://example.test'),
          credentials: TestCredentials(),
          client: MockClient(
            (_) async => http.Response(
              jsonEncode({
                'auth': {},
                'policyUrls': {'privacy': raw},
              }),
              200,
            ),
          ),
        ),
      );
      await auth.loadSocialProviders();
      expect(
        auth.policyUrls.containsKey('privacy'),
        raw.startsWith('http://example') || raw.startsWith('https://example'),
      );
      auth.dispose();
    });
  }

  test(
    'lazy client config retains only supplied absolute http policy URLs and clears stale options on failure',
    () async {
      var fail = false, calls = 0;
      final auth = AuthController(
        CloudClient(
          baseUrl: Uri.parse('https://example.test'),
          credentials: TestCredentials(),
          client: MockClient((request) async {
            calls++;
            expect(request.url.path, '/v1/client-config');
            return fail
                ? http.Response('{}', 503)
                : http.Response(
                    jsonEncode({
                      'auth': {'apple': false, 'google': false},
                      'policyUrls': {
                        'terms': 'https://example.test/terms',
                        'privacy': 'javascript:alert(1)',
                      },
                    }),
                    200,
                  );
          }),
        ),
      );
      expect(calls, 0);
      await auth.loadSocialProviders();
      expect(auth.policyUrls, {
        'terms': Uri.parse('https://example.test/terms'),
      });
      expect(calls, 1);
      fail = true;
      await auth.loadSocialProviders();
      expect(auth.policyUrls, isEmpty);
      expect(auth.socialConfigurationError, isNotNull);
      auth.dispose();
    },
  );
}
