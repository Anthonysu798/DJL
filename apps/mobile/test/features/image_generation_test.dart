import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

void main() {
  test(
    'image generation survives controller recreation and retries the same server id',
    () async {
      final store = TestCredentials();
      await store.write('cloud.session', 'session');
      final ids = <String>[];
      final client = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: store,
        client: MockClient((request) async {
          if (request.url.path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          if (request.url.path == '/v1/client-config') {
            return http.Response(
              '{"tools":{"imageGeneration":true,"imageEditing":true}}',
              200,
            );
          }
          if (request.url.path == '/v1/models') {
            return http.Response(
              '{"models":[{"id":"m","provider":"anthropic","status":"active","capabilities":["text.chat","vision"]}]}',
              200,
            );
          }
          if (request.url.path == '/v1/conversations') {
            return http.Response('{"id":"c"}', 201);
          }
          if (request.url.path == '/v1/conversations/c') {
            return http.Response(
              '{"conversation":{"id":"c"},"messages":[]}',
              200,
            );
          }
          if (request.url.path.endsWith('/images')) {
            final input = jsonDecode(request.body) as Map;
            ids.add(input['clientMessageId'] as String);
            expect(input['aspectRatio'], '4:3');
            if (ids.length == 1) {
              return http.Response(
                '{"error":{"code":"overloaded","message":"try again"}}',
                503,
              );
            }
            return http.Response(
              '{"message":{"id":"u","role":"user","parts":[{"type":"text","text":"A desk"}]},"reply":{"id":"a","role":"assistant","parentId":"u","parts":[]},"run":{"id":"r"}}',
              201,
            );
          }
          if (request.url.path.endsWith('/events')) {
            return http.Response(
              'data: {"runId":"r","seq":1,"type":"status","payload":{"status":"succeeded","error":null}}\n\n',
              200,
            );
          }
          throw StateError('Unexpected route');
        }),
      );
      final first = ChatController(
        CloudRepository(client),
        accountScope: 'u:o',
      );
      await first.initialize();
      expect(await first.generateImage('A desk', '4:3'), isFalse);
      final conversation = first.conversation;
      first.dispose();
      final second = ChatController(
        CloudRepository(client),
        accountScope: 'u:o',
        conversation: conversation,
      );
      await second.initialize();
      expect(second.canRetry, isTrue);
      expect(await second.retry(), isTrue);
      expect(ids[0], ids[1]);
      second.dispose();
      client.close();
    },
  );
}
