import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/core/security/remote_crypto.dart';
import 'package:djl_mobile/features/desktop/data/desktop_local_store.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import '../core/trusted_device_preferences_test.dart'
    show ActiveWriteCredentials;

Pairing switchPair(String mac, {String? pin}) => Pairing({
  'v': 2,
  'macDeviceId': mac,
  'sessionId': '$mac-session',
  'relay': 'wss://relay.test/relay',
  'macIdentityPublicKey':
      pin ?? base64Encode(List.filled(32, mac.codeUnitAt(0))),
  'expiresAt': 9999999999999,
  'displayName': 'Mac $mac',
});

class SwitchPairings extends PairingRepository {
  SwitchPairings(super.credentials);
  final resolutions = <String>[];
  Completer<Pairing>? resolveGate;
  Object? resolveFailure;
  @override
  Future<Pairing> resolveTrusted(Pairing pair) async {
    resolutions.add(pair.macDeviceId);
    if (resolveGate != null) return resolveGate!.future;
    if (resolveFailure != null) throw resolveFailure!;
    return pair;
  }
}

class SwitchStore extends DesktopLocalStore {
  SwitchStore() : super(TestCredentials());
  final values = <String, RemoteJson>{};
  final writes = <String>[];
  Completer<RemoteJson>? loadGate;
  @override
  Future<RemoteJson> load(String mac) async => loadGate != null
      ? await loadGate!.future
      : jsonDecode(jsonEncode(values[mac] ?? {})) as RemoteJson;
  @override
  Future<void> save(String mac, RemoteJson value) async {
    writes.add(mac);
    values[mac] = jsonDecode(jsonEncode(value)) as RemoteJson;
  }
}

class SwitchTransport extends RemoteTransport {
  SwitchTransport(super.pairings);
  final events = StreamController<RemoteJson>.broadcast(sync: true);
  final calls = <({String? mac, String method, RemoteJson params})>[];
  final connects = <String>[];
  Pairing? current;
  bool online = false;
  int disconnects = 0;
  String? failMethod;
  Object? connectFailure;
  final histories = <String, RemoteJson>{};
  int generation = 0;
  Completer<RemoteJson>? requestGate;
  String? gateMethod;
  @override
  bool get connected => online;
  @override
  String? get macDeviceId => current?.macDeviceId;
  @override
  String? get sessionId => current?.sessionId;
  @override
  Stream<RemoteJson> get messages => events.stream;
  @override
  Future<void> connect(Pairing pair, {required bool bootstrap}) async {
    final attempt = ++generation;
    connects.add(pair.macDeviceId);
    current = pair;
    if (connectFailure != null) throw connectFailure!;
    await pairings.trust(pair, isCurrent: () => attempt == generation);
    if (attempt != generation) throw StateError('Connection cancelled.');
    online = true;
  }

  @override
  Future<void> disconnect() async {
    disconnects++;
    generation++;
    online = false;
  }

  @override
  Future<void> send(RemoteJson message) async {
    calls.add((
      mac: macDeviceId,
      method: message['method'] as String,
      params: Map<String, dynamic>.from(message['params'] as Map),
    ));
  }

  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add((mac: macDeviceId, method: method, params: params));
    if (method == failMethod) throw StateError('Failed $method');
    if (method == gateMethod) return requestGate!.future;
    if (method == 'thread/read') {
      return {
        'thread':
            histories[params['threadId']] ??
            {'id': params['threadId'], 'turns': []},
      };
    }
    if (method == 'thread/list') {
      return {
        'data': [
          {'id': '$macDeviceId-chat', 'name': '$macDeviceId chat'},
        ],
      };
    }
    return {'data': []};
  }

  @override
  Future<void> dispose() async => events.close();
}

Future<
  ({
    DesktopController desktop,
    SwitchPairings pairs,
    SwitchTransport transport,
    SwitchStore store,
    TestCredentials credentials,
  })
>
switchFixture({TestCredentials? storage}) async {
  final credentials = storage ?? TestCredentials();
  final pairs = SwitchPairings(credentials);
  await pairs.trust(switchPair('A'));
  await pairs.trust(switchPair('B'));
  final transport = SwitchTransport(pairs), store = SwitchStore();
  final desktop = DesktopController(
    pairs,
    connection: transport,
    localStore: store,
  );
  await desktop.connect(switchPair('A'));
  await desktop.loadDevicePreferences();
  expect(desktop.connected, isTrue, reason: desktop.error);
  expect(desktop.state, 'connected', reason: desktop.error);
  transport.calls.clear();
  transport.connects.clear();
  transport.disconnects = 0;
  pairs.resolutions.clear();
  return (
    desktop: desktop,
    pairs: pairs,
    transport: transport,
    store: store,
    credentials: credentials,
  );
}

Future<void> drainSwitch() async {
  for (var i = 0; i < 20; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

class FailingSelectionCredentials extends ActiveWriteCredentials {
  bool failBeforeActive = false;
  @override
  Future<void> write(String key, String? value) async {
    if (failBeforeActive && key == 'desktop.active' && value != null) {
      throw StateError('Selected pointer write failed before persistence');
    }
    await super.write(key, value);
  }
}

Future<Map<String, String>> distinctSwitchCaches(
  DesktopController desktop,
  SwitchStore store,
) async {
  await drainSwitch();
  desktop.threadList.data.snapshots.clear();
  desktop.threadList.data.upsert({
    'id': 'A-only-cache',
    'name': 'A private sidebar',
  });
  desktop.threadList.data.drafts['owner'] = 'A draft';
  store.values['B'] = {
    'threads': [
      {'id': 'B-only-cache', 'name': 'B offline sidebar'},
    ],
    'drafts': {'owner': 'B draft'},
    'timelines': {
      'B-only-cache': [
        {'id': 'B-message', 'text': 'B cached message'},
      ],
    },
  };
  await desktop.threadList.saveNow();
  return {
    for (final mac in ['A', 'B']) mac: jsonEncode(store.values[mac]),
  };
}

void expectBSafeFailure(
  DesktopController desktop,
  SwitchStore store,
  Map<String, String> disk,
) {
  expect(desktop.active?.macDeviceId, 'B');
  expect(desktop.threadList.macDeviceId, 'B');
  expect(desktop.threadList.visible.map((row) => row['id']), ['B-only-cache']);
  expect(desktop.threads.map((row) => row['id']), ['B-only-cache']);
  expect(desktop.threadList.data.find('A-only-cache'), isNull);
  expect(desktop.threadList.data.drafts['owner'], 'B draft');
  expect(desktop.timeline, isEmpty);
  expect(desktop.thread, isNull);
  for (final mac in ['A', 'B']) {
    expect(jsonEncode(store.values[mac]), disk[mac]);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'saved switch resolves B before touching live A or its selected timeline',
    () async {
      final f = await switchFixture();
      addTearDown(f.desktop.dispose);
      f.desktop.thread = {'id': 'A-selected'};
      f.desktop.timeline = [
        {'id': 'A-message', 'text': 'keep me'},
      ];
      final cache = f.desktop.threadList.data;
      f.pairs.resolveGate = Completer<Pairing>();
      final pending = f.desktop.selectSaved(switchPair('B'));
      await Future<void>.delayed(Duration.zero);
      final remained =
          f.desktop.active?.macDeviceId == 'A' &&
          f.transport.connected &&
          f.transport.disconnects == 0 &&
          identical(cache, f.desktop.threadList.data) &&
          f.desktop.thread?['id'] == 'A-selected';
      f.pairs.resolveGate!.completeError(
        const RemoteRelayUnavailable('B offline'),
      );
      await pending;
      expect(
        remained,
        isTrue,
        reason: 'A must remain live throughout target resolution',
      );
      expect(f.desktop.active?.macDeviceId, 'A');
      expect(f.desktop.timeline.single['text'], 'keep me');
      expect(f.transport.connects, isEmpty);
    },
  );

  test('wrong-pin trusted resolution cannot tear down A or select B', () async {
    final f = await switchFixture();
    addTearDown(f.desktop.dispose);
    f.pairs.resolveFailure = const RemoteSecurityException(
      'B identity rejected',
    );
    await f.desktop.selectSaved(switchPair('B'));
    expect(f.desktop.active?.macDeviceId, 'A');
    expect(f.transport.connected, isTrue);
    expect(f.transport.disconnects, 0);
    expect(f.transport.connects, isEmpty);
  });
  test(
    'successful saved switch commits B only after model sync and keeps both drafts',
    () async {
      final f = await switchFixture();
      addTearDown(f.desktop.dispose);
      f.desktop.threadList.data.drafts['same'] = 'A draft';
      f.store.values['B'] = {
        'drafts': {'same': 'B draft'},
        'timelines': {
          'same': [
            {'id': 'old', 'text': 'old B history'},
          ],
        },
      };
      final oldB = jsonEncode(f.store.values['B']);
      f.transport.gateMethod = 'model/list';
      f.transport.requestGate = Completer<RemoteJson>();
      final pending = f.desktop.selectSaved(switchPair('B'));
      await drainSwitch();
      expect(f.desktop.active?.macDeviceId, 'B');
      expect(f.desktop.previousDevice?.macDeviceId, 'A');
      expect(f.desktop.timeline, isEmpty);
      expect(f.desktop.thread, isNull);
      expect(jsonEncode(f.store.values['B']), oldB);
      expect(f.store.values['A']?['drafts'], {'same': 'A draft'});
      f.transport.requestGate!.complete({'data': []});
      await pending;
      expect(f.desktop.state, 'connected');
      expect(f.desktop.previousDevice, isNull);
      expect(f.desktop.threadList.data.drafts['same'], 'B draft');
      expect(f.desktop.switchingDevice, isNull);
      await f.desktop.cancelSavedSwitch();
      expect(f.desktop.active?.macDeviceId, 'B');
      expect(f.desktop.connected, isTrue);
    },
  );

  for (final failure in ['secure', 'initialize', 'thread/list', 'model/list']) {
    test(
      'post teardown $failure failure keeps B disconnected and original caches',
      () async {
        final f = await switchFixture();
        addTearDown(f.desktop.dispose);
        f.store.values['B'] = {
          'drafts': {'same': 'B original'},
          'threads': [
            {'id': 'old-B'},
          ],
        };
        final original = jsonEncode(f.store.values['B']);
        f.desktop.threadList.data.drafts['same'] = 'A original';
        if (failure == 'secure') {
          f.transport.connectFailure = StateError('secure failed');
        } else {
          f.transport.failMethod = failure;
        }
        await f.desktop.selectSaved(switchPair('B'));
        expect(f.desktop.active?.macDeviceId, 'B');
        expect(f.credentials.values['desktop.active'], 'B');
        final coldStore = SwitchStore()..values.addAll(f.store.values);
        final cold = DesktopController(
          f.pairs,
          connection: SwitchTransport(f.pairs),
          localStore: coldStore,
        );
        await cold.restore();
        expect(cold.active?.macDeviceId, 'B');
        cold.dispose();
        expect(f.desktop.previousDevice?.macDeviceId, 'A');
        expect(f.desktop.connected, isFalse);
        expect(f.desktop.state, 'disconnected');
        expect(f.desktop.automaticConnectionAllowed, isFalse);
        expect(jsonEncode(f.store.values['B']), original);
        expect(f.store.values['A']?['drafts'], {'same': 'A original'});
        expect(f.desktop.timeline, isEmpty);
        expect(f.desktop.models, isEmpty);
        f.desktop.suspend();
        f.desktop.resume();
        await drainSwitch();
        expect(f.pairs.resolutions, ['B']);
        expect(
          f.transport.calls.where(
            (c) => {
              'turn/start',
              'turn/interrupt',
              'git/revertPatchApply',
            }.contains(c.method),
          ),
          isEmpty,
        );
      },
    );
  }

  test(
    'confirmation captures exact trust lifetime and source navigation',
    () async {
      final f = await switchFixture();
      addTearDown(f.desktop.dispose);
      final captured = f.desktop.prepareSavedSwitch(switchPair('B'))!;
      await f.pairs.forget(switchPair('B'));
      await f.pairs.trust(switchPair('B'));
      await f.desktop.switchSaved(captured, confirmed: true);
      expect(f.pairs.resolutions, isEmpty);
      expect(f.desktop.active?.macDeviceId, 'A');
      expect(f.transport.disconnects, 0);
      await f.desktop.loadDevicePreferences();
      final next = f.desktop.prepareSavedSwitch(switchPair('B'))!;
      f.desktop.cancelNavigation();
      await f.desktop.switchSaved(next, confirmed: true);
      expect(f.pairs.resolutions, isEmpty);
      expect(f.transport.disconnects, 0);
      expect(f.desktop.prepareSavedSwitch(switchPair('A')), isNull);
    },
  );

  test(
    'switch cancel during resolve clears selection and late result cannot beat new intent',
    () async {
      final f = await switchFixture();
      addTearDown(f.desktop.dispose);
      final gate = f.pairs.resolveGate = Completer<Pairing>();
      final old = f.desktop.selectSaved(switchPair('B'));
      await drainSwitch();
      await f.desktop.cancelSavedSwitch();
      expect(f.desktop.active, isNull);
      expect(f.credentials.values['desktop.active'], isNull);
      expect(f.desktop.previousDevice?.macDeviceId, 'A');
      expect(f.desktop.automaticConnectionAllowed, isFalse);
      f.desktop.resume();
      await drainSwitch();
      expect(f.transport.connects, isEmpty);
      f.pairs.resolveGate = null;
      f.transport.gateMethod = 'initialize';
      f.transport.requestGate = Completer<RemoteJson>();
      final next = f.desktop.selectSaved(switchPair('A'));
      await drainSwitch();
      expect(f.desktop.busy, isTrue);
      gate.complete(switchPair('B'));
      await old;
      expect(f.desktop.busy, isTrue);
      expect(f.desktop.active?.macDeviceId, 'A');
      f.transport.requestGate!.complete({});
      await next;
      expect(f.desktop.state, 'connected');
      expect(f.transport.connects, ['A']);
    },
  );

  for (final stage in ['initialize', 'thread/list', 'model/list']) {
    test(
      'cancel during $stage fences late reads and leaves cache unmodified',
      () async {
        final f = await switchFixture();
        addTearDown(f.desktop.dispose);
        f.store.values['B'] = {
          'drafts': {'x': 'original'},
        };
        final original = jsonEncode(f.store.values['B']);
        f.transport.gateMethod = stage;
        f.transport.requestGate = Completer<RemoteJson>();
        final pending = f.desktop.selectSaved(switchPair('B'));
        await drainSwitch();
        await f.desktop.cancelSavedSwitch();
        final sent = f.transport.calls.length;
        f.transport.requestGate!.complete({'data': []});
        await pending;
        expect(f.transport.calls.length, sent);
        expect(f.desktop.active, isNull);
        expect(f.desktop.connected, isFalse);
        expect(f.credentials.values['desktop.active'], isNull);
        expect(jsonEncode(f.store.values['B']), original);
        expect(f.desktop.threadList.macDeviceId, isNull);
      },
    );
  }

  test(
    'all known live threads interrupt once in order; replay and synthetic IDs require a verified read',
    () async {
      final f = await switchFixture();
      addTearDown(f.desktop.dispose);
      void event(String thread, String turn, {bool replay = false}) =>
          f.transport.events.add({
            'method': 'turn/started',
            'djlReplayedEvent': replay,
            'params': {
              'threadId': thread,
              'turn': {'id': turn},
            },
          });
      event('z', 'real-z');
      event('a', 'real-a');
      event('a', 'real-a');
      event('replay', 'not-live', replay: true);
      event('synthetic', 'turn-line-1');
      f.transport.histories['replay'] = {
        'id': 'replay',
        'turns': [
          {'id': 'verified', 'status': 'inProgress'},
        ],
      };
      f.transport.histories['synthetic'] = {
        'id': 'synthetic',
        'turns': [
          {'id': 'rollout-fake', 'status': 'inProgress'},
        ],
      };
      expect(f.desktop.switchNeedsConfirmation, isTrue);
      final intent = f.desktop.prepareSavedSwitch(switchPair('B'))!;
      await f.desktop.switchSaved(intent);
      expect(f.pairs.resolutions, isEmpty);
      await f.desktop.switchSaved(intent, confirmed: true);
      expect(
        f.transport.calls
            .where((c) => c.method == 'turn/interrupt')
            .map((c) => (c.mac, c.params['threadId'], c.params['turnId']))
            .toList(),
        [
          ('A', 'a', 'real-a'),
          ('A', 'replay', 'verified'),
          ('A', 'z', 'real-z'),
        ],
      );
      expect(f.desktop.switchNotice, contains('could not be confirmed'));
      expect(f.desktop.active?.macDeviceId, 'B');
    },
  );

  test(
    'bounded interruption continues with uncertainty and late completion sends nothing else',
    () async {
      final f = await switchFixture();
      addTearDown(f.desktop.dispose);
      for (final id in ['a', 'b']) {
        f.transport.events.add({
          'method': 'turn/started',
          'params': {
            'threadId': id,
            'turn': {'id': 'turn-$id'},
          },
        });
      }
      f.transport.gateMethod = 'turn/interrupt';
      f.transport.requestGate = Completer<RemoteJson>();
      final watch = Stopwatch()..start();
      await f.desktop.switchSaved(
        f.desktop.prepareSavedSwitch(switchPair('B'))!,
        confirmed: true,
      );
      expect(watch.elapsedMilliseconds, lessThan(2500));
      expect(f.desktop.active?.macDeviceId, 'B');
      expect(f.desktop.switchNotice, contains('may still be running'));
      f.transport.requestGate!.complete({});
      await drainSwitch();
      expect(
        f.transport.calls.where((c) => c.method == 'turn/interrupt'),
        hasLength(1),
      );
    },
  );

  test(
    'manual pause fences inflight reconnect and survives suspend resume until explicit choice',
    () async {
      final f = await switchFixture();
      addTearDown(f.desktop.dispose);
      await f.desktop.disconnect();
      final gate = f.pairs.resolveGate = Completer<Pairing>();
      final reconnect = f.desktop.reconnect();
      await drainSwitch();
      expect(f.desktop.canEnterManualPairing, isTrue);
      f.desktop.pauseForManualPairing();
      f.desktop.suspend();
      f.desktop.resume();
      gate.complete(switchPair('A'));
      await reconnect;
      await drainSwitch();
      expect(f.desktop.connected, isFalse);
      expect(f.desktop.busy, isFalse);
      expect(f.desktop.automaticConnectionAllowed, isFalse);
      expect(f.transport.connects, isEmpty);
      f.pairs.resolveGate = null;
      await f.desktop.reconnect();
      expect(f.desktop.connected, isTrue);
    },
  );

  test(
    'cancel during target cache load cannot attach late cached messages',
    () async {
      final f = await switchFixture();
      addTearDown(f.desktop.dispose);
      f.store.loadGate = Completer<RemoteJson>();
      final pending = f.desktop.selectSaved(switchPair('B'));
      await drainSwitch();
      await f.desktop.cancelSavedSwitch();
      f.store.loadGate!.complete({
        'threads': [
          {'id': 'late'},
        ],
        'timelines': {
          'late': [
            {'id': 'old', 'text': 'must stay hidden'},
          ],
        },
      });
      await pending;
      expect(f.desktop.active, isNull);
      expect(f.desktop.threadList.macDeviceId, isNull);
      expect(f.desktop.timeline, isEmpty);
      expect(f.desktop.threads, isEmpty);
      expect(f.transport.connects, isEmpty);
    },
  );

  test(
    'source chat changed during consent cannot switch the captured operation',
    () async {
      final f = await switchFixture();
      addTearDown(f.desktop.dispose);
      final intent = f.desktop.prepareSavedSwitch(switchPair('B'))!;
      await f.desktop.openThread({
        'id': 'new-selection',
      }, readOnlyNavigation: true);
      f.transport.calls.clear();
      await f.desktop.switchSaved(intent, confirmed: true);
      expect(f.pairs.resolutions, isEmpty);
      expect(f.transport.disconnects, 0);
      expect(f.desktop.active?.macDeviceId, 'A');
      expect(f.desktop.thread?['id'], 'new-selection');
    },
  );

  test(
    'lock cancels a pending switch and late resolution cannot regain authority',
    () async {
      final f = await switchFixture();
      addTearDown(f.desktop.dispose);
      f.pairs.resolveGate = Completer<Pairing>();
      final pending = f.desktop.selectSaved(switchPair('B'));
      await drainSwitch();
      f.desktop.setRoutingAllowed(false);
      await drainSwitch();
      f.pairs.resolveGate!.complete(switchPair('B'));
      await pending;
      f.desktop.setRoutingAllowed(true);
      f.desktop.resume();
      await drainSwitch();
      expect(f.desktop.active, isNull);
      expect(f.desktop.automaticConnectionAllowed, isFalse);
      expect(f.transport.connects, isEmpty);
      expect(f.credentials.values['desktop.active'], isNull);
    },
  );
  test(
    'qualified hidden target resolves before teardown then reads only its captured link',
    () async {
      final f = await switchFixture();
      addTearDown(f.desktop.dispose);
      final b = switchPair('B');
      await f.desktop.setDeviceMenuVisibility(
        f.desktop.devicePreferences(b)!,
        false,
      );
      final link = DesktopLinkTarget(
        'same',
        macId: 'B',
        macKeySha256: DesktopLinkTarget.keyFingerprint(b.publicKey),
      );
      f.desktop.queueNavigation(link, forceHostChoice: true);
      final intent = f.desktop.prepareSavedSwitch(b)!;
      f.pairs.resolveGate = Completer<Pairing>();
      final switching = f.desktop.switchSaved(intent);
      await drainSwitch();
      expect(f.desktop.active?.macDeviceId, 'A');
      expect(f.transport.disconnects, 0);
      expect(
        f.transport.calls.where((c) => c.method == 'thread/read'),
        isEmpty,
      );
      f.pairs.resolveGate!.complete(b);
      await switching;
      await f.desktop.routeNavigation();
      expect(f.desktop.navigationDisplayTarget, link);
      expect(
        f.transport.calls
            .where((c) => c.method == 'thread/read')
            .map((c) => c.mac),
        ['B'],
      );
    },
  );
  test(
    'switch cancellation preserves a newer qualified navigation intent',
    () async {
      final f = await switchFixture();
      addTearDown(f.desktop.dispose);
      f.pairs.resolveGate = Completer<Pairing>();
      final switching = f.desktop.selectSaved(switchPair('B'));
      await drainSwitch();
      final newer = DesktopLinkTarget(
        'newer',
        macId: 'A',
        macKeySha256: DesktopLinkTarget.keyFingerprint(
          switchPair('A').publicKey,
        ),
      );
      f.desktop.queueNavigation(newer, forceHostChoice: true);
      await f.desktop.cancelSavedSwitch();
      f.pairs.resolveGate!.complete(switchPair('B'));
      await switching;
      expect(f.desktop.navigationTarget, newer);
      expect(f.desktop.active, isNull);
      expect(f.desktop.navigationNeedsHost, isTrue);
      expect(f.transport.connects, isEmpty);
    },
  );
  test(
    'late selected-pointer write settles before cancellation clears it',
    () async {
      final storage = ActiveWriteCredentials();
      final f = await switchFixture(storage: storage);
      addTearDown(f.desktop.dispose);
      final disk = await distinctSwitchCaches(f.desktop, f.store);
      storage.activeGate = Completer<void>();
      final switching = f.desktop.selectSaved(switchPair('B'));
      await drainSwitch();
      expectBSafeFailure(f.desktop, f.store, disk);
      final cancelling = f.desktop.cancelSavedSwitch();
      await drainSwitch();
      expect(f.desktop.cancellingSwitch, isTrue);
      expect(f.desktop.active, isNull);
      storage.activeGate!.complete();
      await cancelling;
      await switching;
      expect(storage.values['desktop.active'], isNull);
      for (final mac in ['A', 'B']) {
        expect(jsonEncode(f.store.values[mac]), disk[mac]);
      }
      expect(f.transport.connects, isEmpty);
      expect(f.desktop.busy, isFalse);
      final cold = DesktopController(
        f.pairs,
        connection: SwitchTransport(f.pairs),
        localStore: f.store,
      );
      await cold.restore();
      expect(cold.active, isNull);
      cold.dispose();
    },
  );

  test(
    'persisted selection uncertainty and recovery-read failure never claim rollback or permit a new write',
    () async {
      final storage = ActiveWriteCredentials();
      final f = await switchFixture(storage: storage);
      addTearDown(f.desktop.dispose);
      final disk = await distinctSwitchCaches(f.desktop, f.store);
      storage.persistThenThrow = true;
      await f.desktop.selectSaved(switchPair('B'));
      expectBSafeFailure(f.desktop, f.store, disk);
      expect(f.desktop.active?.macDeviceId, 'B');
      expect(storage.values['desktop.active'], 'B');
      expect(f.desktop.connected, isFalse);
      expect(f.desktop.error, contains('Could not confirm'));
      expect(f.desktop.previousDevice?.macDeviceId, 'A');
      storage.persistThenThrow = false;
      storage.failRecovery = true;
      final writes = storage.writes;
      await f.desktop.reconnect();
      expect(storage.writes, writes);
      expect(f.desktop.error, contains('recover the saved selection'));
      expect(f.desktop.connected, isFalse);
      storage.failRecovery = false;
      await f.desktop.reconnect();
      expect(f.desktop.connected, isTrue);
      expect(storage.values['desktop.active'], 'B');
    },
  );
  test(
    'live starting status without a turn requires consent and resolves a real ID by read',
    () async {
      final f = await switchFixture();
      addTearDown(f.desktop.dispose);
      f.transport.events.add({
        'method': 'thread/status/changed',
        'params': {
          'threadId': 'starting',
          'status': {'type': 'pending'},
        },
      });
      expect(f.desktop.switchNeedsConfirmation, isTrue);
      f.transport.histories['starting'] = {
        'id': 'starting',
        'turns': [
          {'id': 'verified-start', 'status': 'inProgress'},
        ],
      };
      await f.desktop.switchSaved(
        f.desktop.prepareSavedSwitch(switchPair('B'))!,
        confirmed: true,
      );
      expect(
        f.transport.calls
            .where((c) => c.method == 'turn/interrupt')
            .map((c) => c.params['turnId']),
        ['verified-start'],
      );
      expect(
        f.transport.calls.where((c) => c.method == 'thread/resume'),
        isEmpty,
      );
    },
  );
  for (final mode in ['before persistence', 'recovery refusal']) {
    test(
      'selected pointer $mode keeps B cache ownership and both disk snapshots',
      () async {
        final storage = FailingSelectionCredentials();
        final f = await switchFixture(storage: storage);
        addTearDown(f.desktop.dispose);
        final disk = await distinctSwitchCaches(f.desktop, f.store);
        if (mode == 'before persistence') {
          storage.failBeforeActive = true;
        } else {
          storage.persistThenThrow = true;
          await expectLater(f.pairs.trust(switchPair('A')), throwsStateError);
          storage.persistThenThrow = false;
          storage.failRecovery = true;
        }
        await f.desktop.selectSaved(switchPair('B'));
        expectBSafeFailure(f.desktop, f.store, disk);
        expect(f.desktop.previousDevice?.macDeviceId, 'A');
        expect(f.desktop.connected, isFalse);
        expect(f.desktop.automaticConnectionAllowed, isFalse);
        expect(storage.values['desktop.active'], 'A');
        expect(f.transport.connects, isEmpty);
      },
    );
  }
}
