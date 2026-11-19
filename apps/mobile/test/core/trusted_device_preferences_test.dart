import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/core/security/remote_crypto.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'cloud_client_test.dart' show TestCredentials;

Pairing preferencePair({
  String mac = 'mac',
  int pin = 1,
  String session = 's',
}) => Pairing({
  'v': 2,
  'relay': 'wss://relay.example/relay',
  'sessionId': session,
  'macDeviceId': mac,
  'macIdentityPublicKey': base64Encode(List.filled(32, pin)),
  'expiresAt': 1,
  'displayName': 'Studio.local',
});

class PreferenceCredentials extends TestCredentials {
  int writes = 0;
  bool failRead = false, failWrite = false, persistThenThrow = false;
  bool failRecoveryRead = false;
  final reads = <String>[];
  String? failKey;
  Completer<void>? writeGate;
  @override
  Future<String?> read(String key) async {
    reads.add(key);
    if (key == 'desktop.trusted' && failRead) {
      throw StateError('Read unavailable');
    }
    return super.read(key);
  }

  @override
  Future<void> write(String key, String? value) async {
    writes++;
    if (key == 'desktop.trusted') {
      await writeGate?.future;
      if (failWrite) throw StateError('Write unavailable');
    }
    if (key == failKey) throw StateError('Cleanup unavailable');
    await super.write(key, value);
    if (key == 'desktop.trusted' && persistThenThrow) {
      if (failRecoveryRead) failRead = true;
      throw StateError('Write result uncertain');
    }
  }
}

class ActiveWriteCredentials extends TestCredentials {
  Completer<void>? activeGate;
  bool persistThenThrow = false, failRecovery = false;
  int writes = 0;
  @override
  Future<String?> read(String key) async {
    if (failRecovery && key == 'desktop.active') {
      throw StateError('Active read unavailable');
    }
    return super.read(key);
  }

  @override
  Future<void> write(String key, String? value) async {
    writes++;
    if (key == 'desktop.active') await activeGate?.future;
    await super.write(key, value);
    if (key == 'desktop.active' && persistThenThrow) {
      throw StateError('Active write uncertain');
    }
  }
}

void main() {
  test(
    'cancelled trusted completion cannot restore active after serialized cleanup',
    () async {
      final store = ActiveWriteCredentials();
      final pairs = PairingRepository(store);
      await pairs.trust(preferencePair());
      store.activeGate = Completer<void>();
      final trust = pairs.trust(preferencePair(session: 'next'));
      for (var i = 0; i < 5; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      final clear = pairs.clearActive();
      store.activeGate!.complete();
      await trust;
      await clear;
      expect(store.values['desktop.active'], isNull);
      expect((await pairs.trusted()).single.sessionId, 'next');
    },
  );
  test(
    'uncertain active write requires authoritative read before another write',
    () async {
      final store = ActiveWriteCredentials(), pair = preferencePair();
      final pairs = PairingRepository(store);
      await pairs.trust(pair);
      store.persistThenThrow = true;
      await expectLater(
        pairs.trust(preferencePair(session: 'next')),
        throwsStateError,
      );
      store.failRecovery = true;
      store.persistThenThrow = false;
      final writes = store.writes;
      await expectLater(
        pairs.clearActive(),
        throwsA(isA<RemoteSecurityException>()),
      );
      await expectLater(
        pairs.trust(pair),
        throwsA(isA<RemoteSecurityException>()),
      );
      expect(store.writes, writes);
      store.failRecovery = false;
      await pairs.clearActive();
      expect(store.values['desktop.active'], isNull);
    },
  );
  test(
    'saved transport trust rejects forgotten and re-paired lifetime',
    () async {
      final pairs = PairingRepository(ActiveWriteCredentials());
      final pair = preferencePair();
      await pairs.trust(pair);
      final target = (await pairs.trustedEntries()).single;
      await pairs.forget(pair);
      await pairs.trust(pair);
      await expectLater(
        pairs.trust(preferencePair(session: 'old'), expected: target),
        throwsA(isA<Exception>()),
      );
      expect((await pairs.trusted()).single.sessionId, 's');
    },
  );

  test(
    'trusted reads local envelope but exposes only original pairing payload',
    () async {
      final store = PreferenceCredentials();
      final pair = preferencePair();
      store.values['desktop.trusted'] = jsonEncode([
        {
          'djlTrustedEntry': 1,
          'trustId': 'incarnation',
          'pairing': pair.data,
          'preferences': {'nickname': 'Desk', 'visibleInMenu': false},
        },
      ]);
      final before = store.values['desktop.trusted'];
      final repository = PairingRepository(store);
      expect((await repository.trusted()).single.data, pair.data);
      expect(store.values['desktop.trusted'], before);
      expect(store.writes, 0);
    },
  );
  test(
    'legacy defaults are read without writes; save trims and never edits pairing',
    () async {
      final store = PreferenceCredentials();
      final pair = preferencePair();
      store.values['desktop.trusted'] = jsonEncode([pair.data]);
      final before = store.values['desktop.trusted'];
      final repository = PairingRepository(store);
      final target = (await repository.trustedEntries()).single;
      expect(target.nickname, '');
      expect(target.visibleInMenu, isTrue);
      expect(store.values['desktop.trusted'], before);
      expect(store.writes, 0);
      await repository.updateDevicePreferences(
        target,
        nickname: '  Desk \n',
        visibleInMenu: false,
      );
      final saved = (await repository.trustedEntries()).single;
      expect(saved.nickname, 'Desk');
      expect(saved.visibleInMenu, isFalse);
      expect((await repository.trusted()).single.data, pair.data);
      expect(pair.data.containsKey('preferences'), isFalse);
      await repository.updateDevicePreferences(target, nickname: ' \n ');
      expect((await repository.trustedEntries()).single.nickname, '');
    },
  );
  test(
    'same pin refresh preserves prefs; other Mac and changed pin get defaults',
    () async {
      final repository = PairingRepository(PreferenceCredentials());
      final pair = preferencePair();
      await repository.trust(pair);
      final target = (await repository.trustedEntries()).single;
      await repository.updateDevicePreferences(
        target,
        nickname: 'Desk',
        visibleInMenu: false,
      );
      await repository.trust(preferencePair(session: 'refreshed'));
      var saved = (await repository.trustedEntries()).single;
      expect(saved.nickname, 'Desk');
      expect(saved.visibleInMenu, isFalse);
      expect(saved.trustId, target.trustId);
      expect(saved.pairing.sessionId, 'refreshed');
      await repository.trust(preferencePair(mac: 'other'));
      expect((await repository.trustedEntries()).last.nickname, '');
      await repository.trust(preferencePair(pin: 2));
      saved = (await repository.trustedEntries()).last;
      expect(saved.nickname, '');
      expect(saved.visibleInMenu, isTrue);
      await expectLater(
        repository.updateDevicePreferences(target, nickname: 'Stale'),
        throwsStateError,
      );
      await repository.forget(pair); // Stale pin cannot remove its replacement.
      expect((await repository.trusted()).length, 2);
    },
  );
  test(
    'forget and re-pair rejects old editor even with identical Mac and pin',
    () async {
      final repository = PairingRepository(PreferenceCredentials());
      final pair = preferencePair();
      await repository.trust(pair);
      final old = (await repository.trustedEntries()).single;
      await repository.updateDevicePreferences(old, nickname: 'Old');
      await repository.forget(pair);
      await repository.trust(pair);
      await expectLater(
        repository.updateDevicePreferences(old, nickname: 'Resurrected'),
        throwsStateError,
      );
      expect((await repository.trustedEntries()).single.nickname, '');
    },
  );
  for (final cleanup in ['desktop.cursor.mac', 'desktop.active']) {
    test(
      'later $cleanup failure cannot revive preferences after row deletion',
      () async {
        final store = PreferenceCredentials();
        final repository = PairingRepository(store);
        final pair = preferencePair();
        await repository.trust(pair);
        final old = (await repository.trustedEntries()).single;
        await repository.updateDevicePreferences(
          old,
          nickname: 'Old',
          visibleInMenu: false,
        );
        store.failKey = cleanup;
        await expectLater(repository.forget(pair), throwsStateError);
        expect(await repository.trusted(), isEmpty);
        store.failKey = null;
        await repository.trust(pair);
        final saved = (await repository.trustedEntries()).single;
        expect(saved.nickname, '');
        expect(saved.visibleInMenu, isTrue);
        await expectLater(
          repository.updateDevicePreferences(old, nickname: 'Stale'),
          throwsStateError,
        );
      },
    );
  }
  test(
    'queued rename, forget, trust and stale rename cannot resurrect metadata',
    () async {
      final store = PreferenceCredentials();
      final repository = PairingRepository(store);
      final pair = preferencePair();
      await repository.trust(pair);
      final old = (await repository.trustedEntries()).single;
      store.writeGate = Completer<void>();
      final first = repository.updateDevicePreferences(old, nickname: 'First');
      final forget = repository.forget(pair), trust = repository.trust(pair);
      final stale = expectLater(
        repository.updateDevicePreferences(old, nickname: 'Stale'),
        throwsStateError,
      );
      store.writeGate!.complete();
      await Future.wait([first, forget, trust, stale]);
      expect((await repository.trustedEntries()).single.nickname, '');
    },
  );
  test(
    'malformed local metadata is an error while raw trust stays recoverable',
    () async {
      final store = PreferenceCredentials();
      final repository = PairingRepository(store);
      final pair = preferencePair();
      store.values['desktop.trusted'] = jsonEncode([
        {
          'djlTrustedEntry': 1,
          'pairing': pair.data,
          'trustId': 'id',
          'preferences': {'nickname': 7},
        },
      ]);
      await expectLater(repository.trustedEntries(), throwsFormatException);
      expect((await repository.trusted()).single.data, pair.data);
      expect(store.writes, 0);
      await repository.trust(preferencePair(session: 'recover'));
      expect((await repository.trusted()).single.sessionId, 'recover');
      await expectLater(repository.trustedEntries(), throwsFormatException);
      await repository.forget(pair);
      expect(await repository.trusted(), isEmpty);
      store.failRead = true;
      await expectLater(repository.trustedEntries(), throwsStateError);
    },
  );
  test(
    'failed and ambiguous writes expose authoritative persisted outcome on reread',
    () async {
      final store = PreferenceCredentials();
      final repository = PairingRepository(store);
      await repository.trust(preferencePair());
      final target = (await repository.trustedEntries()).single;
      store.failWrite = true;
      await expectLater(
        repository.updateDevicePreferences(target, nickname: 'No'),
        throwsStateError,
      );
      expect((await repository.trustedEntries()).single.nickname, '');
      store.failWrite = false;
      store.persistThenThrow = true;
      await expectLater(
        repository.updateDevicePreferences(target, nickname: 'Yes'),
        throwsStateError,
      );
      expect((await repository.trustedEntries()).single.nickname, 'Yes');
      store.failRead = true;
      await expectLater(repository.trustedEntries(), throwsStateError);
    },
  );
}
