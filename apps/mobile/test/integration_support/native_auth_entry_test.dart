import 'package:djl_mobile/features/settings/presentation/cloud_settings_page.dart';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/auth/presentation/auth_page.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controls.dart';
import '../../integration_test/cloud_test.dart'
    show
        nativeAuthInput,
        nativeCloudEntry,
        nativePasswordSignIn,
        nativeSettings;
import '../../integration_test/support/native_acceptance.dart';
import '../../integration_test/threads_test.dart' show reveal;
import '../core/cloud_client_test.dart' show TestCredentials;
import '../features/auth_fidelity_test.dart' show AuthFixture, mountAuth;
import '../features/desktop_activity_test.dart' show ActivityCacheStore;
import '../features/desktop_offline_test.dart' show savedPair;
import '../features/desktop_recovery_test.dart' show RecoveringTransport;
import '../features/settings/app_lock_controller_test.dart' show FakeOwnerAuth;
import '../features/settings/settings_controller_test.dart'
    show MemorySettingsStore;
import 'native_send_composer_test.dart' show NativeInputBinding;

const _email = 'native-entry@example.test';
const _password = 'PUBLIC QA PASSWORD FIXTURE';

class _RootFixture {
  _RootFixture({MemorySettingsStore? store})
    : store = store ?? MemorySettingsStore();
  final MemorySettingsStore store;
  final credentials = TestCredentials(), owner = FakeOwnerAuth();
  final requests = <http.Request>[];
  DesktopController? desktop;
  late final settings = SettingsController(store);
  late final lock = AppLockController(owner);
  late final recorder = ConversationRequestRecorder(
    MockClient((request) async {
      requests.add(request);
      final path = request.url.path;
      final Object body = switch (path) {
        '/v1/auth/sign-in/email' => {'token': 'test-session'},
        '/v1/auth/token' => {'token': 'test-jwt'},
        '/v1/me' => {
          'user': {'id': 'qa-user'},
          'activeOrgId': 'qa-org',
        },
        '/v1/models' => {'models': []},
        '/v1/conversations' => {'conversations': []},
        _ when path.startsWith('/v1/conversations/') => {
          'conversation': {
            'id': request.url.pathSegments.last,
            'title': 'QA link',
          },
          'messages': [],
        },
        _ => {},
      };
      return http.Response(jsonEncode(body), 200);
    }),
  );
  late final cloud = CloudClient(
    baseUrl: Uri.parse('https://example.test'),
    credentials: credentials,
    client: recorder,
  );

  Future<void> cacheMac() async {
    final pairings = PairingRepository(credentials);
    await pairings.trust(savedPair());
    final transport = RecoveringTransport(pairings)
      ..failure = StateError('Offline public host fixture');
    desktop = DesktopController(
      pairings,
      connection: transport,
      localStore: ActivityCacheStore(),
    );
  }

  Future<void> mount(WidgetTester tester, {Uri? link}) async {
    await tester.pumpWidget(
      DjlApp(
        client: cloud,
        settings: settings,
        appLock: lock,
        desktop: desktop,
        linkStream: const Stream.empty(),
        initialLink: Future.value(link),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> dispose(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    desktop?.dispose();
    settings.dispose();
    lock.dispose();
  }
}

void main() {
  NativeInputBinding();
  WidgetController.hitTestWarningShouldBeFatal = true;
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
    'native password setup explicitly selects the actual code-default form method',
    (tester) async {
      final fixture = AuthFixture()..responses.add(http.Response('{}', 401));
      await mountAuth(tester, fixture);
      addTearDown(fixture.auth.dispose);
      addTearDown(fixture.cloud.close);
      final primary = find.byKey(const Key('auth_primary'));
      expect(find.byKey(const Key('password')), findsNothing);
      expect(
        find.descendant(of: primary, matching: find.text('Email me a code')),
        findsOneWidget,
      );
      await nativePasswordSignIn(tester, email: _email, password: _password);
      expect(find.byType(AuthPage), findsOneWidget);
      expect(find.byKey(const Key('password')), findsOneWidget);
      expect(
        find.descendant(of: primary, matching: find.text('Sign in')),
        findsOneWidget,
      );
      final request = fixture.requests.singleWhere(
        (r) => r.url.path == '/v1/auth/sign-in/email',
      );
      final body = jsonDecode(request.body) as Map;
      expect(body['email'], _email);
      expect(body['password'] == _password, isTrue);
      expect(
        fixture.requests.where((r) => r.url.path.contains('email-otp')),
        isEmpty,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'native auth input refocuses the same real password editable after unfocus',
    (tester) async {
      final fixture = AuthFixture()..responses.add(http.Response('{}', 401));
      await mountAuth(tester, fixture);
      addTearDown(fixture.auth.dispose);
      addTearDown(fixture.cloud.close);
      await nativePasswordSignIn(tester, email: _email, password: _password);
      final field = find.byKey(const Key('password'));
      final editable = tester.state<EditableTextState>(
        find.descendant(of: field, matching: find.byType(EditableText)),
      );
      expect(editable.widget.focusNode.hasFocus, isFalse);
      expect(tester.binding.focusedEditable, same(editable));
      await nativeAuthInput(tester, field, 'PUBLIC FIRST INPUT');
      await nativeAuthInput(tester, field, 'PUBLIC SECOND INPUT');
      expect(
        tester.state<EditableTextState>(
          find.descendant(of: field, matching: find.byType(EditableText)),
        ),
        same(editable),
      );
      expect(
        tester.widget<TextField>(field).controller!.text ==
            'PUBLIC SECOND INPUT',
        isTrue,
      );
      expect(editable.widget.focusNode.hasFocus, isFalse);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'native auth input mismatch cannot expose the supplied password in its assertion',
    (tester) async {
      const canary = 'PUBLIC ASSERTION REDACTION CANARY';
      final text = TextEditingController();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: TextField(
              key: const Key('password'),
              controller: text,
              obscureText: true,
              inputFormatters: [FilteringTextInputFormatter.deny(RegExp('.'))],
            ),
          ),
        ),
      );
      try {
        Object? failure;
        try {
          await nativeAuthInput(
            tester,
            find.byKey(const Key('password')),
            canary,
          );
        } catch (error) {
          failure = error;
        }
        expect(failure, isA<TestFailure>());
        expect(failure.toString().contains(canary), isFalse);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        text.dispose();
      }
    },
  );

  testWidgets(
    'native password setup refuses a disabled primary without an auth request',
    (tester) async {
      final fixture = AuthFixture();
      await mountAuth(tester, fixture);
      addTearDown(fixture.auth.dispose);
      addTearDown(fixture.cloud.close);
      await tester.tap(find.text('Password'));
      await tester.pumpAndSettle();
      expect(find.text('Password'), findsNWidgets(2));
      Object? failure;
      try {
        await nativePasswordSignIn(
          tester,
          email: 'invalid',
          password: _password,
        );
      } catch (error) {
        failure = error;
      }
      expect(failure, isNotNull);
      expect(fixture.requests, isEmpty);
      expect(
        tester
                .widget<TextField>(find.byKey(const Key('password')))
                .controller!
                .text ==
            _password,
        isTrue,
      );
      expect(
        tester
            .widget<TextButton>(find.byKey(const Key('auth_primary')))
            .onPressed,
        isNull,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'native password setup refuses another auth flow without submitting it',
    (tester) async {
      final fixture = AuthFixture();
      await mountAuth(tester, fixture);
      addTearDown(fixture.auth.dispose);
      addTearDown(fixture.cloud.close);
      await tester.tap(find.text('Create account'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('name')), findsOneWidget);
      Object? failure;
      try {
        await nativePasswordSignIn(tester, email: _email, password: _password);
      } catch (error) {
        failure = error;
      }
      expect(failure, isNotNull);
      expect(fixture.requests, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'native password setup fails hard on missing real auth controls',
    (tester) async {
      await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: Text('Password'))),
      );
      Object? failure;
      try {
        await nativePasswordSignIn(tester, email: _email, password: _password);
      } catch (error) {
        failure = error;
      }
      expect(failure, isNotNull);
      expect(tester.takeException(), isNull);
    },
  );

  for (final entry in ['Welcome', 'Cloud', 'cached Mac', 'locked cached Mac']) {
    testWidgets(
      'native Settings entry preserves the actual $entry root semantics',
      (tester) async {
        final fixture = _RootFixture();
        if (entry == 'Cloud') {
          fixture.credentials.values['cloud.session'] = 'existing-session';
        }
        if (entry.contains('Mac')) await fixture.cacheMac();
        if (entry == 'locked cached Mac') fixture.owner.result = false;
        await fixture.mount(tester);
        try {
          if (entry == 'Cloud' || entry == 'Welcome') {
            await nativeCloudEntry(tester);
          }
          if (entry == 'Welcome') {
            expect(find.text('Welcome to DJL'), findsOneWidget);
            expect(find.byTooltip('Settings'), findsNothing);
          }
          if (entry == 'locked cached Mac') {
            expect(fixture.lock.shielded, isFalse);
            expect(fixture.owner.calls, 0);
            expect(find.text('Unlock DJL'), findsNothing);
          }
          final revision = fixture.cloud.revision;
          await nativeSettings(tester);
          expect(
            find.byType(
              entry == 'Cloud' ? CloudSettingsPage : SettingsControls,
            ),
            findsOneWidget,
          );
          expect(fixture.cloud.revision, revision);
          if (entry == 'Cloud') {
            expect(
              fixture.credentials.values['cloud.session'],
              'existing-session',
            );
          }
          if (entry.contains('Mac')) {
            expect(fixture.requests, isEmpty);
            expect(
              fixture.desktop!.active!.macDeviceId,
              savedPair().macDeviceId,
            );
            expect(fixture.desktop!.active!.publicKey, savedPair().publicKey);
          }
          if (entry == 'Welcome') {
            expect(
              find.byType(PairingPage, skipOffstage: false),
              findsOneWidget,
            );
          }
          expect(fixture.recorder.conversationMutationAttempts, 0);
          expect(tester.takeException(), isNull);
        } finally {
          await fixture.dispose(tester);
        }
      },
    );
  }

  testWidgets(
    'native Cloud setup switches a signed-out saved Mac through the real Cloud action',
    (tester) async {
      final fixture = _RootFixture();
      await fixture.cacheMac();
      await fixture.mount(tester);
      try {
        expect(find.byType(PairingPage), findsOneWidget);
        expect(find.text('Continue with email'), findsNothing);
        await nativeCloudEntry(tester);
        expect(find.text('Welcome to DJL'), findsOneWidget);
        await nativePasswordSignIn(tester, email: _email, password: _password);
        await tester.pumpAndSettle();
        expect(find.byType(ChatPage), findsOneWidget);
        expect(
          tester
              .widget<ChatPage>(find.byType(ChatPage))
              .controller
              .conversation,
          isNull,
        );
        expect(fixture.desktop!.active!.macDeviceId, savedPair().macDeviceId);
        expect(fixture.desktop!.active!.publicKey, savedPair().publicKey);
        expect(fixture.recorder.conversationMutationAttempts, 0);
        expect(tester.takeException(), isNull);
      } finally {
        await fixture.dispose(tester);
      }
    },
  );

  testWidgets(
    'native links setup opens the queued exact conversation with no sends',
    (tester) async {
      final fixture = _RootFixture();
      await fixture.mount(tester, link: Uri.parse('djl://cloud/c/native-cold'));
      try {
        await nativeCloudEntry(tester);
        await nativePasswordSignIn(tester, email: _email, password: _password);
        await tester.pumpAndSettle();
        final chat = tester.widget<ChatPage>(find.byType(ChatPage)).controller;
        expect(chat.conversation!.id, 'native-cold');
        expect(identical(chat.repository.client, fixture.cloud), isTrue);
        expect(chat.messages, isEmpty);
        expect(fixture.recorder.conversationMutationAttempts, 0);
        expect(tester.takeException(), isNull);
      } finally {
        await fixture.dispose(tester);
      }
    },
  );

  testWidgets(
    'native Settings write and recreated-root restore use the actual supported entry',
    (tester) async {
      final store = MemorySettingsStore();
      await establishNativeSettingsBaseline(store);
      final first = _RootFixture(store: store);
      await first.mount(tester);
      try {
        await nativeSettings(tester);
        await reveal(tester, find.byKey(const Key('theme-setting')));
        await tester.tap(find.byKey(const Key('theme-setting')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Dark').last);
        await tester.pumpAndSettle();
        await reveal(tester, find.byKey(const Key('font-setting')));
        await tester.tap(find.byKey(const Key('font-setting')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Geist Mono').last);
        await tester.pumpAndSettle();
        expect(find.text('App lock'), findsNothing);
        await verifyNativeSettings(store, nativeSettingsTarget);
      } finally {
        await first.dispose(tester);
      }
      final restored = _RootFixture(store: store);
      await restored.mount(tester);
      try {
        await nativeSettings(tester);
        final controls = tester.widget<SettingsControls>(
          find.byType(SettingsControls),
        );
        expect(controls.controller.theme, ThemeMode.dark);
        expect(controls.controller.font, AppFontStyle.geistMono);
        expect(find.text('App lock'), findsNothing);
        expect(restored.owner.calls, 0);
        await verifyNativeSettings(store, nativeSettingsTarget);
        expect(tester.takeException(), isNull);
      } finally {
        await restored.dispose(tester);
      }
    },
  );
}
