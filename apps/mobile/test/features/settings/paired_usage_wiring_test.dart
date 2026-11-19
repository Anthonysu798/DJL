import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop;

Future<void> event(
  ReasoningTransport t,
  String method,
  Object? params, {
  String mac = 'mac-a',
  String session = 'secure-a',
}) async {
  t.events.add({
    'method': method,
    'params': params,
    '_macDeviceId': mac,
    '_sessionId': session,
  });
  await Future<void>.delayed(Duration.zero);
}

Map<String, dynamic> limits(int used) => {
  'threadId': 'another-thread',
  'primary': {'usedPercent': used, 'windowDurationMins': 300},
};

void main() {
  test(
    'real controller routes account-wide windows before thread filtering',
    () async {
      final t = ReasoningTransport();
      final desktop = await reasoningDesktop(t);
      try {
        expect(desktop.usage.canRead, isTrue);
        await event(t, 'account/rateLimits/updated', limits(25));
        expect(desktop.usage.rows.single.window.remainingPercent, 75);
        expect(desktop.usage.resolved, isTrue);
        await event(
          t,
          'account/rateLimits/updated',
          limits(90),
          mac: 'old-mac',
        );
        await event(
          t,
          'account/rateLimits/updated',
          limits(90),
          session: 'old-session',
        );
        expect(desktop.usage.rows.single.window.remainingPercent, 75);
      } finally {
        desktop.dispose();
      }
    },
  );

  test('null rate-limit notifications are not valid empty snapshots', () async {
    final t = ReasoningTransport();
    final d = await reasoningDesktop(t);
    try {
      await event(t, 'account/rateLimits/updated', null);
      expect(d.usage.resolved, isFalse);
      await event(t, 'account/rateLimits/updated', {});
      expect(d.usage.resolved, isTrue);
      expect(d.usage.rows, isEmpty);
    } finally {
      d.dispose();
    }
  });

  test(
    'account changes and changed trust cannot retain another account quota',
    () async {
      final t = ReasoningTransport();
      final d = await reasoningDesktop(t);
      try {
        await event(t, 'account/rateLimits/updated', limits(25));
        await event(t, 'account/updated', {});
        expect(d.usage.rows, isEmpty);
        expect(d.usage.resolved, isFalse);
        await event(t, 'account/rateLimits/updated', limits(40));
        d.active = Pairing({
          ...d.active!.data,
          'macIdentityPublicKey': 'changed-pin',
        });
        d.setPlan(false);
        expect(d.usage.rows, isEmpty);
        expect(d.usage.canRead, isFalse);
      } finally {
        d.dispose();
      }
    },
  );
}
