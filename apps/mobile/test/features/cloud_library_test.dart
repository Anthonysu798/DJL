import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/account/data/account_repository.dart';
import 'package:djl_mobile/features/account/domain/account_snapshot.dart';
import 'package:djl_mobile/features/account/presentation/account_controller.dart';
import 'package:djl_mobile/features/notifications/domain/cloud_notification.dart';
import 'package:djl_mobile/features/images/domain/gallery_image.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

Map<String, dynamic> fixture(String name) =>
    jsonDecode(
          File(
            '../../packages/contracts/fixtures/cloud/$name.json',
          ).readAsStringSync(),
        )
        as Map<String, dynamic>;
void main() {
  test(
    'account fixture keeps exact credit display and bounded usage fractions',
    () {
      final snapshot = AccountSnapshot.fromJson(
        fixture('me'),
        fixture('credits'),
        fixture('usage-windows'),
      );
      expect(snapshot.email, 'ada@example.com');
      expect(snapshot.credits, '2005.00');
      expect(snapshot.plan, 'starter');
      expect(snapshot.fiveHour.fraction, closeTo(.28, .00001));
      expect(snapshot.bankedResets, 1);
      expect(UsageWindow.fromJson({'limit': '100', 'used': '200'}).fraction, 1);
    },
  );
  test(
    'notification and image fixtures preserve routing and file identities',
    () {
      final notification = CloudNotification.fromJson(
        (fixture('notifications')['notifications'] as List).first
            as Map<String, dynamic>,
      );
      expect(notification.conversationId, 'conv_1');
      expect(notification.unread, isTrue);
      final image = GalleryImage.fromJson(
        (fixture('images')['images'] as List).first as Map<String, dynamic>,
      );
      expect(image.part['type'], 'image_ref');
      expect(image.part['fileId'], image.fileId);
      expect(image.conversationId, isNotEmpty);
    },
  );
  test('bank redemption retry keeps idempotency key until success', () async {
    final store = TestCredentials();
    await store.write('cloud.session', 'test-session');
    final ids = <String>[];
    final client = CloudClient(
      baseUrl: Uri.parse('https://example.test'),
      credentials: store,
      client: MockClient((request) async {
        if (request.url.path == '/v1/auth/token') {
          return http.Response('{"token":"jwt"}', 200);
        }
        if (request.url.path.endsWith('/redeem')) {
          ids.add(
            (jsonDecode(request.body) as Map)['idempotencyKey'] as String,
          );
          return ids.length == 1
              ? http.Response(
                  '{"error":{"code":"overloaded","message":"retry"}}',
                  503,
                )
              : http.Response(jsonEncode(fixture('usage-redeem')), 200);
        }
        final name = switch (request.url.path) {
          '/v1/me' => 'me',
          '/v1/credits' => 'credits',
          _ => 'usage-windows',
        };
        return http.Response(jsonEncode(fixture(name)), 200);
      }),
    );
    final controller = AccountController(AccountRepository(client));
    await controller.refresh();
    expect(await controller.redeem(), isFalse);
    expect(await controller.redeem(), isTrue);
    expect(ids, hasLength(2));
    expect(ids[0], ids[1]);
    controller.dispose();
    client.close();
  });
}
