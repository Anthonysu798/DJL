import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';

void main() {
  test(
    'Usage failure preserves the pending send without a generic error or automatic redemption',
    () async {
      final requests = <http.Request>[];
      final client = CloudClient(
        baseUrl: Uri.parse('https://usage.test'),
        credentials: TestCredentials()
          ..values['cloud.session'] = 'memory-session',
        client: MockClient((request) async {
          requests.add(request);
          if (request.url.path == '/v1/auth/token') {
            return http.Response('{"token":"memory-jwt"}', 200);
          }
          if (request.url.path.endsWith('/messages')) {
            return http.Response(
              jsonEncode({
                'error': {
                  'code': 'usage_window_exhausted',
                  'message': 'Your window is full',
                  'resetsAt': '2026-11-10T10:00:00Z',
                },
              }),
              429,
            );
          }
          return http.Response(
            jsonEncode(switch (request.url.path) {
              '/v1/models' => {
                'models': [
                  {
                    'id': 'm',
                    'displayName': 'Model',
                    'provider': 'anthropic',
                    'status': 'active',
                    'capabilities': ['text.chat'],
                  },
                ],
              },
              '/v1/conversations/c' => {
                'conversation': {'id': 'c', 'title': 'Owned usage chat'},
                'messages': [],
              },
              '/v1/usage/windows' => {
                'planId': 'free',
                'windows': {
                  'fiveHour': {
                    'kind': 'five_hour',
                    'limit': '100',
                    'used': '100',
                    'remaining': '0',
                    'resetsAt': '2026-11-10T10:00:00Z',
                  },
                  'week': {
                    'kind': 'week',
                    'limit': '200',
                    'used': '100',
                    'remaining': '100',
                    'resetsAt': '2026-11-11T10:00:00Z',
                  },
                },
                'banks': {'count': 2, 'nextExpiresAt': '2026-12-01T10:00:00Z'},
              },
              _ => <String, Object?>{},
            }),
            200,
          );
        }),
      );
      final chat = ChatController(
        CloudRepository(client),
        accountScope: 'owner',
        conversation: const Conversation(id: 'c', title: 'Owned usage chat'),
      );
      addTearDown(() {
        chat.dispose();
        client.close();
      });
      await chat.initialize();
      expect(await chat.send('owned pending prompt'), false);
      expect(chat.canRetry, true);
      expect(chat.usageBlockedUntil, '2026-11-10T10:00:00Z');
      await chat.refreshUsage();
      expect(chat.usage!.bankedResets, 2);
      expect(chat.usage!.fiveHour.fraction, 1);
      expect(chat.usageLoading, false);
      expect(chat.usageError, isNull);
      expect(
        chat.error,
        isNull,
        reason:
            'Usage exhaustion has a dedicated recovery banner in the source.',
      );
      expect(
        requests.where((r) => r.url.path == '/v1/usage/resets/redeem'),
        isEmpty,
      );
      expect(requests.where((r) => r.url.path.endsWith('/messages')).length, 1);
    },
  );

  test('Usage-blocked run remains resumable like the source CloudRun', () {
    final run = RunReducer(runId: 'owned-run', messages: []);
    run.apply({
      'runId': 'owned-run',
      'seq': 1,
      'type': 'status',
      'payload': {
        'status': 'blocked_on_usage',
        'error': {'code': 'usage_window_exhausted', 'message': 'Window full'},
      },
    });
    expect(run.status, 'blocked_on_usage');
    expect(run.lastSeq, 1);
    expect(
      run.terminal,
      false,
      reason:
          'Only succeeded, failed and cancelled are terminal in the source.',
    );
  });
}
