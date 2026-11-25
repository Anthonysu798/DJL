import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/core/security/remote_crypto.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_recovery_test.dart'
    show LocalPairings, OnlineTransport, RecoveryMemoryStore, pair;

final rotatedPair = Pairing({...pair.data, 'sessionId': 'rotated'});
final otherPair = Pairing({...pair.data, 'macDeviceId': 'other'});

class PresencePairings extends LocalPairings {
  int resolutions = 0;
  Object? failure;
  bool failOnce = false;
  @override
  Future<List<Pairing>> trusted() async => [pair, otherPair];
  @override
  Future<Pairing> resolveTrusted(Pairing incoming) async {
    resolutions++;
    final error = failure;
    if (failOnce) failure = null;
    if (error != null) throw error;
    return rotatedPair;
  }
}

class PresenceTransport extends OnlineTransport {
  PresenceTransport(super.pairings);
  String? currentSession;
  final methods = <String>[];
  @override
  String? get sessionId => currentSession;
  @override
  Future<void> connect(Pairing pair, {required bool bootstrap}) async {
    currentSession = pair.sessionId;
    await super.connect(pair, bootstrap: bootstrap);
  }

  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    methods.add(method);
    return super.request(method, params, timeout: timeout);
  }
}

void presence(PresenceTransport transport, bool online, {String? mac}) =>
    transport.events.add({
      'method': 'djl/hostPresence',
      '_macDeviceId': ?mac,
      'params': {'online': online},
    });

void presenceTest(
  String description,
  Future<void> Function(
    WidgetTester,
    DesktopController,
    PresencePairings,
    PresenceTransport,
  )
  body,
) {
  testWidgets(description, (tester) async {
    final pairs = PresencePairings();
    final transport = PresenceTransport(pairs);
    final desktop = DesktopController(
      pairs,
      connection: transport,
      localStore: RecoveryMemoryStore(),
    );
    try {
      await desktop.connect(pair, resolve: false);
      await body(tester, desktop, pairs, transport);
    } finally {
      desktop.dispose();
      await tester.pump();
    }
  });
}

void main() {
  presenceTest('offline desktop is not presented as a reachable paired host', (
    tester,
    desktop,
    pairs,
    transport,
  ) async {
    expect(desktop.host.connected, isTrue);
    presence(transport, false);
    await tester.pump();
    expect(transport.connected, isTrue);
    expect(desktop.host.connected, isFalse);
  });

  presenceTest('remembers since when the computer has been asleep', (
    tester,
    desktop,
    pairs,
    transport,
  ) async {
    expect(desktop.hostOfflineSince, isNull);
    presence(transport, false);
    await tester.pump();
    final since = desktop.hostOfflineSince;
    expect(since, isNotNull);
    // A repeated "still offline" keeps the first moment, not the latest one.
    presence(transport, false);
    await tester.pump(const Duration(seconds: 5));
    expect(desktop.hostOfflineSince, since);
    presence(transport, true);
    await tester.pump();
    expect(desktop.state, 'connected');
    expect(desktop.hostOfflineSince, isNull);
  });

  presenceTest(
    'an open relay socket resolves the restarted desktop without resending mutations',
    (tester, desktop, pairs, transport) async {
      presence(transport, false);
      await tester.pump(const Duration(seconds: 29));
      expect(pairs.resolutions, 0);
      await tester.pump(const Duration(seconds: 1));
      await tester.pump();
      expect(pairs.resolutions, 1);
      expect(transport.attempts, 2);
      expect(desktop.active?.sessionId, 'rotated');
      expect(desktop.host.connected, isTrue);
      expect(
        transport.methods.where(
          {'turn/start', 'turn/steer', 'thread/send'}.contains,
        ),
        isEmpty,
      );
    },
  );

  presenceTest('same-session host return cancels the pending resolve', (
    tester,
    desktop,
    pairs,
    transport,
  ) async {
    presence(transport, false);
    await tester.pump(const Duration(seconds: 10));
    presence(transport, true);
    await tester.pump(const Duration(seconds: 60));
    expect(desktop.state, 'connected');
    expect(desktop.host.connected, isTrue);
    expect(pairs.resolutions, 0);
    expect(transport.attempts, 1);
  });

  for (final gate in ['suspend', 'disconnect', 'manual pairing', 'routing']) {
    presenceTest('$gate cancels old host presence recovery', (
      tester,
      desktop,
      pairs,
      transport,
    ) async {
      presence(transport, false);
      await tester.pump(const Duration(seconds: 10));
      switch (gate) {
        case 'suspend':
          desktop.suspend();
        case 'disconnect':
          await desktop.disconnect();
        case 'manual pairing':
          desktop.pauseForManualPairing();
        case 'routing':
          desktop.setRoutingAllowed(false);
      }
      await tester.pump(const Duration(seconds: 90));
      expect(pairs.resolutions, 0);
      expect(transport.attempts, 1);
    });
  }

  presenceTest('new host ownership retires the previous timer', (
    tester,
    desktop,
    pairs,
    transport,
  ) async {
    presence(transport, false);
    await tester.pump(const Duration(seconds: 10));
    await desktop.connect(otherPair, resolve: false);
    await tester.pump(const Duration(seconds: 90));
    expect(desktop.active?.macDeviceId, 'other');
    expect(pairs.resolutions, 0);
    expect(transport.attempts, 2);
  });

  presenceTest(
    'security rejection during presence recovery stops automatic retries',
    (tester, desktop, pairs, transport) async {
      pairs.failure = const RemoteSecurityException('Untrusted host');
      presence(transport, false);
      await tester.pump(const Duration(seconds: 30));
      await tester.pump();
      expect(pairs.resolutions, 1);
      expect(desktop.connected, isFalse);
      desktop.resume();
      await tester.pump(const Duration(seconds: 120));
      expect(pairs.resolutions, 1);
      expect(transport.attempts, 1);
    },
  );

  presenceTest(
    'temporary resolution failure enters the existing bounded backoff',
    (tester, desktop, pairs, transport) async {
      pairs.failure = const RemoteRelayUnavailable('Desktop offline');
      pairs.failOnce = true;
      presence(transport, false);
      await tester.pump(const Duration(seconds: 30));
      await tester.pump();
      expect(pairs.resolutions, 1);
      await tester.pump(const Duration(seconds: 1));
      await tester.pump();
      expect(pairs.resolutions, 2);
      expect(transport.attempts, 2);
      expect(desktop.active?.sessionId, 'rotated');
    },
  );

  presenceTest('busy work defers rather than loses presence recovery', (
    tester,
    desktop,
    pairs,
    transport,
  ) async {
    desktop.busy = true;
    presence(transport, false);
    await tester.pump(const Duration(seconds: 30));
    expect(pairs.resolutions, 0);
    desktop.busy = false;
    await tester.pump(const Duration(seconds: 30));
    await tester.pump();
    expect(pairs.resolutions, 1);
    expect(transport.attempts, 2);
  });

  presenceTest(
    'a stale other-host presence frame cannot change reachability or trigger resolution',
    (tester, desktop, pairs, transport) async {
      presence(transport, false, mac: 'other');
      await tester.pump(const Duration(seconds: 60));
      expect(desktop.state, 'connected');
      expect(desktop.host.connected, isTrue);
      expect(pairs.resolutions, 0);
      expect(transport.attempts, 1);
    },
  );
}
