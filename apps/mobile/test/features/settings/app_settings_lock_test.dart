import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import '../../core/cloud_client_test.dart' show TestCredentials;
import '../cloud_deep_links_test.dart' show client;
import 'settings_controller_test.dart' show MemorySettingsStore;
import 'app_lock_controller_test.dart' show FakeOwnerAuth;

String savedPair() => jsonEncode([
  {
    'v': 2,
    'sessionId': 'session',
    'macDeviceId': 'saved-mac',
    'macIdentityPublicKey': base64Encode(List.filled(32, 1)),
    'relay': 'wss://relay.example.test',
    'expiresAt': 1,
  },
]);

class DelayedTrustedCredentials extends TestCredentials {
  final restored = Completer<String?>();
  @override
  Future<String?> read(String key) =>
      key == 'desktop.trusted' ? restored.future : super.read(key);
}

void main() {
  testWidgets(
    'inactive startup resumes without requesting device authentication',
    (tester) async {
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
      });
      final credentials = TestCredentials()
        ..values['desktop.trusted'] = savedPair();
      final owner = FakeOwnerAuth()..result = false;
      final lock = AppLockController(owner);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          settings: SettingsController(MemorySettingsStore()),
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      expect(owner.calls, 0);
      expect(lock.requiresUnlock, isFalse);
      expect(lock.shielded, isTrue);
      expect(find.text('Unlock DJL'), findsNothing);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(owner.calls, 0);
      expect(lock.shielded, isFalse);
      expect(find.text('DJL is locked'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'cold Cloud link waits for secure restore without an app-authentication gate',
    (tester) async {
      final credentials = DelayedTrustedCredentials()
        ..values['cloud.session'] = 'session';
      final calls = <String>[];
      final owner = FakeOwnerAuth()..result = false;
      final lock = AppLockController(owner);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, calls),
          settings: SettingsController(MemorySettingsStore()),
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(Uri.parse('djl://cloud/c/protected-chat')),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Preparing DJL'), findsOneWidget);
      expect(find.textContaining('DJL is inactive'), findsNothing);
      expect(find.byType(ChatPage), findsNothing);
      expect(
        calls.where((v) => v.contains('/conversations/protected-chat')),
        isEmpty,
      );
      credentials.restored.complete(savedPair());
      await tester.pumpAndSettle();
      expect(owner.calls, 0);
      expect(find.text('Unlock DJL'), findsNothing);
      expect(find.byType(ChatPage), findsOneWidget);
      expect(
        tester
            .widget<ChatPage>(find.byType(ChatPage))
            .controller
            .conversation
            ?.id,
        'protected-chat',
      );
      expect(
        calls.where((v) => v == 'GET /v1/conversations/protected-chat'),
        hasLength(1),
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'preference read error shields and retry restores without replacing saved values',
    (tester) async {
      final store = MemorySettingsStore()..failRead = true;
      final settings = SettingsController(store);
      final lock = AppLockController(FakeOwnerAuth());
      await tester.pumpWidget(
        DjlApp(
          client: client(TestCredentials(), []),
          settings: settings,
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Retry startup'), findsOneWidget);
      expect(lock.ready, false);
      store.failRead = false;
      store.values['djl.appearance.mode'] = 'dark';
      await tester.tap(find.text('Retry startup'));
      await tester.pumpAndSettle();
      expect(find.text('Connect to DJL Desktop'), findsOneWidget);
      expect(find.text('Preparing DJL'), findsNothing);
      expect(
        Theme.of(
          tester.element(find.text('Connect to DJL Desktop')),
        ).brightness,
        Brightness.dark,
      );
      expect(tester.takeException(), isNull);
    },
  );
}
