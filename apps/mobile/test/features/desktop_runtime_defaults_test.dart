import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_requests_test.dart' show TestTransport;
import 'desktop_recovery_test.dart' show RecoveryMemoryStore;
import 'settings/runtime_defaults_test.dart' show catalog;
import 'settings/settings_controller_test.dart' show MemorySettingsStore;
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'desktop_fork_test.dart' show ForkTransport;

class RuntimeCreationTransport extends TestTransport {
  RuntimeCreationTransport(super.pairings);
  final creation = Completer<void>();
  bool rejectSandbox = false;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': Map.of(params)});
    if (method == 'thread/start') {
      await creation.future;
      if (rejectSandbox && params.containsKey('sandboxPolicy')) {
        throw const RemoteRpcException(-32602, 'Unknown sandboxPolicy', null);
      }
      return {
        'thread': {'id': 'created', 'turns': []},
      };
    }
    if (method == 'thread/list') {
      return {
        'data': [
          {'id': 'old'},
          {'id': 'created'},
        ],
      };
    }
    if (method == 'thread/resume' || method == 'thread/read') {
      return {
        'thread': {'id': params['threadId'], 'turns': []},
      };
    }
    return {
      'turn': {'id': 'turn-1'},
    };
  }
}

void main() {
  test(
    'new chat takes source defaults without rewriting the selected old conversation while creation awaits',
    () async {
      final pairs = PairingRepository(TestCredentials()),
          transport = RuntimeCreationTransport(
            PairingRepository(TestCredentials()),
          );
      final desktop =
          DesktopController(
              pairs,
              connection: transport,
              localStore: RecoveryMemoryStore(),
            )
            ..models = catalog
            ..thread = {'id': 'old'}
            ..model = 'claudeAgent::other'
            ..effort = 'high'
            ..access = 'full-access'
            ..plan = true;
      final creating = desktop.createThread();
      await Future<void>.delayed(Duration.zero);
      final request = transport.calls.single['params'] as Map;
      expect(request['model'], 'gpt-5.5');
      expect(request['djlProvider'], 'codex');
      expect(request['approvalPolicy'], 'on-request');
      expect(request['serviceTier'], 'default');
      desktop.setEffort('high');
      expect(
        desktop.threadList.data.runtimes['old']?['model'],
        'claudeAgent::other',
      );
      expect(desktop.access, 'full-access');
      transport.creation.complete();
      expect(await creating, true);
      expect(desktop.model, 'codex::gpt-5.5');
      expect(desktop.effort, 'high');
      expect(desktop.access, 'on-request');
      expect(desktop.plan, false);
      expect(desktop.threadList.data.runtimes['old']?['access'], 'full-access');
      expect(
        desktop.threadList.data.runtimes['created']?['access'],
        'on-request',
      );
      desktop.dispose();
    },
  );
  test(
    'saved defaults freeze across creation fallback and subsequent turn despite async global edits',
    () async {
      final settings = SettingsController(MemorySettingsStore());
      await settings.load();
      await settings.setRuntimeCatalog(catalog);
      await settings.setRuntimeModel(null);
      await settings.setRuntimeTier('fast');
      final transport = RuntimeCreationTransport(
        PairingRepository(TestCredentials()),
      )..rejectSandbox = true;
      final desktop = DesktopController(
        transport.pairings,
        connection: transport,
        settings: settings,
        localStore: RecoveryMemoryStore(),
      )..models = catalog;
      final sending = desktop.send('hello');
      await Future<void>.delayed(Duration.zero);
      await settings.setRuntimeModel('claudeAgent::other');
      await settings.setRuntimeAccess('full-access');
      transport.creation.complete();
      expect(await sending, true, reason: desktop.error);
      final starts = transport.calls
          .where((c) => c['method'] == 'thread/start')
          .toList();
      expect(starts, hasLength(2));
      for (final call in starts) {
        final params = call['params'] as Map;
        expect(params['model'], 'gpt-5.5');
        expect(params['djlProvider'], 'codex');
        expect(params['serviceTier'], 'fast');
        expect(params['approvalPolicy'], 'on-request');
      }
      final turn =
          transport.calls.firstWhere(
                (c) => c['method'] == 'turn/start',
              )['params']
              as Map;
      expect(turn['model'], 'gpt-5.5');
      expect(turn['effort'], 'medium');
      expect(turn['approvalPolicy'], 'on-request');
      expect(turn['serviceTier'], 'fast');
      expect(settings.runtimeDefaults.modelId, 'claudeAgent::other');
      expect(
        desktop.threadList.data.runtimes['created']?['model'],
        'codex::gpt-5.5',
      );
      desktop.dispose();
    },
  );
  test(
    'global defaults never sync or mutate an existing turn and reopening retains its override',
    () async {
      final settings = SettingsController(MemorySettingsStore());
      await settings.load();
      await settings.setRuntimeCatalog(catalog);
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
            ..models = catalog
            ..thread = {'id': 'old'}
            ..model = 'claudeAgent::other'
            ..effort = 'high'
            ..access = 'full-access'
            ..plan = true
            ..turnId = 'running';
      desktop.setEffort('high');
      await settings.setRuntimeModel('codex::other');
      await settings.setRuntimeAccess('auto-review');
      expect(transport.calls, isEmpty);
      expect(desktop.model, 'claudeAgent::other');
      expect(desktop.access, 'full-access');
      expect(desktop.turnId, 'running');
      await desktop.openThread({'id': 'old'});
      expect(desktop.model, 'claudeAgent::other');
      expect(desktop.effort, 'high');
      expect(desktop.access, 'full-access');
      expect(desktop.plan, true);
      desktop.dispose();
    },
  );
  test(
    'an independent fork inherits source runtime rather than later global defaults',
    () async {
      final settings = SettingsController(MemorySettingsStore());
      await settings.load();
      await settings.setRuntimeCatalog(catalog);
      final transport = ForkTransport(PairingRepository(TestCredentials()));
      final desktop =
          DesktopController(
              transport.pairings,
              connection: transport,
              settings: settings,
              localStore: RecoveryMemoryStore(),
            )
            ..models = catalog
            ..thread = {
              'id': 'source',
              'model': 'other',
              'modelProvider': 'claudeAgent',
            }
            ..model = 'claudeAgent::other'
            ..effort = 'high'
            ..access = 'auto-review'
            ..plan = true;
      expect(await desktop.forkThread(), true, reason: desktop.error);
      expect(desktop.thread?['id'], 'forked');
      expect(desktop.model, 'claudeAgent::other');
      expect(desktop.effort, 'high');
      expect(desktop.access, 'auto-review');
      expect(desktop.plan, true);
      expect(settings.runtimeDefaults.modelId, 'codex::gpt-5.5');
      desktop.dispose();
    },
  );
  test(
    'unselected async creation retains its own defaults without replacing another chat runtime',
    () async {
      final transport = RuntimeCreationTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop =
          DesktopController(
              transport.pairings,
              connection: transport,
              localStore: RecoveryMemoryStore(),
            )
            ..models = catalog
            ..thread = {'id': 'old'}
            ..model = 'claudeAgent::other'
            ..access = 'full-access';
      final creating = desktop.createThread();
      await Future<void>.delayed(Duration.zero);
      desktop.thread = {'id': 'another'};
      desktop.setModel('codex::other');
      transport.creation.complete();
      expect(await creating, false);
      expect(desktop.thread?['id'], 'another');
      expect(desktop.model, 'codex::other');
      expect(
        desktop.threadList.data.runtimes['created']?['model'],
        'codex::gpt-5.5',
      );
      expect(
        desktop.threadList.data.runtimes['another']?['model'],
        'codex::other',
      );
      desktop.dispose();
    },
  );
  test(
    'unreadable defaults or an empty paired catalog block creation without a remote mutation',
    () async {
      final store = MemorySettingsStore()..failRead = true;
      final settings = SettingsController(store);
      await settings.load();
      final transport = RuntimeCreationTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = DesktopController(
        transport.pairings,
        connection: transport,
        settings: settings,
      );
      expect(await desktop.createThread(), false);
      expect(transport.calls, isEmpty);
      store.failRead = false;
      await settings.load();
      expect(await desktop.createThread(), false);
      expect(transport.calls, isEmpty);
      desktop.dispose();
    },
  );
}
