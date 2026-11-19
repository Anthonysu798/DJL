import 'dart:async';
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/security/remote_crypto.dart';
import 'package:djl_mobile/features/desktop/data/desktop_local_store.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

class RecoveryMemoryStore extends DesktopLocalStore {
  RecoveryMemoryStore() : super(TestCredentials());
  @override
  Future<RemoteJson> load(String mac) async => {};
  @override
  Future<void> save(String mac, RemoteJson value) async {}
}

class LocalPairings extends PairingRepository {
  LocalPairings() : super(TestCredentials());
  @override
  Future<Pairing> resolveTrusted(Pairing pairing) async => pairing;
}

class TemporarilyUnavailablePairings extends LocalPairings {
  int resolutions = 0;
  @override
  Future<Pairing> resolveTrusted(Pairing pairing) async {
    resolutions++;
    if (resolutions <= 2) {
      throw const RemoteRelayUnavailable('Temporary relay connection loss');
    }
    return pairing;
  }
}

class RecoveringTransport extends RemoteTransport {
  RecoveringTransport(super.pairings);
  final events = StreamController<RemoteJson>.broadcast(sync: true);
  int attempts = 0;
  Object? failure;
  bool online = false;
  String? _mac;
  @override
  String? get macDeviceId => _mac;
  @override
  bool get connected => online;
  @override
  Stream<RemoteJson> get messages => events.stream;
  @override
  Future<void> connect(Pairing pair, {required bool bootstrap}) async {
    _mac = pair.macDeviceId;
    attempts++;
    if (failure != null) throw failure!;
    if (attempts <= 2) throw StateError('Temporary relay failure');
    online = true;
  }

  @override
  Future<void> disconnect() async {
    online = false;
  }

  @override
  Future<void> send(RemoteJson message) async {}
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async => {'data': []};
  @override
  Future<void> dispose() async {
    await events.close();
  }
}

class OnlineTransport extends RecoveringTransport {
  OnlineTransport(super.pairings);
  @override
  Future<void> connect(Pairing pair, {required bool bootstrap}) async {
    _mac = pair.macDeviceId;
    attempts++;
    online = true;
  }
}

class IdentityReadCredentials extends TestCredentials {
  bool locked = true;
  int reads = 0, writes = 0;
  @override
  Future<String?> read(String key) async {
    if (key == 'desktop.identity') {
      reads++;
      if (locked) {
        throw PlatformException(
          code: 'storage_locked',
          message: 'Synthetic private native detail',
        );
      }
    }
    return super.read(key);
  }

  @override
  Future<void> write(String key, String? value) async {
    writes++;
    await super.write(key, value);
  }
}

class IdentityReadPairings extends PairingRepository {
  IdentityReadPairings(super.credentials);
  @override
  Future<Pairing> resolveTrusted(Pairing pair) async {
    await identity();
    return pair;
  }
}

const pair = Pairing({
  'macDeviceId': 'qa',
  'sessionId': 'qa',
  'relay': 'wss://relay.test',
  'macIdentityPublicKey': 'fixture',
});
void main() {
  testWidgets(
    'malformed relay authentication rejection stops automatic retry including resume',
    (tester) async {
      var resolutions = 0;
      final pairs = PairingRepository(
        TestCredentials(),
        client: MockClient((_) async {
          resolutions++;
          return http.Response(
            '{"ok":false,"code":"resolve_request_rejected","error":{"message":"Untrusted nested detail"}}',
            403,
          );
        }),
      );
      final transport = OnlineTransport(pairs);
      final controller = DesktopController(
        pairs,
        connection: transport,
        localStore: RecoveryMemoryStore(),
      );
      await tester.runAsync(() => controller.connect(pair));
      expect(resolutions, 1);
      expect(controller.error, 'The desktop pairing service is unavailable.');
      expect(controller.connected, isFalse);
      await tester.pump(const Duration(seconds: 60));
      controller.suspend();
      controller.resume();
      await tester.pump();
      expect(resolutions, 1);
      expect(transport.attempts, 0);
      controller.dispose();
      await tester.pump();
    },
  );

  testWidgets(
    'native identity read failure stops automatic retry and explicit reconnect restores original identity',
    (tester) async {
      final credentials = IdentityReadCredentials();
      credentials.values['desktop.identity'] = jsonEncode({
        'phoneDeviceId': 'original-phone',
        'seed': base64Encode(List.filled(32, 7)),
        'publicKey': base64Encode(List.filled(32, 9)),
      });
      final before = Map<String, String>.from(credentials.values),
          pairs = IdentityReadPairings(credentials),
          transport = OnlineTransport(IdentityReadPairings(credentials));
      final desktop = DesktopController(
        pairs,
        connection: transport,
        localStore: RecoveryMemoryStore(),
      );
      await desktop.connect(pair);
      expect(credentials.reads, 1);
      expect(credentials.writes, 0);
      expect(transport.attempts, 0);
      expect(desktop.error, contains('Reconnect'));
      expect(desktop.error, isNot(contains('private native detail')));
      await tester.pump(const Duration(seconds: 60));
      desktop.suspend();
      desktop.resume();
      await tester.pump();
      expect(credentials.reads, 1);
      expect(transport.attempts, 0);
      expect(credentials.values, before);
      credentials.locked = false;
      await desktop.reconnect();
      expect(credentials.reads, 2);
      expect(credentials.writes, 0);
      expect(transport.attempts, 1);
      expect(desktop.connected, isTrue);
      expect((await pairs.identity()).deviceId, 'original-phone');
      expect(credentials.values, before);
      await desktop.disconnect();
      desktop.dispose();
      await tester.pump();
    },
  );

  testWidgets(
    'temporary trusted HTTP resolution failures retry with fresh resolution attempts',
    (tester) async {
      final pairs = TemporarilyUnavailablePairings();
      final transport = OnlineTransport(pairs);
      final controller = DesktopController(
        pairs,
        connection: transport,
        localStore: RecoveryMemoryStore(),
      );
      await controller.connect(pair);
      expect(pairs.resolutions, 1);
      expect(transport.attempts, 0);
      await tester.pump(const Duration(seconds: 1));
      expect(pairs.resolutions, 2);
      await tester.pump(const Duration(seconds: 2));
      expect(pairs.resolutions, 3);
      expect(transport.attempts, 1);
      expect(controller.connected, isTrue);
      await controller.disconnect();
      await tester.pump(const Duration(seconds: 40));
      expect(pairs.resolutions, 3);
      controller.dispose();
      await tester.pump();
    },
  );
  testWidgets(
    'transient failures keep retrying with backoff and pause cancels recovery',
    (tester) async {
      final pairs = LocalPairings(),
          transport = RecoveringTransport(LocalPairings());
      final controller = DesktopController(
        pairs,
        connection: transport,
        localStore: RecoveryMemoryStore(),
      );
      await controller.connect(pair);
      expect(transport.attempts, 1);
      await tester.pump(const Duration(seconds: 1));
      expect(transport.attempts, 2);
      await tester.pump(const Duration(seconds: 2));
      expect(transport.attempts, 3);
      expect(controller.connected, isTrue);
      controller.suspend();
      await tester.pump(const Duration(seconds: 40));
      expect(transport.attempts, 3);
      controller.resume();
      await tester.pump();
      expect(transport.attempts, 4);
      await controller.disconnect();
      await tester.pump(const Duration(seconds: 40));
      expect(transport.attempts, 4);
      controller.dispose();
      await tester.pump();
    },
  );
  testWidgets('identity failures never automatically retry, including resume', (
    tester,
  ) async {
    final pairs = LocalPairings(),
        transport = RecoveringTransport(LocalPairings())
          ..failure = const RemoteSecurityException('Untrusted identity');
    final controller = DesktopController(
      pairs,
      connection: transport,
      localStore: RecoveryMemoryStore(),
    );
    await controller.connect(pair);
    await tester.pump(const Duration(seconds: 60));
    controller.suspend();
    controller.resume();
    await tester.pump();
    expect(transport.attempts, 1);
    controller.dispose();
    await tester.pump();
  });
}
