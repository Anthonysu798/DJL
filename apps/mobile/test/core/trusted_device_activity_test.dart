import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'trusted_device_preferences_test.dart'
    show PreferenceCredentials, preferencePair;

Map<String, dynamic> activityRow({int pin = 1}) => {
  'djlTrustedEntry': 1,
  'trustId': 'observed-identity',
  'pairing': preferencePair(pin: pin).data,
  'preferences': {'nickname': 'Work desk', 'visibleInMenu': false},
  'activity': {'lastPairedAt': 1609459200000, 'lastUsedAt': 1640995200000},
};

void main() {
  test(
    'invalid optional activity cannot hide an otherwise valid pairing',
    () async {
      for (final value in [
        'invalid',
        <String, dynamic>{},
        -9223372036854775808,
        8640000000000001,
      ]) {
        final store = PreferenceCredentials();
        final row = activityRow()
          ..['activity'] = {'lastPairedAt': value, 'lastUsedAt': value};
        final raw = jsonEncode([row]);
        store.values['desktop.trusted'] = raw;
        final repository = PairingRepository(store);
        final entry = (await repository.trustedEntries()).single;
        expect(entry.lastActivityAt, isNull);
        expect(entry.pairing.data, preferencePair().data);
        expect((await repository.trusted()).single.data, preferencePair().data);
        expect(store.values['desktop.trusted'], raw);
        expect(store.writes, 0);
      }
    },
  );
  test(
    'legacy reads preserve unknown dates without a credential write',
    () async {
      final store = PreferenceCredentials();
      final raw = jsonEncode([preferencePair().data]);
      store.values['desktop.trusted'] = raw;
      final entry = (await PairingRepository(store).trustedEntries()).single;
      expect(entry.toJson()['activity'], isNull);
      expect(entry.pairing.data, preferencePair().data);
      expect(store.values['desktop.trusted'], raw);
      expect(store.writes, 0);
    },
  );

  test(
    'authenticated trust records activity separately from the wire payload',
    () async {
      final store = PreferenceCredentials(), pair = preferencePair();
      final repository = PairingRepository(store);
      final before = DateTime.now().millisecondsSinceEpoch;
      await repository.trust(pair);
      final after = DateTime.now().millisecondsSinceEpoch;
      final row =
          (jsonDecode(store.values['desktop.trusted']!) as List).single as Map;
      expect(row['activity'], isA<Map>());
      final activity = row['activity'] as Map;
      expect(activity['lastPairedAt'], inInclusiveRange(before, after));
      expect(activity['lastUsedAt'], activity['lastPairedAt']);
      expect(row['pairing'], pair.data);
      expect((await repository.trusted()).single.data, pair.data);
      expect(
        (await repository.trustedEntries()).single.toJson()['activity'],
        activity,
      );
    },
  );

  test(
    'preferences preserve recorded dates and refresh preserves the pairing date',
    () async {
      final store = PreferenceCredentials();
      final original = activityRow();
      store.values['desktop.trusted'] = jsonEncode([original]);
      final repository = PairingRepository(store);
      final entry = (await repository.trustedEntries()).single;
      expect(entry.toJson()['activity'], original['activity']);
      await repository.updateDevicePreferences(entry, nickname: 'Renamed');
      var row =
          (jsonDecode(store.values['desktop.trusted']!) as List).single as Map;
      expect(row['activity'], original['activity']);
      final before = DateTime.now().millisecondsSinceEpoch;
      await repository.trust(preferencePair(session: 'verified-live-session'));
      row =
          (jsonDecode(store.values['desktop.trusted']!) as List).single as Map;
      final activity = row['activity'] as Map;
      expect(activity['lastPairedAt'], 1609459200000);
      expect(activity['lastUsedAt'], greaterThanOrEqualTo(before));
      expect(row['trustId'], 'observed-identity');
      expect(row['preferences'], {
        'nickname': 'Renamed',
        'visibleInMenu': false,
      });
      expect(
        row['pairing'],
        preferencePair(session: 'verified-live-session').data,
      );
    },
  );

  test(
    'legacy refresh learns usage without inventing its original pairing date',
    () async {
      final store = PreferenceCredentials();
      store.values['desktop.trusted'] = jsonEncode([preferencePair().data]);
      final repository = PairingRepository(store);
      final before = DateTime.now().millisecondsSinceEpoch;
      await repository.trust(preferencePair(session: 'live'));
      final entry = (await repository.trustedEntries()).single;
      final activity = entry.toJson()['activity'] as Map;
      expect(activity['lastPairedAt'], isNull);
      expect(activity['lastUsedAt'], greaterThanOrEqualTo(before));
      expect(entry.pairing.data, preferencePair(session: 'live').data);
    },
  );

  test(
    'cancelled trust cannot advance dates; replacing a pin starts new activity',
    () async {
      final store = PreferenceCredentials();
      final raw = jsonEncode([activityRow()]);
      store.values['desktop.trusted'] = raw;
      final repository = PairingRepository(store);
      await repository.trust(preferencePair(), isCurrent: () => false);
      expect(store.values['desktop.trusted'], raw);
      expect(store.writes, 0);
      final before = DateTime.now().millisecondsSinceEpoch;
      await repository.trust(preferencePair(pin: 2));
      final entry = (await repository.trustedEntries()).single;
      expect(entry.trustId, isNot('observed-identity'));
      expect(entry.nickname, isEmpty);
      final activity = entry.toJson()['activity'] as Map;
      expect(activity['lastPairedAt'], greaterThanOrEqualTo(before));
      expect(activity['lastUsedAt'], activity['lastPairedAt']);
    },
  );
}
