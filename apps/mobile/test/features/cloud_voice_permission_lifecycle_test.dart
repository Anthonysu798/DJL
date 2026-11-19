import 'dart:async';
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

class PendingPermissionVoice extends TestVoice {
  final permission = Completer<bool>();
  int initializations = 0;
  @override
  Future<bool> initialize() {
    initializations++;
    return permission.future;
  }
}

void main() {
  for (final outcome in [
    'denied',
    'granted',
    'backgrounded',
    'granted then backgrounded',
    'drawer opened',
    'drawer opened then closed',
  ]) {
    testWidgets(
      'voice permission $outcome across a system overlay preserves the draft and never sends',
      (tester) async {
        var posts = 0;
        final credentials = TestCredentials()
          ..values['cloud.session'] = 'qa-session';
        final client = CloudClient(
          baseUrl: Uri.parse('https://qa.invalid'),
          credentials: credentials,
          client: MockClient((request) async {
            if (request.method != 'GET') posts++;
            return switch (request.url.path) {
              '/v1/auth/token' => http.Response('{"token":"jwt"}', 200),
              '/v1/models' => http.Response(
                '{"models":[{"id":"m","displayName":"Model","provider":"anthropic","status":"active","capabilities":["text.chat","vision"]}]}',
                200,
              ),
              '/v1/client-config' => http.Response('{"tools":{}}', 200),
              _ => throw StateError(
                'Unexpected QA request ${request.url.path}',
              ),
            };
          }),
        );
        final exposed = ValueNotifier(true);
        addTearDown(exposed.dispose);
        final driver = PendingPermissionVoice();
        final chat = ChatController(
          CloudRepository(client),
          accountScope: 'user:org',
        );
        await tester.pumpWidget(
          MaterialApp(
            home: ValueListenableBuilder<bool>(
              valueListenable: exposed,
              builder: (_, value, _) => ChatPage(
                controller: chat,
                voiceDriver: driver,
                exposed: value,
              ),
            ),
          ),
        );
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox.shrink());
          client.close();
        });
        await tester.pumpAndSettle();
        final composer = find.byKey(const Key('composer'));
        await tester.enterText(composer, 'Keep my draft');
        await tester.tap(find.byTooltip('Start dictation'));
        await tester.pump();
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.inactive,
        );
        await tester.pump();
        if (outcome == 'backgrounded') {
          tester.binding.handleAppLifecycleStateChanged(
            AppLifecycleState.hidden,
          );
          tester.binding.handleAppLifecycleStateChanged(
            AppLifecycleState.paused,
          );
        }
        if (outcome.startsWith('drawer')) {
          exposed.value = false;
          await tester.pump();
        }
        driver.permission.complete(outcome != 'denied');
        await tester.pump();
        expect(
          driver.starts,
          0,
          reason: 'Never record before the app returns to the foreground.',
        );
        if (outcome == 'granted then backgrounded') {
          tester.binding.handleAppLifecycleStateChanged(
            AppLifecycleState.hidden,
          );
          tester.binding.handleAppLifecycleStateChanged(
            AppLifecycleState.paused,
          );
          await tester.pump();
        }
        if (outcome.contains('backgrounded')) {
          tester.binding.handleAppLifecycleStateChanged(
            AppLifecycleState.hidden,
          );
          tester.binding.handleAppLifecycleStateChanged(
            AppLifecycleState.inactive,
          );
        }
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        await tester.pumpAndSettle();
        if (outcome == 'granted') {
          expect(driver.starts, 1);
          driver.result!('captured words');
          await tester.pump();
          expect(
            tester.widget<TextField>(composer).controller!.text,
            'Keep my draft captured words',
          );
        } else {
          expect(driver.starts, 0);
          expect(
            tester.widget<TextField>(composer).controller!.text,
            'Keep my draft',
          );
          if (outcome == 'denied') {
            expect(
              find.textContaining(RegExp('microphone', caseSensitive: false)),
              findsOneWidget,
            );
            await tester.tap(find.byTooltip('Start dictation'));
            await tester.pumpAndSettle();
            expect(driver.initializations, 2);
          }
        }
        if (outcome == 'drawer opened then closed') {
          exposed.value = true;
          await tester.pumpAndSettle();
          expect(
            driver.starts,
            0,
            reason: 'Closing the menu does not restart recording.',
          );
        }
        expect(posts, 0);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
