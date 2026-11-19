import '../support/open_cloud.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/auth/data/social_identity.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'social_auth_controller_test.dart' show ControlledSocialIdentity;

class StartupHeldCredentials extends TestCredentials {
  final trusted = Completer<String?>();
  @override
  Future<String?> read(String key) =>
      key == 'desktop.trusted' ? trusted.future : super.read(key);
}

class HeldCloudSessionCredentials extends TestCredentials {
  final session = Completer<String?>();
  @override
  Future<String?> read(String key) =>
      key == 'cloud.session' ? session.future : super.read(key);
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets('desktop setup is available while the Cloud session is loading', (
    tester,
  ) async {
    final store = HeldCloudSessionCredentials();
    final cloud = CloudClient(
      baseUrl: Uri.parse('https://example.test'),
      credentials: store,
      client: MockClient((_) async => http.Response('{}', 500)),
    );
    await tester.pumpWidget(
      DjlApp(
        client: cloud,
        linkStream: const Stream.empty(),
        initialLink: Future.value(null),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(PairingPage), findsOneWidget);
    expect(find.text('Connect to DJL Desktop'), findsOneWidget);
    expect(find.text('Pair with Code'), findsOneWidget);
    expect(find.text('Continue with email'), findsNothing);
    store.session.complete(null);
    await tester.pumpAndSettle();
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets(
    'actual welcome intersects capabilities and keeps email/Mac routes usable',
    (tester) async {
      final native = ControlledSocialIdentity()
        ..providers = {SocialProvider.google};
      final cloud = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: TestCredentials(),
        client: MockClient(
          (_) async =>
              http.Response('{"auth":{"apple":true,"google":true}}', 200),
        ),
      );
      await tester.pumpWidget(
        DjlApp(
          client: cloud,
          socialIdentity: native,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(PairingPage), findsOneWidget);
      expect(find.text('Continue with Google'), findsNothing);
      await tester.tap(find.text('DJL Cloud'));
      await tester.pumpAndSettle();
      expect(find.text('Continue with Google'), findsOneWidget);
      expect(find.text('Continue with Apple'), findsNothing);
      await tester.tap(find.text('Continue with email'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('email')), findsOneWidget);
      await tester.tap(find.byKey(const Key('email')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Pair with a Mac'));
      await tester.pumpAndSettle();
      expect(find.byType(PairingPage), findsOneWidget);
      expect(find.byTooltip('Settings'), findsOneWidget);
      expect(find.text('Pair with Code'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'welcome retries unavailable configuration and native cancel stays quiet',
    (tester) async {
      var offline = true;
      final native = ControlledSocialIdentity()..result = null;
      final cloud = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: TestCredentials(),
        client: MockClient(
          (_) async => offline
              ? http.Response('{}', 503)
              : http.Response(
                  jsonEncode({
                    'auth': {'apple': true, 'google': true},
                  }),
                  200,
                ),
        ),
      );
      await tester.pumpWidget(
        DjlApp(
          client: cloud,
          socialIdentity: native,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      await openCloudFromDesktop(tester);
      expect(find.text('Continue with Google'), findsNothing);
      expect(find.text('Continue with Apple'), findsNothing);
      offline = false;
      await tester.tap(find.text('Retry sign-in options'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Continue with Google'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Continue with Google'));
      await tester.pumpAndSettle();
      expect(find.text('Welcome to DJL'), findsOneWidget);
      expect(native.acquisitions, [SocialProvider.google]);
      expect(find.textContaining('Could not sign in'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'short large-text welcome disables duplicate acquisition while native prompt is pending',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(360, 600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      tester.platformDispatcher.textScaleFactorTestValue = 1.6;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final native = ControlledSocialIdentity()..pending = Completer();
      final cloud = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: TestCredentials(),
        client: MockClient(
          (_) async =>
              http.Response('{"auth":{"google":true,"apple":true}}', 200),
        ),
      );
      await tester.pumpWidget(
        DjlApp(
          client: cloud,
          socialIdentity: native,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      await openCloudFromDesktop(tester);
      await tester.ensureVisible(find.text('Continue with Google'));
      await tester.pumpAndSettle();
      expect(find.text('Continue with Google').hitTestable(), findsOneWidget);
      await tester.tap(find.text('Continue with Google'));
      await tester.pump();
      final google = find.ancestor(
        of: find.text('Continue with Google'),
        matching: find.byType(TextButton),
      );
      expect(tester.widget<TextButton>(google).onPressed, isNull);
      expect(native.acquisitions, [SocialProvider.google]);
      expect(tester.takeException(), isNull);
      native.pending!.complete(null);
      await tester.pumpAndSettle();
      expect(tester.widget<TextButton>(google).onPressed, isNotNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  for (final phase in ['acquisition', 'exchange']) {
    testWidgets(
      'welcome policies follow busy $phase and preserve actual Mac cancellation',
      (tester) async {
        final native = ControlledSocialIdentity();
        final store = TestCredentials();
        var exchange = Completer<http.Response>();
        var exchanges = 0;
        final cloud = CloudClient(
          baseUrl: Uri.parse('https://example.test'),
          credentials: store,
          client: MockClient((request) async {
            if (request.url.path == '/v1/client-config') {
              return http.Response(
                jsonEncode({
                  'auth': {'google': true},
                  'policyUrls': {
                    'terms': 'https://example.test/terms',
                    'privacy': 'https://example.test/privacy',
                  },
                }),
                200,
              );
            }
            expect(request.url.path, '/v1/auth/sign-in/social');
            exchanges++;
            return exchange.future;
          }),
        );
        await tester.pumpWidget(
          DjlApp(
            client: cloud,
            socialIdentity: native,
            linkStream: const Stream.empty(),
            initialLink: Future.value(null),
          ),
        );
        await tester.pumpAndSettle();
        await openCloudFromDesktop(tester);

        TextButton button(String label) => tester.widget<TextButton>(
          find.ancestor(
            of: find.text(label),
            matching: find.byType(TextButton),
          ),
        );
        void expectPoliciesEnabled(bool enabled) {
          for (final label in ['Terms', 'Privacy']) {
            expect(
              button(label).onPressed,
              enabled ? isNotNull : isNull,
              reason: '$label during $phase',
            );
          }
        }

        expectPoliciesEnabled(true);
        for (final macCancel in [false, true]) {
          if (phase == 'acquisition') native.pending = Completer();
          exchange = Completer<http.Response>();
          await tester.ensureVisible(find.text('Continue with Google'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Continue with Google'));
          await tester.pump();
          await tester.pump();
          expect(exchanges, phase == 'exchange' ? (macCancel ? 2 : 1) : 0);
          expectPoliciesEnabled(false);
          expect(button('Pair with a Mac').onPressed, isNotNull);
          if (macCancel) {
            await tester.ensureVisible(find.text('Pair with a Mac'));
            await tester.pump();
            await tester.tap(find.text('Pair with a Mac'));
            await tester.pumpAndSettle();
            expect(find.byType(PairingPage), findsOneWidget);
            expect(find.byTooltip('Settings'), findsOneWidget);
            expect(find.text('Pair with Code'), findsOneWidget);
          }
          if (phase == 'acquisition') {
            native.pending!.complete(macCancel ? native.result : null);
          } else {
            exchange.complete(
              macCancel
                  ? http.Response('{"token":"cancelled-session"}', 200)
                  : http.Response('{"message":"Try again"}', 401),
            );
          }
          await tester.pumpAndSettle();
          expect(store.values['cloud.session'], isNull);
          if (macCancel) {
            expect(find.byType(PairingPage), findsOneWidget);
            expect(find.byTooltip('Settings'), findsOneWidget);
            expect(find.text('Pair with Code'), findsOneWidget);
            await tester.tap(find.byTooltip('Open navigation'));
            await tester.pumpAndSettle();
            await tester.tap(find.text('Cloud chat').hitTestable());
            await tester.pumpAndSettle();
          }
          expect(find.text('Welcome to DJL'), findsOneWidget);
          expectPoliciesEnabled(true);
        }
        expect(native.acquisitions, [
          SocialProvider.google,
          SocialProvider.google,
        ]);
        expect(exchanges, phase == 'exchange' ? 2 : 0);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }

  testWidgets(
    'root inactive shield holds provider result until actual foreground resume',
    (tester) async {
      final native = ControlledSocialIdentity()..pending = Completer();
      final store = TestCredentials();
      var exchanges = 0;
      final cloud = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: store,
        client: MockClient((request) async {
          final path = request.url.path;
          if (path == '/v1/client-config') {
            return http.Response('{"auth":{"google":true}}', 200);
          }
          if (path == '/v1/auth/sign-in/social') {
            exchanges++;
            return http.Response('{"token":"root-session"}', 200);
          }
          if (path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          if (path == '/v1/conversations') {
            return http.Response('{"conversations":[]}', 200);
          }
          return http.Response(
            '{"user":{"id":"qa"},"activeOrgId":"qa-org"}',
            200,
          );
        }),
      );
      await tester.pumpWidget(
        DjlApp(
          client: cloud,
          socialIdentity: native,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      await openCloudFromDesktop(tester);
      await tester.tap(find.text('Continue with Google'));
      await tester.pump();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      native.pending!.complete(native.result);
      await tester.pump();
      await tester.pump();
      expect(exchanges, 0);
      expect(store.values['cloud.session'], isNull);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(exchanges, 1);
      expect(store.values['cloud.session'], 'root-session');
      expect(native.acquisitions, [SocialProvider.google]);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('actual Mac navigation invalidates pending welcome acquisition', (
    tester,
  ) async {
    final native = ControlledSocialIdentity()..pending = Completer();
    final store = TestCredentials();
    var exchanges = 0;
    final cloud = CloudClient(
      baseUrl: Uri.parse('https://example.test'),
      credentials: store,
      client: MockClient((request) async {
        if (request.url.path == '/v1/auth/sign-in/social') exchanges++;
        return http.Response('{"auth":{"google":true}}', 200);
      }),
    );
    await tester.pumpWidget(
      DjlApp(
        client: cloud,
        socialIdentity: native,
        linkStream: const Stream.empty(),
        initialLink: Future.value(null),
      ),
    );
    await tester.pumpAndSettle();
    await openCloudFromDesktop(tester);
    await tester.tap(find.text('Continue with Google'));
    await tester.pump();
    await tester.ensureVisible(find.text('Pair with a Mac'));
    await tester.pump();
    await tester.tap(find.text('Pair with a Mac'));
    await tester.pumpAndSettle();
    native.pending!.complete(native.result);
    await tester.pumpAndSettle();
    expect(find.byType(PairingPage), findsOneWidget);
    expect(find.byTooltip('Settings'), findsOneWidget);
    expect(find.text('Pair with Code'), findsOneWidget);
    expect(exchanges, 0);
    expect(store.values['cloud.session'], isNull);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  for (final phase in ['acquisition', 'exchange', 'privacy deferred']) {
    testWidgets('desktop link cancels social sign-in during $phase', (
      tester,
    ) async {
      final native = ControlledSocialIdentity();
      if (phase != 'exchange') native.pending = Completer();
      final store = TestCredentials();
      final links = StreamController<Uri>.broadcast(sync: true);
      final exchange = Completer<http.Response>();
      var exchanges = 0;
      final cloud = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: store,
        client: MockClient((request) async {
          if (request.url.path == '/v1/client-config') {
            return http.Response('{"auth":{"google":true}}', 200);
          }
          if (request.url.path == '/v1/auth/sign-in/social') {
            exchanges++;
            return phase == 'exchange'
                ? exchange.future
                : http.Response('{"token":"late-session"}', 200);
          }
          if (request.url.path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          if (request.url.path == '/v1/conversations') {
            return http.Response('{"conversations":[]}', 200);
          }
          return http.Response(
            '{"user":{"id":"qa"},"activeOrgId":"qa-org"}',
            200,
          );
        }),
      );
      await tester.pumpWidget(
        DjlApp(
          client: cloud,
          socialIdentity: native,
          linkStream: links.stream,
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      await openCloudFromDesktop(tester);
      await tester.tap(find.text('Continue with Google'));
      await tester.pump();
      if (phase == 'exchange') {
        for (var i = 0; i < 8; i++) {
          await tester.pump(const Duration(milliseconds: 20));
        }
        expect(exchanges, 1);
      }
      if (phase == 'privacy deferred') {
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.inactive,
        );
        native.pending!.complete(native.result);
        await tester.pump();
        await tester.pump();
        expect(exchanges, 0);
      }
      links.add(Uri.parse('djl://thread/native-review-thread'));
      await tester.pump();
      expect(find.byType(PairingPage), findsOneWidget);
      expect(find.byTooltip('Settings'), findsOneWidget);
      expect(find.text('Pair with Code'), findsOneWidget);
      if (phase == 'exchange') {
        exchange.complete(http.Response('{"token":"late-session"}', 200));
      }
      if (phase == 'acquisition') native.pending!.complete(native.result);
      if (phase == 'privacy deferred') {
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
      }
      await tester.pumpAndSettle();
      final actual = {
        'exchanges': exchanges,
        'persisted': store.values['cloud.session'] != null,
        'pairing': find.byType(PairingPage).evaluate().length,
      };
      await tester.pumpWidget(const SizedBox.shrink());
      unawaited(links.close());
      expect(actual, {
        'exchanges': phase == 'exchange' ? 1 : 0,
        'persisted': false,
        'pairing': 1,
      });
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets(
    'Cloud conversation link preserves a current pending social sign-in',
    (tester) async {
      final native = ControlledSocialIdentity()..pending = Completer();
      final store = TestCredentials();
      final links = StreamController<Uri>.broadcast(sync: true);
      var exchanges = 0;
      final cloud = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: store,
        client: MockClient((request) async {
          final path = request.url.path;
          if (path == '/v1/client-config') {
            return http.Response('{"auth":{"google":true}}', 200);
          }
          if (path == '/v1/auth/sign-in/social') {
            exchanges++;
            return http.Response('{"token":"cloud-session"}', 200);
          }
          if (path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          if (path == '/v1/conversations') {
            return http.Response('{"conversations":[]}', 200);
          }
          if (path == '/v1/conversations/linked-cloud') {
            return http.Response(
              '{"conversation":{"id":"linked-cloud","title":"Linked cloud"},"messages":[]}',
              200,
            );
          }
          if (path == '/v1/models') return http.Response('{"models":[]}', 200);
          return http.Response(
            '{"user":{"id":"qa"},"activeOrgId":"qa-org"}',
            200,
          );
        }),
      );
      await tester.pumpWidget(
        DjlApp(
          client: cloud,
          socialIdentity: native,
          linkStream: links.stream,
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      await openCloudFromDesktop(tester);
      await tester.tap(find.text('Continue with Google'));
      await tester.pump();
      links.add(Uri.parse('djl://cloud/c/linked-cloud'));
      await tester.pump();
      native.pending!.complete(native.result);
      await tester.pumpAndSettle();
      expect(exchanges, 1);
      expect(store.values['cloud.session'], 'cloud-session');
      expect(
        tester
            .widget<ChatPage>(find.byType(ChatPage))
            .controller
            .conversation
            ?.id,
        'linked-cloud',
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      unawaited(links.close());
    },
  );

  testWidgets(
    'welcome options wait for secure startup and do not poll on resume',
    (tester) async {
      final store = StartupHeldCredentials();
      var configReads = 0;
      final cloud = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: store,
        client: MockClient((request) async {
          if (request.url.path == '/v1/client-config') configReads++;
          return http.Response('{"auth":{"google":true}}', 200);
        }),
      );
      await tester.pumpWidget(
        DjlApp(
          client: cloud,
          socialIdentity: ControlledSocialIdentity(),
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(configReads, 0);
      store.trusted.complete(null);
      await tester.pumpAndSettle();
      expect(configReads, 0);
      await openCloudFromDesktop(tester);
      expect(configReads, 1);
      expect(find.text('Continue with Google'), findsOneWidget);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pump();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(configReads, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
