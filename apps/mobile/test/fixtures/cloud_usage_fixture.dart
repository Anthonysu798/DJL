import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

// Only the HTTP boundary is replaced. Controller, storage and reducer are real.
class CloudUsageFixture {
  CloudUsageFixture({
    this.restoredBlocked = false,
    this.blockOnEvent = false,
    this.blockCode = 'usage_window_exhausted',
  }) {
    client = CloudClient(
      baseUrl: Uri.parse('https://memory-usage.invalid'),
      credentials: credentials,
      client: MockClient(request),
    );
    chat = ChatController(
      CloudRepository(client),
      accountScope: 'memory-owner',
      conversation: const Conversation(id: 'c', title: 'Owned usage QA'),
    );
  }
  final credentials = TestCredentials()..values['cloud.session'] = 'memory';
  late final CloudClient client;
  late final ChatController chat;
  final bool restoredBlocked, blockOnEvent;
  final String blockCode;
  final eventAfter = <String?>[];
  int usageReads = 0;
  bool usageUnavailable = false, rejectAfterReset = false;
  String? resetsAt = '2026-11-10T10:00:00Z';
  bool exhausted = true;
  int banks = 2, redemptionFailures = 0;
  Completer<http.Response>? redemptionGate;
  final images = <Map<String, dynamic>>[];
  final messages = <Map<String, dynamic>>[],
      redemptions = <Map<String, dynamic>>[];
  Map<String, Object?> get usage => {
    'planId': 'free',
    'windows': {
      'fiveHour': {
        'kind': 'five_hour',
        'limit': '100',
        'used': exhausted ? '100' : '0',
        'remaining': exhausted ? '0' : '100',
        'resetsAt': exhausted ? resetsAt : null,
      },
      'week': {
        'kind': 'week',
        'limit': '200',
        'used': exhausted ? '100' : '0',
        'remaining': exhausted ? '100' : '200',
        'resetsAt': '2026-11-11T10:00:00Z',
      },
    },
    'banks': {
      'count': banks,
      'nextExpiresAt': banks > 0 ? '2026-12-01T10:00:00Z' : null,
    },
  };
  Future<http.Response> request(http.Request request) async {
    final path = request.url.path;
    if (path == '/v1/auth/token') {
      return http.Response('{"token":"memory"}', 200);
    }
    if (path.endsWith('/messages') || path.endsWith('/images')) {
      final image = path.endsWith('/images');
      final input = jsonDecode(request.body) as Map<String, dynamic>;
      (image ? images : messages).add(input);
      if ((exhausted || rejectAfterReset) && !blockOnEvent) {
        exhausted = true;
        return http.Response(
          jsonEncode({
            'error': {
              'code': blockCode,
              'message': 'Window full',
              'resetsAt': resetsAt,
            },
          }),
          429,
        );
      }
      return http.Response(
        jsonEncode({
          'message': {
            'id': 'u',
            'role': 'user',
            'parts': image
                ? [
                    {'type': 'text', 'text': input['prompt']},
                  ]
                : input['parts'],
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
    if (path == '/v1/usage/resets/redeem') {
      redemptions.add(jsonDecode(request.body) as Map<String, dynamic>);
      if (redemptionGate case final gate?) return gate.future;
      if (redemptionFailures > 0) {
        redemptionFailures--;
        return http.Response(
          '{"error":{"code":"unavailable","message":"Reset result unknown"}}',
          503,
        );
      }
      exhausted = false;
      banks--;
      return http.Response(
        jsonEncode({'redeemedBankId': 'memory-bank', 'usage': usage}),
        200,
      );
    }
    if (path.endsWith('/events')) {
      final after = request.url.queryParameters['after'];
      eventAfter.add(after);
      final List<Map<String, Object?>> events;
      if (blockOnEvent && exhausted) {
        events = [
          {
            'runId': 'r',
            'seq': 1,
            'type': 'status',
            'payload': {
              'status': 'blocked_on_usage',
              'error': {'code': blockCode, 'message': 'Window full'},
            },
          },
        ];
      } else if (after == '1') {
        events = [
          {
            'runId': 'r',
            'seq': 2,
            'type': 'status',
            'payload': {'status': 'running', 'error': null},
          },
          {
            'runId': 'r',
            'seq': 3,
            'type': 'text.delta',
            'payload': {'messageId': 'a', 'text': 'Resumed original run'},
          },
          {
            'runId': 'r',
            'seq': 4,
            'type': 'status',
            'payload': {'status': 'succeeded', 'error': null},
          },
        ];
      } else {
        events = [
          {
            'runId': 'r',
            'seq': 1,
            'type': 'text.delta',
            'payload': {'messageId': 'a', 'text': 'Recovered once'},
          },
          {
            'runId': 'r',
            'seq': 2,
            'type': 'status',
            'payload': {'status': 'succeeded', 'error': null},
          },
        ];
      }
      return http.Response(
        events.map((event) => 'data: ${jsonEncode(event)}\n\n').join(),
        200,
      );
    }
    if (path == '/v1/usage/windows') {
      usageReads++;
      if (usageUnavailable) {
        return http.Response(
          '{"error":{"code":"unavailable","message":"Usage could not be loaded"}}',
          503,
        );
      }
    }
    return http.Response(
      jsonEncode(switch (path) {
        '/v1/models' => {
          'models': [
            {
              'id': 'm',
              'displayName': 'Model',
              'provider': 'anthropic',
              'status': 'active',
              'capabilities': ['text.chat', 'vision'],
            },
          ],
        },
        '/v1/conversations/c' => {
          'conversation': {'id': 'c', 'title': 'Owned usage QA'},
          'messages': [
            if (restoredBlocked) ...[
              {
                'id': 'u',
                'role': 'user',
                'parts': [
                  {'type': 'text', 'text': 'Original blocked run'},
                ],
              },
              {
                'id': 'a',
                'parentId': 'u',
                'role': 'assistant',
                'runId': 'r',
                'parts': [],
              },
            ],
          ],
        },
        '/v1/usage/windows' => usage,
        '/v1/client-config' => {
          'tools': {'imageGeneration': true},
        },
        '/v1/runs/r' => {
          'run': {
            'id': 'r',
            'status': 'blocked_on_usage',
            'lastSeq': 1,
            'error': {'code': blockCode, 'message': 'Window full'},
          },
        },
        _ => <String, Object?>{},
      }),
      200,
    );
  }

  void dispose() {
    chat.dispose();
    client.close();
  }
}
