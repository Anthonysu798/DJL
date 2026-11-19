import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/workspace/data/workspace_repository.dart';
import 'package:djl_mobile/features/workspace/data/turn_checkpoints.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'workspace_repository_test.dart' show WorkspaceTransport;

class CheckpointTransport extends WorkspaceTransport {
  final captureReady = Completer<void>();
  bool fail = false;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': params});
    if (fail) {
      throw StateError('No Git repository');
    }
    if (params['checkpointKind'] == 'messageStart') {
      await captureReady.future;
    }
    return method == 'workspace/checkpointCopy' ? {'copied': true} : {};
  }
}

void main() {
  test(
    'fast completion waits for pre-send capture and start alias, repeated completion is ignored',
    () async {
      final transport = CheckpointTransport();
      final checkpoints = TurnCheckpoints(
        WorkspaceRepository(transport, cwd: '/repo', threadId: 't1'),
        messageId: 'm1',
      );
      final prepare = checkpoints.prepare();
      final finish = checkpoints.completed('u1');
      await Future<void>.delayed(Duration.zero);
      expect(transport.calls, hasLength(1));
      expect(
        (transport.calls.single['params'] as Map)['checkpointKind'],
        'messageStart',
      );
      transport.captureReady.complete();
      await prepare;
      await finish;
      await checkpoints.completed('u1');
      expect(transport.calls.map((c) => c['method']).toList(), [
        'workspace/checkpointCapture',
        'workspace/checkpointCopy',
        'workspace/checkpointCapture',
      ]);
      expect(
        (transport.calls.last['params'] as Map)['checkpointKind'],
        'turnEnd',
      );
    },
  );
  test('optional checkpoint errors do not fail chat sends', () async {
    final transport = CheckpointTransport()..fail = true;
    final checkpoints = TurnCheckpoints(
      WorkspaceRepository(transport, cwd: '/repo', threadId: 't1'),
      messageId: 'm1',
    );
    await checkpoints.prepare();
    await checkpoints.started('u1');
    await checkpoints.completed('u1');
    expect(checkpoints.warning, isNotNull);
  });
}
