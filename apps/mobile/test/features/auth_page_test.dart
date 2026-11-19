import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/auth/presentation/auth_controller.dart';
import 'package:djl_mobile/features/auth/presentation/auth_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

void main() {
  testWidgets(
    'password form masks password, validates, and displays server errors',
    (tester) async {
      var calls = 0;
      final auth = AuthController(
        CloudClient(
          baseUrl: Uri.parse('https://example.test'),
          credentials: TestCredentials(),
          client: MockClient((r) async {
            calls++;
            return http.Response(
              '{"code":"INVALID_PASSWORD","message":"Wrong credentials"}',
              401,
            );
          }),
        ),
      );
      await tester.pumpWidget(MaterialApp(home: AuthPage(controller: auth)));
      await tester.tap(find.text('Password'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('auth_primary')));
      await tester.pump();
      expect(calls, 0);
      await tester.enterText(
        find.byKey(const Key('email')),
        'ada@example.test',
      );
      await tester.enterText(find.byKey(const Key('password')), 'incorrect');
      expect(
        tester
            .widget<EditableText>(
              find.descendant(
                of: find.byKey(const Key('password')),
                matching: find.byType(EditableText),
              ),
            )
            .obscureText,
        isTrue,
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('auth_primary')));
      await tester.pumpAndSettle();
      expect(calls, 1);
      expect(find.text('Wrong credentials'), findsOneWidget);
      auth.dispose();
    },
  );
}
