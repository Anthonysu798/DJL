import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import 'auth_form_fencing_test.dart' show HeldEmailCredentials;
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/auth/presentation/auth_controller.dart';
import 'package:djl_mobile/features/auth/presentation/auth_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

class AuthFixture {
  AuthFixture({TestCredentials? credentials})
    : credentials = credentials ?? TestCredentials();
  final TestCredentials credentials;
  final requests = <http.Request>[];
  final responses = <Object>[];
  late final cloud = CloudClient(
    baseUrl: Uri.parse('https://example.test'),
    credentials: credentials,
    client: MockClient((request) async {
      requests.add(request);
      if (request.url.path == '/v1/auth/token') {
        return http.Response('{"token":"fixture-jwt"}', 200);
      }
      if (request.url.path == '/v1/me') {
        return http.Response('{"user":{"id":"fixture"}}', 200);
      }
      final next = responses.isEmpty
          ? http.Response('{}', 200)
          : responses.removeAt(0);
      if (next is Completer<http.Response>) return next.future;
      return next as http.Response;
    }),
  );
  late final auth = AuthController(cloud);
}

Future<void> mountAuth(
  WidgetTester tester,
  AuthFixture fixture, {
  ThemeData? theme,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: theme ?? djlTheme(Brightness.light),
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.push<void>(
              context,
              MaterialPageRoute(
                builder: (_) => AuthPage(controller: fixture.auth),
              ),
            ),
            child: const Text('Open email'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open email'));
  await tester.pumpAndSettle();
}

Future<void> fill(WidgetTester tester, String key, String value) async {
  await tester.enterText(find.byKey(Key(key)), value);
  await tester.pump();
}

Future<void> press(
  WidgetTester tester,
  String label, {
  bool primary = false,
}) async {
  final buttons = find.ancestor(
    of: find.text(label),
    matching: find.byType(TextButton),
  );
  final candidates = primary
      ? find.byKey(const Key('auth_primary'))
      : buttons.evaluate().isNotEmpty
      ? buttons
      : find.text(label);
  if (candidates.evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      candidates,
      160,
      scrollable: find
          .descendant(
            of: find.byType(ListView).last,
            matching: find.byType(Scrollable),
          )
          .first,
      maxScrolls: 12,
    );
  }
  final target = candidates.last;
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  expect(target.hitTestable(), findsOneWidget);
  await tester.tap(target);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'tokenless OTP success never signs in or silently leaves the current verification form',
    (tester) async {
      final fixture = AuthFixture();
      await mountAuth(tester, fixture);
      await fill(tester, 'email', 'ada@example.test');
      await press(tester, 'Email me a code');
      await fill(tester, 'code', '123456');
      await press(tester, 'Verify and continue');
      expect(fixture.auth.signedIn, isFalse);
      expect(fixture.credentials.values['cloud.session'], isNull);
      expect(
        find.text('Could not complete sign-in. Try again.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('code')), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      fixture.auth.dispose();
    },
  );
  testWidgets(
    'creation verification resend uses its bound email and purpose; method change clears code and error',
    (tester) async {
      final fixture = AuthFixture();
      await mountAuth(tester, fixture);
      await press(tester, 'Create account');
      await fill(tester, 'name', 'Ada');
      await fill(tester, 'email', 'ada@example.test');
      await fill(tester, 'password', 'new-password');
      await press(tester, 'Create account');
      await fill(tester, 'code', '123456');
      fixture.responses.add(
        http.Response('{"message":"Wrong verification code"}', 401),
      );
      await press(tester, 'Verify and continue');
      expect(find.text('Wrong verification code'), findsOneWidget);
      await tester.pump(const Duration(seconds: 60));
      await tester.pump();
      await press(tester, 'Resend code');
      expect(jsonDecode(fixture.requests.last.body), {
        'email': 'ada@example.test',
        'type': 'email-verification',
      });
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('code')))
            .controller!
            .text,
        isEmpty,
      );
      await press(tester, 'Password');
      expect(find.text('Wrong verification code'), findsNothing);
      await press(tester, 'Email code');
      expect(find.byKey(const Key('code')), findsNothing);
      await tester.pumpWidget(const SizedBox());
      fixture.auth.dispose();
    },
  );

  testWidgets(
    'busy code request locks methods and fields; dismissal rejects its late token before route disposal',
    (tester) async {
      final fixture = AuthFixture(), response = Completer<http.Response>();
      fixture.responses.add(response);
      await mountAuth(tester, fixture);
      await fill(tester, 'email', 'ada@example.test');
      await tester.tap(find.byKey(const Key('auth_primary')));
      await tester.pump();
      expect(
        tester.widget<TextField>(find.byKey(const Key('email'))).enabled,
        isFalse,
      );
      await tester.tap(find.text('Password'));
      await tester.pump();
      expect(find.byKey(const Key('password')), findsNothing);
      await tester.tap(find.byKey(const Key('auth_primary')));
      await tester.pump();
      expect(fixture.requests, hasLength(1));
      await tester.pageBack();
      await tester.pump();
      response.complete(http.Response('{"token":"late-email-session"}', 200));
      await tester.pumpAndSettle();
      expect(fixture.credentials.values['cloud.session'], isNull);
      expect(fixture.auth.signedIn, isFalse);
      expect(find.text('Open email'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      fixture.auth.dispose();
    },
  );
  testWidgets(
    'an invalidated pending email never enters the code phase for the changed field',
    (tester) async {
      final fixture = AuthFixture(), response = Completer<http.Response>();
      fixture.responses.add(response);
      await mountAuth(tester, fixture);
      await fill(tester, 'email', 'first@example.test');
      await tester.tap(find.byKey(const Key('auth_primary')));
      await tester.pump();
      tester
              .widget<TextField>(find.byKey(const Key('email')))
              .controller!
              .text =
          'second@example.test';
      response.complete(http.Response('{}', 200));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('code')), findsNothing);
      expect(fixture.auth.notice, isNull);
      await press(tester, 'Email me a code');
      expect(
        find.text(
          'We sent a code to second@example.test. It expires in 10 minutes.',
        ),
        findsOneWidget,
      );
      await tester.pumpWidget(const SizedBox());
      fixture.auth.dispose();
    },
  );
  for (final newer in [false, true]) {
    testWidgets(
      'actual email page dismissal during queued credential write ${newer ? 'preserves newer owner' : 'restores previous owner'}',
      (tester) async {
        final store = HeldEmailCredentials()
          ..values['cloud.session'] = 'previous-session';
        final fixture = AuthFixture(credentials: store)
          ..responses.add(http.Response('{"token":"late-email-session"}', 200));
        await mountAuth(tester, fixture);
        await press(tester, 'Password');
        await fill(tester, 'email', 'ada@example.test');
        await fill(tester, 'password', 'short');
        await tester.tap(find.byKey(const Key('auth_primary')));
        await tester.pump();
        expect(store.started.isCompleted, isTrue);
        await tester.pageBack();
        await tester.pump();
        final replacement = newer
            ? fixture.cloud.setSession('newer-session')
            : null;
        store.release.complete();
        await tester.pumpAndSettle();
        await replacement;
        expect(
          store.values['cloud.session'],
          newer ? 'newer-session' : 'previous-session',
        );
        expect(fixture.auth.signedIn, isFalse);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        fixture.auth.dispose();
      },
    );
  }
  for (final size in [
    const Size(360, 800),
    const Size(402, 874),
    const Size(411, 923),
  ]) {
    for (final dark in [false, true]) {
      testWidgets(
        'grouped auth and recovery are reachable with keyboard on ${size.width} dark=$dark large=$dark',
        (tester) async {
          tester.view.devicePixelRatio = 2;
          tester.view.physicalSize = size * 2;
          tester.view.padding = const FakeViewPadding(top: 88, bottom: 48);
          tester.view.viewPadding = const FakeViewPadding(top: 88, bottom: 48);
          tester.view.viewInsets = const FakeViewPadding(bottom: 600);
          tester.platformDispatcher.textScaleFactorTestValue = dark ? 1.7 : 1;
          addTearDown(tester.view.reset);
          addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
          final fixture = AuthFixture();
          await mountAuth(
            tester,
            fixture,
            theme: djlTheme(
              dark ? Brightness.dark : Brightness.light,
              font: dark ? AppFontStyle.geistMono : AppFontStyle.system,
            ),
          );
          await fill(tester, 'email', 'ada@example.test');
          await press(tester, 'Email me a code');
          await tester.ensureVisible(find.byKey(const Key('code')));
          await tester.pumpAndSettle();
          expect(find.byKey(const Key('code')).hitTestable(), findsOneWidget);
          await press(tester, 'Use another email');
          await press(tester, 'Password');
          await press(tester, 'Forgot password?');
          await press(tester, 'Send recovery code');
          await fill(tester, 'code', '123456');
          await fill(tester, 'password', 'new-password');
          await press(tester, 'Reset password', primary: true);
          await press(tester, 'Back to sign in');
          expect(find.text('Continue with email'), findsOneWidget);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
          fixture.auth.dispose();
        },
      );
    }
  }

  testWidgets(
    'email opens in code method and requests a code only for a valid normalized email',
    (tester) async {
      final fixture = AuthFixture();
      await mountAuth(tester, fixture);
      expect(find.text('Continue with email'), findsOneWidget);
      expect(find.byKey(const Key('password')), findsNothing);
      expect(find.text('Email me a code'), findsOneWidget);
      await press(tester, 'Email me a code');
      expect(fixture.requests, isEmpty);
      await fill(tester, 'email', ' Ada@Example.Test ');
      await press(tester, 'Email me a code');
      expect(
        fixture.requests.single.url.path,
        '/v1/auth/email-otp/send-verification-otp',
      );
      expect(jsonDecode(fixture.requests.single.body), {
        'email': 'ada@example.test',
        'type': 'sign-in',
      });
      expect(find.byKey(const Key('code')), findsOneWidget);
      expect(find.textContaining('It expires in 10 minutes.'), findsOneWidget);
      expect(find.text('Verify and continue'), findsOneWidget);
      expect(find.text('Resend in 60s'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      fixture.auth.dispose();
    },
  );
  testWidgets(
    'failed code request stays at email entry and never binds the wrong email',
    (tester) async {
      final fixture = AuthFixture()
        ..responses.add(http.Response('{"message":"Try again"}', 503));
      await mountAuth(tester, fixture);
      await fill(tester, 'email', 'first@example.test');
      await press(tester, 'Email me a code');
      expect(find.byKey(const Key('code')), findsNothing);
      expect(find.text('Try again'), findsOneWidget);
      await fill(tester, 'email', 'second@example.test');
      await press(tester, 'Email me a code');
      expect(
        find.text(
          'We sent a code to second@example.test. It expires in 10 minutes.',
        ),
        findsOneWidget,
      );
      expect(
        jsonDecode(fixture.requests.last.body)['email'],
        'second@example.test',
      );
      await tester.pumpWidget(const SizedBox());
      fixture.auth.dispose();
    },
  );
  testWidgets(
    'code submit requires six ASCII digits and sends the exact public OTP body',
    (tester) async {
      final fixture = AuthFixture();
      await mountAuth(tester, fixture);
      await fill(tester, 'email', 'ada@example.test');
      await press(tester, 'Email me a code');
      await fill(tester, 'code', '12a３45678');
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('code')))
            .controller!
            .text,
        '124567',
      );
      await fill(tester, 'code', '12345');
      await press(tester, 'Verify and continue');
      expect(fixture.requests, hasLength(1));
      fixture.responses.add(http.Response('{"token":"fixture-session"}', 200));
      await fill(tester, 'code', '123456');
      await press(tester, 'Verify and continue');
      expect(
        fixture.requests
            .firstWhere((r) => r.url.path.endsWith('sign-in/email-otp'))
            .body,
        '{"email":"ada@example.test","otp":"123456"}',
      );
      expect(fixture.credentials.values['cloud.session'], 'fixture-session');
      expect(find.text('Open email'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      fixture.auth.dispose();
    },
  );
  testWidgets(
    'code cooldown, another email and method changes reset the visible verification phase',
    (tester) async {
      final fixture = AuthFixture();
      await mountAuth(tester, fixture);
      await fill(tester, 'email', 'ada@example.test');
      await press(tester, 'Email me a code');
      await press(tester, 'Resend in 60s');
      expect(fixture.requests, hasLength(1));
      await tester.pump(const Duration(seconds: 60));
      await tester.pump();
      await press(tester, 'Resend code');
      expect(fixture.requests, hasLength(2));
      await fill(tester, 'code', '123456');
      await press(tester, 'Use another email');
      expect(find.byKey(const Key('code')), findsNothing);
      await press(tester, 'Password');
      expect(find.byKey(const Key('password')), findsOneWidget);
      await press(tester, 'Email code');
      expect(find.byKey(const Key('code')), findsNothing);
      expect(find.text('Email me a code'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      fixture.auth.dispose();
    },
  );
  for (final verify in [false, true]) {
    testWidgets(
      'account creation ${verify ? 'enters verification' : 'signs in'} using source password constraints',
      (tester) async {
        final fixture = AuthFixture();
        await mountAuth(tester, fixture);
        await press(tester, 'Create account');
        await fill(tester, 'name', ' Ada ');
        await fill(tester, 'email', ' ADA@EXAMPLE.TEST ');
        await fill(tester, 'password', '123456789');
        await press(tester, 'Create account');
        expect(fixture.requests, isEmpty);
        fixture.responses.add(
          http.Response(verify ? '{}' : '{"token":"created-session"}', 200),
        );
        await fill(tester, 'password', '1234567890');
        await press(tester, 'Create account');
        expect(jsonDecode(fixture.requests.first.body), {
          'name': 'Ada',
          'email': 'ada@example.test',
          'password': '1234567890',
        });
        if (verify) {
          expect(find.text('Verify and continue'), findsOneWidget);
          fixture.responses.add(
            http.Response('{"token":"verified-session"}', 200),
          );
          await fill(tester, 'code', '654321');
          await press(tester, 'Verify and continue');
          expect(
            fixture.requests
                .firstWhere((r) => r.url.path.endsWith('verify-email'))
                .body,
            '{"email":"ada@example.test","otp":"654321"}',
          );
        }
        expect(fixture.auth.signedIn, isTrue);
        await tester.pumpWidget(const SizedBox());
        fixture.auth.dispose();
      },
    );
  }
  testWidgets(
    'password recovery requests and verifies a code then returns its bound email to password sign-in',
    (tester) async {
      final fixture = AuthFixture();
      await mountAuth(tester, fixture);
      await press(tester, 'Password');
      await fill(tester, 'email', ' ADA@EXAMPLE.TEST ');
      await press(tester, 'Forgot password?');
      expect(find.text('Reset password'), findsOneWidget);
      await press(tester, 'Send recovery code');
      expect(
        fixture.requests.single.url.path,
        '/v1/auth/email-otp/request-password-reset',
      );
      expect(jsonDecode(fixture.requests.single.body), {
        'email': 'ada@example.test',
      });
      await fill(tester, 'code', '123456');
      await fill(tester, 'password', 'new-password');
      await press(tester, 'Reset password', primary: true);
      expect(
        fixture.requests.last.url.path,
        '/v1/auth/email-otp/reset-password',
      );
      expect(jsonDecode(fixture.requests.last.body), {
        'email': 'ada@example.test',
        'otp': '123456',
        'password': 'new-password',
      });
      expect(fixture.credentials.values['cloud.session'], isNull);
      expect(find.text('Password updated'), findsOneWidget);
      await press(tester, 'Back to sign in');
      expect(find.text('Continue with email'), findsOneWidget);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('email')))
            .controller!
            .text,
        'ada@example.test',
      );
      expect(find.text('Sign in'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      fixture.auth.dispose();
    },
  );
}
