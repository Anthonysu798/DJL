import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'auth_fidelity_test.dart' show AuthFixture, mountAuth, fill, press;

Future<void> returnKey(WidgetTester tester) async {
  await tester.testTextInput.receiveAction(TextInputAction.newline);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('password Return dismisses editing without signing in', (
    tester,
  ) async {
    final fixture = AuthFixture();
    await mountAuth(tester, fixture);
    await press(tester, 'Password');
    await fill(tester, 'email', 'ada@example.test');
    await fill(tester, 'password', 'public-test-password');
    fixture.responses.add(
      http.Response('{"message":"Wrong credentials"}', 401),
    );
    await returnKey(tester);
    expect(fixture.requests, isEmpty);
    expect(fixture.auth.signedIn, isFalse);
    expect(tester.testTextInput.isVisible, isFalse);
    await press(tester, 'Sign in', primary: true);
    expect(fixture.requests, hasLength(1));
    expect(find.text('Wrong credentials'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    fixture.auth.dispose();
  });

  testWidgets('verification Return does not verify until the explicit button', (
    tester,
  ) async {
    final fixture = AuthFixture();
    await mountAuth(tester, fixture);
    await fill(tester, 'email', 'ada@example.test');
    await press(tester, 'Email me a code', primary: true);
    expect(fixture.requests, hasLength(1));
    await fill(tester, 'code', '123456');
    fixture.responses.add(http.Response('{"message":"Wrong code"}', 401));
    await returnKey(tester);
    expect(fixture.requests, hasLength(1));
    expect(fixture.auth.signedIn, isFalse);
    await press(tester, 'Verify and continue', primary: true);
    expect(fixture.requests, hasLength(2));
    expect(find.text('Wrong code'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    fixture.auth.dispose();
  });

  testWidgets('recovery Return does not reset a password implicitly', (
    tester,
  ) async {
    final fixture = AuthFixture();
    await mountAuth(tester, fixture);
    await press(tester, 'Password');
    await fill(tester, 'email', 'ada@example.test');
    await press(tester, 'Forgot password?');
    await press(tester, 'Send recovery code');
    expect(fixture.requests, hasLength(1));
    await fill(tester, 'code', '123456');
    await fill(tester, 'password', 'public-new-password');
    fixture.responses.add(
      http.Response('{"message":"Wrong recovery code"}', 400),
    );
    await returnKey(tester);
    expect(fixture.requests, hasLength(1));
    await press(tester, 'Reset password');
    expect(fixture.requests, hasLength(2));
    expect(find.text('Wrong recovery code'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    fixture.auth.dispose();
  });
}
