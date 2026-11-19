import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_recovery_test.dart' show RecoveryMemoryStore;
import 'desktop_runtime_defaults_test.dart' show RuntimeCreationTransport;
import 'settings/runtime_defaults_test.dart' show catalog;
import 'settings/settings_controller_test.dart' show MemorySettingsStore;

final firstSendCatalog = <RemoteJson>[
  ...catalog.take(3),
  {
    ...catalog[3],
    'supportedReasoningEfforts': ['low', 'high'],
    'supportsFastMode': true,
  },
];

class BlockedRefreshTransport extends RuntimeCreationTransport {
  BlockedRefreshTransport(super.pairings);
  final refreshing = Completer<void>(), refresh = Completer<void>();
  @override
  String? get macDeviceId => 'mac-a';
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'thread/list' && !refresh.isCompleted) {
      if (!refreshing.isCompleted) refreshing.complete();
      await refresh.future;
    }
    if (method == 'turn/start' && params.containsKey('sandboxPolicy')) {
      calls.add({'method': method, 'params': Map.of(params)});
      throw const RemoteRpcException(-32602, 'Unknown sandboxPolicy', null);
    }
    return super.request(method, params, timeout: timeout);
  }
}

Future<void> chooseComposer(DesktopController desktop) async {
  desktop.setModel('claudeAgent::other');
  desktop.setEffort('low');
  await desktop.setAccess('full-access');
  desktop.setPlan(true);
  desktop.setServiceTier('fast');
}

void expectComposerWire(Map params, {required bool turn}) {
  expect(params['model'], 'other');
  expect(params['djlProvider'], 'claudeAgent');
  expect(params['approvalPolicy'], 'never');
  expect(params['serviceTier'], 'fast');
  if (turn) {
    expect(params['effort'], 'low');
    expect(params['collaborationMode'], {
      'mode': 'plan',
      'settings': {
        'model': 'other',
        'reasoning_effort': 'low',
        'developer_instructions': null,
      },
    });
  }
}

void main() {
  test(
    'first send honors explicit composer model provider reasoning access plan and tier with injected defaults',
    () async {
      final store = MemorySettingsStore();
      final globals = SettingsController(store);
      await globals.load();
      await globals.setRuntimeCatalog(firstSendCatalog);
      final persisted = Map.of(store.values);
      final transport = RuntimeCreationTransport(
        PairingRepository(TestCredentials()),
      )..creation.complete();
      final desktop = DesktopController(
        transport.pairings,
        connection: transport,
        settings: globals,
        localStore: RecoveryMemoryStore(),
      )..models = firstSendCatalog;
      await chooseComposer(desktop);
      expect(await desktop.send('first message'), true, reason: desktop.error);
      expectComposerWire(
        transport.calls.firstWhere(
              (call) => call['method'] == 'thread/start',
            )['params']
            as Map,
        turn: false,
      );
      expectComposerWire(
        transport.calls.firstWhere(
              (call) => call['method'] == 'turn/start',
            )['params']
            as Map,
        turn: true,
      );
      expect(store.values, persisted);
      expect(desktop.model, 'claudeAgent::other');
      expect(desktop.plan, true);
      desktop.dispose();
      globals.dispose();
    },
  );
  test(
    'closing a selected thread initializes the new empty composer from global defaults without rewriting the old runtime',
    () async {
      final settings = SettingsController(MemorySettingsStore());
      await settings.load();
      await settings.setRuntimeCatalog(firstSendCatalog);
      final transport = RuntimeCreationTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop =
          DesktopController(
              transport.pairings,
              connection: transport,
              settings: settings,
              localStore: RecoveryMemoryStore(),
            )
            ..models = firstSendCatalog
            ..thread = {'id': 'old'};
      await chooseComposer(desktop);
      desktop.closeThread('old');
      expect(desktop.thread, isNull);
      expect(desktop.model, 'codex::gpt-5.5');
      expect(desktop.access, 'on-request');
      expect(desktop.plan, false);
      expect(
        desktop.threadList.data.runtimes['old']?['model'],
        'claudeAgent::other',
      );
      expect(desktop.threadList.data.runtimes['old']?['plan'], true);
      expect(transport.calls, isEmpty);
      desktop.dispose();
    },
  );
  test(
    'initial turn and compatibility retries retain creation snapshot through blocked refresh while later thread edits survive',
    () async {
      final settings = SettingsController(MemorySettingsStore());
      await settings.load();
      await settings.setRuntimeCatalog(firstSendCatalog);
      final transport = BlockedRefreshTransport(
        PairingRepository(TestCredentials()),
      )..creation.complete();
      final desktop = DesktopController(
        transport.pairings,
        connection: transport,
        settings: settings,
        localStore: RecoveryMemoryStore(),
      )..models = firstSendCatalog;
      desktop.active = const Pairing({'macDeviceId': 'mac-a'});
      await desktop.threadList.attach('mac-a');
      await chooseComposer(desktop);
      final sending = desktop.send('first message');
      await transport.refreshing.future.timeout(const Duration(seconds: 2));
      expect(desktop.busy, true);
      expect(desktop.thread?['id'], 'created');
      desktop.setModel('codex::other');
      await desktop.setAccess('on-request');
      desktop.setEffort('low');
      desktop.setPlan(false);
      desktop.setServiceTier('default');
      transport.refresh.complete();
      expect(await sending, true, reason: desktop.error);
      final turns = transport.calls
          .where((call) => call['method'] == 'turn/start')
          .toList();
      expect(turns, hasLength(2));
      for (final call in turns) {
        expectComposerWire(call['params'] as Map, turn: true);
      }
      expectComposerWire(
        transport.calls.firstWhere(
              (call) => call['method'] == 'thread/start',
            )['params']
            as Map,
        turn: false,
      );
      expect((turns.last['params'] as Map)['sandbox'], 'danger-full-access');
      expect(desktop.model, 'codex::other');
      expect(desktop.access, 'on-request');
      expect(desktop.plan, false);
      expect(
        desktop.threadList.data.runtimes['created']?['model'],
        'codex::other',
      );
      desktop.turnId = null;
      expect(await desktop.send('later message'), true, reason: desktop.error);
      final later = transport.calls.last['params'] as Map;
      expect(later['model'], 'other');
      expect(later['djlProvider'], 'codex');
      expect(later['approvalPolicy'], 'on-request');
      expect(later['serviceTier'], 'default');
      expect(later.containsKey('collaborationMode'), false);
      expect(settings.runtimeDefaults.modelId, 'codex::gpt-5.5');
      desktop.dispose();
    },
  );
}
