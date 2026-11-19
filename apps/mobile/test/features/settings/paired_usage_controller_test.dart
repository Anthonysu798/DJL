import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/settings/presentation/paired_usage_controller.dart';

Map<String, dynamic> limits(int used) => {
  'primary': {'usedPercent': used, 'windowDurationMins': 300},
};
void bind(
  PairedUsageController c, {
  String mac = 'a',
  String pin = 'pin-a',
  String session = 's1',
  bool connected = true,
  int generation = 0,
}) => c.bind(
  mac: mac,
  pin: pin,
  session: session,
  connected: connected,
  generation: generation,
);

void main() {
  test(
    'account read uses null and a valid empty snapshot resolves once',
    () async {
      final calls = <Object?>[];
      final c = PairedUsageController((params) async {
        calls.add(params);
        return {};
      });
      addTearDown(c.dispose);
      bind(c);
      await c.refreshIfNeeded();
      await c.refreshIfNeeded();
      expect(calls, [null]);
      expect(c.resolved, isTrue);
      expect(c.rows, isEmpty);
      expect(c.loading, isFalse);
      await c.refresh();
      expect(calls, [null, null]);
    },
  );

  for (final code in [-32602, -32600]) {
    test(
      'source compatibility retries only explicit invalid null params ($code)',
      () async {
        final calls = <Object?>[];
        final c = PairedUsageController((params) async {
          calls.add(params == null ? null : Map.of(params));
          if (calls.length == 1) {
            throw RemoteRpcException(
              code,
              'invalid type: null, expected map',
              null,
            );
          }
          return limits(25);
        });
        addTearDown(c.dispose);
        bind(c);
        await c.refresh();
        expect(calls, [null, <String, dynamic>{}]);
        expect(c.rows.single.window.remainingPercent, 75);
        expect(c.error, isNull);
      },
    );
  }

  for (final code in [-32601, -32602, 403]) {
    test(
      'unrelated or unsupported errors never trigger a compatibility retry ($code)',
      () async {
        var calls = 0;
        final c = PairedUsageController((_) async {
          calls++;
          throw RemoteRpcException(
            code,
            'Private upstream account detail',
            null,
          );
        });
        addTearDown(c.dispose);
        bind(c);
        await c.refresh();
        expect(calls, 1);
        expect(c.error, isNotNull);
        expect(c.error, isNot(contains('Private')));
        expect(c.resolved, isFalse);
      },
    );
  }

  test(
    'current read failure clears cached buckets and stays explicitly retryable',
    () async {
      var fail = false;
      final c = PairedUsageController((_) async {
        if (fail) throw StateError('Private provider detail');
        return limits(10);
      });
      addTearDown(c.dispose);
      bind(c);
      await c.refresh();
      expect(c.rows.single.window.remainingPercent, 90);
      fail = true;
      await c.refresh();
      expect(c.rows, isEmpty);
      expect(c.error, 'Could not load current limits. Try again.');
      expect(c.resolved, isFalse);
    },
  );

  test(
    'old Mac reply cannot replace a newer paired account snapshot',
    () async {
      final old = Completer<Map<String, dynamic>>();
      var calls = 0;
      final c = PairedUsageController((_) {
        calls++;
        return calls == 1 ? old.future : Future.value(limits(70));
      });
      addTearDown(c.dispose);
      bind(c);
      final pending = c.refresh();
      bind(c, mac: 'b', pin: 'pin-b', session: 's2');
      await c.refresh();
      old.complete(limits(10));
      await pending;
      expect(c.rows.single.window.remainingPercent, 30);
      expect(c.error, isNull);
    },
  );

  test(
    'disconnect retains only marked same-owner cache and fences the old read',
    () async {
      final held = Completer<Map<String, dynamic>>();
      var calls = 0;
      final c = PairedUsageController((_) {
        calls++;
        return calls == 2
            ? held.future
            : Future.value(limits(calls == 1 ? 10 : 20));
      });
      addTearDown(c.dispose);
      bind(c);
      await c.refresh();
      final pending = c.refresh();
      bind(c, connected: false);
      expect(c.canRead, isFalse);
      expect(c.stale, isTrue);
      expect(c.rows.single.window.remainingPercent, 90);
      held.complete(limits(99));
      await pending;
      expect(c.rows.single.window.remainingPercent, 90);
      bind(c, session: 's2', generation: 1);
      await c.refreshIfNeeded();
      expect(c.rows.single.window.remainingPercent, 80);
      expect(c.stale, isFalse);
      bind(
        c,
        pin: 'rotated-pin',
        session: 's2',
        generation: 1,
        connected: false,
      );
      expect(c.rows, isEmpty);
    },
  );

  test('a partial live update wins over an older held read response', () async {
    final held = Completer<Map<String, dynamic>>();
    final c = PairedUsageController((_) => held.future);
    addTearDown(c.dispose);
    bind(c);
    final pending = c.refresh();
    c.applyUpdate(limits(60));
    held.complete(limits(10));
    await pending;
    expect(c.rows.single.window.remainingPercent, 40);
    expect(c.resolved, isTrue);
    expect(c.loading, isFalse);
  });

  test(
    'account change clears prior account data and cancels its late snapshot',
    () async {
      final held = Completer<Map<String, dynamic>>();
      var calls = 0;
      final c = PairedUsageController(
        (_) => ++calls == 1 ? held.future : Future.value(limits(80)),
      );
      addTearDown(c.dispose);
      bind(c);
      final pending = c.refresh();
      c.applyUpdate(limits(20));
      c.accountChanged();
      expect(c.rows, isEmpty);
      expect(c.resolved, isFalse);
      await c.refreshIfNeeded();
      held.complete(limits(5));
      await pending;
      expect(c.rows.single.window.remainingPercent, 20);
    },
  );

  test(
    'disposal rejects a late snapshot without publishing new state',
    () async {
      final held = Completer<Map<String, dynamic>>();
      final c = PairedUsageController((_) => held.future);
      bind(c);
      final pending = c.refresh();
      var notifications = 0;
      c.addListener(() => notifications++);
      c.dispose();
      held.complete(limits(10));
      await pending;
      expect(notifications, 0);
    },
  );
}
