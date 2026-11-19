import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/settings/domain/device_owner_auth.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import 'package:djl_mobile/features/settings/presentation/privacy_shield.dart';
import '../../integration_test/support/native_app_ready.dart';

class _Owner implements DeviceOwnerAuth {
  Future<bool> result = Future.value(true);
  int calls = 0;
  @override
  Future<bool> isSupported() async => true;
  @override
  Future<bool> authenticate() {
    calls++;
    return result;
  }

  @override
  Future<void> stop() async {}
}

Future<void> _mount(WidgetTester tester, AppLockController lock) =>
    tester.pumpWidget(
      MaterialApp(
        home: PrivacyShield(
          controller: lock,
          child: const Scaffold(body: Text('Private fixture')),
        ),
      ),
    );

void main() {
  testWidgets(
    'native preparation waits for startup without changing lock policy',
    (tester) async {
      final owner = _Owner();
      final lock = AppLockController(owner);
      await _mount(tester, lock);
      final initialization = Timer(
        const Duration(milliseconds: 400),
        () => lock.initialize(enabled: true, hasProtectedContent: false),
      );
      try {
        await waitForNativeAppReady(tester, 'QA');
        expect(lock.ready, isTrue);
        expect(lock.shielded, isFalse);
        expect(owner.calls, 0);
      } finally {
        initialization.cancel();
        await tester.pumpWidget(const SizedBox());
        lock.dispose();
      }
    },
  );
  testWidgets(
    'native preparation remains blocked after refusal until explicit successful authentication',
    (tester) async {
      final owner = _Owner(), refused = Completer<bool>();
      owner.result = refused.future;
      final lock = AppLockController(owner)
        ..initialize(enabled: true, hasProtectedContent: true);
      await _mount(tester, lock);
      unawaited(lock.authenticate());
      var completed = false;
      bool? blockedAfterRefusal;
      final timers = [
        Timer(const Duration(milliseconds: 400), () => refused.complete(false)),
        Timer(const Duration(milliseconds: 600), () {
          blockedAfterRefusal = !completed && lock.requiresUnlock;
        }),
        Timer(const Duration(milliseconds: 800), () {
          owner.result = Future.value(true);
          unawaited(lock.authenticate());
        }),
      ];
      try {
        await waitForNativeAppReady(tester, 'QA').then((_) => completed = true);
        expect(completed, isTrue);
        expect(blockedAfterRefusal, isTrue);
        expect(owner.calls, 2);
        expect(lock.requiresUnlock, isFalse);
        expect(tester.takeException(), isNull);
      } finally {
        for (final timer in timers) {
          timer.cancel();
        }
        await tester.pumpWidget(const SizedBox());
        lock.dispose();
      }
    },
  );
}
