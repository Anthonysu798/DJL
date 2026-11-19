import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/remote_notifications/domain/remote_notification.dart';
import 'package:djl_mobile/features/remote_notifications/presentation/remote_push_controller.dart';
import '../../core/cloud_client_test.dart' show TestCredentials;
import 'remote_push_test.dart' show PushNative, PushStore, flush;

RemotePushState androidState() => RemotePushState.from({
  'provider': 'fcm',
  'availability': 'ready',
  'permission': 'authorized',
  'environment': 'production',
  'token': 'AbC_Fid-123',
});

void main() {
  test(
    'turning off revokes native consent separately from clearing a session installation',
    () async {
      final client = CloudClient(
        baseUrl: Uri.parse('https://cloud.test.invalid'),
        credentials: TestCredentials(),
      );
      final native = PushNative()..value = androidState();
      final controller = RemotePushController(client, native, PushStore(true));
      await controller.initialize();
      await controller.setEnabled(false);
      expect(native.disableRequests, [true]);
      controller.dispose();
      client.close();
    },
  );
  test(
    'legacy relay completion normalizes only a valid terminal result and omits empty turn',
    () {
      final raw = {
        'eventId': 'test-tap',
        'receivedAt': DateTime.now().millisecondsSinceEpoch,
        'source': 'djl.runCompletion',
        'threadId': 'thread-1',
        'turnId': '',
        'result': 'completed',
      };
      expect(RemoteNotificationTap.parse(raw)?.desktop?.thread, 'thread-1');
      expect(RemoteNotificationTap.parse(raw)?.desktop?.turn, isNull);
      expect(
        RemoteNotificationTap.parse({...raw, 'result': 'running'}),
        isNull,
      );
      expect(RemoteNotificationTap.parse({...raw, 'turnId': '../bad'}), isNull);
    },
  );
  test(
    'FCM state preserves opaque case-sensitive identifiers and rejects unknown providers',
    () {
      expect(androidState().available, isTrue);
      expect(androidState().hasToken, isTrue);
      expect(
        RemotePushState.from({
          'provider': 'other',
          'availability': 'ready',
          'environment': 'production',
          'token': 'a' * 64,
        }).available,
        isFalse,
      );
      for (final token in ['', ' bad', 'bad\n', 'x' * 201]) {
        expect(
          RemotePushState.from({
            'provider': 'fcm',
            'availability': 'ready',
            'environment': 'production',
            'token': token,
          }).hasToken,
          isFalse,
        );
      }
    },
  );

  for (final advertised in [false, true]) {
    test(
      'Cloud FCM registration requires advertised support: $advertised',
      () async {
        final bodies = <Object?>[];
        final client = CloudClient(
          baseUrl: Uri.parse('https://cloud.test.invalid'),
          credentials: TestCredentials()..values['cloud.session'] = 'test-only',
          client: MockClient((request) async {
            if (request.url.path == '/v1/client-config') {
              return http.Response(
                jsonEncode({
                  'pushConfigured': true,
                  if (advertised) 'pushProviders': ['fcm'],
                }),
                200,
              );
            }
            if (request.url.path == '/v1/auth/token') {
              return http.Response('{"token":"test-only"}', 200);
            }
            bodies.add(jsonDecode(request.body));
            return http.Response('', 204);
          }),
        );
        final native = PushNative()..value = androidState();
        final controller = RemotePushController(
          client,
          native,
          PushStore(true),
        );
        controller.updateContext(allowed: true, cloudOwner: 'test-owner');
        await controller.initialize();
        await flush();
        expect(
          bodies,
          advertised
              ? [
                  {
                    'provider': 'fcm',
                    'token': 'AbC_Fid-123',
                    'environment': 'production',
                  },
                ]
              : isEmpty,
        );
        controller.dispose();
        client.close();
      },
    );
  }

  for (final advertised in [false, true]) {
    test(
      'paired FCM checks capability before sending its identifier: $advertised',
      () async {
        final calls = <String>[];
        final client = CloudClient(
          baseUrl: Uri.parse('https://cloud.test.invalid'),
          credentials: TestCredentials(),
        );
        final native = PushNative()..value = androidState();
        final controller = RemotePushController(
          client,
          native,
          PushStore(true),
        );
        controller.updateContext(
          allowed: true,
          paired: PairedPushOwner('test-mac', (method, params) async {
            calls.add(method);
            if (method.endsWith('/capabilities')) {
              expect(params, isEmpty);
              return {
                'providers': [if (advertised) 'fcm'],
              };
            }
            expect(params['provider'], 'fcm');
            expect(params['deviceToken'], 'AbC_Fid-123');
            return {'ok': true};
          }),
        );
        await controller.initialize();
        await flush();
        expect(calls, [
          'notifications/push/capabilities',
          if (advertised) 'notifications/push/register',
        ]);
        controller.dispose();
        client.close();
      },
    );
  }
}
