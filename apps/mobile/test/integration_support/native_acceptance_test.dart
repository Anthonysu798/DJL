import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/settings/data/settings_store.dart';
import '../../integration_test/support/native_acceptance.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

ChatController controller({required bool failLoad}) => ChatController(
  CloudRepository(
    CloudClient(
      baseUrl: Uri.parse('http://127.0.0.1:8853'),
      credentials: TestCredentials()
        ..values['cloud.session'] = 'fixture-session',
      client: MockClient((request) async {
        if (request.url.path == '/v1/auth/token') {
          return http.Response('{"token":"fixture"}', 200);
        }
        if (request.url.path == '/v1/models') {
          return http.Response('{"models":[]}', 200);
        }
        if (request.url.path == '/v1/client-config') {
          return http.Response('{}', 200);
        }
        if (failLoad) {
          return http.Response(
            '{"error":{"message":"fixture unavailable"}}',
            503,
          );
        }
        return http.Response(
          jsonEncode({
            'conversation': {'id': 'cold', 'title': 'Native cold link QA'},
            'messages': [],
          }),
          200,
        );
      }),
    ),
  ),
  accountScope: 'fixture',
  conversation: Conversation(id: 'cold'),
);

class MemoryAcceptanceSettings implements SettingsStore {
  MemoryAcceptanceSettings(this.values, {this.ignoreWrites = false});
  final Map<String, Object> values;
  final bool ignoreWrites;
  int reads = 0, writes = 0;
  @override
  Future<Map<String, Object>> read() async {
    reads++;
    return Map.of(values);
  }

  @override
  Future<void> write(String key, Object? value) async {
    writes++;
    if (!ignoreWrites && value != null) values[key] = value;
  }
}

void main() {
  test('native driver handshake uses the platform host route', () {
    expect(
      nativeAcceptanceDriverHost(isAndroid: true),
      Uri.parse('http://10.0.2.2:8855/'),
    );
    expect(
      nativeAcceptanceDriverHost(isAndroid: false),
      Uri.parse('http://127.0.0.1:8855/'),
    );
  });
  test(
    'constructor-only route ID cannot claim the server conversation loaded',
    () {
      final chat = controller(failLoad: false);
      expect(chat.loading, false);
      expect(chat.conversation?.id, 'cold');
      expect(nativeLinkLoaded(chat, 'cold', 'Native cold link QA'), false);
      chat.dispose();
      chat.repository.client.close();
    },
  );
  test(
    'failed detail GET with empty messages cannot pass native link acceptance',
    () async {
      final chat = controller(failLoad: true);
      await chat.initialize();
      expect(chat.loading, false);
      expect(chat.conversation?.id, 'cold');
      expect(chat.messages, isEmpty);
      expect(chat.error, isNotNull);
      expect(nativeLinkLoaded(chat, 'cold', 'Native cold link QA'), false);
      chat.dispose();
      chat.repository.client.close();
    },
  );
  test(
    'loaded title and error-free intended conversation are both required',
    () async {
      final chat = controller(failLoad: false);
      await chat.initialize();
      expect(nativeLinkLoaded(chat, 'cold', 'Native cold link QA'), true);
      expect(nativeLinkLoaded(chat, 'warm', 'Native warm link QA'), false);
      expect(nativeLinkLoaded(chat, 'cold', 'Native warm link QA'), false);
      chat.error = 'later load error';
      expect(nativeLinkLoaded(chat, 'cold', 'Native cold link QA'), false);
      chat.dispose();
      chat.repository.client.close();
    },
  );
  test(
    'request oracle counts attempted chat mutations even when transport fails',
    () async {
      final recorder = ConversationRequestRecorder(
        MockClient((_) async {
          throw http.ClientException('fixture failed');
        }),
      );
      for (final method in ['POST', 'PUT', 'PATCH', 'DELETE']) {
        await expectLater(
          recorder.send(
            http.Request(
              method,
              Uri.parse(
                'http://127.0.0.1:8853/v1/conversations/cold/messages?fixture=1',
              ),
            ),
          ),
          throwsA(isA<http.ClientException>()),
        );
      }
      expect(recorder.conversationMutationAttempts, 4);
      expect(recorder.totalRequestAttempts, 4);
      expect(recorder.count('POST', '/v1/conversations/cold/messages'), 1);
      recorder.close();
    },
  );
  test(
    'request oracle passes failed responses through and excludes legitimate auth mutations',
    () async {
      final recorder = ConversationRequestRecorder(
        MockClient((_) async => http.Response('unavailable', 503)),
      );
      for (final path in ['/v1/auth/sign-in/email', '/v1/auth/sign-out']) {
        final response = await recorder.post(
          Uri.parse('http://127.0.0.1:8853$path'),
        );
        expect(response.statusCode, 503);
      }
      await recorder.get(
        Uri.parse('http://127.0.0.1:8853/v1/conversations/cold'),
      );
      await recorder.head(Uri.parse('http://127.0.0.1:8853/v1/conversations'));
      await recorder.post(
        Uri.parse('http://127.0.0.1:8853/v1/conversations-other'),
      );
      expect(recorder.conversationMutationAttempts, 0);
      expect(recorder.totalRequestAttempts, 5);
      final response = await recorder.post(
        Uri.parse('http://127.0.0.1:8853/v1/conversations'),
      );
      expect(response.statusCode, 503);
      expect(response.body, 'unavailable');
      expect(recorder.conversationMutationAttempts, 1);
      recorder.close();
    },
  );
  test(
    'all-attempt oracle includes repeated failed token and GET attempts',
    () async {
      final recorder = ConversationRequestRecorder(
        MockClient((_) async {
          throw http.ClientException('fixture refused');
        }),
      );
      expect(recorder.totalRequestAttempts, 0);
      for (final path in ['/v1/auth/token', '/v1/auth/token', '/v1/models']) {
        await expectLater(
          recorder.send(
            http.Request(
              path.endsWith('token') ? 'POST' : 'GET',
              Uri.parse('http://127.0.0.1:8853$path'),
            ),
          ),
          throwsA(isA<http.ClientException>()),
        );
      }
      expect(recorder.totalRequestAttempts, 3);
      expect(recorder.count('POST', '/v1/auth/token'), 2);
      expect(recorder.conversationMutationAttempts, 0);
      recorder.close();
    },
  );
  test(
    'failed ChatController send is recorded despite empty displayed messages',
    () async {
      final recorder = ConversationRequestRecorder(
        MockClient(
          (request) async => request.url.path == '/v1/auth/token'
              ? http.Response('{"token":"fixture"}', 200)
              : http.Response(
                  '{"error":{"message":"fixture rejected send"}}',
                  400,
                ),
        ),
      );
      final cloud = CloudClient(
        baseUrl: Uri.parse('http://127.0.0.1:8853'),
        credentials: TestCredentials()
          ..values['cloud.session'] = 'fixture-session',
        client: recorder,
      );
      final chat = ChatController(
        CloudRepository(cloud),
        accountScope: 'fixture',
        conversation: Conversation(id: 'cold'),
      )..model = 'fixture-model';
      expect(await chat.send('fixture attempted message'), false);
      expect(chat.messages, isEmpty);
      expect(chat.error, isNotNull);
      expect(recorder.conversationMutationAttempts, 1);
      expect(recorder.count('POST', '/v1/conversations/cold/messages'), 1);
      chat.dispose();
      cloud.close();
    },
  );
  test(
    'native recording seam accepts only explicit isolated local HTTP endpoints',
    () {
      expect(nativeAcceptanceApi('http://127.0.0.1:8853').host, '127.0.0.1');
      expect(nativeAcceptanceApi('http://10.0.2.2:8853').host, '10.0.2.2');
      expect(nativeAcceptanceApi('http://127.0.0.1:8853/').path, '/');
      for (final value in [
        '',
        'https://api.slcor.com',
        'http://example.com',
        'http://u:p@127.0.0.1:8853',
        'http://127.0.0.1:8853?key=bad',
        'http://127.0.0.1:8853#bad',
        'http://127.0.0.1:8853/prefix',
        'http://127.0.0.1:8853/prefix/',
        'http://127.0.0.1:8853//',
        'http://127.0.0.1:8853/v1/',
      ]) {
        expect(() => nativeAcceptanceApi(value), throwsArgumentError);
      }
    },
  );
  test(
    'mutation run establishes persisted opposite appearance and preserves other preferences',
    () async {
      final store = MemoryAcceptanceSettings({
        ...nativeSettingsTarget,
        'djl.security.biometricLockEnabled': true,
        'codex.selectedModelId': 'keep-runtime',
        'unrelated': 'keep',
      });
      await establishNativeSettingsBaseline(store);
      for (final entry in nativeSettingsBaseline.entries) {
        expect(store.values[entry.key], entry.value);
        expect(entry.value, isNot(nativeSettingsTarget[entry.key]));
      }
      expect(store.values['codex.selectedModelId'], 'keep-runtime');
      expect(store.values['unrelated'], 'keep');
      expect(store.values['djl.security.biometricLockEnabled'], isTrue);
      expect(store.writes, 2);
      expect(store.reads, greaterThan(0));
    },
  );
  test(
    'matching stale target cannot survive a no-op baseline write as a new run',
    () async {
      final store = MemoryAcceptanceSettings({
        ...nativeSettingsTarget,
      }, ignoreWrites: true);
      await expectLater(
        establishNativeSettingsBaseline(store),
        throwsStateError,
      );
    },
  );
  test(
    'restore verification reads exact values without writes or normalization',
    () async {
      final store = MemoryAcceptanceSettings({
        ...nativeSettingsTarget,
        'codex.selectedModelId': 'keep-runtime',
      });
      await verifyNativeSettings(store, nativeSettingsTarget);
      expect(store.writes, 0);
      store.values['codex.appFontStyle'] = 'invalid';
      await expectLater(
        verifyNativeSettings(store, nativeSettingsTarget),
        throwsStateError,
      );
      expect(store.values['codex.appFontStyle'], 'invalid');
      expect(store.writes, 0);
    },
  );
}
