import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

void main() {
  test('complete send and stream; background/resume never posts twice', () async {
    final store = TestCredentials();
    await store.write('cloud.session', 's');
    var sends = 0;
    final client = CloudClient(
      baseUrl: Uri.parse('https://example.test'),
      credentials: store,
      client: MockClient((r) async {
        if (r.url.path == '/v1/auth/token') {
          return http.Response('{"token":"jwt"}', 200);
        }
        if (r.url.path == '/v1/client-config') {
          return http.Response('{"tools":{}}', 200);
        }
        if (r.url.path == '/v1/models') {
          return http.Response(
            '{"models":[{"id":"m","displayName":"Model","provider":"anthropic","status":"active","capabilities":["text.chat","vision"]}]}',
            200,
          );
        }
        if (r.url.path == '/v1/conversations') {
          return http.Response('{"id":"c","title":null}', 201);
        }
        if (r.url.path.endsWith('/messages')) {
          sends++;
          return http.Response(
            jsonEncode({
              'message': {
                'id': 'u',
                'role': 'user',
                'parts': [
                  {'type': 'text', 'text': 'hi'},
                ],
              },
              'reply': {
                'id': 'a',
                'parentId': 'u',
                'role': 'assistant',
                'runId': 'r',
                'parts': [],
              },
              'run': {'id': 'r', 'status': 'running'},
            }),
            201,
          );
        }
        if (r.url.path.endsWith('/events')) {
          return http.Response(
            'data: {"runId":"r","seq":1,"type":"text.delta","payload":{"messageId":"a","text":"Hello"}}\n\ndata: {"runId":"r","seq":2,"type":"status","payload":{"status":"succeeded","error":null}}\n\n',
            200,
          );
        }
        throw StateError('Unexpected request ${r.url}');
      }),
    );
    final chat = ChatController(
      CloudRepository(client),
      accountScope: 'user:org',
    );
    await chat.initialize();
    expect(await chat.send('hi'), isTrue);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect(chat.messages.last.text, 'Hello');
    expect(chat.streaming, isFalse);
    chat.suspend();
    chat.resume();
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(sends, 1);
    chat.dispose();
  });
}
