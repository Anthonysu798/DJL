import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/desktop_local_store.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_overview.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_threads_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_threads_controller_test.dart' show ThreadTransport;

void seedGroup(ThreadLocalState state) {
  for (final row in <RemoteJson>[
    {'id': 'a', 'name': 'Visible parent', 'cwd': '/work/Alpha'},
    {
      'id': 'child',
      'name': 'Hidden child',
      'cwd': '/work/Alpha/',
      'parentThreadId': 'a',
    },
    {'id': 'grandchild', 'cwd': '/work/Alpha', 'parentThreadId': 'child'},
    {'id': 'z', 'name': 'Pinned second root', 'cwd': '/work/Alpha'},
    {'id': 'archived', 'cwd': '/work/Alpha'},
    {'id': 'other', 'cwd': '/work/Beta'},
    {'id': 'studio', 'cwd': '/work/Alpha', 'djlScope': 'studio'},
    {'id': 'deleted', 'cwd': '/work/Alpha'},
  ]) {
    state.upsert(row);
  }
  state.archiveOverrides['archived'] = true;
  state.deleted.add('deleted');
  state.pinned.add('z');
}

class HeldGroupTransport extends ThreadTransport {
  final started = Completer<void>(), reply = Completer<void>();
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'thread/archive' && params['threadId'] == 'a') {
      calls.add({'method': method, 'params': params});
      started.complete();
      await reply.future;
      return {};
    }
    return super.request(method, params, timeout: timeout);
  }
}

class HeldGroupSave extends DesktopLocalStore {
  HeldGroupSave(super.credentials, {super.root});
  bool holdNext = false;
  final started = Completer<void>(), reply = Completer<void>();
  @override
  Future<void> save(String mac, RemoteJson value) async {
    if (holdNext) {
      holdNext = false;
      started.complete();
      await reply.future;
    }
    await super.save(mac, value);
  }
}

class RevisedGroupTransport extends HeldGroupTransport {
  int revision = 1;
  @override
  int get connectionRevision => revision;
}

Future<(DesktopThreadsController, ThreadTransport, DesktopLocalStore)>
setupGroup({ThreadTransport? transport}) async {
  final root = await Directory.systemTemp.createTemp('djl-project-group-');
  final wire = transport ?? ThreadTransport();
  final store = DesktopLocalStore(TestCredentials(), root: root);
  final controller = DesktopThreadsController(wire, store);
  addTearDown(() async {
    controller.dispose();
    await store.flush();
    await root.delete(recursive: true);
  });
  await controller.attach('qa-mac');
  seedGroup(controller.data);
  return (controller, wire, store);
}

void main() {
  for (final action in ['archive', 'remove']) {
    test(
      'accepted group $action persists before a synchronous Mac-switch listener',
      () async {
        final (threads, wire, store) = await setupGroup();
        wire.online = false;
        var switched = false;
        Future<void>? switching;
        void changeMac() {
          if (switched) return;
          switched = true;
          wire.mac = 'other-mac';
          switching = threads.attach('other-mac');
        }

        threads.addListener(changeMac);
        if (action == 'archive') {
          await threads.archiveGroup(['a', 'z']);
        } else {
          await threads.removeGroupLocally(['a', 'z']);
        }
        await switching;
        threads.removeListener(changeMac);
        final old = ThreadLocalState.fromJson(await store.load('qa-mac'));
        if (action == 'archive') {
          expect(old.isArchived('a'), isTrue);
          expect(old.isArchived('grandchild'), isTrue);
        } else {
          expect(old.deleted, containsAll(['a', 'child', 'grandchild', 'z']));
        }
        expect(threads.macDeviceId, 'other-mac');
        expect(threads.visible, isEmpty);
        expect(wire.calls, isEmpty);
      },
    );
  }
  test(
    'project selection includes pinned and search-hidden members, not other scope',
    () {
      final data = ThreadLocalState();
      seedGroup(data);
      final visible = projectDesktopOverview(
        data.visible(),
        scope: DesktopOverviewScope.projects,
        pinned: data.pinned,
        query: 'Visible parent',
      ).single;
      expect(visible.threads.map((t) => t['id']), ['a']);
      expect(
        desktopProjectThreadIds(data, visible),
        unorderedEquals(['a', 'child', 'grandchild', 'z']),
      );
      expect(
        desktopProjectThreadIds(data, visible, liveOnly: false),
        unorderedEquals(['a', 'child', 'grandchild', 'z', 'archived']),
      );
      final pinned = DesktopOverviewGroup(
        id: 'pinned',
        label: 'Pinned',
        kind: DesktopOverviewGroupKind.pinned,
        threads: visible.threads,
      );
      expect(desktopProjectThreadIds(data, pinned, liveOnly: false), isEmpty);
    },
  );

  test(
    'group archive cascades locally with exactly one RPC per selected root',
    () async {
      final (threads, wire, _) = await setupGroup();
      final affected = await threads.archiveGroup(['z', 'child', 'a', 'a']);
      expect(affected, unorderedEquals(['a', 'child', 'grandchild', 'z']));
      expect(wire.calls, [
        {
          'method': 'thread/archive',
          'params': {'threadId': 'a'},
        },
        {
          'method': 'thread/archive',
          'params': {'threadId': 'z'},
        },
      ]);
      for (final id in affected) {
        expect(threads.data.isArchived(id), isTrue);
      }
      expect(threads.data.isArchived('other'), isFalse);
      expect(threads.data.pinned, isEmpty);
    },
  );

  test('offline group archive persists without a desktop mutation', () async {
    final (threads, wire, store) = await setupGroup();
    wire.online = false;
    await threads.archiveGroup(['a', 'z']);
    expect(wire.calls, isEmpty);
    final saved = ThreadLocalState.fromJson(await store.load('qa-mac'));
    expect(saved.isArchived('grandchild'), isTrue);
    expect(saved.isArchived('z'), isTrue);
    expect(saved.isArchived('other'), isFalse);
  });

  test(
    'local group removal includes archived subtrees and emits no RPC',
    () async {
      final (threads, wire, store) = await setupGroup();
      threads.data.drafts['grandchild'] = 'private unsent draft';
      threads.data.timelines['child'] = [
        {'id': 'history', 'text': 'private'},
      ];
      final affected = await threads.removeGroupLocally(['a', 'z', 'archived']);
      expect(
        affected,
        unorderedEquals(['a', 'child', 'grandchild', 'z', 'archived']),
      );
      expect(wire.calls, isEmpty);
      final saved = ThreadLocalState.fromJson(await store.load('qa-mac'));
      for (final id in affected) {
        expect(saved.deleted, contains(id));
        expect(saved.find(id), isNull);
        expect(saved.drafts.containsKey(id), isFalse);
        expect(saved.timelines.containsKey(id), isFalse);
      }
      expect(saved.find('other'), isNotNull);
      expect(saved.isArchived('other'), isFalse);
    },
  );

  test(
    'Mac switch during an accepted root prevents remaining group RPCs',
    () async {
      final wire = HeldGroupTransport();
      final (threads, _, store) = await setupGroup(transport: wire);
      final operation = threads.archiveGroup(['a', 'z']);
      await wire.started.future;
      wire.mac = 'other-mac';
      await threads.attach('other-mac');
      wire.reply.complete();
      await operation;
      expect(wire.calls, [
        {
          'method': 'thread/archive',
          'params': {'threadId': 'a'},
        },
      ]);
      expect(threads.visible, isEmpty);
      expect(threads.syncWarning, isNull);
      final old = ThreadLocalState.fromJson(await store.load('qa-mac'));
      expect(old.isArchived('z'), isTrue);
    },
  );

  test(
    'uncertain group archive retains local state and existing sync warning',
    () async {
      final (threads, wire, _) = await setupGroup();
      wire.failure = StateError('unconfirmed fixture reply');
      await threads.archiveGroup(['a', 'z']);
      expect(threads.data.isArchived('grandchild'), isTrue);
      expect(threads.data.isArchived('z'), isTrue);
      expect(threads.syncWarning, contains('could not be confirmed'));
      expect(wire.calls, hasLength(2));
    },
  );

  test('Mac switch while saving prevents the first queued group RPC', () async {
    final root = await Directory.systemTemp.createTemp('djl-group-held-save-');
    final store = HeldGroupSave(TestCredentials(), root: root);
    final wire = ThreadTransport();
    final threads = DesktopThreadsController(wire, store);
    addTearDown(() async {
      threads.dispose();
      await store.flush();
      await root.delete(recursive: true);
    });
    await threads.attach('qa-mac');
    seedGroup(threads.data);
    store.holdNext = true;
    final operation = threads.archiveGroup(['a', 'z']);
    await store.started.future;
    wire.mac = 'other-mac';
    await threads.attach('other-mac');
    store.reply.complete();
    await operation;
    expect(wire.calls, isEmpty);
    expect(threads.visible, isEmpty);
    expect(threads.syncWarning, isNull);
    final old = ThreadLocalState.fromJson(await store.load('qa-mac'));
    expect(old.isArchived('child'), isTrue);
    expect(old.isArchived('z'), isTrue);
  });

  test('same-Mac connection replacement fences remaining group RPCs', () async {
    final wire = RevisedGroupTransport();
    final (threads, _, _) = await setupGroup(transport: wire);
    final operation = threads.archiveGroup(['a', 'z']);
    await wire.started.future;
    wire.revision++;
    wire.reply.complete();
    await operation;
    expect(wire.calls, [
      {
        'method': 'thread/archive',
        'params': {'threadId': 'a'},
      },
    ]);
    expect(threads.data.isArchived('z'), isTrue);
    expect(threads.syncWarning, isNull);
  });

  test('cache replacement while saving prevents queued group RPCs', () async {
    final root = await Directory.systemTemp.createTemp(
      'djl-group-cache-owner-',
    );
    final store = HeldGroupSave(TestCredentials(), root: root);
    final wire = ThreadTransport();
    final threads = DesktopThreadsController(wire, store);
    addTearDown(() async {
      threads.dispose();
      await store.flush();
      await root.delete(recursive: true);
    });
    await threads.attach('qa-mac');
    seedGroup(threads.data);
    store.holdNext = true;
    final operation = threads.archiveGroup(['a', 'z']);
    await store.started.future;
    threads.data = ThreadLocalState()..upsert({'id': 'fresh', 'cwd': '/fresh'});
    store.reply.complete();
    await operation;
    expect(wire.calls, isEmpty);
    expect(threads.visible.single['id'], 'fresh');
    expect(threads.data.archiveOverrides, isEmpty);
    expect(threads.syncWarning, isNull);
  });
}
