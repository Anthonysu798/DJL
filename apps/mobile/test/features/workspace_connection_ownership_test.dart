import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/workspace/data/workspace_repository.dart';
import 'workspace_repository_test.dart' show WorkspaceTransport;

class ConnectionWorkspaceTransport extends WorkspaceTransport {
  String wireSession = 'qa-session';
  int wireRevision = 1;
  Completer<RemoteJson>? reply;
  @override
  String? get sessionId => wireSession;
  @override
  int get connectionRevision => wireRevision;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': params});
    return reply?.future ?? response;
  }
}

void changeWorkspaceConnection(ConnectionWorkspaceTransport t, String kind) {
  switch (kind) {
    case 'mac':
      t.mac = 'different-mac';
    case 'session':
      t.wireSession = 'replacement-session';
    case 'revision':
      t.wireRevision++;
  }
}

WorkspaceRepository ownedWorkspace(ConnectionWorkspaceTransport t) =>
    WorkspaceRepository(t, cwd: '/qa/repo', threadId: 'thread-a');

final checkpointPreview = <String, dynamic>{
  'canRestore': true,
  'checkpointRef': 'refs/djl/checkpoints/thread-a/start/ipc-turn-0',
  'commit': 'public-test-commit',
  'affectedFiles': ['hello.txt'],
};

void main() {
  for (final kind in ['mac', 'session', 'revision']) {
    test(
      'checkpoint capture rejects a changed $kind before dispatch',
      () async {
        final t = ConnectionWorkspaceTransport();
        final repository = ownedWorkspace(t);
        changeWorkspaceConnection(t, kind);
        await expectLater(
          repository.capture(kind: 'turnEnd', turnId: 'ipc-turn-0'),
          throwsStateError,
        );
        expect(t.calls, isEmpty);
      },
    );

    test('checkpoint capture rejects a changed $kind after await', () async {
      final t = ConnectionWorkspaceTransport()..reply = Completer();
      final repository = ownedWorkspace(t);
      final capturing = repository.capture(
        kind: 'turnEnd',
        turnId: 'ipc-turn-0',
      );
      changeWorkspaceConnection(t, kind);
      t.reply!.complete({});
      await expectLater(capturing, throwsStateError);
      expect(t.calls, hasLength(1));
    });

    test(
      'an in-flight restore preview cannot survive a changed $kind',
      () async {
        final t = ConnectionWorkspaceTransport()..reply = Completer();
        final repository = ownedWorkspace(t);
        final preview = repository.previewRestore('ipc-turn-0');
        changeWorkspaceConnection(t, kind);
        t.reply!.complete(checkpointPreview);
        await expectLater(preview, throwsStateError);
        expect(t.calls, hasLength(1));
      },
    );

    test(
      'confirmed restore cannot migrate into a fresh repository after $kind change',
      () async {
        final t = ConnectionWorkspaceTransport()..response = checkpointPreview;
        final confirmed = (await ownedWorkspace(
          t,
        ).previewRestore('ipc-turn-0')).confirm(userConfirmed: true)!;
        t.calls.clear();
        changeWorkspaceConnection(t, kind);
        await expectLater(
          ownedWorkspace(t).restore(confirmed),
          throwsStateError,
        );
        expect(t.calls, isEmpty);
      },
    );
  }

  test(
    'a fresh same-owner repository preserves the exact confirmed restore wire',
    () async {
      final t = ConnectionWorkspaceTransport()..response = checkpointPreview;
      final preview = await ownedWorkspace(t).previewRestore('ipc-turn-0');
      expect(preview.confirm(userConfirmed: false), isNull);
      final confirmed = preview.confirm(userConfirmed: true)!;
      t.calls.clear();
      await ownedWorkspace(t).restore(confirmed);
      expect(t.calls.single, {
        'method': 'workspace/checkpointRestoreApply',
        'params': {
          'cwd': '/qa/repo',
          'threadId': 'thread-a',
          'targetTurnId': 'ipc-turn-0',
          'targetCheckpointRef': checkpointPreview['checkpointRef'],
          'expectedTargetCommit': checkpointPreview['commit'],
          'confirmDestructiveRestore': true,
        },
      });
    },
  );
}
