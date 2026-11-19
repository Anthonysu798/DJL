import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'cloud_client_test.dart' show TestCredentials;

void main() {
  test('retry of a send preserves id and explicit null parent', () async {
    var attempts = 0;
    final store = TestCredentials();
    await store.write('cloud.session', 'session');
    final client = CloudClient(
      baseUrl: Uri.parse('https://example.test'),
      credentials: store,
      client: MockClient((r) async {
        if (r.url.path == '/v1/auth/token') {
          return http.Response('{"token":"jwt"}', 200);
        }
        final input = jsonDecode(r.body) as Map;
        expect(input['clientMessageId'], 'same');
        expect(input.containsKey('parentId'), isTrue);
        attempts++;
        return attempts == 1
            ? http.Response(
                '{"error":{"code":"overloaded","message":"busy"}}',
                503,
              )
            : http.Response('{"accepted":true}', 201);
      }),
    );
    final repo = CloudRepository(client);
    final reply = await repo.send(
      'c',
      const SendInput(
        clientMessageId: 'same',
        parentId: null,
        parts: [
          {'type': 'text', 'text': 'hi'},
        ],
        model: 'm',
        mode: 'chat',
      ),
      retryDelay: Duration.zero,
    );
    expect(reply['accepted'], true);
    expect(attempts, 2);
  });
  test(
    'message tree chooses newest branch and permits explicit sibling selection',
    () {
      final messages = [
        ChatMessage(id: 'u1', role: 'user', parts: []),
        ChatMessage(id: 'a1', parentId: 'u1', role: 'assistant', parts: []),
        ChatMessage(id: 'a2', parentId: 'u1', role: 'assistant', parts: []),
        ChatMessage(id: 'u2', parentId: 'a1', role: 'user', parts: []),
      ];
      expect(visibleBranch(messages, {}).map((m) => m.id), ['u1', 'a2']);
      expect(visibleBranch(messages, {'u1': 'a1'}).map((m) => m.id), [
        'u1',
        'a1',
        'u2',
      ]);
    },
  );
}
