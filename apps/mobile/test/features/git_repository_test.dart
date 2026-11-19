import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/git/data/git_repository.dart';
import 'package:djl_mobile/features/git/domain/git_models.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_requests_test.dart' show TestTransport;
import '../core/cloud_client_test.dart' show TestCredentials;

class EpochGitTransport extends TestTransport {
  EpochGitTransport(super.pairings);
  String? mac = 'mac-a', session = 'git-session';
  int generation = 0;
  Completer<RemoteJson>? statusReply;
  @override
  String? get macDeviceId => mac;
  @override
  String? get sessionId => session;
  @override
  int get connectionRevision => generation;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': Map.of(params)});
    if (method == 'git/status') {
      return statusReply?.future ?? {'isRepo': true, 'branch': 'qa'};
    }
    return {};
  }
}

void main() {
  test('Git repository rejects a stale parent scope before sending', () async {
    var current = true;
    final transport = EpochGitTransport(PairingRepository(TestCredentials()));
    final git = GitRepository(
      transport,
      cwd: '/tmp/qa',
      isCurrent: () => current,
    );
    current = false;
    await expectLater(() => git.commit('Old scope'), throwsStateError);
    expect(transport.calls, isEmpty);
    await transport.dispose();
  });

  test(
    'Git repository discards a reply after its parent scope changes',
    () async {
      var current = true;
      final transport = EpochGitTransport(PairingRepository(TestCredentials()));
      final reply = transport.statusReply = Completer<RemoteJson>();
      final git = GitRepository(
        transport,
        cwd: '/tmp/qa',
        isCurrent: () => current,
      );
      final rejected = expectLater(git.status(), throwsStateError);
      current = false;
      reply.complete({'isRepo': true, 'branch': 'old-scope'});
      await rejected;
      expect(transport.calls, hasLength(1));
      await transport.dispose();
    },
  );

  for (final change in ['generation', 'session', 'mac']) {
    test(
      'Git connection ownership rejects stale sends after $change',
      () async {
        final transport = EpochGitTransport(
          PairingRepository(TestCredentials()),
        );
        final old = GitRepository(transport, cwd: '/tmp/qa/');
        switch (change) {
          case 'generation':
            transport.generation++;
          case 'session':
            transport.session = 'replacement-session';
          case 'mac':
            transport.mac = 'mac-b';
        }
        await expectLater(
          () => old.commit('Stale confirmation'),
          throwsStateError,
        );
        expect(transport.calls, isEmpty);
        await GitRepository(
          transport,
          cwd: '/tmp/qa/',
        ).commit('Reviewed after reconnect');
        expect(transport.calls.single, {
          'method': 'git/commit',
          'params': {'cwd': '/tmp/qa/', 'message': 'Reviewed after reconnect'},
        });
        await transport.dispose();
      },
    );
  }

  test(
    'Git connection replacement rejects an in-flight old status reply',
    () async {
      final transport = EpochGitTransport(PairingRepository(TestCredentials()));
      final reply = transport.statusReply = Completer<RemoteJson>();
      final git = GitRepository(transport, cwd: '/tmp/qa');
      final status = git.status();
      final rejected = expectLater(status, throwsStateError);
      transport.generation++;
      reply.complete({'isRepo': true, 'branch': 'old-connection-branch'});
      await rejected;
      expect(transport.calls, hasLength(1));
      await transport.dispose();
    },
  );

  test(
    'Git status uses Swift fields and keeps dirty, tracking and push availability distinct',
    () {
      final status = GitStatus.fromJson({
        'isRepo': true,
        'repoRoot': '/tmp/qa',
        'branch': 'main',
        'tracking': null,
        'dirty': true,
        'hasHeadCommit': true,
        'hasPushRemote': false,
        'ahead': 0,
        'behind': 0,
        'canPush': false,
        'files': [
          {'path': 'a.dart', 'status': 'M'},
        ],
      });
      expect(status.dirty, isTrue);
      expect(status.hasRemote, isFalse);
      expect(status.canPush, isFalse);
      expect(status.files.single.path, 'a.dart');
    },
  );
  test(
    'Git commands are always cwd scoped and destructive reset retains explicit confirmation',
    () async {
      final transport = TestTransport(PairingRepository(TestCredentials()));
      final git = GitRepository(transport, cwd: '/tmp/qa');
      await git.commit('QA commit');
      expect(transport.calls.last, {
        'method': 'git/commit',
        'params': {'cwd': '/tmp/qa', 'message': 'QA commit'},
      });
      await git.createWorktree('qa', 'main', 'copy');
      expect((transport.calls.last['params'] as Map)['changeTransfer'], 'copy');
      await git.resetToRemote();
      expect(
        (transport.calls.last['params'] as Map)['confirm'],
        'discard_runtime_changes',
      );
      expect(
        transport.calls.every((c) => (c['params'] as Map)['cwd'] == '/tmp/qa'),
        isTrue,
      );
      await transport.dispose();
    },
  );
}
