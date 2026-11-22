import 'dart:convert';

import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:djl_mobile/features/reports/data/content_reporter.dart';
import 'package:djl_mobile/features/reports/presentation/report_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _Credentials implements CredentialStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String? value) async {
    value == null ? values.remove(key) : values[key] = value;
  }
}

void main() {
  group('ContentReporter', () {
    late List<http.Request> sent;
    late _Credentials credentials;
    late ContentReporter reporter;

    setUp(() {
      sent = [];
      credentials = _Credentials();
      final client = CloudClient(
        baseUrl: Uri.parse('https://cloud.test/'),
        credentials: credentials,
        client: MockClient((request) async {
          if (request.url.path == '/v1/auth/token') {
            return http.Response(
              jsonEncode({'token': 'jwt', 'expiresAt': '2099-01-01T00:00:00Z'}),
              200,
            );
          }
          sent.add(request);
          return http.Response(
            jsonEncode({
              'report': {'id': 'r1', 'createdAt': '2026-11-20T00:00:00Z'},
            }),
            201,
          );
        }),
      );
      reporter = ContentReporter(client);
    });

    test('a paired-Mac answer is reported without an account', () async {
      await reporter.reportDesktop(
        text: 'answer',
        agent: 'claude',
        reason: ReportReason.offensive,
        note: '  rude  ',
      );
      final request = sent.single;
      expect(request.method, 'POST');
      expect(request.url.path, '/v1/reports');
      expect(request.headers.containsKey('Authorization'), isFalse);
      expect(request.headers['Content-Type'], startsWith('application/json'));
      expect(jsonDecode(request.body), {
        'source': 'desktop',
        'reason': 'offensive',
        'text': 'answer',
        'agent': 'claude',
        'note': 'rude',
      });
    });

    test('a signed-in person reports with their account', () async {
      credentials.values['cloud.session'] = 'session';
      await reporter.reportDesktop(text: 'a', reason: ReportReason.other);
      expect(sent.single.headers['Authorization'], 'Bearer jwt');
      expect(jsonDecode(sent.single.body), {
        'source': 'desktop',
        'reason': 'other',
        'text': 'a',
      });
    });

    test('a DJL Cloud answer names its conversation and message', () async {
      credentials.values['cloud.session'] = 'session';
      await reporter.reportCloud(
        conversationId: 'c1',
        messageId: 'm1',
        reason: ReportReason.wrong,
      );
      expect(jsonDecode(sent.single.body), {
        'source': 'cloud',
        'reason': 'wrong',
        'conversationId': 'c1',
        'messageId': 'm1',
      });
    });

    test('long text and notes are cut to the server limits', () async {
      await reporter.reportDesktop(
        text: 'x' * 25000,
        reason: ReportReason.harmful,
        note: 'n' * 1500,
      );
      final body = jsonDecode(sent.single.body) as Map;
      expect((body['text'] as String).length, 20000);
      expect((body['note'] as String).length, 1000);
    });
  });

  group('ReportSheet', () {
    Future<void> open(WidgetTester tester, SendReport send) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: djlTheme(Brightness.light),
          home: Scaffold(
            body: Builder(
              builder: (context) =>
                  Center(child: ReportAnswerButton(send: send)),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('report.answer')));
      await tester.pumpAndSettle();
    }

    testWidgets('sends the chosen reason and note, then thanks the person', (
      tester,
    ) async {
      ReportReason? reason;
      String? note;
      await open(tester, (r, n) async {
        reason = r;
        note = n;
      });
      final send = find.byKey(const Key('report.send'));
      expect(tester.widget<FilledButton>(send).onPressed, isNull);

      await tester.tap(find.byKey(const Key('report.reason.harmful')));
      await tester.enterText(find.byKey(const Key('report.note')), 'unsafe');
      await tester.pump();
      await tester.tap(send);
      await tester.pumpAndSettle();

      expect(reason, ReportReason.harmful);
      expect(note, 'unsafe');
      expect(find.byType(ReportSheet), findsNothing);
      expect(find.text("Thanks. We'll review this answer."), findsOneWidget);
    });

    testWidgets('keeps the sheet open with a plain message when it fails', (
      tester,
    ) async {
      await open(
        tester,
        (_, _) async =>
            throw const CloudFailure(429, 'rate_limited', 'Too many.'),
      );
      await tester.tap(find.byKey(const Key('report.reason.offensive')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('report.send')));
      await tester.pumpAndSettle();

      expect(find.byType(ReportSheet), findsOneWidget);
      expect(
        find.text('Too many reports right now. Try again later.'),
        findsOneWidget,
      );
    });
  });
}
