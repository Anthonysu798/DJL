import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/desktop_local_store.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_threads_controller_test.dart' show ThreadTransport;
import '../core/cloud_client_test.dart' show TestCredentials;

Pairing savedPair() => Pairing({
  'v': 2,
  'macDeviceId': 'qa-mac',
  'sessionId': 'session',
  'relay': 'wss://relay.test/relay',
  'macIdentityPublicKey': base64Encode(List.filled(32, 1)),
  'expiresAt': DateTime.now().millisecondsSinceEpoch + 60000,
});

class DelayedResume extends ThreadTransport {
  final resume = Completer<RemoteJson>();
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': params});
    if (method == 'thread/resume') return resume.future;
    return {
      'thread': {'id': 't1', 'turns': []},
    };
  }
}

void main() {
  test(
    'cold restore opens an encrypted offline timeline without a network request or revived turn',
    () async {
      final root = await Directory.systemTemp.createTemp('djl-offline-');
      final credentials = TestCredentials();
      final pairings = PairingRepository(credentials),
          transport = ThreadTransport()..online = false;
      final store = DesktopLocalStore(credentials, root: root);
      await pairings.trust(savedPair());
      await store.save('qa-mac', {
        'threads': [
          {'id': 't1', 'name': 'Saved chat', 'cwd': '/repo'},
        ],
        'timelines': {
          't1': [
            {
              'id': 'm1',
              'type': 'agentMessage',
              'text': 'Private offline reply',
            },
          ],
        },
        'runtimes': {
          't1': {
            'model': 'qa-model',
            'effort': 'high',
            'access': 'on-request',
            'serviceTier': 'default',
            'plan': false,
          },
        },
      });
      final desktop = DesktopController(
        pairings,
        connection: transport,
        localStore: store,
      );
      try {
        await desktop.restore();
        expect(desktop.threads.single['name'], 'Saved chat');
        await desktop.openThread(desktop.threads.single);
        expect(desktop.timeline.single['text'], 'Private offline reply');
        expect(desktop.turnId, isNull);
        expect(transport.calls, isEmpty);
        expect(desktop.effort, 'high');
      } finally {
        desktop.dispose();
        await store.flush();
        await root.delete(recursive: true);
      }
    },
  );
  test(
    'a resumed request completing after disconnect cannot read history on a replacement connection',
    () async {
      final root = await Directory.systemTemp.createTemp('djl-resume-race-');
      final credentials = TestCredentials();
      final store = DesktopLocalStore(credentials, root: root),
          transport = DelayedResume();
      final desktop = DesktopController(
        PairingRepository(credentials),
        connection: transport,
        localStore: store,
      )..active = savedPair();
      try {
        await desktop.threadList.attach('qa-mac');
        final opening = desktop.openThread({'id': 't1'});
        await Future<void>.delayed(Duration.zero);
        await desktop.disconnect();
        transport.mac = 'replacement';
        transport.online = true;
        transport.resume.complete({
          'thread': {'id': 't1'},
        });
        await opening;
        expect(
          transport.calls.where((c) => c['method'] == 'thread/read'),
          isEmpty,
        );
      } finally {
        desktop.dispose();
        await store.flush();
        await root.delete(recursive: true);
      }
    },
  );
}
