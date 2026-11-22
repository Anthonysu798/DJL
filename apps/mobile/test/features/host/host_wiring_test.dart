import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'host_controller_test.dart' show HostTransport, HostStore;
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import '../desktop_recovery_test.dart' show RecoveryMemoryStore;

class WiredHostTransport extends HostTransport {
  final events = StreamController<RemoteJson>.broadcast(sync: true);
  String mac = 'a', sid = 's1';
  bool online = true;
  @override
  String get macDeviceId => mac;
  @override
  String get sessionId => sid;
  @override
  bool get connected => online;
  @override
  Stream<RemoteJson> get messages => events.stream;
  @override
  Future<void> dispose() async => events.close();
}

void main() {
  test(
    'account events refresh before selected-thread filtering; foreground refreshes',
    () async {
      final transport = WiredHostTransport();
      final desktop =
          DesktopController(
              transport.pairings,
              connection: transport,
              localStore: RecoveryMemoryStore(),
            )
            ..active = const Pairing({
              'macDeviceId': 'a',
              'sessionId': 's1',
              'macIdentityPublicKey': 'key',
            })
            ..thread = {'id': 'selected'};
      addTearDown(desktop.dispose);
      await desktop.refreshHost();
      expect(desktop.host.snapshot?.bridgeVersion, '1.0');
      transport.status['bridgeVersion'] = '2.0';
      transport.events.add({
        'method': 'account/updated',
        'params': {'threadId': 'other'},
      });
      await Future<void>.delayed(Duration.zero);
      expect(desktop.host.snapshot?.bridgeVersion, '2.0');
      transport.status['bridgeVersion'] = '4.0';
      desktop.resume();
      await Future<void>.delayed(Duration.zero);
      expect(desktop.host.snapshot?.bridgeVersion, '4.0');
      expect(desktop.thread?['id'], 'selected');
      transport.status['bridgeVersion'] = 'wrong';
      transport.events.add({
        'method': 'account/updated',
        '_macDeviceId': 'other',
        '_sessionId': 's1',
        'params': {},
      });
      await Future<void>.delayed(Duration.zero);
      expect(desktop.host.snapshot?.bridgeVersion, '4.0');
    },
  );
  test(
    'an old desktop refresh continuation cannot sync a newly selected host',
    () async {
      final transport = WiredHostTransport();
      final settings = SettingsController(HostStore());
      final desktop =
          DesktopController(
              transport.pairings,
              connection: transport,
              settings: settings,
              localStore: RecoveryMemoryStore(),
            )
            ..active = const Pairing({
              'macDeviceId': 'a',
              'sessionId': 's1',
              'macIdentityPublicKey': 'key',
            });
      addTearDown(desktop.dispose);
      addTearDown(settings.dispose);
      await desktop.host.loadPreference();
      final oldStatus = Completer<RemoteJson>();
      transport.handler = (m, p) => oldStatus.future;
      final oldRefresh = desktop.refreshHost();
      transport.mac = 'b';
      transport.sid = 's2';
      desktop.active = const Pairing({
        'macDeviceId': 'b',
        'sessionId': 's2',
        'macIdentityPublicKey': 'key2',
      });
      desktop.host.bind(
        device: 'b',
        session: 's2',
        connected: true,
        trusted: false,
      );
      transport.handler = null;
      await desktop.host.refresh();
      oldStatus.complete(transport.status);
      await oldRefresh;
      expect(
        transport.calls.where((c) => c.$1 == 'desktop/preferences/update'),
        isEmpty,
      );
    },
  );
  test(
    'ordinary account and foreground refresh never replay an uncertain preference; explicit sync and real reconnect recover',
    () async {
      final transport = WiredHostTransport();
      final store = HostStore();
      final settings = SettingsController(store);
      final desktop =
          DesktopController(
              transport.pairings,
              connection: transport,
              settings: settings,
              localStore: RecoveryMemoryStore(),
            )
            ..active = const Pairing({
              'macDeviceId': 'a',
              'sessionId': 's1',
              'macIdentityPublicKey': 'key',
            });
      addTearDown(desktop.dispose);
      addTearDown(settings.dispose);
      await desktop.host.loadPreference();
      await desktop.host.setKeepAwake(true);
      var failPreference = true;
      transport.handler = (method, params) async {
        if (method == 'desktop/preferences/update') {
          if (failPreference) throw TimeoutException('uncertain fixture write');
          return {'success': true};
        }
        return Map.of(transport.status);
      };
      int writes() => transport.calls
          .where((c) => c.$1 == 'desktop/preferences/update')
          .length;
      await desktop.refreshHost();
      expect(writes(), 1);
      expect(store.values['codex.keepMacAwakeWhileBridgeRuns'], true);
      expect(desktop.host.preferenceError, isNotNull);
      for (final event in ['account/updated']) {
        transport.status['bridgeVersion'] = event;
        transport.events.add({
          'method': event,
          'params': {'threadId': 'other', 'success': true},
        });
        await Future<void>.delayed(Duration.zero);
        expect(desktop.host.snapshot?.bridgeVersion, event);
        expect(writes(), 1);
      }
      transport.status['bridgeVersion'] = 'foreground';
      desktop.resume();
      await Future<void>.delayed(Duration.zero);
      expect(desktop.host.snapshot?.bridgeVersion, 'foreground');
      expect(
        transport.calls.where((c) => c.$1 == 'account/status/read').length,
        3,
      );
      expect(writes(), 1);
      failPreference = false;
      await desktop.host.syncPreference();
      expect(writes(), 2);
      expect(desktop.host.preferenceSynced, isTrue);
      failPreference = true;
      await desktop.host.setKeepAwake(false);
      await Future<void>.delayed(Duration.zero);
      expect(writes(), 3);
      expect(desktop.host.preferenceSynced, isFalse);
      failPreference = false;
      transport.online = false;
      desktop.host.bind(
        device: 'a',
        session: 's1',
        connected: false,
        trusted: false,
      );
      // A secure reconnect may reuse the relay session identifier.
      transport.sid = 's1';
      transport.online = true;
      await desktop.refreshHost();
      expect(writes(), 4);
      expect(transport.calls.last.$2, {'keepMacAwake': false});
      expect(desktop.host.preferenceSynced, isTrue);
      await desktop.refreshHost();
      expect(writes(), 4);
    },
  );
}
