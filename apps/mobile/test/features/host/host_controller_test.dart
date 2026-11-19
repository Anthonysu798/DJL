import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/host/domain/host_snapshot.dart';
import 'package:djl_mobile/features/host/presentation/host_controller.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/settings/data/settings_store.dart';
import '../../core/cloud_client_test.dart' show TestCredentials;

class HostStore implements SettingsStore {
  final values = <String, Object>{};
  bool fail = false;
  @override
  Future<Map<String, Object>> read() async => Map.of(values);
  @override
  Future<void> write(String key, Object? value) async {
    if (fail) throw StateError('write failure');
    if (value != null) values[key] = value;
  }
}

class HostTransport extends RemoteTransport {
  HostTransport() : super(PairingRepository(TestCredentials()));
  final calls = <(String, RemoteJson)>[];
  Future<RemoteJson> Function(String, RemoteJson)? handler;
  RemoteJson status = {
    'status': 'authenticated',
    'authMethod': 'chatgpt',
    'tokenReady': true,
    'hostPlatform': 'macos',
    'bridgeVersion': '1.0',
    'bridgeLatestVersion': '2.0',
    'hostCapabilities': {
      'desktopHandoff': true,
      'displayWake': true,
      'keepAwake': true,
      'bridgeUpdate': true,
    },
  };
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add((method, Map.of(params)));
    if (handler != null) return handler!(method, params);
    return method == 'account/status/read' ? Map.of(status) : {'success': true};
  }
}

void main() {
  late HostTransport transport;
  late HostStore store;
  late HostController host;
  setUp(() {
    transport = HostTransport();
    store = HostStore();
    host = HostController(transport, store: store);
  });
  tearDown(() => host.dispose());
  Future<void> online({String device = 'a', String session = 's1'}) async {
    host.bind(device: device, session: session, connected: true, trusted: true);
    await host.refresh();
  }

  test(
    'safe snapshot excludes secrets, preserves auth vs voice and strict capabilities',
    () {
      final snapshot = HostSnapshot.decode({
        ...transport.status,
        'authMethod': 'api_key',
        'tokenReady': true,
        'authToken': 'SECRET',
        'nested': {'access_token': 'SECRET'},
        'hostCapabilities': {'desktop_handoff': false, 'display_wake': true},
      });
      expect(jsonEncode(snapshot.toJson()), isNot(contains('SECRET')));
      expect(snapshot.authenticated, isTrue);
      expect(snapshot.voiceReady, isFalse);
      expect(snapshot.capabilities(trusted: true).desktopHandoff, isFalse);
      expect(snapshot.capabilities(trusted: true).displayWake, isTrue);
      expect(snapshot.capabilities(trusted: true).terminal, isTrue);
      expect(
        HostSnapshot.decode({
          'hostPlatform': 'unknown',
        }).capabilities(trusted: true).displayWake,
        isFalse,
      );
      expect(
        HostSnapshot.decode({
          'hostPlatform': 'macos',
        }).capabilities(trusted: false).displayWake,
        isFalse,
      );
      expect(
        HostSnapshot.decode({
          'hostPlatform': 'macos',
        }).capabilities(trusted: true).displayWake,
        isTrue,
      );
      expect(
        HostSnapshot.decode({
          'hostPlatform': 'windows',
          'hostCapabilities': {'desktopHandoff': false},
        }).capabilities(trusted: true).desktopHandoff,
        isFalse,
      );
    },
  );
  test(
    'status coalesces, uses empty params, fallback only explicit unsupported',
    () async {
      final pending = Completer<RemoteJson>();
      transport.handler = (m, p) => pending.future;
      host.bind(device: 'a', session: 's1', connected: true, trusted: true);
      final a = host.refresh(), b = host.refresh();
      expect(transport.calls.length, 1);
      expect(transport.calls.single.$1, 'account/status/read');
      expect(transport.calls.single.$2, <String, dynamic>{});
      pending.complete(transport.status);
      await Future.wait([a, b]);
      transport.handler = (m, p) async {
        if (m == 'account/status/read') {
          throw const RemoteRpcException(-32601, 'Method not found', null);
        }
        return transport.status;
      };
      await host.refresh();
      expect(transport.calls.last.$1, 'getAuthStatus');
      expect(transport.calls.last.$2, <String, dynamic>{});
      transport.calls.clear();
      transport.handler = (m, p) async => throw TimeoutException('uncertain');
      await host.refresh();
      expect(transport.calls.length, 1);
      expect(host.stale, isTrue);
      expect(host.snapshot?.bridgeVersion, '1.0');
      expect(host.statusError, isNotNull);
    },
  );
  test(
    'late prior session and device snapshots cannot overwrite selected host',
    () async {
      final pending = Completer<RemoteJson>();
      transport.handler = (m, p) => pending.future;
      host.bind(device: 'a', session: 's1', connected: true, trusted: true);
      final old = host.refresh();
      host.bind(device: 'b', session: 's2', connected: true, trusted: true);
      transport.handler = null;
      transport.status['bridgeVersion'] = 'b-version';
      await host.refresh();
      pending.complete({'bridgeVersion': 'wrong-device'});
      await old;
      expect(host.snapshot?.bridgeVersion, 'b-version');
      expect(host.loading, isFalse);
    },
  );
  test(
    'actions use exact methods, trim thread, guard taps and reject false/malformed',
    () async {
      await online();
      transport.calls.clear();
      final pending = Completer<RemoteJson>();
      transport.handler = (m, p) => pending.future;
      final action = host.continueOnDesktop('  thread-1  ');
      expect(await host.continueOnDesktop('thread-1'), isFalse);
      expect(transport.calls.length, 1);
      expect(transport.calls.single.$1, 'desktop/continueOnDesktop');
      expect(transport.calls.single.$2, {'threadId': 'thread-1'});
      pending.complete({'success': false});
      expect(await action, isFalse);
      expect(host.actionError?.kind, HostErrorKind.refused);
      transport.handler = (m, p) async => {};
      expect(await host.wakeDisplay(), isFalse);
      expect(transport.calls.last.$1, 'desktop/wakeDisplay');
      expect(transport.calls.last.$2, <String, dynamic>{});
      expect(await host.continueOnDesktop('   '), isFalse);
    },
  );
  test(
    'uncertain action never replays on status refresh or reconnect',
    () async {
      await online();
      transport.calls.clear();
      transport.handler = (m, p) async {
        if (m.startsWith('desktop/')) throw TimeoutException('uncertain');
        return transport.status;
      };
      expect(await host.continueOnDesktop('t'), isFalse);
      host.bind(device: 'a', session: 's2', connected: true, trusted: true);
      await host.refresh();
      expect(
        transport.calls
            .where((c) => c.$1 == 'desktop/continueOnDesktop')
            .length,
        1,
      );
      expect(host.actionError, isNull);
    },
  );
  test('old action cannot update a new device UI', () async {
    await online();
    final pending = Completer<RemoteJson>();
    transport.handler = (m, p) => pending.future;
    final old = host.continueOnDesktop('t');
    host.bind(device: 'b', session: 's2', connected: true, trusted: true);
    pending.complete({'success': true});
    expect(await old, isFalse);
    expect(host.actionMessage, isNull);
  });
  test(
    'offline wake requires trust then reconnect and fresh capability before single action',
    () async {
      await online();
      host.bind(device: 'a', session: null, connected: false, trusted: true);
      var connects = 0;
      host.connectSaved = (device) async {
        connects++;
        host.bind(
          device: device,
          session: 's2',
          connected: true,
          trusted: true,
        );
        await host.refresh();
      };
      transport.calls.clear();
      expect(await host.wakeDisplay(), isTrue);
      expect(connects, 1);
      expect(
        transport.calls.where((c) => c.$1 == 'desktop/wakeDisplay').length,
        1,
      );
      host.bind(device: 'a', session: null, connected: false, trusted: false);
      expect(await host.wakeDisplay(), isFalse);
      expect(connects, 1);
      host.bind(device: 'a', session: null, connected: false, trusted: true);
      transport.status['hostCapabilities'] = {'displayWake': false};
      expect(await host.wakeDisplay(), isFalse);
      expect(
        transport.calls.where((c) => c.$1 == 'desktop/wakeDisplay').length,
        1,
      );
    },
  );
  test(
    'global keep-awake default persists offline; write failure never syncs',
    () async {
      await host.loadPreference();
      expect(host.keepAwake, isFalse);
      expect(await host.setKeepAwake(true), isTrue);
      expect(store.values['codex.keepMacAwakeWhileBridgeRuns'], true);
      expect(host.preferenceSynced, isFalse);
      store.fail = true;
      expect(await host.setKeepAwake(false), isFalse);
      expect(host.keepAwake, isTrue);
      expect(host.preferenceError, isNotNull);
      expect(transport.calls, isEmpty);
    },
  );
  test(
    'old keep-awake acknowledgement cannot claim a newer toggle synced',
    () async {
      await online();
      final pending = Completer<RemoteJson>();
      transport.handler = (m, p) => pending.future;
      final first = host.setKeepAwake(true);
      await Future<void>.delayed(Duration.zero);
      final second = host.setKeepAwake(false);
      await Future<void>.delayed(Duration.zero);
      expect(host.preferenceSynced, isFalse);
      expect(store.values['codex.keepMacAwakeWhileBridgeRuns'], false);
      pending.complete({'success': true});
      await Future.wait([first, second]);
      await host.syncPreference();
      expect(host.keepAwake, isFalse);
      expect(store.values['codex.keepMacAwakeWhileBridgeRuns'], false);
      expect(transport.calls.last.$1, 'desktop/preferences/update');
      expect(transport.calls.last.$2, {'keepMacAwake': false});
      expect(host.preferenceSynced, isTrue);
    },
  );
  test(
    'update acknowledgement waits for post-reconnect fresh version',
    () async {
      await online();
      expect(await host.updateBridge(), isTrue);
      final updateCall = transport.calls.singleWhere(
        (c) => c.$1 == 'desktop/bridge/updateAndRestart',
      );
      expect(updateCall.$2, <String, dynamic>{});
      expect(host.updateState, HostUpdateState.reconnecting);
      await host.refresh();
      expect(host.updateState, HostUpdateState.reconnecting);
      expect(await host.updateBridge(), isFalse);
      host.bind(device: 'a', session: null, connected: false, trusted: true);
      host.bind(device: 'a', session: 's2', connected: true, trusted: true);
      expect(host.updateState, HostUpdateState.checking);
      transport.status['bridgeVersion'] = '2.0';
      await host.refresh();
      expect(host.updateState, HostUpdateState.verified);
      expect(
        transport.calls
            .where((c) => c.$1 == 'desktop/bridge/updateAndRestart')
            .length,
        1,
      );
    },
  );
  test(
    'fresh session capability read is required before replaying a stored preference or action',
    () async {
      await host.loadPreference();
      await online();
      transport.calls.clear();
      host.bind(device: 'a', session: 's2', connected: true, trusted: true);
      expect(host.canHandoff, isFalse);
      await host.syncPreference();
      expect(transport.calls, isEmpty);
      await host.refresh();
      await host.syncPreference();
      expect(transport.calls.last.$1, 'desktop/preferences/update');
      expect(transport.calls.last.$2, {'keepMacAwake': false});
      await host.syncPreference();
      expect(
        transport.calls
            .where((c) => c.$1 == 'desktop/preferences/update')
            .length,
        1,
      );
    },
  );
  test(
    'explicit preference retry saves the failed desired choice after rollback',
    () async {
      await host.loadPreference();
      store.fail = true;
      expect(await host.setKeepAwake(true), isFalse);
      expect(host.keepAwake, isFalse);
      store.fail = false;
      await host.retryPreference();
      expect(host.keepAwake, isTrue);
      expect(store.values['codex.keepMacAwakeWhileBridgeRuns'], true);
    },
  );
  test(
    'same session reconnect generation rejects old status response',
    () async {
      final pending = Completer<RemoteJson>();
      transport.handler = (m, p) => pending.future;
      host.bind(
        device: 'a',
        session: 's1',
        connected: true,
        trusted: true,
        generation: 1,
      );
      final old = host.refresh();
      host.bind(
        device: 'a',
        session: 's1',
        connected: true,
        trusted: true,
        generation: 2,
      );
      transport.handler = null;
      transport.status['bridgeVersion'] = 'current';
      await host.refresh();
      pending.complete({'bridgeVersion': 'old'});
      await old;
      expect(host.snapshot?.bridgeVersion, 'current');
    },
  );
  test(
    'unsupported RPC keeps code semantics and safe user error; auth failure never falls back',
    () async {
      await online();
      transport.calls.clear();
      transport.handler = (m, p) async => throw const RemoteRpcException(
        -32000,
        'private host error',
        {'errorCode': 'unsupported_platform'},
      );
      expect(await host.continueOnDesktop('t'), isFalse);
      expect(host.actionError?.kind, HostErrorKind.unsupported);
      expect(host.actionError?.rpcCode, -32000);
      expect(host.actionError?.errorCode, 'unsupported_platform');
      expect(host.actionError?.message, isNot(contains('private')));
      await host.refresh();
      expect(transport.calls.where((c) => c.$1 == 'getAuthStatus'), isEmpty);
    },
  );
  test('delayed preference result cannot sync a newly selected host', () async {
    await online();
    final pending = Completer<RemoteJson>();
    transport.handler = (m, p) => pending.future;
    final first = host.setKeepAwake(true);
    await Future<void>.delayed(Duration.zero);
    final newer = host.setKeepAwake(false);
    host.bind(device: 'b', session: 's2', connected: true, trusted: true);
    pending.complete({'success': true});
    await Future.wait([first, newer]);
    expect(host.preferenceSynced, isFalse);
    expect(
      transport.calls.where((c) => c.$1 == 'desktop/preferences/update').length,
      1,
    );
    expect(host.keepAwake, isFalse);
  });
  test(
    'update timeout stays uncertain with no automatic mutation retry',
    () async {
      await online();
      transport.handler = (m, p) async {
        if (m == 'desktop/bridge/updateAndRestart') {
          throw TimeoutException('lost ack');
        }
        return transport.status;
      };
      expect(await host.updateBridge(), isFalse);
      await host.refresh();
      expect(host.canUpdate, isFalse);
      expect(host.actionError?.kind, HostErrorKind.uncertain);
      expect(
        transport.calls
            .where((c) => c.$1 == 'desktop/bridge/updateAndRestart')
            .length,
        1,
      );
    },
  );
  test(
    'legacy trusted macOS does not grant unadvertised bridge updater',
    () async {
      transport.status.remove('hostCapabilities');
      await online();
      expect(host.canHandoff, isTrue);
      expect(host.canUpdate, isFalse);
      expect(await host.updateBridge(), isFalse);
      expect(
        transport.calls.where((c) => c.$1 == 'desktop/bridge/updateAndRestart'),
        isEmpty,
      );
    },
  );
  test(
    'capability snake aliases preserve explicit false for every host action',
    () {
      final caps = HostSnapshot.decode({
        'hostPlatform': 'macos',
        'hostCapabilities': {
          'desktop_handoff': true,
          'display_wake': false,
          'keep_awake': true,
          'host_browser_login': false,
          'terminal': false,
          'bridge_update': true,
          'access_token': 'SECRET',
        },
      }).capabilities(trusted: true);
      expect(caps.desktopHandoff, isTrue);
      expect(caps.displayWake, isFalse);
      expect(caps.keepAwake, isTrue);
      expect(caps.hostBrowserLogin, isFalse);
      expect(caps.terminal, isFalse);
      expect(caps.bridgeUpdate, isTrue);
      expect(jsonEncode(caps.toJson()), isNot(contains('SECRET')));
    },
  );
  test('offline wake cannot survive a selected-device round trip', () async {
    await online();
    host.bind(device: 'a', session: null, connected: false, trusted: true);
    final gate = Completer<void>();
    host.connectSaved = (device) async {
      await gate.future;
      host.bind(device: device, session: 's2', connected: true, trusted: true);
      await host.refresh();
    };
    final wake = host.wakeDisplay();
    expect(await host.wakeDisplay(), isFalse);
    host.bind(device: 'b', session: null, connected: false, trusted: true);
    host.bind(device: 'a', session: null, connected: false, trusted: true);
    gate.complete();
    expect(await wake, isFalse);
    expect(
      transport.calls.where((c) => c.$1 == 'desktop/wakeDisplay'),
      isEmpty,
    );
  });
  test(
    'preference false or malformed success remains persisted but unsynced',
    () async {
      await online();
      for (final response in <RemoteJson>[
        {'success': false},
        {},
        {'success': 'true'},
      ]) {
        transport.handler = (m, p) async => response;
        await host.setKeepAwake(true);
        await host.syncPreference();
        expect(store.values['codex.keepMacAwakeWhileBridgeRuns'], true);
        expect(host.preferenceSynced, isFalse);
        expect(host.preferenceError, isNotNull);
      }
    },
  );
  test(
    'reconnect cannot report update verification without a fresh version',
    () async {
      await online();
      await host.updateBridge();
      host.bind(device: 'a', session: null, connected: false, trusted: true);
      host.bind(device: 'a', session: 's2', connected: true, trusted: true);
      transport.status.remove('bridgeVersion');
      await host.refresh();
      expect(host.updateState, HostUpdateState.checking);
      transport.status['bridgeVersion'] = '1.0';
      await host.refresh();
      expect(host.updateState, HostUpdateState.unchanged);
    },
  );
  for (final rejection in <(String, Object)>[
    (
      'unsupported method',
      const RemoteRpcException(-32601, 'Method not found', null),
    ),
    (
      'unsupported updater',
      const RemoteRpcException(-32000, 'not supported', {
        'errorCode': 'unsupported_bridge_update',
      }),
    ),
    (
      'refused updater',
      const RemoteRpcException(-32000, 'refused', {
        'errorCode': 'bridge_update_failed',
      }),
    ),
    ('success false', <String, dynamic>{'success': false}),
  ]) {
    test(
      'definite updater rejection: ${rejection.$1} clears pending restart and permits only explicit recovery',
      () async {
        await online();
        transport.handler = (method, params) async {
          if (method != 'desktop/bridge/updateAndRestart') {
            return transport.status;
          }
          if (rejection.$2 is RemoteRpcException) throw rejection.$2;
          return rejection.$2 as RemoteJson;
        };
        expect(await host.updateBridge(), isFalse);
        expect(host.updateState, HostUpdateState.idle);
        expect(host.actionError, isNotNull);
        expect(host.canUpdate, isTrue);
        await host.refresh();
        host.bind(device: 'a', session: null, connected: false, trusted: true);
        host.bind(device: 'a', session: 's2', connected: true, trusted: true);
        transport.status['bridgeVersion'] = '2.0';
        await host.refresh();
        expect(host.updateState, HostUpdateState.idle);
        expect(
          transport.calls
              .where((c) => c.$1 == 'desktop/bridge/updateAndRestart')
              .length,
          1,
        );
        transport.handler = null;
        expect(await host.updateBridge(), isTrue);
        expect(host.updateState, HostUpdateState.reconnecting);
        expect(
          transport.calls
              .where((c) => c.$1 == 'desktop/bridge/updateAndRestart')
              .length,
          2,
        );
      },
    );
  }
  test(
    'malformed updater response retains unknown-result restart guard',
    () async {
      await online();
      transport.handler = (method, params) async =>
          method == 'desktop/bridge/updateAndRestart' ? {} : transport.status;
      expect(await host.updateBridge(), isFalse);
      expect(host.actionError?.kind, HostErrorKind.uncertain);
      expect(host.updateState, HostUpdateState.reconnecting);
      await host.refresh();
      expect(await host.updateBridge(), isFalse);
      expect(
        transport.calls
            .where((c) => c.$1 == 'desktop/bridge/updateAndRestart')
            .length,
        1,
      );
    },
  );
}
