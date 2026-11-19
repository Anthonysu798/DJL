import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/core/security/remote_crypto.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'cloud_client_test.dart' show TestCredentials;

class DelayedIdentityPairings extends PairingRepository {
  DelayedIdentityPairings(super.credentials);
  final gate = Completer<PhoneIdentity>();
  @override
  Future<PhoneIdentity> identity() => gate.future;
}

class DelayedCursorCredentials extends TestCredentials {
  final entered = Completer<void>();
  final gate = Completer<String?>();
  @override
  Future<String?> read(String key) async {
    if (key.startsWith('desktop.cursor.')) {
      entered.complete();
      return gate.future;
    }
    return super.read(key);
  }
}

class DelayedTrustCredentials extends TestCredentials {
  final entered = Completer<void>();
  final gate = Completer<void>();
  @override
  Future<void> write(String key, String? value) async {
    if (key == 'desktop.active' && value != null) {
      if (!entered.isCompleted) entered.complete();
      await gate.future;
    }
    await super.write(key, value);
  }
}

class DelayedReaderCloseTransport extends RemoteTransport {
  DelayedReaderCloseTransport(super.pairings);
  bool holdNextClose = false;
  final closeEntered = Completer<void>();
  final closeRelease = Completer<void>();
  @override
  Future<void> disconnect() async {
    final hold = holdNextClose;
    holdNextClose = false;
    await super.disconnect();
    if (hold) {
      closeEntered.complete();
      await closeRelease.future;
    }
  }
}

Future<(Process, Pairing)> readerGateway() async {
  final process = await Process.start('bun', ['tool/remote_test_server.cjs']);
  process.stderr.drain<void>();
  final first = await process.stdout
      .transform(utf8.decoder)
      .transform(const LineSplitter())
      .first
      .timeout(const Duration(seconds: 10));
  return (process, Pairing.parse(first, allowLocal: true));
}

void main() {
  for (final samePhone in [true, false]) {
    test(
      'fresh transport does not reuse mutation IDs, same phone=$samePhone',
      () async {
        final gateway = await readerGateway();
        final repository = PairingRepository(
          TestCredentials(),
          allowLocal: true,
        );
        final first = RemoteTransport(repository);
        RemoteTransport? fresh;
        try {
          await first.connect(gateway.$2, bootstrap: true);
          final before = await first.request('turn/start', {'text': 'first'});
          await first.dispose();
          fresh = RemoteTransport(
            samePhone
                ? repository
                : PairingRepository(TestCredentials(), allowLocal: true),
          );
          await fresh.connect(gateway.$2, bootstrap: !samePhone);
          final after = await fresh.request('turn/start', {'text': 'second'});
          expect(
            after['requestId'],
            isNot(before['requestId']),
            reason:
                'The desktop persists deduplication across phone/app lifetimes.',
          );
          await fresh.disconnect();
          await fresh.connect(gateway.$2, bootstrap: false);
          final reconnected = await fresh.request('turn/start', {
            'text': 'third',
          });
          expect({
            before['requestId'],
            after['requestId'],
            reconnected['requestId'],
          }, hasLength(3));
        } finally {
          if (fresh == null) await first.dispose();
          await fresh?.dispose();
          gateway.$1.kill();
          await gateway.$1.exitCode;
        }
      },
      timeout: const Timeout(Duration(seconds: 40)),
    );
  }
  for (final closeCode in [1001, 4001, 4005, 4009]) {
    test(
      'handshake closure $closeCode preserves recovery classification',
      () async {
        final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
        server.listen((request) async {
          final socket = await WebSocketTransformer.upgrade(request);
          socket.listen((_) {
            socket.close(closeCode);
          });
        });
        final repository = PairingRepository(
          TestCredentials(),
          allowLocal: true,
        );
        final transport = RemoteTransport(repository);
        final pair = Pairing({
          'relay': 'ws://127.0.0.1:${server.port}/relay',
          'sessionId': 'transient-handshake',
          'macDeviceId': 'qa-desktop',
          'macIdentityPublicKey': base64Encode(List<int>.filled(32, 0)),
        });
        try {
          await expectLater(
            transport.connect(pair, bootstrap: false),
            throwsA(
              closeCode == 1001
                  ? isA<SocketException>()
                  : isA<RemoteSecurityException>(),
            ),
          );
          expect(transport.connected, isFalse);
          expect(await repository.trusted(), isEmpty);
        } finally {
          await transport.dispose();
          await server.close(force: true);
        }
      },
    );
  }
  test(
    'encrypted request preserves explicit null params on the wire',
    () async {
      final gateway = await readerGateway();
      final transport = RemoteTransport(
        PairingRepository(TestCredentials(), allowLocal: true),
      );
      try {
        await transport.connect(gateway.$2, bootstrap: true);
        final result = await transport.requestNull('fixture/explicit-null');
        expect(result['method'], 'fixture/explicit-null');
        expect(result.containsKey('params'), isTrue);
        expect(result['params'], isNull);
      } finally {
        await transport.dispose();
        gateway.$1.kill();
        await gateway.$1.exitCode;
      }
    },
  );

  test(
    'current reader close still publishes one disconnect after its close settles',
    () async {
      final a = await readerGateway();
      final transport = DelayedReaderCloseTransport(
        PairingRepository(TestCredentials(), allowLocal: true),
      );
      var disconnected = 0;
      transport.onDisconnected = (_, _) {
        disconnected++;
      };
      try {
        await transport.connect(a.$2, bootstrap: true);
        transport.holdNextClose = true;
        a.$1.kill();
        await transport.closeEntered.future.timeout(
          const Duration(seconds: 10),
        );
        expect(disconnected, 0);
        transport.closeRelease.complete();
        await Future<void>.delayed(const Duration(milliseconds: 30));
        expect(disconnected, 1);
        expect(transport.connected, isFalse);
      } finally {
        if (!transport.closeRelease.isCompleted) {
          transport.closeRelease.complete();
        }
        await transport.dispose();
        a.$1.kill();
        await a.$1.exitCode;
      }
    },
    timeout: const Timeout(Duration(seconds: 40)),
  );

  test(
    'old reader close completion cannot notify or disrupt a newer secure connection',
    () async {
      final a = await readerGateway(), b = await readerGateway();
      final repository = PairingRepository(TestCredentials(), allowLocal: true);
      final transport = DelayedReaderCloseTransport(repository);
      var disconnected = 0;
      transport.onDisconnected = (_, _) {
        disconnected++;
      };
      try {
        expect(a.$2.publicKey, isNot(b.$2.publicKey));
        await transport.connect(a.$2, bootstrap: true);
        transport.holdNextClose = true;
        a.$1.kill();
        await transport.closeEntered.future.timeout(
          const Duration(seconds: 10),
        );
        expect(transport.connected, isFalse);
        await transport.connect(b.$2, bootstrap: true);
        expect(
          (await transport.request(
            'fixture/new-before-old-close',
            {},
          ))['method'],
          'fixture/new-before-old-close',
        );
        expect(disconnected, 0);
        transport.closeRelease.complete();
        await Future<void>.delayed(const Duration(milliseconds: 30));
        expect(
          (await transport.request(
            'fixture/new-after-old-close',
            {},
          ))['method'],
          'fixture/new-after-old-close',
        );
        expect(transport.connected, isTrue);
        expect((await repository.trusted()).single.publicKey, b.$2.publicKey);
        expect(
          disconnected,
          0,
          reason: 'The old reader no longer owns this disconnect completion.',
        );
      } finally {
        if (!transport.closeRelease.isCompleted) {
          transport.closeRelease.complete();
        }
        await transport.dispose();
        a.$1.kill();
        b.$1.kill();
        await a.$1.exitCode;
        await b.$1.exitCode;
      }
    },
    timeout: const Timeout(Duration(seconds: 40)),
  );

  for (final stage in ['socket', 'serverHello', 'secureReady']) {
    test(
      'real handshake cancellation at $stage has no late control continuation',
      () async {
        final process = await Process.start('bun', [
          'tool/remote_test_server.cjs',
        ]);
        final first = await process.stdout
            .transform(utf8.decoder)
            .transform(const LineSplitter())
            .first
            .timeout(const Duration(seconds: 10));
        process.stderr.drain<void>();
        final original = Pairing.parse(first, allowLocal: true);
        final listener = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
        final entered = Completer<void>(),
            release = Completer<void>(),
            ready = Completer<void>();
        final controls = <String>[];
        WebSocket? client, gateway;
        listener.listen((request) async {
          if (stage == 'socket') {
            entered.complete();
            await release.future;
          }
          client = await WebSocketTransformer.upgrade(request);
          gateway = await WebSocket.connect(
            '${original.relay}/${original.sessionId}',
          );
          client!.listen((frame) {
            final value = jsonDecode(frame as String) as Map;
            if (value['kind'] is String) controls.add(value['kind'] as String);
            if (gateway?.readyState == WebSocket.open) gateway!.add(frame);
          });
          gateway!.listen((frame) async {
            final value = jsonDecode(frame as String) as Map;
            if (value['kind'] == stage && !entered.isCompleted) {
              entered.complete();
              await release.future;
            }
            if (client?.readyState == WebSocket.open) client!.add(frame);
          });
          ready.complete();
        });
        final pair = Pairing({
          ...original.data,
          'relay': 'ws://127.0.0.1:${listener.port}/relay',
        });
        final transport = RemoteTransport(
          PairingRepository(TestCredentials(), allowLocal: true),
        );
        try {
          final failed = expectLater(
            transport.connect(pair, bootstrap: true),
            throwsA(anything),
          );
          await entered.future.timeout(const Duration(seconds: 10));
          final before = List<String>.of(controls);
          await transport.disconnect();
          release.complete();
          await failed;
          await ready.future.timeout(const Duration(seconds: 10));
          await Future<void>.delayed(const Duration(milliseconds: 30));
          expect(controls, before);
          expect(controls, isNot(contains('resumeState')));
          expect(transport.connected, isFalse);
          expect(await transport.pairings.trusted(), isEmpty);
        } finally {
          if (!release.isCompleted) release.complete();
          await transport.dispose();
          await client?.close();
          await gateway?.close();
          await listener.close(force: true);
          process.kill();
          await process.exitCode;
        }
      },
      timeout: const Timeout(Duration(seconds: 40)),
    );
  }

  test('cancel during cursor read cannot open a late socket', () async {
    final listener = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    var opens = 0;
    listener.listen((request) async {
      opens++;
      request.response.statusCode = 403;
      await request.response.close();
    });
    final store = DelayedCursorCredentials();
    store.values['desktop.identity'] = jsonEncode({
      'phoneDeviceId': 'phone',
      'seed': base64Encode(List.filled(32, 2)),
      'publicKey': base64Encode(List.filled(32, 3)),
    });
    final transport = RemoteTransport(PairingRepository(store));
    final pair = Pairing({
      'macDeviceId': 'cursor',
      'sessionId': 'session',
      'relay': 'ws://127.0.0.1:${listener.port}',
      'macIdentityPublicKey': base64Encode(List.filled(32, 1)),
    });
    final failure = expectLater(
      transport.connect(pair, bootstrap: true),
      throwsStateError,
    );
    await store.entered.future;
    await transport.disconnect();
    store.gate.complete(null);
    try {
      await failure;
      expect(opens, 0);
      expect(transport.connected, isFalse);
    } finally {
      await transport.dispose();
      await listener.close(force: true);
    }
  });

  test(
    'real secure-ready trust completion cannot resume after cancel and queued active cleanup',
    () async {
      final process = await Process.start('bun', [
        'tool/remote_test_server.cjs',
      ]);
      final first = await process.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .first
          .timeout(const Duration(seconds: 10));
      process.stderr.drain<void>();
      final pair = Pairing.parse(first, allowLocal: true),
          store = DelayedTrustCredentials();
      final pairs = PairingRepository(store, allowLocal: true);
      // The transport and cleanup must use the same serialized repository owner.
      final real = RemoteTransport(pairs);
      try {
        final failed = expectLater(
          real.connect(pair, bootstrap: true),
          throwsStateError,
        );
        await store.entered.future.timeout(const Duration(seconds: 10));
        final closing = real.disconnect(), clearing = pairs.clearActive();
        store.gate.complete();
        await closing;
        await failed;
        await clearing;
        expect(real.connected, isFalse);
        expect(store.values['desktop.active'], isNull);
        expect((await pairs.trusted()).single.publicKey, pair.publicKey);
        await real.connect(pair, bootstrap: false);
        expect(
          (await real.request('fixture/after-cancel', {}))['method'],
          'fixture/after-cancel',
        );
      } finally {
        await real.dispose();
        process.kill();
        await process.exitCode;
      }
    },
    timeout: const Timeout(Duration(seconds: 40)),
  );

  test('cancel during identity read never opens a late socket', () async {
    final listener = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    var opens = 0;
    listener.listen((request) async {
      opens++;
      request.response.statusCode = HttpStatus.forbidden;
      await request.response.close();
    });
    final pairs = DelayedIdentityPairings(TestCredentials());
    final transport = RemoteTransport(pairs);
    final pair = Pairing({
      'macDeviceId': 'delayed',
      'sessionId': 'session',
      'relay': 'ws://127.0.0.1:${listener.port}',
      'macIdentityPublicKey': base64Encode(List.filled(32, 1)),
    });
    final connecting = transport.connect(pair, bootstrap: true);
    final failure = expectLater(connecting, throwsA(isA<StateError>()));
    await Future<void>.delayed(Duration.zero);
    await transport.disconnect();
    pairs.gate.complete(
      PhoneIdentity(
        'phone',
        List.filled(32, 2),
        base64Encode(List.filled(32, 3)),
      ),
    );
    try {
      await failure;
      expect(opens, 0);
      expect(transport.connected, isFalse);
    } finally {
      await transport.dispose();
      await listener.close(force: true);
    }
  });

  test(
    'real gateway handshake, encrypted RPC and trusted reconnect interoperate',
    () async {
      final process = await Process.start('bun', [
        'tool/remote_test_server.cjs',
      ]);
      final lines = process.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter());
      final errors = <String>[];
      process.stderr.transform(utf8.decoder).listen(errors.add);
      final first = await lines.first.timeout(const Duration(seconds: 10));
      final pairing = Pairing.parse(first, allowLocal: true);
      final repository = PairingRepository(TestCredentials(), allowLocal: true);
      final transport = RemoteTransport(repository);
      try {
        await transport.connect(pairing, bootstrap: true);
        final result = await transport.request('fixture/echo', {
          'text': 'encrypted hello',
        });
        expect(result['params'], {'text': 'encrypted hello'});
        expect(transport.connected, isTrue);
        expect(
          (await repository.trusted()).single.publicKey,
          pairing.publicKey,
        );
        await transport.disconnect();
        await transport.connect(pairing, bootstrap: false);
        final again = await transport.request('fixture/reconnect', {});
        expect(again['method'], 'fixture/reconnect');
        final concurrent = await Future.wait(
          List.generate(
            12,
            (i) => transport.request('fixture/concurrent', {
              'index': i,
              'padding': List.filled(i.isEven ? 100000 : 1, 'x').join(),
            }),
          ),
        );
        expect(
          concurrent.map((r) => (r['params'] as Map)['index']).toList(),
          List.generate(12, (i) => i),
        );
        final pending = List.generate(
          8,
          (i) => transport.request('fixture/pending', {'index': i}),
        );
        final cancelled = expectLater(
          Future.wait(pending),
          throwsA(isA<StateError>()),
        );
        await transport.disconnect();
        await cancelled;
      } finally {
        await transport.dispose();
        process.kill();
        await process.exitCode;
      }
    },
    timeout: const Timeout(Duration(seconds: 40)),
  );
}
