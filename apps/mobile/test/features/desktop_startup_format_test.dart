import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'cloud_deep_links_test.dart' show client;
import 'desktop_root_routing_test.dart' show RoutingDesktop, savedPair;
import 'desktop_subagents_test.dart' show SubagentTransport;
import 'settings/app_lock_controller_test.dart' show FakeOwnerAuth;
import 'settings/settings_controller_test.dart' show MemorySettingsStore;

const _formatMessage =
    'Saved desktop connection details could not be read. Your saved connections have been kept.';

class StartupCredentials extends TestCredentials {
  final writtenKeys = <String>[];
  @override
  Future<void> write(String key, String? value) async {
    writtenKeys.add(key);
    await super.write(key, value);
  }
}

class TransientFormatPairings extends PairingRepository {
  TransientFormatPairings(super.credentials);
  bool failRead = true;
  @override
  Future<List<Pairing>> trusted() async {
    if (failRead) throw const FormatException('Synthetic unreadable data');
    return super.trusted();
  }
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
    'a rejected saved local relay reports unreadable data and retains its values',
    (tester) async {
      final pair = savedPair('mac-format128');
      final credentials = StartupCredentials()
        ..values['desktop.trusted'] = jsonEncode([
          {...pair.data, 'relay': 'ws://127.0.0.1:8884/relay'},
        ])
        ..values['desktop.active'] = pair.macDeviceId;
      final original = Map<String, String>.of(credentials.values);
      final transport = SubagentTransport()..online = false;
      final desktop = RoutingDesktop(
        transport,
        repository: PairingRepository(credentials),
      )..connects = false;
      final owner = FakeOwnerAuth();
      final lock = AppLockController(owner);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          settings: SettingsController(MemorySettingsStore()),
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text(_formatMessage), findsOneWidget);
      expect(find.text('Could not start DJL'), findsOneWidget);
      expect(find.textContaining('DJL is inactive'), findsNothing);
      expect(find.textContaining('Unlock your device'), findsNothing);
      expect(find.text('Retry startup'), findsOneWidget);
      expect(owner.calls, 0);
      expect(desktop.connections, 0);
      expect(transport.calls, isEmpty);
      expect(credentials.values, original);
      expect(credentials.writtenKeys, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      lock.dispose();
    },
  );

  testWidgets(
    'format recovery retry retains the original saved selection without app authentication',
    (tester) async {
      final pair = savedPair('mac-format128');
      final credentials = StartupCredentials()
        ..values['desktop.trusted'] = jsonEncode([pair.data])
        ..values['desktop.active'] = pair.macDeviceId;
      final original = Map<String, String>.of(credentials.values);
      final repository = TransientFormatPairings(credentials);
      final transport = SubagentTransport()..online = false;
      final desktop = RoutingDesktop(transport, repository: repository)
        ..connects = false;
      final owner = FakeOwnerAuth()..result = false;
      final lock = AppLockController(owner);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          desktop: desktop,
          settings: SettingsController(MemorySettingsStore()),
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      final root = tester.state(find.byType(DjlApp));
      expect(find.text(_formatMessage), findsOneWidget);
      expect(credentials.values, original);
      expect(credentials.writtenKeys, isEmpty);
      repository.failRead = false;
      await tester.tap(find.text('Retry startup'));
      await tester.pumpAndSettle();
      expect(tester.state(find.byType(DjlApp)), same(root));
      expect(find.byType(PairingPage), findsOneWidget);
      expect(find.text('Preparing DJL'), findsNothing);
      expect(find.text('Unlock DJL'), findsNothing);
      expect(desktop.active?.macDeviceId, pair.macDeviceId);
      expect(credentials.values, original);
      expect(owner.calls, 0);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      lock.dispose();
    },
  );
}
