import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

Map<String, Object?> usage(int banks) => {
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
  'banks': {'count': banks, 'nextExpiresAt': '2026-12-01T10:00:00Z'},
};

void main() {
  for (final replacement in ['session', 'disposed']) {
    test(
      'Late usage read cannot publish after $replacement replacement',
      () async {
        final started = Completer<void>(),
            response = Completer<http.Response>();
        final client = CloudClient(
          baseUrl: Uri.parse('https://usage.test'),
          credentials: TestCredentials()..values['cloud.session'] = 'memory',
          client: MockClient((request) {
            if (request.url.path == '/v1/auth/token') {
              return Future.value(http.Response('{"token":"memory"}', 200));
            }
            expect(request.method, 'GET');
            expect(request.url.path, '/v1/usage/windows');
            started.complete();
            return response.future;
          }),
        );
        final chat = ChatController(
          CloudRepository(client),
          accountScope: 'owner',
        );
        final pending = chat.refreshUsage();
        await started.future;
        if (replacement == 'session') {
          await client.setSession('replacement');
        } else {
          chat.dispose();
        }
        response.complete(http.Response(jsonEncode(usage(2)), 200));
        await pending;
        expect(chat.usage, isNull);
        expect(chat.usageError, isNull);
        if (replacement == 'session') chat.dispose();
        client.close();
      },
    );
  }
  test(
    'A late earlier usage snapshot cannot replace the newest bank count',
    () async {
      final requests = <Completer<http.Response>>[];
      final firstStarted = Completer<void>(), secondStarted = Completer<void>();
      final client = CloudClient(
        baseUrl: Uri.parse('https://usage.test'),
        credentials: TestCredentials()..values['cloud.session'] = 'memory',
        client: MockClient((request) {
          if (request.url.path == '/v1/auth/token') {
            return Future.value(http.Response('{"token":"memory"}', 200));
          }
          expect(request.method, 'GET');
          expect(request.url.path, '/v1/usage/windows');
          final reply = Completer<http.Response>();
          requests.add(reply);
          if (requests.length == 1) {
            firstStarted.complete();
          } else {
            secondStarted.complete();
          }
          return reply.future;
        }),
      );
      final chat = ChatController(
        CloudRepository(client),
        accountScope: 'owner',
      );
      final first = chat.refreshUsage();
      await firstStarted.future;
      final second = chat.refreshUsage();
      await secondStarted.future;
      requests[1].complete(http.Response(jsonEncode(usage(1)), 200));
      await second;
      expect(chat.usage!.bankedResets, 1);
      requests[0].complete(http.Response(jsonEncode(usage(2)), 200));
      await first;
      expect(chat.usage!.bankedResets, 1);
      expect(chat.usageLoading, false);
      chat.dispose();
      client.close();
    },
  );
}
