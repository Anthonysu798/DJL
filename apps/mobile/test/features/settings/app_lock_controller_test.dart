import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/settings/domain/device_owner_auth.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';

class FakeOwnerAuth implements DeviceOwnerAuth {
  bool supported = true, result = true, throws = false;
  int calls = 0, stops = 0;
  Completer<bool>? pending;
  @override
  Future<bool> isSupported() async => supported;
  @override
  Future<bool> authenticate() async {
    calls++;
    if (throws) throw StateError('cancelled');
    return pending?.future ?? result;
  }

  @override
  Future<void> stop() async {
    stops++;
  }
}

void main() {
  late DateTime now;
  late FakeOwnerAuth auth;
  late AppLockController lock;
  setUp(() {
    now = DateTime.utc(2026);
    auth = FakeOwnerAuth();
    lock = AppLockController(auth, now: () => now);
  });
  tearDown(() => lock.dispose());
  test(
    'startup shields until restored; launch locks only enabled saved desktop',
    () {
      expect(lock.shielded, true);
      expect(lock.ready, false);
      lock.initialize(enabled: true, hasProtectedContent: true);
      expect(lock.requiresUnlock, true);
      expect(lock.shielded, true);
      for (final state in [(true, false), (false, true), (false, false)]) {
        final other = AppLockController(auth);
        other.initialize(enabled: state.$1, hasProtectedContent: state.$2);
        expect(other.requiresUnlock, false);
        expect(other.shielded, false);
        other.dispose();
      }
    },
  );
  test(
    'inactive shields even disabled and never counts as real background',
    () {
      lock.initialize(enabled: false, hasProtectedContent: true);
      lock.lifecycle(AppLifecycleState.inactive);
      expect(lock.shielded, true);
      now = now.add(const Duration(hours: 1));
      expect(lock.lifecycle(AppLifecycleState.resumed), false);
      expect(lock.shielded, false);
      lock.setEnabled(true);
      lock.lifecycle(AppLifecycleState.inactive);
      now = now.add(const Duration(hours: 1));
      expect(lock.lifecycle(AppLifecycleState.resumed), false);
      expect(lock.requiresUnlock, false);
    },
  );
  test(
    '299 seconds unlocks; 300 locks; duplicates retain first background time',
    () async {
      lock.initialize(enabled: true, hasProtectedContent: true);
      await lock.authenticate();
      lock.lifecycle(AppLifecycleState.hidden);
      now = now.add(const Duration(seconds: 299));
      lock.lifecycle(AppLifecycleState.paused);
      expect(lock.lifecycle(AppLifecycleState.resumed), false);
      expect(lock.shielded, false);
      lock.lifecycle(AppLifecycleState.paused);
      now = now.add(const Duration(seconds: 299));
      lock.lifecycle(AppLifecycleState.paused);
      now = now.add(const Duration(seconds: 1));
      expect(lock.lifecycle(AppLifecycleState.resumed), true);
      expect(lock.requiresUnlock, true);
    },
  );
  test(
    'unavailable, false and cancelled auth remain locked; explicit retry succeeds',
    () async {
      lock.initialize(enabled: true, hasProtectedContent: true);
      auth.supported = false;
      await lock.authenticate();
      expect(auth.calls, 0);
      expect(lock.error, isNotNull);
      expect(lock.shielded, true);
      auth.supported = true;
      auth.result = false;
      await lock.authenticate();
      expect(lock.requiresUnlock, true);
      auth.throws = true;
      await lock.authenticate();
      expect(lock.requiresUnlock, true);
      expect(lock.authenticating, false);
      auth.throws = false;
      auth.result = true;
      await lock.authenticate();
      expect(lock.shielded, false);
      expect(lock.error, isNull);
    },
  );
  test(
    'dedupes prompts and tolerates OS inactive/resume without another prompt',
    () async {
      lock.initialize(enabled: true, hasProtectedContent: true);
      auth.pending = Completer<bool>();
      final first = lock.authenticate();
      await Future<void>.delayed(Duration.zero);
      await lock.authenticate();
      lock.lifecycle(AppLifecycleState.inactive);
      expect(lock.lifecycle(AppLifecycleState.resumed), false);
      expect(auth.calls, 1);
      auth.pending!.complete(true);
      await first;
      expect(lock.shielded, false);
    },
  );
  test('cancel completion before OS resumed requires explicit retry', () async {
    lock.initialize(enabled: true, hasProtectedContent: true);
    auth.pending = Completer<bool>();
    final first = lock.authenticate();
    await Future<void>.delayed(Duration.zero);
    lock.lifecycle(AppLifecycleState.inactive);
    auth.pending!.complete(false);
    await first;
    expect(lock.lifecycle(AppLifecycleState.resumed), false);
    expect(lock.requiresUnlock, true);
    expect(auth.calls, 1);
  });
  test(
    'success while OS inactive keeps snapshot shield until resumed',
    () async {
      lock.initialize(enabled: true, hasProtectedContent: true);
      auth.pending = Completer<bool>();
      final first = lock.authenticate();
      await Future<void>.delayed(Duration.zero);
      lock.lifecycle(AppLifecycleState.inactive);
      auth.pending!.complete(true);
      await first;
      expect(lock.requiresUnlock, false);
      expect(lock.shielded, true);
      expect(lock.lifecycle(AppLifecycleState.resumed), false);
      expect(lock.shielded, false);
    },
  );
  test(
    'real background invalidates auth success; retry is explicit after stale completion',
    () async {
      lock.initialize(enabled: true, hasProtectedContent: true);
      auth.pending = Completer<bool>();
      final first = lock.authenticate();
      await Future<void>.delayed(Duration.zero);
      lock.lifecycle(AppLifecycleState.paused);
      expect(lock.lifecycle(AppLifecycleState.resumed), false);
      auth.pending!.complete(true);
      await first;
      expect(lock.shielded, true);
      expect(lock.requiresUnlock, true);
      expect(auth.calls, 1);
      auth.pending = null;
      await lock.authenticate();
      expect(lock.shielded, false);
    },
  );
  test('disable and subsequent lock invalidate in-flight success', () async {
    lock.initialize(enabled: true, hasProtectedContent: true);
    auth.pending = Completer<bool>();
    final first = lock.authenticate();
    await Future<void>.delayed(Duration.zero);
    lock.setEnabled(false);
    expect(lock.shielded, false);
    lock.setEnabled(true);
    lock.lock();
    auth.pending!.complete(true);
    await first;
    expect(lock.shielded, true);
    expect(lock.requiresUnlock, true);
  });
}
