import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
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
