import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'settings/settings_controller_test.dart' show MemorySettingsStore;
import 'voice_controller_test.dart' show TestVoice;

void main() {
  testWidgets(
    'a reply completed under another route stays silent after returning and changing mode',
    (tester) async {
      final settings = SettingsController(
        MemorySettingsStore()..values['djl.voice.spokenReplies'] = true,
      );
      await settings.load();
      final credentials = TestCredentials()
        ..values['cloud.session'] = 'qa-session';
      final held = Completer<http.Response>();
      final client = CloudClient(
        baseUrl: Uri.parse('https://qa.invalid'),
        credentials: credentials,
        client: MockClient((request) async {
          switch (request.url.path) {
            case '/v1/auth/token':
              return http.Response('{"token":"jwt"}', 200);
            case '/v1/models':
              return http.Response(
                '{"models":[{"id":"m","displayName":"Model","provider":"anthropic","status":"active","capabilities":["text.chat","vision"]}]}',
                200,
              );
            case '/v1/client-config':
              return http.Response('{"tools":{}}', 200);
            case '/v1/conversations':
              return http.Response('{"id":"c"}', 201);
            case '/v1/conversations/c/messages':
              return http.Response(
                jsonEncode({
                  'message': {
                    'id': 'u',
                    'role': 'user',
                    'parts': [
                      {'type': 'text', 'text': 'Hello'},
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
            case '/v1/runs/r/events':
              return held.future;
            default:
              throw StateError('Unexpected QA request ${request.url.path}');
          }
        }),
      );
      final voice = TestVoice()..playback.complete();
      final chat = ChatController(
        CloudRepository(client),
        accountScope: 'user:org',
      );
      final created = <String?>[];
      final navigator = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: navigator,
          home: ChatPage(
            controller: chat,
            settings: settings,
            voiceDriver: voice,
            onConversationChanged: created.add,
          ),
        ),
      );
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox.shrink());
        settings.dispose();
        client.close();
      });
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('composer')), 'Hello');
      await tester.pump();
      await tester.tap(find.byTooltip('Send message'));
      await tester.pumpAndSettle();
      expect(created, ['c']);
      expect(chat.streaming, true);
      unawaited(
        navigator.currentState!.push(
          MaterialPageRoute<void>(
            builder: (_) => const Scaffold(body: Text('Another page')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      held.complete(
        http.Response(
          'data: {"runId":"r","seq":1,"type":"text.delta","payload":{"messageId":"a","text":"Covered reply"}}\n\n'
          'data: {"runId":"r","seq":2,"type":"status","payload":{"status":"succeeded","error":null}}\n\n',
          200,
        ),
      );
      await tester.pumpAndSettle();
      expect(voice.spoken, isEmpty);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Task mode'));
      await tester.pumpAndSettle();
      expect(voice.spoken, isEmpty);
    },
  );
  testWidgets(
    'Cloud page speaks a newly sent successful reply once, never history or disabled replies',
    (tester) async {
      final store = MemorySettingsStore()
        ..values['djl.voice.spokenReplies'] = true;
      final settings = SettingsController(store);
      await settings.load();
      final credentials = TestCredentials();
      await credentials.write('cloud.session', 'qa-session');
      var sends = 0;
      final client = CloudClient(
        baseUrl: Uri.parse('https://qa.invalid'),
        credentials: credentials,
        client: MockClient((request) async {
          final path = request.url.path;
          if (path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          if (path == '/v1/models') {
            return http.Response(
              '{"models":[{"id":"m","provider":"anthropic","status":"active","capabilities":["text.chat","vision"]}]}',
              200,
            );
          }
          if (path == '/v1/client-config') {
            return http.Response('{"tools":{}}', 200);
          }
          if (path == '/v1/conversations/c') {
            return http.Response(
              jsonEncode({
                'conversation': {'id': 'c', 'title': 'Existing chat'},
                'messages': [
                  {
                    'id': 'old',
                    'role': 'assistant',
                    'runId': 'history',
                    'parts': [
                      {'type': 'text', 'text': 'Old reply'},
                    ],
                  },
                ],
              }),
              200,
            );
          }
          if (path == '/v1/runs/history') {
            return http.Response(
              '{"run":{"id":"history","status":"succeeded","lastSeq":2}}',
              200,
            );
          }
          if (path == '/v1/conversations/c/messages') {
            sends++;
            return http.Response(
              jsonEncode({
                'message': {
                  'id': 'u$sends',
                  'parentId': 'old',
                  'role': 'user',
                  'parts': [
                    {'type': 'text', 'text': 'Hello'},
                  ],
                },
                'reply': {
                  'id': 'a$sends',
                  'parentId': 'u$sends',
                  'role': 'assistant',
                  'runId': 'r$sends',
                  'parts': [],
                },
                'run': {'id': 'r$sends', 'status': 'running'},
              }),
              201,
            );
          }
          if (path.endsWith('/events')) {
            return http.Response(
              'data: {"runId":"r$sends","seq":1,"type":"text.delta","payload":{"messageId":"a$sends","text":"Fresh reply $sends"}}\n\n'
              'data: {"runId":"r$sends","seq":2,"type":"status","payload":{"status":"succeeded","error":null}}\n\n',
              200,
            );
          }
          throw StateError('Unexpected QA request $path');
        }),
      );
      final driver = TestVoice()..playback.complete();
      final chat = ChatController(
        CloudRepository(client),
        accountScope: 'user:org',
        conversation: const Conversation(id: 'c'),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: ChatPage(
            controller: chat,
            settings: settings,
            voiceDriver: driver,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Old reply'), findsOneWidget);
      expect(driver.spoken, isEmpty);
      await tester.enterText(find.byKey(const Key('composer')), 'Hello');
      await tester.pump();
      await tester.tap(find.byTooltip('Send message'));
      await tester.pumpAndSettle();
      expect(sends, 1);
      expect(driver.spoken, ['Fresh reply 1']);
      chat.resume();
      await tester.pumpAndSettle();
      expect(driver.spoken, ['Fresh reply 1']);
      await settings.setSpokenReplies(false);
      await tester.enterText(find.byKey(const Key('composer')), 'Hello again');
      await tester.pump();
      await tester.tap(find.byTooltip('Send message'));
      await tester.pumpAndSettle();
      expect(sends, 2);
      expect(driver.spoken, ['Fresh reply 1']);
      await settings.setSpokenReplies(true);
      await tester.pumpAndSettle();
      expect(driver.spoken, ['Fresh reply 1']);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      settings.dispose();
      client.close();
    },
  );
}
