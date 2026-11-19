import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/workspace/data/workspace_repository.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_requests_test.dart' show TestTransport;
import '../core/cloud_client_test.dart' show TestCredentials;

class WorkspaceTransport extends TestTransport {
  WorkspaceTransport() : super(PairingRepository(TestCredentials()));
  String mac = 'qa-mac';
  RemoteJson response = {};
  @override
  String? get macDeviceId => mac;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': params});
    return response;
  }
}

void main() {
  test('text metadata and conditional metadata survive reload', () async {
    final transport = WorkspaceTransport()
      ..response = {
        'path': '/repo/readme.md',
        'fileName': 'readme.md',
        'byteLength': 8,
        'mtimeMs': 123,
        'content': 'hello\nhi',
        'encoding': 'utf-8',
        'lineCount': 2,
      };
    final repository = WorkspaceRepository(
      transport,
      cwd: '/repo',
      threadId: 't',
    );
    final first = await repository.readTextFile('readme.md');
    expect(first.encoding, 'utf-8');
    expect(first.lineCount, 2);
    transport.response = {
      'path': '/repo/readme.md',
      'fileName': 'readme.md',
      'byteLength': 8,
      'mtimeMs': 123,
      'notModified': true,
    };
    final second = await repository.readTextFile('readme.md', cached: first);
    expect(second.encoding, 'utf-8');
    expect(second.lineCount, 2);
    expect(second.content, 'hello\nhi');
  });
  test(
    'project browser preserves directory limits and folder creation wire format',
    () async {
      final transport = WorkspaceTransport()
        ..response = {
          'path': '/repo',
          'parentPath': '/',
          'entries': [
            {'name': 'src', 'path': '/repo/src', 'isSymlink': true},
          ],
        };
      final project = ProjectRepository(transport);
      final listing = await project.listDirectory('/repo');
      expect(listing.entries.single.isSymlink, isTrue);
      expect(transport.calls.last, {
        'method': 'project/listDirectory',
        'params': {'path': '/repo', 'limit': 200},
      });
      await project.search('/repo', 'mobile');
      expect(transport.calls.last['params'], {
        'path': '/repo',
        'query': 'mobile',
        'limit': 80,
      });
      transport.response = {'path': '/repo/new'};
      expect(await project.createDirectory('/repo', 'new'), '/repo/new');
      expect(transport.calls.last['params'], {
        'parentPath': '/repo',
        'name': 'new',
      });
      transport.mac = 'another-mac';
      await expectLater(project.listDirectory('/repo'), throwsStateError);
    },
  );
  test(
    'text previews use metadata validators and retain cached content on notModified',
    () async {
      final transport = WorkspaceTransport()
        ..response = {
          'path': '/repo/a.dart',
          'fileName': 'a.dart',
          'byteLength': 4,
          'mtimeMs': 123,
          'content': 'test',
        };
      final workspace = WorkspaceRepository(
        transport,
        cwd: '/repo',
        threadId: 't1',
      );
      final first = await workspace.readTextFile('a.dart');
      transport.response = {
        'path': '/repo/a.dart',
        'fileName': 'a.dart',
        'byteLength': 4,
        'mtimeMs': 123,
        'notModified': true,
      };
      final second = await workspace.readTextFile('a.dart', cached: first);
      expect(second.content, 'test');
      expect(transport.calls.last['params'], {
        'cwd': '/repo',
        'path': 'a.dart',
        'includeContent': true,
        'ifByteLength': 4,
        'ifMtimeMs': 123,
      });
      transport.mac = 'another-mac';
      await expectLater(workspace.readTextFile('a.dart'), throwsStateError);
    },
  );
  test(
    'checkpoint restore requires confirmed preview scoped to thread, directory and target commit',
    () async {
      final transport = WorkspaceTransport()
        ..response = {
          'canRestore': true,
          'checkpointRef': 'refs/djl/checkpoints/t1/start/u1',
          'commit': 'abc123',
          'affectedFiles': ['a.dart'],
          'stagedFiles': [],
          'untrackedFiles': ['new.txt'],
        };
      final workspace = WorkspaceRepository(
        transport,
        cwd: '/repo',
        threadId: 't1',
      );
      final preview = await workspace.previewRestore('u1');
      expect(preview.confirm(userConfirmed: false), isNull);
      final confirmed = preview.confirm(userConfirmed: true)!;
      await workspace.restore(confirmed);
      expect(transport.calls.last, {
        'method': 'workspace/checkpointRestoreApply',
        'params': {
          'cwd': '/repo',
          'threadId': 't1',
          'targetTurnId': 'u1',
          'targetCheckpointRef': 'refs/djl/checkpoints/t1/start/u1',
          'expectedTargetCommit': 'abc123',
          'confirmDestructiveRestore': true,
        },
      });
      final other = WorkspaceRepository(
        transport,
        cwd: '/repo',
        threadId: 'other',
      );
      await expectLater(other.restore(confirmed), throwsStateError);
      transport.response = {'canRestore': false};
      expect(
        (await workspace.previewRestore('u1')).confirm(userConfirmed: true),
        isNull,
      );
    },
  );
}
