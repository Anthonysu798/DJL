import '../support/open_cloud.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets(
    'opening a chat waits for restored account identity rather than using a shared scope',
    (tester) async {
      final store = TestCredentials();
      await store.write('cloud.session', 'session');
      final account = Completer<http.Response>();
      final client = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: store,
        client: MockClient((request) async {
          if (request.url.path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          if (request.url.path == '/v1/me') return account.future;
          if (request.url.path == '/v1/conversations') {
            return http.Response('{"conversations":[],"nextCursor":null}', 200);
          }
          if (request.url.path == '/v1/models') {
            return http.Response(
              '{"models":[{"id":"m","provider":"anthropic","status":"active","capabilities":["text.chat","vision"]}]}',
              200,
            );
          }
          if (request.url.path == '/v1/client-config') {
            return http.Response('{"tools":{}}', 200);
          }
          throw StateError('Unexpected route');
        }),
      );
      await tester.pumpWidget(DjlApp(client: client));
      await tester.pumpAndSettle();
      await openCloudFromDesktop(tester);
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('New chat'));
      await tester.pump();
      expect(find.byType(ChatPage), findsNothing);
      account.complete(
        http.Response(
          '{"user":{"id":"user-1","email":"qa@example.test"},"activeOrgId":"org-1"}',
          200,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(ChatPage), findsOneWidget);
      expect(
        tester.widget<ChatPage>(find.byType(ChatPage)).controller.accountScope,
        'user-1:org-1',
      );
      expect(tester.takeException(), isNull);
    },
  );
}
