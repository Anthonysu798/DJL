import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/support/native_credential_phase.dart';

class PhaseStore implements CredentialStore {
  final values = <String, String>{};
  final calls = <(String, String)>[];
  bool corruptSentinel = false;

  @override
  Future<String?> read(String key) async {
    calls.add(('read', key));
    if (corruptSentinel && key == nativeCredentialSentinel) {
      throw PlatformException(code: 'decrypt_failed', message: 'PRIVATE ERROR');
    }
    return values[key];
  }

  @override
  Future<void> write(String key, String? value) async {
    calls.add((value == null ? 'delete' : 'write', key));
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }
}

void main() {
  test(
    'prepare preflights both keys and preserves unrelated credentials',
    () async {
      final store = PhaseStore()..values['genuine'] = 'PRIVATE';
      await runNativeCredentialPhase(store, 'prepare', android: true);
      expect(store.calls.take(2), [
        ('read', nativeCredentialSentinel),
        ('read', nativeCredentialControl),
      ]);
      expect(store.values['genuine'], 'PRIVATE');
      expect(store.calls.where((c) => c.$1 == 'write').map((c) => c.$2), [
        nativeCredentialSentinel,
        nativeCredentialControl,
      ]);
      store.calls.clear();
      await runNativeCredentialPhase(store, 'prepare', android: true);
      expect(store.calls.every((c) => c.$1 == 'read'), isTrue);
    },
  );

  final refusedValues = [
    {nativeCredentialSentinel: 'UNKNOWN PRIVATE'},
    {nativeCredentialControl: 'UNKNOWN PRIVATE'},
    {nativeCredentialSentinel: nativeCredentialSentinelValue},
  ];
  for (var index = 0; index < refusedValues.length; index++) {
    final values = refusedValues[index];
    test(
      'prepare refuses unexpected existing or partial sentinel state $index',
      () async {
        final store = PhaseStore()..values.addAll(values);
        await expectLater(
          runNativeCredentialPhase(store, 'prepare', android: true),
          throwsA(
            isA<StateError>().having(
              (e) => e.message,
              'message',
              'Native credential QA phase refused.',
            ),
          ),
        );
        expect(store.calls.every((c) => c.$1 == 'read'), isTrue);
        expect(store.values, values);
      },
    );
  }

  for (final android in [false, true]) {
    test('healthy verify is read-only on android=$android', () async {
      final store = PhaseStore()
        ..values.addAll({
          nativeCredentialSentinel: nativeCredentialSentinelValue,
          nativeCredentialControl: nativeCredentialControlValue,
        });
      await runNativeCredentialPhase(store, 'verify', android: android);
      expect(store.calls, [
        ('read', nativeCredentialSentinel),
        ('read', nativeCredentialControl),
      ]);
    });
  }

  test(
    'Android fault verify requires native error and healthy control with zero mutations',
    () async {
      final store = PhaseStore()
        ..corruptSentinel = true
        ..values[nativeCredentialControl] = nativeCredentialControlValue;
      await runNativeCredentialPhase(store, 'fault-verify', android: true);
      expect(store.calls, [
        ('read', nativeCredentialSentinel),
        ('read', nativeCredentialControl),
      ]);
      store.values[nativeCredentialControl] = 'UNEXPECTED';
      await expectLater(
        runNativeCredentialPhase(store, 'fault-verify', android: true),
        throwsStateError,
      );
      expect(store.calls.every((c) => c.$1 == 'read'), isTrue);
    },
  );

  test(
    'fault verify refuses iOS and successful or missing sentinel reads',
    () async {
      final store = PhaseStore()
        ..values[nativeCredentialControl] = nativeCredentialControlValue;
      await expectLater(
        runNativeCredentialPhase(store, 'fault-verify', android: false),
        throwsStateError,
      );
      expect(store.calls, isEmpty);
      await expectLater(
        runNativeCredentialPhase(store, 'fault-verify', android: true),
        throwsStateError,
      );
      expect(store.calls.every((c) => c.$1 == 'read'), isTrue);
    },
  );

  test(
    'cleanup requires explicit approval and known restored values before either delete',
    () async {
      final store = PhaseStore()
        ..values.addAll({
          nativeCredentialSentinel: nativeCredentialSentinelValue,
          nativeCredentialControl: nativeCredentialControlValue,
          'genuine': 'PRIVATE',
        });
      await expectLater(
        runNativeCredentialPhase(store, 'cleanup', android: true),
        throwsStateError,
      );
      expect(store.calls, isEmpty);
      await runNativeCredentialPhase(
        store,
        'cleanup',
        android: true,
        cleanupApproved: true,
      );
      expect(store.values, {'genuine': 'PRIVATE'});
      expect(store.calls.where((c) => c.$1 == 'delete').map((c) => c.$2), [
        nativeCredentialSentinel,
        nativeCredentialControl,
      ]);
    },
  );

  test('cleanup unknown control refuses before deleting either key', () async {
    final store = PhaseStore()
      ..values[nativeCredentialSentinel] = nativeCredentialSentinelValue
      ..values[nativeCredentialControl] = 'UNKNOWN PRIVATE';
    await expectLater(
      runNativeCredentialPhase(
        store,
        'cleanup',
        android: true,
        cleanupApproved: true,
      ),
      throwsStateError,
    );
    expect(store.calls.every((c) => c.$1 == 'read'), isTrue);
  });
}
