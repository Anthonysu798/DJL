import 'package:shared_preferences/shared_preferences.dart';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/app/cloud_deep_link.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

CloudClient client(
  TestCredentials store,
  List<String> calls, {
  bool pushConfigured = false,
}) => CloudClient(
  baseUrl: Uri.parse('https://example.test'),
  credentials: store,
  client: MockClient((request) async {
    calls.add('${request.method} ${request.url.path}');
    final path = request.url.path;
    final Object response;
    if (path == '/v1/auth/token') {
      response = {'token': 'jwt'};
    } else if (path == '/v1/auth/sign-in/email') {
      response = {'token': 'test-session'};
    } else if (path == '/v1/me') {
      response = {
        'user': {'id': 'u1'},
        'activeOrgId': 'o1',
      };
    } else if (path == '/v1/models') {
      response = {'models': []};
    } else if (path == '/v1/client-config') {
      response = {'pushConfigured': pushConfigured};
    } else if (path == '/v1/conversations') {
      response = {'conversations': [], 'nextCursor': null};
    } else if (path.startsWith('/v1/conversations/')) {
      response = {
        'conversation': {
          'id': request.url.pathSegments.last,
          'title': request.url.pathSegments.last,
        },
        'messages': [],
      };
    } else {
      response = {};
    }
    return http.Response(jsonEncode(response), 200);
  }),
);
void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets('failed account loading parks the link until explicit retry', (
    tester,
  ) async {
    final store = TestCredentials()..values['cloud.session'] = 'session';
    var available = false, reads = 0;
    final cloud = CloudClient(
      baseUrl: Uri.parse('https://example.test'),
      credentials: store,
      client: MockClient((request) async {
        final path = request.url.path;
        if (path == '/v1/auth/token') {
          return http.Response('{"token":"jwt"}', 200);
        }
        if (path == '/v1/me') {
          reads++;
          return available
              ? http.Response('{"user":{"id":"u1"},"activeOrgId":"o1"}', 200)
              : http.Response('{"error":{"message":"Offline"}}', 503);
        }
        final Object value = path == '/v1/models'
            ? {'models': []}
            : path == '/v1/conversations'
            ? {'conversations': []}
            : path.startsWith('/v1/conversations/')
            ? {
                'conversation': {'id': 'parked'},
                'messages': [],
              }
            : {};
        return http.Response(jsonEncode(value), 200);
      }),
    );
    await tester.pumpWidget(
      DjlApp(
        client: cloud,
        linkStream: const Stream.empty(),
        initialLink: Future.value(Uri.parse('djl://cloud/c/parked')),
      ),
    );
    for (var i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    final settledReads = reads;
    await tester.pump(const Duration(seconds: 1));
    await tester.pump(const Duration(seconds: 1));
    expect(reads, settledReads);
    expect(reads, lessThanOrEqualTo(2));
    expect(find.byType(ChatPage), findsNothing);
    await tester.tap(find.byTooltip('Open navigation'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Settings'));
    await tester.pumpAndSettle();
    expect(find.text('Appearance'), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Open navigation'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Notifications'));
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('Retry account'), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    available = true;
    await tester.tap(find.text('Retry linked conversation'));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<ChatPage>(find.byType(ChatPage))
          .controller
          .conversation
          ?.id,
      'parked',
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'session expiry drops queued account navigation before another sign-in',
    (tester) async {
      final store = TestCredentials()..values['cloud.session'] = 'old-session';
      final calls = <String>[],
          links = StreamController<Uri>.broadcast(sync: true);
      final cloud = client(store, calls);
      await tester.pumpWidget(
        DjlApp(
          client: cloud,
          linkStream: links.stream,
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      links.add(Uri.parse('djl://cloud/c/old-account-chat'));
      await cloud.setSession(null);
      cloud.onSessionEnded?.call();
      await tester.pumpAndSettle();
      expect(find.text('Welcome to DJL'), findsOneWidget);
      await tester.tap(find.text('Continue with email'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Password'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('email')),
        'next@example.test',
      );
      await tester.enterText(
        find.byKey(const Key('password')),
        'fixture-password',
      );
      await tester.pump();
      final submit = find.byKey(const Key('auth_primary'));
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(find.byType(ChatPage), findsOneWidget);
      expect(
        tester.widget<ChatPage>(find.byType(ChatPage)).controller.conversation,
        isNull,
      );
      expect(calls.where((v) => v.contains('/old-account-chat')), isEmpty);
      await links.close();
      expect(tester.takeException(), isNull);
    },
  );
  test(
    'Cloud conversation links match Swift route and reject other routes',
    () {
      expect(cloudConversationId(Uri.parse('DJL://cloud/c/conv_1')), 'conv_1');
      expect(
        cloudConversationId(Uri.parse('djl://cloud/c/with%20space')),
        'with space',
      );
      for (final value in [
        'https://cloud/c/a',
        'djl://auth/gpt/callback?token=bad',
        'djl://cloud/c',
        'djl://cloud/c/a/extra',
        'djl://cloud/c/a%2Fb',
      ]) {
        expect(cloudConversationId(Uri.parse(value)), isNull, reason: value);
      }
    },
  );
  testWidgets(
    'cold link waits for sign-in and opens only its conversation without sending',
    (tester) async {
      final store = TestCredentials(), calls = <String>[];
      await tester.pumpWidget(
        DjlApp(
          client: client(store, calls),
          linkStream: const Stream.empty(),
          initialLink: Future.value(Uri.parse('djl://cloud/c/cold-chat')),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Welcome to DJL'), findsOneWidget);
      expect(calls.where((v) => v.contains('/conversations')), isEmpty);
      await tester.tap(find.text('Continue with email'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Password'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('email')), 'qa@example.test');
      await tester.enterText(
        find.byKey(const Key('password')),
        'fixture-password',
      );
      await tester.pump();
      final submit = find.byKey(const Key('auth_primary'));
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pumpAndSettle();
      expect(find.byType(ChatPage), findsOneWidget);
      expect(
        tester
            .widget<ChatPage>(find.byType(ChatPage))
            .controller
            .conversation
            ?.id,
        'cold-chat',
      );
      expect(
        calls.where((v) => v.startsWith('POST ') && !v.contains('/auth/')),
        isEmpty,
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'warm link replaces an open chat and duplicate delivery does not stack routes',
    (tester) async {
      final store = TestCredentials()..values['cloud.session'] = 'session';
      final calls = <String>[],
          links = StreamController<Uri>.broadcast(sync: true);
      await tester.pumpWidget(
        DjlApp(
          client: client(store, calls),
          linkStream: links.stream,
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      links.add(Uri.parse('djl://cloud/c/first'));
      await tester.pumpAndSettle();
      links.add(Uri.parse('djl://cloud/c/second'));
      await tester.pumpAndSettle();
      links.add(Uri.parse('djl://cloud/c/second'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<ChatPage>(find.byType(ChatPage))
            .controller
            .conversation
            ?.id,
        'second',
      );
      expect(
        calls.where((v) => v == 'GET /v1/conversations/second'),
        hasLength(1),
      );
      links.add(Uri.parse('djl://cloud/c/superseded'));
      links.add(Uri.parse('djl://cloud/c/second'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<ChatPage>(find.byType(ChatPage))
            .controller
            .conversation
            ?.id,
        'second',
      );
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(ChatPage), findsOneWidget);
      expect(
        tester.widget<ChatPage>(find.byType(ChatPage)).controller.conversation,
        isNull,
      );
      await links.close();
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('a late initial URI cannot replace a newer warm link', (
    tester,
  ) async {
    final store = TestCredentials()..values['cloud.session'] = 'session';
    final initial = Completer<Uri?>(),
        links = StreamController<Uri>.broadcast(sync: true);
    await tester.pumpWidget(
      DjlApp(
        client: client(store, []),
        linkStream: links.stream,
        initialLink: initial.future,
      ),
    );
    await tester.pumpAndSettle();
    links.add(Uri.parse('djl://cloud/c/newer'));
    await tester.pumpAndSettle();
    initial.complete(Uri.parse('djl://cloud/c/stale'));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<ChatPage>(find.byType(ChatPage))
          .controller
          .conversation
          ?.id,
      'newer',
    );
    await links.close();
  });
}
