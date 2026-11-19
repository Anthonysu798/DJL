import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/trusted_device_preferences_test.dart'
    show PreferenceCredentials, preferencePair;
import 'desktop_recovery_test.dart' show RecoveryMemoryStore;
import 'pairing_presentation_test.dart' show ObservedPairingTransport;

void main() {
  test(
    'local saves notify and preserve transport, navigation, raw identity and selected thread',
    () async {
      final store = PreferenceCredentials();
      final repository = PairingRepository(store);
      final a = preferencePair(), b = preferencePair(mac: 'b');
      store.values['desktop.trusted'] = jsonEncode([a.data, b.data]);
      final transport = ObservedPairingTransport(repository);
      final desktop = DesktopController(
        repository,
        connection: transport,
        localStore: RecoveryMemoryStore(),
      );
      await desktop.restore();
      desktop.active = a;
      desktop.thread = {'id': 'thread', 'name': 'Keep title'};
      final revision = desktop.selectionRevision,
          navigation = desktop.navigationRevision;
      final target = desktop.devicePreferences(a)!;
      final writes = store.writes;
      var notifications = 0;
      desktop.addListener(() => notifications++);
      expect(desktop.devicePreferencesReady, isTrue);
      expect(await desktop.setDeviceNickname(target, '  My desk  '), isTrue);
      expect(desktop.deviceName(a), 'My desk');
      expect(desktop.deviceName(b), 'Studio.local');
      expect(store.writes, writes + 1);
      expect(notifications, greaterThan(0));
      expect(desktop.selectionRevision, revision);
      expect(desktop.navigationRevision, navigation);
      expect(desktop.thread!['name'], 'Keep title');
      expect(desktop.active, same(a));
      expect(transport.attempts, 0);
      expect(transport.rpc, isEmpty);
      expect(transport.disconnects, 0);
      expect((await repository.trusted()).first.data, a.data);
      desktop.dispose();
    },
  );
  test(
    'captured editor keeps original host across selection and same-pin refresh',
    () async {
      final store = PreferenceCredentials();
      final repository = PairingRepository(store);
      final a = preferencePair(), b = preferencePair(mac: 'b');
      await repository.trust(a);
      await repository.trust(b);
      final desktop = DesktopController(
        repository,
        connection: ObservedPairingTransport(repository),
        localStore: RecoveryMemoryStore(),
      );
      await desktop.restore();
      final target = desktop.devicePreferences(a)!;
      desktop.active = b;
      await repository.trust(preferencePair(session: 'new'));
      expect(await desktop.setDeviceNickname(target, 'First'), isTrue);
      expect(desktop.deviceName(a), 'First');
      expect(desktop.deviceName(b), 'Studio.local');
      await repository.forget(a);
      await repository.trust(a);
      expect(await desktop.setDeviceNickname(target, 'Stale'), isFalse);
      expect(desktop.deviceName(a), 'Studio.local');
      expect(desktop.devicePreferencesError, isNotNull);
      desktop.dispose();
    },
  );
  test(
    'failed write keeps error, rereads persisted value, blocks writes after failed recovery until retry',
    () async {
      final store = PreferenceCredentials();
      final repository = PairingRepository(store);
      final pair = preferencePair();
      await repository.trust(pair);
      final desktop = DesktopController(
        repository,
        connection: ObservedPairingTransport(repository),
        localStore: RecoveryMemoryStore(),
      );
      await desktop.restore();
      final target = desktop.devicePreferences(pair)!;
      store.persistThenThrow = true;
      expect(await desktop.setDeviceNickname(target, 'Persisted'), isFalse);
      expect(desktop.deviceName(pair), 'Persisted');
      expect(desktop.devicePreferencesError, isNotNull);
      store.failRead = true;
      expect(await desktop.setDeviceNickname(target, 'Other'), isFalse);
      expect(desktop.devicePreferencesReady, isFalse);
      final writes = store.writes;
      expect(await desktop.setDeviceNickname(target, 'Blocked'), isFalse);
      expect(store.writes, writes);
      store.failRead = false;
      store.persistThenThrow = false;
      await desktop.loadDevicePreferences();
      expect(desktop.devicePreferencesReady, isTrue);
      expect(await desktop.setDeviceNickname(target, 'Recovered'), isTrue);
      desktop.dispose();
    },
  );
  test(
    'active exception leaves stored false dormant and stable menu order',
    () async {
      final repository = PairingRepository(PreferenceCredentials());
      final a = preferencePair(), b = preferencePair(mac: 'b');
      await repository.trust(a);
      await repository.trust(b);
      final desktop = DesktopController(
        repository,
        connection: ObservedPairingTransport(repository),
        localStore: RecoveryMemoryStore(),
      );
      await desktop.restore();
      desktop.active = b;
      expect(
        await desktop.setDeviceMenuVisibility(
          desktop.devicePreferences(a)!,
          false,
        ),
        isTrue,
      );
      expect(desktop.menuDevices.map((p) => p.macDeviceId), ['b']);
      desktop.active = a;
      expect(desktop.menuDevices.map((p) => p.macDeviceId), ['mac', 'b']);
      expect(
        await desktop.setDeviceMenuVisibility(
          desktop.devicePreferences(a)!,
          true,
        ),
        isFalse,
      );
      expect(desktop.devicePreferences(a)!.visibleInMenu, isFalse);
      desktop.active = null;
      expect(
        await desktop.setDeviceMenuVisibility(
          desktop.devicePreferences(b)!,
          false,
        ),
        isTrue,
      );
      expect(desktop.menuDevices, isEmpty);
      expect(desktop.trusted, hasLength(2));
      desktop.dispose();
    },
  );
  test(
    'completion after dispose never reports save success or notifies',
    () async {
      final store = PreferenceCredentials();
      final repository = PairingRepository(store);
      final pair = preferencePair();
      await repository.trust(pair);
      final desktop = DesktopController(
        repository,
        connection: ObservedPairingTransport(repository),
        localStore: RecoveryMemoryStore(),
      );
      await desktop.restore();
      final target = desktop.devicePreferences(pair)!;
      store.writeGate = Completer<void>();
      final saving = desktop.setDeviceNickname(target, 'Pending');
      await Future<void>.delayed(Duration.zero);
      desktop.dispose();
      store.writeGate!.complete();
      expect(await saving, isFalse);
    },
  );
  test(
    'ambiguous persisted write followed by failed read requires explicit recovery',
    () async {
      final store = PreferenceCredentials();
      final repository = PairingRepository(store);
      final pair = preferencePair();
      await repository.trust(pair);
      final desktop = DesktopController(
        repository,
        connection: ObservedPairingTransport(repository),
        localStore: RecoveryMemoryStore(),
      );
      await desktop.restore();
      final target = desktop.devicePreferences(pair)!;
      store.persistThenThrow = true;
      store.failRecoveryRead = true;
      expect(await desktop.setDeviceNickname(target, 'Written'), isFalse);
      expect(desktop.devicePreferencesReady, isFalse);
      expect(
        jsonDecode(
          store.values['desktop.trusted']!,
        ).single['preferences']['nickname'],
        'Written',
      );
      final writes = store.writes;
      expect(await desktop.setDeviceNickname(target, 'Blocked'), isFalse);
      expect(store.writes, writes);
      store.failRead = false;
      store.persistThenThrow = false;
      await desktop.loadDevicePreferences();
      expect(desktop.deviceName(pair), 'Written');
      expect(store.reads.any((key) => key.startsWith('cloud.')), isFalse);
      desktop.dispose();
    },
  );
  test(
    'malformed preferences do not block restored trust and transport recovery',
    () async {
      final store = PreferenceCredentials();
      final pair = preferencePair();
      store.values['desktop.trusted'] = jsonEncode([
        {
          'djlTrustedEntry': 1,
          'trustId': 'id',
          'pairing': pair.data,
          'preferences': {'nickname': 8},
        },
      ]);
      store.values['desktop.active'] = pair.macDeviceId;
      final repository = PairingRepository(store);
      final desktop = DesktopController(
        repository,
        connection: ObservedPairingTransport(repository),
        localStore: RecoveryMemoryStore(),
      );
      await desktop.restore();
      expect(desktop.active!.publicKey, pair.publicKey);
      expect(desktop.trusted, hasLength(1));
      expect(desktop.devicePreferencesReady, isFalse);
      expect(desktop.devicePreferencesError, isNotNull);
      expect(desktop.error, isNull);
      expect(store.writes, 0);
      await repository.trust(preferencePair(session: 'refreshed'));
      expect((await repository.trusted()).single.sessionId, 'refreshed');
      desktop.dispose();
    },
  );
  test(
    'stale forget cannot disconnect or clear selected same-Mac replacement pin',
    () async {
      final store = PreferenceCredentials();
      final repository = PairingRepository(store);
      final old = preferencePair(), replacement = preferencePair(pin: 2);
      await repository.trust(replacement);
      final transport = ObservedPairingTransport(repository);
      final desktop = DesktopController(
        repository,
        connection: transport,
        localStore: RecoveryMemoryStore(),
      );
      await desktop.restore();
      await desktop.forget(old);
      expect(transport.disconnects, 0);
      expect(desktop.active!.publicKey, replacement.publicKey);
      expect(
        (await repository.trusted()).single.publicKey,
        replacement.publicKey,
      );
      desktop.dispose();
    },
  );
}
