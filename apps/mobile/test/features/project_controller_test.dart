import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/workspace/data/workspace_repository.dart';
import 'package:djl_mobile/features/workspace/presentation/project_controller.dart';
import 'workspace_repository_test.dart' show WorkspaceTransport;

class FolderTransport extends WorkspaceTransport {
  int revision = 0;
  String session = 'qa-folder-session';
  List<RemoteJson> locations = [
    {'id': 'home', 'label': 'Home', 'path': '/qa/home'},
    {'id': 'developer', 'label': 'Developer', 'path': '/qa/dev'},
  ];
  List<RemoteJson> entries = [
    {'name': 'Directory child', 'path': '/qa/dev/child', 'isSymlink': false},
  ];
  List<RemoteJson> searchEntries = [
    {'name': 'Found folder', 'path': '/qa/dev/found', 'isSymlink': true},
  ];
  bool failSearch = false;
  Completer<RemoteJson>? createReply;
  Completer<RemoteJson>? directoryReply;
  @override
  int get connectionRevision => revision;
  @override
  String? get sessionId => session;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': Map.of(params)});
    switch (method) {
      case 'project/quickLocations':
        return {'locations': locations};
      case 'project/listDirectory':
        return directoryReply?.future ??
            {'path': params['path'], 'parentPath': '/qa', 'entries': entries};
      case 'project/searchDirectories':
        if (failSearch) throw StateError('Folder search failed');
        return {'entries': searchEntries};
      case 'project/createDirectory':
        return createReply?.future ??
            {'path': '${params['parentPath']}/${params['name']}'};
      default:
        throw StateError('Unexpected folder fixture method.');
    }
  }
}

void main() {
  test(
    'folder browser prefers Developer and honors an explicit current path',
    () async {
      final wire = FolderTransport();
      final browser = ProjectController(ProjectRepository(wire));
      await browser.initialize(null);
      expect(browser.listing?.path, '/qa/dev');
      expect(wire.calls.map((v) => v['method']), [
        'project/quickLocations',
        'project/listDirectory',
      ]);
      browser.dispose();
      final explicit = ProjectController(ProjectRepository(FolderTransport()));
      await explicit.initialize('/qa/explicit');
      expect(explicit.listing?.path, '/qa/explicit');
      explicit.dispose();
    },
  );

  test(
    'no quick locations does not issue a directory request with an empty path',
    () async {
      final wire = FolderTransport()..locations = [];
      final c = ProjectController(ProjectRepository(wire));
      await c.initialize(null);
      expect(c.listing, isNull);
      expect(c.error, 'No local folders are available from this device.');
      expect(wire.calls.map((v) => v['method']), ['project/quickLocations']);
      c.dispose();
    },
  );

  test(
    'creating a folder returns its exact path without another browse request',
    () async {
      final wire = FolderTransport();
      final browser = ProjectController(ProjectRepository(wire));
      await browser.initialize('/qa/dev');
      await expectLater(
        browser.create(' nested folder '),
        completion('/qa/dev/nested folder'),
      );
      expect(
        wire.calls.where((v) => v['method'] == 'project/listDirectory'),
        hasLength(1),
      );
      expect(wire.calls.last['params'], {
        'parentPath': '/qa/dev',
        'name': 'nested folder',
      });
      browser.dispose();
    },
  );

  test(
    'a held folder create is not duplicated and disposal ignores its result',
    () async {
      final wire = FolderTransport()..createReply = Completer<RemoteJson>();
      final c = ProjectController(ProjectRepository(wire));
      await c.initialize('/qa/dev');
      final pending = c.create('one');
      await c.create('two');
      expect(
        wire.calls.where((v) => v['method'] == 'project/createDirectory'),
        hasLength(1),
      );
      c.dispose();
      wire.createReply!.complete({'path': '/qa/dev/one'});
      await expectLater(pending, completion(isNull));
      expect(
        wire.calls.where((v) => v['method'] == 'project/listDirectory'),
        hasLength(1),
      );
    },
  );

  for (final change in ['connection', 'session']) {
    test(
      'project repository refuses $change replacement before a folder write',
      () async {
        final wire = FolderTransport();
        final owned = ProjectRepository(wire);
        if (change == 'connection') wire.revision++;
        if (change == 'session') wire.session = 'qa-replacement';
        await expectLater(
          owned.createDirectory('/qa/dev', 'new'),
          throwsStateError,
        );
        expect(wire.calls, isEmpty);
      },
    );
    test(
      'project repository refuses a late $change reply without replay',
      () async {
        final wire = FolderTransport()..createReply = Completer<RemoteJson>();
        final repo = ProjectRepository(wire);
        final pending = repo.createDirectory('/qa/dev', 'new');
        final refusal = expectLater(pending, throwsStateError);
        if (change == 'connection') wire.revision++;
        if (change == 'session') wire.session = 'qa-replacement';
        wire.createReply!.complete({'path': '/qa/dev/new'});
        await refusal;
        expect(
          wire.calls.where((v) => v['method'] == 'project/createDirectory'),
          hasLength(1),
        );
      },
    );
  }
}
