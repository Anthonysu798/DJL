import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controls.dart';
import '../../core/cloud_client_test.dart' show TestCredentials;
import '../cloud_deep_links_test.dart' show client;
import '../desktop_root_routing_test.dart' show RoutingDesktop, savedPair;
import '../desktop_subagents_test.dart' show SubagentTransport;
import 'app_lock_controller_test.dart' show FakeOwnerAuth;
import 'settings_controller_test.dart' show MemorySettingsStore;

void main() {
  testWidgets(
    'saved sessions open directly even when the previous app-lock preference is enabled',
    (tester) async {
      final credentials = TestCredentials(), pair = savedPair('mac-a');
      final trusted = jsonEncode([pair.data]);
      credentials.values['desktop.trusted'] = trusted;
      credentials.values['desktop.active'] = 'mac-a';
      final remote = SubagentTransport()..online = false;
      final desktop = RoutingDesktop(
        remote,
        repository: PairingRepository(credentials),
      );
      final store = MemorySettingsStore()
        ..values[SettingsController.lockKey] = true;
      final settings = SettingsController(store);
      final owner = FakeOwnerAuth()..result = false;
      var now = DateTime.utc(2026);
      final lock = AppLockController(owner, now: () => now);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          settings: settings,
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      expect(owner.calls, 0);
      expect(lock.requiresUnlock, isFalse);
      expect(lock.shielded, isFalse);
      expect(find.text('DJL is locked'), findsNothing);
      expect(find.text('Unlock DJL'), findsNothing);
      expect(desktop.connections, 1);
      for (final state in [
        AppLifecycleState.inactive,
        AppLifecycleState.hidden,
        AppLifecycleState.paused,
      ]) {
        tester.binding.handleAppLifecycleStateChanged(state);
      }
      await tester.pump();
      now = now.add(const Duration(hours: 1));
      for (final state in [
        AppLifecycleState.hidden,
        AppLifecycleState.inactive,
        AppLifecycleState.resumed,
      ]) {
        tester.binding.handleAppLifecycleStateChanged(state);
      }
      await tester.pumpAndSettle();
      expect(owner.calls, 0);
      expect(lock.requiresUnlock, isFalse);
      expect(lock.shielded, isFalse);
      expect(credentials.values['desktop.trusted'], trusted);
      expect(credentials.values['desktop.active'], 'mac-a');
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
      settings.dispose();
      lock.dispose();
    },
  );

  group('builds without DJL Cloud sign-in', () {
    Future<StreamController<Uri>> mountRemoteOnly(WidgetTester tester) async {
      final links = StreamController<Uri>();
      final settings = SettingsController(MemorySettingsStore());
      final lock = AppLockController(FakeOwnerAuth());
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        await links.close();
        settings.dispose();
        lock.dispose();
      });
      await tester.pumpWidget(
        DjlApp(
          client: client(TestCredentials(), []),
          settings: settings,
          appLock: lock,
          linkStream: links.stream,
          initialLink: Future.value(null),
          cloudAccounts: false,
        ),
      );
      await tester.pumpAndSettle();
      return links;
    }

    testWidgets('pairing, the menu and Settings never offer DJL Cloud', (
      tester,
    ) async {
      await mountRemoteOnly(tester);
      expect(find.byType(PairingPage), findsOneWidget);
      expect(find.byKey(const Key('pairing.getDesktop')), findsOneWidget);
      expect(find.text('DJL Cloud'), findsNothing);
      if (find.byTooltip('Settings').evaluate().isEmpty) {
        await tester.tap(find.byTooltip('Open navigation'));
        await tester.pumpAndSettle();
        expect(find.text('Cloud chat'), findsNothing);
      }
      await tester.tap(find.byTooltip('Settings'));
      await tester.pumpAndSettle();
      expect(find.text('Appearance'), findsOneWidget);
      expect(find.text('DJL Cloud'), findsNothing);
      expect(find.text('Sign in to DJL Cloud'), findsNothing);
    });

    testWidgets('a Cloud chat link does not open sign-in', (tester) async {
      final links = await mountRemoteOnly(tester);
      links.add(Uri.parse('djl://cloud/c/conversation-1'));
      await tester.pumpAndSettle();
      expect(find.byType(PairingPage), findsOneWidget);
      expect(find.text('Welcome to DJL'), findsNothing);
      expect(find.text('Continue with email'), findsNothing);
    });
  });

  testWidgets('settings no longer offer app-lock or biometric authentication', (
    tester,
  ) async {
    final settings = SettingsController(MemorySettingsStore());
    await settings.load();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SettingsControls(controller: settings),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('App lock'), findsNothing);
    expect(find.text('Security'), findsNothing);
    expect(find.textContaining('Require Face ID'), findsNothing);
    expect(find.text('Appearance'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    settings.dispose();
  });
}
