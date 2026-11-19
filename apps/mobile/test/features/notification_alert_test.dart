import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/notifications/data/notification_repository.dart';
import 'package:djl_mobile/features/notifications/presentation/notification_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

Map<String, Object?> notification(
  String id, {
  String? conversation,
  bool read = false,
}) => {
  'id': id,
  'conversationId': conversation ?? 'conversation-$id',
  'conversationTitle': 'Task $id',
  'status': 'succeeded',
  'finishedAt': '2026-10-30T12:00:00Z',
  'readAt': read ? '2026-10-30T12:01:00Z' : null,
};

void main() {
  test(
    'mark all read leaves the remainder usable when the public30-ID request limit is reached',
    () async {
      final credentials = TestCredentials()
        ..values['cloud.session'] = 'qa-session';
      final ids = List.generate(
        35,
        (i) => '00000000-0000-4000-8000-${i.toString().padLeft(12, '0')}',
      );
      final batches = <List<dynamic>>[];
      final client = CloudClient(
        baseUrl: Uri.parse('https://qa.invalid'),
        credentials: credentials,
        client: MockClient((request) async {
          if (request.url.path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          if (request.url.path == '/v1/notifications/read') {
            final batch = (jsonDecode(request.body) as Map)['ids'] as List;
            if (batch.isEmpty || batch.length > 30) {
              return http.Response(
                '{"error":{"message":"At most30IDs are accepted."}}',
                400,
              );
            }
            batches.add(batch);
            return http.Response('{"unreadCount":5}', 200);
          }
          return http.Response(
            jsonEncode({
              'notifications': ids.map(notification).toList(),
              'unreadCount': 35,
              'nextCursor': null,
            }),
            200,
          );
        }),
      );
      final controller = NotificationController(NotificationRepository(client));
      addTearDown(() {
        controller.dispose();
        client.close();
      });
      await controller.refresh();
      await controller.markRead(null);
      expect(controller.error, isNull);
      expect(batches.single.length, 30);
      expect(controller.unreadCount, 5);
      expect(
        controller.items.where((item) => item.unread).map((item) => item.id),
        ids.skip(30),
      );
    },
  );
  testWidgets(
    'foreground alerts skip initial, read, seen and displayed tasks; expire after six seconds',
    (tester) async {
      final credentials = TestCredentials();
      await credentials.write('cloud.session', 'qa-session');
      var pages = 0;
      final marked = <List<dynamic>>[];
      final client = CloudClient(
        baseUrl: Uri.parse('https://qa.invalid'),
        credentials: credentials,
        client: MockClient((request) async {
          if (request.url.path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          if (request.url.path == '/v1/notifications/read') {
            marked.add((jsonDecode(request.body) as Map)['ids'] as List);
            return http.Response('{"unreadCount":2}', 200);
          }
          expectSync(request.url.path, '/v1/notifications');
          pages++;
          return http.Response(
            jsonEncode({
              'notifications': [
                if (pages > 1) ...[
                  notification('active', conversation: 'displayed'),
                  notification('already-read', read: true),
                  notification('new'),
                ],
                notification('old'),
              ],
              'unreadCount': pages == 1 ? 1 : 3,
              'nextCursor': null,
            }),
            200,
          );
        }),
      );
      final controller = NotificationController(NotificationRepository(client));
      addTearDown(() {
        controller.dispose();
        client.close();
      });
      controller.configure(
        foreground: true,
        alerts: true,
        activeConversation: 'displayed',
      );
      await tester.pump();
      expect(controller.error, isNull);
      expect(pages, 1);
      expect(controller.banner, isNull);
      await tester.pump(const Duration(seconds: 15));
      expect(controller.banner?.id, 'new');
      expect(marked, [
        ['active'],
      ]);
      expect(controller.items.first.unread, false);
      await tester.pump(const Duration(seconds: 6));
      expect(controller.banner, isNull);
      await tester.pump(const Duration(seconds: 9));
      expect(pages, 3);
      expect(controller.banner, isNull);
      controller.configure(foreground: false, alerts: true);
      await tester.pump(const Duration(seconds: 45));
      expect(pages, 3);
    },
  );

  testWidgets(
    'background fences held responses, disabling alerts still refreshes inbox, account change stops old reads',
    (tester) async {
      final credentials = TestCredentials();
      await credentials.write('cloud.session', 'qa-session');
      final held = Completer<http.Response>();
      var pages = 0;
      final client = CloudClient(
        baseUrl: Uri.parse('https://qa.invalid'),
        credentials: credentials,
        client: MockClient((request) async {
          if (request.url.path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          pages++;
          if (pages == 1) return held.future;
          return http.Response(
            jsonEncode({
              'notifications': [notification('new-$pages')],
              'unreadCount': 1,
              'nextCursor': null,
            }),
            200,
          );
        }),
      );
      final controller = NotificationController(NotificationRepository(client));
      addTearDown(() {
        controller.dispose();
        client.close();
      });
      controller.configure(foreground: true, alerts: true);
      await tester.pump();
      expect(pages, 1);
      controller.configure(foreground: false, alerts: true);
      held.complete(
        http.Response(
          jsonEncode({
            'notifications': [notification('late')],
            'unreadCount': 1,
            'nextCursor': null,
          }),
          200,
        ),
      );
      await tester.pump();
      expect(controller.items, isEmpty);
      controller.configure(foreground: true, alerts: false);
      await tester.pump();
      await tester.pump(const Duration(seconds: 15));
      expect(controller.items.single.id, 'new-3');
      expect(controller.banner, isNull);
      await client.setSession('different-account');
      await tester.pump(const Duration(seconds: 30));
      expect(pages, 3);
    },
  );

  test(
    'top-page refresh retains loaded older items and their pagination cursor',
    () async {
      final credentials = TestCredentials();
      await credentials.write('cloud.session', 'qa-session');
      var firstPageReads = 0;
      final client = CloudClient(
        baseUrl: Uri.parse('https://qa.invalid'),
        credentials: credentials,
        client: MockClient((request) async {
          if (request.url.path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          final older = request.url.queryParameters['cursor'] != null;
          if (!older) firstPageReads++;
          return http.Response(
            jsonEncode({
              'notifications': [
                notification(
                  older
                      ? 'older'
                      : firstPageReads == 1
                      ? 'first'
                      : 'fresh',
                ),
              ],
              'unreadCount': 1,
              'nextCursor': older ? 'oldest' : 'older',
            }),
            200,
          );
        }),
      );
      final controller = NotificationController(NotificationRepository(client));
      addTearDown(() {
        controller.dispose();
        client.close();
      });
      await controller.refresh();
      await controller.refresh(more: true);
      await controller.refresh();
      expect(controller.items.map((item) => item.id), [
        'fresh',
        'first',
        'older',
      ]);
      expect(controller.cursor, 'oldest');
    },
  );
}
