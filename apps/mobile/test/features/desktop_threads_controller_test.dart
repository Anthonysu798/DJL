import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/desktop_local_store.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_threads_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'workspace_repository_test.dart' show WorkspaceTransport;
import '../core/cloud_client_test.dart' show TestCredentials;

class TemporarilyLockedCredentials extends TestCredentials {
  bool locked = false;
  @override
  Future<String?> read(String key) async {
    if (locked) throw StateError('Device locked');
    return super.read(key);
  }
}

class ThreadTransport extends WorkspaceTransport {
  bool online = true;
  Object? failure;
  @override
  bool get connected => online;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': params});
    if (failure != null) {
      throw failure!;
    }
    return response;
  }
}

void main() {
  test('failed cache load preserves ciphertext and can be retried', () async {
    final root = await Directory.systemTemp.createTemp('djl-cache-retry-');
    final credentials = TemporarilyLockedCredentials();
    final original = DesktopLocalStore(credentials, root: root);
    await original.save('qa-mac', {
      'threads': [
        {'id': 't1', 'name': 'Saved chat'},
      ],
      'drafts': {'t1': 'Recoverable draft'},
    });
    final file =
        (await root
                .list(recursive: true)
                .where((e) => e is File)
                .cast<File>()
                .toList())
            .single;
    final ciphertext = await file.readAsString();
    credentials.locked = true;
    final store = DesktopLocalStore(credentials, root: root);
    final threads = DesktopThreadsController(ThreadTransport(), store);
    try {
      await threads.attach('qa-mac');
      expect(threads.localError, isNotNull);
      await threads.refresh();
      credentials.locked = false;
      await threads.saveNow();
      expect(await file.readAsString(), ciphertext);
      await threads.attach('qa-mac');
      expect(threads.localError, isNull);
      expect(threads.data.drafts['t1'], 'Recoverable draft');
      await threads.saveNow();
      expect((await store.load('qa-mac'))['drafts'], {
        't1': 'Recoverable draft',
      });
    } finally {
      threads.dispose();
      await store.flush();
      await root.delete(recursive: true);
    }
  });
  test(
    'local rename/archive/pin persist when RPC is unavailable and mutations use exact Swift contracts',
    () async {
      final root = await Directory.systemTemp.createTemp(
        'djl-thread-controls-',
      );
      final transport = ThreadTransport();
      final store = DesktopLocalStore(TestCredentials(), root: root);
      final threads = DesktopThreadsController(transport, store);
      try {
        await threads.attach('qa-mac');
        threads.data.mergeServer([
          {'id': 't1', 'name': 'Original'},
          {'id': 'child', 'parentThreadId': 't1'},
        ]);
        await threads.pin('child', true);
        expect(threads.data.isPinned('t1'), isTrue);
        transport.failure = StateError('Reply lost');
        await threads.rename('t1', ' Phone name ');
        expect(threads.data.find('t1')?['name'], 'Phone name');
        expect(threads.syncWarning, isNotNull);
        expect(transport.calls.last, {
          'method': 'thread/name/set',
          'params': {'thread_id': 't1', 'name': 'Phone name'},
        });
        transport.failure = null;
        await threads.archive('t1', true);
        expect(transport.calls.last, {
          'method': 'thread/archive',
          'params': {'threadId': 't1'},
        });
        expect(threads.data.isArchived('child'), isTrue);
        expect(threads.data.pinned, isEmpty);
        final reloaded = DesktopThreadsController(transport, store);
        await reloaded.attach('qa-mac');
        expect(reloaded.data.find('t1')?['name'], 'Phone name');
        expect(reloaded.data.isArchived('child'), isTrue);
        await reloaded.archive('t1', false);
        expect(transport.calls.last['method'], 'thread/unarchive');
        transport.online = false;
        final count = transport.calls.length;
        await reloaded.rename('t1', 'Offline name');
        expect(transport.calls, hasLength(count));
        await reloaded.remove('t1', archiveOnDesktop: false);
        expect(transport.calls, hasLength(count));
        expect(reloaded.data.deleted, contains('t1'));
        reloaded.dispose();
      } finally {
        threads.dispose();
        await store.flush();
        await root.delete(recursive: true);
      }
    },
  );
  test(
    'switching Mac isolates cached state and late local mutation responses',
    () async {
      final root = await Directory.systemTemp.createTemp('djl-thread-switch-');
      final transport = ThreadTransport(),
          store = DesktopLocalStore(TestCredentials(), root: root);
      final threads = DesktopThreadsController(transport, store);
      try {
        await threads.attach('qa-mac');
        threads.data.mergeServer([
          {'id': 'same-id', 'name': 'Mac A'},
        ]);
        final rename = threads.rename('same-id', 'Private Mac A title');
        transport.mac = 'other-mac';
        await threads.attach('other-mac');
        await rename;
        expect(threads.visible, isEmpty);
        expect(threads.syncWarning, isNull);
        expect(transport.calls, isEmpty);
        transport.mac = 'qa-mac';
        await threads.attach('qa-mac');
        expect(threads.visible.single['name'], 'Private Mac A title');
      } finally {
        threads.dispose();
        await store.flush();
        await root.delete(recursive: true);
      }
    },
  );
}
