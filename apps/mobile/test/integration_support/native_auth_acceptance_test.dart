import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:local_auth/local_auth.dart';
import 'package:djl_mobile/features/settings/domain/device_owner_auth.dart';
import '../../integration_test/support/native_auth_acceptance.dart';

class _Auth implements DeviceOwnerAuth {
  _Auth(this.operation);
  Future<bool> Function() operation;
  int stops = 0;
  @override
  Future<bool> isSupported() async => true;
  @override
  Future<void> stop() async {
    stops++;
  }

  @override
  Future<bool> authenticate() => operation();
}

void main() {
  test(
    'observing availability does not request device authentication',
    () async {
      final auth = ObservedDeviceOwnerAuth(_Auth(() async => true));
      expect(auth.supportChecks, 0);
      expect(auth.attempts, 0);
      expect(await auth.isSupported(), isTrue);
      expect(auth.supportChecks, 1);
      expect(auth.attempts, 0);
    },
  );
  test('native false is observed without changing result', () async {
    final auth = ObservedDeviceOwnerAuth(_Auth(() async => false));
    expect(await auth.authenticate(), isFalse);
    expect(auth.refused, isTrue);
  });
  for (final code in [
    LocalAuthExceptionCode.unknownError,
    LocalAuthExceptionCode.noBiometricsEnrolled,
    LocalAuthExceptionCode.userCanceled,
  ]) {
    test(
      'native $code passes through and only actual user cancel counts',
      () async {
        final failure = LocalAuthException(code: code);
        final auth = ObservedDeviceOwnerAuth(_Auth(() async => throw failure));
        await expectLater(auth.authenticate(), throwsA(same(failure)));
        expect(auth.lastError, code);
        expect(auth.refused, code == LocalAuthExceptionCode.userCanceled);
      },
    );
  }
  test(
    'pending next attempt cannot inherit refusal and native success is preserved',
    () async {
      final delegate = _Auth(() async => false);
      final auth = ObservedDeviceOwnerAuth(delegate);
      await auth.authenticate();
      final reply = Completer<bool>();
      delegate.operation = () => reply.future;
      final pending = auth.authenticate();
      expect(auth.lastResult, isNull);
      expect(auth.lastError, isNull);
      expect(auth.refused, isFalse);
      reply.complete(true);
      expect(await pending, isTrue);
      expect(auth.lastResult, isTrue);
      expect(auth.attempts, 2);
      expect(auth.refused, isFalse);
      expect(await auth.isSupported(), isTrue);
      await auth.stop();
      expect(delegate.stops, 1);
    },
  );
}
