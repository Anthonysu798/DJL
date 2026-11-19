import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'voice_controller_test.dart' show TestVoice;

class CatalogFixture {
  CatalogFixture({TestCredentials? credentials}) {
    client = CloudClient(
      baseUrl: Uri.parse('https://qa.invalid'),
      credentials: (credentials ?? TestCredentials())
        ..values['cloud.session'] = 'qa',
      client: MockClient((request) async {
        if (request.method != 'GET') mutations++;
        return switch (request.url.path) {
          '/v1/auth/token' => http.Response('{"token":"jwt"}', 200),
          '/v1/models' => http.Response(
            jsonEncode({
              'models': [
                {
                  'id': 'image',
                  'displayName': 'Image only',
                  'provider': 'openai',
                  'status': 'active',
                  'capabilities': ['image.generate'],
                },
                {
                  'id': 'embed',
                  'displayName': 'Embedding only',
                  'provider': 'openai',
                  'status': 'active',
                  'capabilities': ['embedding'],
                },
                {
                  'id': 'disabled',
                  'displayName': 'Disabled chat',
                  'provider': 'anthropic',
                  'status': 'disabled',
                  'capabilities': ['text.chat'],
                },
                {
                  'id': 'preview',
                  'displayName': 'Preview chat',
                  'provider': 'anthropic',
                  'status': 'preview',
                  'capabilities': ['text.chat', 'vision'],
                },
                {
                  'id': 'degraded',
                  'displayName': 'Degraded chat',
                  'provider': 'openai',
                  'status': 'degraded',
                  'capabilities': ['text.chat'],
                },
                {
                  'id': 'text',
                  'displayName': 'Text chat',
                  'provider': 'openai',
                  'status': 'active',
                  'capabilities': ['text.chat'],
                },
                {
                  'id': 'unknown',
                  'displayName': 'Missing capabilities',
                  'provider': 'openai',
                  'status': 'active',
                },
              ],
            }),
            200,
          ),
          '/v1/client-config' => http.Response('{"tools":{}}', 200),
          _ => http.Response(
            '{"error":{"message":"Unexpected QA mutation"}}',
            503,
          ),
        };
      }),
    );
    chat = ChatController(CloudRepository(client), accountScope: 'u:o');
  }
  late final CloudClient client;
  late final ChatController chat;
  int mutations = 0;
  void close() {
    chat.dispose();
    client.close();
  }
}

void main() {
  test(
    'an image cannot upload through file selection on a text-only model',
    () async {
      final fixture = CatalogFixture();
      addTearDown(fixture.close);
      await fixture.chat.initialize();
      fixture.chat.setModel('text');
      await fixture.chat.attach(
        'review.png',
        'image/png',
        Uint8List.fromList([1, 2]),
      );
      expect(fixture.mutations, 0);
      expect(fixture.chat.attachments, isEmpty);
      expect(
        fixture.chat.error,
        'Choose a model that can view images before sending this attachment.',
      );
    },
  );
  test(
    'chat catalog follows capability and not-disabled policy including preview and degraded',
    () async {
      final fixture = CatalogFixture();
      addTearDown(fixture.close);
      await fixture.chat.initialize();
      expect(fixture.chat.models.map((m) => m['id']), [
        'preview',
        'degraded',
        'text',
      ]);
      expect(fixture.chat.model, 'preview');
      expect(fixture.mutations, 0);
    },
  );
  test(
    'an invalid or non-chat model selection preserves the current chat model',
    () async {
      final fixture = CatalogFixture();
      addTearDown(fixture.close);
      await fixture.chat.initialize();
      fixture.chat.setModel('text');
      for (final invalid in ['embed', 'image', 'disabled', 'missing']) {
        fixture.chat.setModel(invalid);
        expect(fixture.chat.model, 'text');
      }
      expect(fixture.mutations, 0);
    },
  );
  test(
    'image send requires a vision chat model before creating or sending anything',
    () async {
      final fixture = CatalogFixture();
      addTearDown(fixture.close);
      await fixture.chat.initialize();
      fixture.chat.setModel('text');
      fixture.chat.useImage({'type': 'image_ref', 'fileId': 'qa-image'});
      expect(await fixture.chat.send('Review this image'), false);
      expect(fixture.mutations, 0);
      expect(fixture.chat.attachments, hasLength(1));
      expect(
        fixture.chat.error,
        'Choose a model that can view images before sending this attachment.',
      );
    },
  );
  testWidgets(
    'source model menu groups selectable chat models and gates photo actions by vision',
    (tester) async {
      final fixture = CatalogFixture();
      await tester.pumpWidget(
        MaterialApp(
          home: ChatPage(controller: fixture.chat, voiceDriver: TestVoice()),
        ),
      );
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox.shrink());
        fixture.client.close();
      });
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Model'));
      await tester.pumpAndSettle();
      expect(find.text('Anthropic'), findsOneWidget);
      expect(find.text('OpenAI'), findsOneWidget);
      expect(find.text('Image only'), findsNothing);
      expect(find.text('Embedding only'), findsNothing);
      expect(find.text('Disabled chat'), findsNothing);
      await tester.tap(find.byKey(const Key('cloud.model-item.text')));
      await tester.pumpAndSettle();
      expect(fixture.chat.model, 'text');
      await tester.tap(find.byTooltip('Attach file or image'));
      await tester.pumpAndSettle();
      expect(find.text('Choose file'), findsOneWidget);
      expect(find.text('Photo library'), findsNothing);
      expect(find.text('Camera'), findsNothing);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Model'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('cloud.model-item.preview')));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Attach file or image'));
      await tester.pumpAndSettle();
      expect(find.text('Photo library'), findsOneWidget);
      expect(find.text('Camera'), findsOneWidget);
      expect(fixture.mutations, 0);
    },
  );
}
