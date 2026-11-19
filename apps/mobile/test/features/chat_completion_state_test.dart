import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

void main() {
  testWidgets(
    'a cancelled empty response is stopped rather than permanently thinking',
    (tester) async {
      final store = TestCredentials();
      await store.write('cloud.session', 's');
      final client = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: store,
        client: MockClient((r) async {
          if (r.url.path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          if (r.url.path == '/v1/models') {
            return http.Response(
              '{"models":[{"id":"m","provider":"anthropic","status":"active","capabilities":["text.chat","vision"]}]}',
              200,
            );
          }
          if (r.url.path == '/v1/client-config') {
            return http.Response('{"tools":{}}', 200);
          }
          if (r.url.path == '/v1/conversations/c') {
            return http.Response(
              '{"conversation":{"id":"c"},"messages":[{"id":"u","role":"user","parentId":null,"parts":[{"type":"text","text":"Hi"}]},{"id":"a","role":"assistant","parentId":"u","runId":"r","parts":[]}]}',
              200,
            );
          }
          if (r.url.path == '/v1/runs/r') {
            return http.Response(
              '{"run":{"id":"r","status":"cancelled","lastSeq":1}}',
              200,
            );
          }
          throw StateError('Unexpected route');
        }),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: ChatPage(
            controller: ChatController(
              CloudRepository(client),
              accountScope: 'u:o',
              conversation: const Conversation(id: 'c'),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Response stopped.'), findsOneWidget);
      expect(find.text('Thinking…'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
