import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/presentation/worktree_flow_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_project_rebind_test.dart';

class WorktreeTransport extends RebindTransport {
  WorktreeTransport(super.pairings);
  bool existing = false;
  int localCommits = 0;
  Object? resumeFailure, transferFailure, forkFailure;
  Completer<void>? creationGate,
      transferGate,
      forkGate,
      resumeGate,
      historyGate,
      listGate;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': Map.of(params)});
    switch (method) {
      case 'git/status':
        return {
          'isRepo': true,
          'branch': 'main',
          'dirty': false,
          'files': [],
          'localOnlyCommitCount': localCommits,
        };
      case 'git/branches':
        return {
          'branches': ['main', 'other'],
          'current': 'main',
          'default': 'main',
          'localCheckoutPath': localCwd,
        };
      case 'git/createWorktree':
        await creationGate?.future;
        return {
          'branch': params['name'],
          'worktreePath': worktreeCwd,
          'alreadyExisted': existing,
        };
      case 'git/transferManagedHandoff':
        await transferGate?.future;
        if (transferFailure != null) throw transferFailure!;
        return {
          'success': true,
          'targetPath': params['targetPath'],
          'transferredChanges': true,
        };
      case 'thread/resume':
        await resumeGate?.future;
        if (resumeFailure != null) throw resumeFailure!;
        return {
          'thread': {'id': params['threadId'], 'cwd': localCwd},
        };
      case 'thread/fork':
        await forkGate?.future;
        if (forkFailure != null) throw forkFailure!;
        return {
          'thread': {'id': 'new-fork', 'cwd': worktreeCwd},
        };
      case 'thread/read':
        await historyGate?.future;
        return {
          'thread': {
            'id': params['threadId'],
            'cwd': localCwd,
            'turns': [
              {
                'id': 'past',
                'status': 'completed',
                'items': [
                  {
                    'id': 'answer',
                    'type': 'agentMessage',
                    'text': 'Inherited history',
                  },
                ],
              },
            ],
          },
        };
      case 'thread/goal/get':
        return {'goal': null};
      case 'project/projectlessRoots':
        return {'roots': []};
      case 'thread/list':
        await listGate?.future;
        return {
          'data': [
            {'id': 'same-chat', 'cwd': localCwd, 'name': 'Owned title'},
            {
              'id': 'new-fork',
              'cwd': worktreeCwd,
              'forkedFromThreadId': 'same-chat',
            },
          ],
        };
      default:
        throw StateError('Unexpected worktree fixture request: $method');
    }
  }
}

Future<void> waitForRequest(WorktreeTransport remote, String method) async {
  for (
    var i = 0;
    i < 100 && !remote.calls.any((c) => c['method'] == method);
    i++
  ) {
    await Future<void>.delayed(Duration.zero);
  }
  expect(remote.calls.any((c) => c['method'] == method), isTrue);
}

void main() {
  for (final phase in [
    'thread/fork',
    'thread/resume',
    'thread/read',
    'thread/list',
  ]) {
    for (final owner in ['session', 'pin', 'cache']) {
      test(
        'late worktree fork $phase cannot adopt a replacement $owner',
        () async {
          final remote = WorktreeTransport(
            PairingRepository(TestCredentials()),
          );
          final gate = Completer<void>();
          if (phase == 'thread/fork') remote.forkGate = gate;
          if (phase == 'thread/resume') remote.resumeGate = gate;
          if (phase == 'thread/read') remote.historyGate = gate;
          if (phase == 'thread/list') remote.listGate = gate;
          final desktop = await rebindDesktop(remote);
          final flow = WorktreeFlowController(
            desktop,
            mode: WorktreeFlowMode.fork,
          );
          addTearDown(() {
            flow.dispose();
            desktop.dispose();
          });
          await flow.prepare();
          final result = flow.submit(
            name: 'feature',
            base: 'main',
            review: (_) async => true,
          );
          await waitForRequest(remote, phase);
          if (owner == 'session') remote.session = 'replacement-session';
          if (owner == 'pin') {
            desktop.active = Pairing({
              ...desktop.active!.data,
              'macIdentityPublicKey': 'replacement-pin',
            });
          }
          if (owner == 'cache') {
            await desktop.threadList.attach('replacement-cache');
          }
          desktop.thread = {'id': 'replacement-owner', 'cwd': '/qa/New owner'};
          desktop.threadList.data.upsert(desktop.thread!);
          final state = jsonEncode(desktop.threadList.data.toJson());
          final before = remote.calls.length;
          gate.complete();
          expect(await result, isFalse);
          expect(desktop.thread?['id'], 'replacement-owner');
          expect(jsonEncode(desktop.threadList.data.toJson()), state);
          expect(remote.calls, hasLength(before));
        },
      );
    }
  }
  test(
    'a pending worktree mutation blocks turns forks and new drafts across views',
    () async {
      final remote = WorktreeTransport(PairingRepository(TestCredentials()));
      final gate = remote.creationGate = Completer<void>();
      final desktop = await rebindDesktop(remote);
      final flow = WorktreeFlowController(
        desktop,
        mode: WorktreeFlowMode.handoff,
      );
      addTearDown(() {
        flow.dispose();
        desktop.dispose();
      });
      await flow.prepare();
      final result = flow.submit(
        name: 'feature',
        base: 'main',
        review: (_) async => true,
      );
      await waitForRequest(remote, 'git/createWorktree');
      final before = remote.calls.length;
      expect(await desktop.send('Must remain unsent'), isFalse);
      expect(await desktop.forkThread(), isFalse);
      expect(desktop.beginNewChatDraft(cwd: localCwd), isNull);
      expect(remote.calls, hasLength(before));
      gate.complete();
      expect(await result, isTrue, reason: flow.error);
      expect(desktop.runtimeReady, isTrue);
    },
  );
  test(
    'missing old association cannot remove a newer associated worktree',
    () async {
      final remote = WorktreeTransport(PairingRepository(TestCredentials()))
        ..transferFailure = const RemoteRpcException(
          -32000,
          'Missing destination',
          {'errorCode': 'missing_handoff_target'},
        );
      final gate = remote.transferGate = Completer<void>();
      final desktop = await rebindDesktop(remote);
      desktop.threadList.data.associatedWorktreePaths['same-chat'] =
          worktreeCwd;
      final flow = WorktreeFlowController(
        desktop,
        mode: WorktreeFlowMode.handoff,
      );
      addTearDown(() {
        flow.dispose();
        desktop.dispose();
      });
      final result = flow.handoffAssociated(worktreeCwd);
      await waitForRequest(remote, 'git/transferManagedHandoff');
      desktop.threadList.data.associatedWorktreePaths['same-chat'] =
          '/qa/.codex/worktrees/newer';
      gate.complete();
      expect(await result, isFalse);
      expect(
        desktop.threadList.data.associatedWorktreePaths['same-chat'],
        '/qa/.codex/worktrees/newer',
      );
      expect(remote.calls, hasLength(1));
    },
  );
  for (final mode in WorktreeFlowMode.values) {
    test('named $mode preserves its distinct source chat semantics', () async {
      final remote = WorktreeTransport(PairingRepository(TestCredentials()));
      final desktop = await rebindDesktop(remote);
      final flow = WorktreeFlowController(desktop, mode: mode);
      addTearDown(() {
        flow.dispose();
        desktop.dispose();
      });
      await flow.prepare();
      expect(flow.preferredBase, 'main');
      expect(
        await flow.submit(
          name: ' qa-feature ',
          base: 'main',
          review: (_) async => true,
        ),
        isTrue,
        reason: flow.error,
      );
      final create = remote.calls.singleWhere(
        (c) => c['method'] == 'git/createWorktree',
      );
      expect(create['params'], {
        'name': 'djl/qa-feature',
        'baseBranch': 'main',
        'changeTransfer': 'none',
        'cwd': localCwd,
      });
      expect(remote.calls.where((c) => c['method'] == 'thread/start'), isEmpty);
      if (mode == WorktreeFlowMode.handoff) {
        expect(remote.calls.map((c) => c['method']), [
          'git/status',
          'git/branches',
          'git/status',
          'git/branches',
          'git/createWorktree',
          'git/transferManagedHandoff',
          'thread/resume',
        ]);
        expect(desktop.thread?['id'], 'same-chat');
        expect(
          desktop.threadList.data.drafts['same-chat'],
          'Unsent owned draft',
        );
      } else {
        expect(desktop.thread?['id'], 'new-fork');
        expect(desktop.thread?['forkedFromThreadId'], 'same-chat');
        expect(desktop.threadList.data.find('same-chat')?['cwd'], localCwd);
        expect(
          remote.calls.where((c) => c['method'] == 'thread/fork'),
          hasLength(1),
        );
        expect(
          remote.calls.where(
            (c) => c['method'] == 'git/transferManagedHandoff',
          ),
          isEmpty,
        );
      }
      expect(desktop.thread?['cwd'], worktreeCwd);
      expect(flow.completed, isTrue);
    });
  }

  test(
    'existing named worktree is never transferred resumed or forked',
    () async {
      final remote = WorktreeTransport(PairingRepository(TestCredentials()))
        ..existing = true;
      final desktop = await rebindDesktop(remote);
      final flow = WorktreeFlowController(
        desktop,
        mode: WorktreeFlowMode.handoff,
      );
      addTearDown(() {
        flow.dispose();
        desktop.dispose();
      });
      await flow.prepare();
      expect(
        await flow.submit(
          name: 'taken',
          base: 'main',
          review: (_) async => true,
        ),
        isFalse,
      );
      expect(flow.errorTitle, 'Branch Already Exists');
      expect(remote.calls.last['method'], 'git/createWorktree');
      expect(desktop.thread?['cwd'], localCwd);
    },
  );

  test(
    'source default-history preflight cancellation issues no creation',
    () async {
      final remote = WorktreeTransport(PairingRepository(TestCredentials()))
        ..localCommits = 2;
      final desktop = await rebindDesktop(remote);
      final flow = WorktreeFlowController(
        desktop,
        mode: WorktreeFlowMode.handoff,
      );
      addTearDown(() {
        flow.dispose();
        desktop.dispose();
      });
      await flow.prepare();
      var reviewed = false;
      expect(
        await flow.submit(
          name: 'feature',
          base: 'main',
          review: (review) async {
            reviewed = true;
            expect(review.title, 'Local commits stay on main');
            expect(review.acceptLabel, 'Create Anyway');
            return false;
          },
        ),
        isFalse,
      );
      expect(reviewed, isTrue);
      expect(
        remote.calls.where((c) => c['method'] == 'git/createWorktree'),
        isEmpty,
      );
    },
  );

  for (final phase in ['git/createWorktree', 'git/transferManagedHandoff']) {
    test(
      'session change after $phase stops later mutations and retains the worktree',
      () async {
        final remote = WorktreeTransport(PairingRepository(TestCredentials()));
        final gate = Completer<void>();
        if (phase == 'git/createWorktree') {
          remote.creationGate = gate;
        } else {
          remote.transferGate = gate;
        }
        final desktop = await rebindDesktop(remote);
        final flow = WorktreeFlowController(
          desktop,
          mode: WorktreeFlowMode.handoff,
        );
        addTearDown(() {
          flow.dispose();
          desktop.dispose();
        });
        await flow.prepare();
        final result = flow.submit(
          name: 'feature',
          base: 'main',
          review: (_) async => true,
        );
        await waitForRequest(remote, phase);
        remote.session = 'new-session';
        gate.complete();
        expect(await result, isFalse);
        expect(remote.calls.last['method'], phase);
        expect(desktop.thread?['cwd'], localCwd);
        expect(
          flow.createdPath,
          phase == 'git/createWorktree' ? null : worktreeCwd,
        );
        if (phase == 'git/createWorktree') {
          expect(flow.error, contains('may have been created'));
        }
        expect(
          remote.calls.where((c) => c['method'] == 'git/removeWorktree'),
          isEmpty,
        );
      },
    );
  }

  for (final uncertain in [false, true]) {
    test(
      'rebind failure uncertain=$uncertain preserves worktree and limits recovery',
      () async {
        final remote = WorktreeTransport(PairingRepository(TestCredentials()))
          ..resumeFailure = uncertain
              ? TimeoutException('Unknown rebind result')
              : const RemoteRpcException(-32000, 'Rebind rejected', null);
        final desktop = await rebindDesktop(remote);
        final flow = WorktreeFlowController(
          desktop,
          mode: WorktreeFlowMode.handoff,
        );
        addTearDown(() {
          flow.dispose();
          desktop.dispose();
        });
        await flow.prepare();
        expect(
          await flow.submit(
            name: 'feature',
            base: 'main',
            review: (_) async => true,
          ),
          isFalse,
        );
        final transfers = remote.calls
            .where((c) => c['method'] == 'git/transferManagedHandoff')
            .toList();
        expect(transfers, hasLength(uncertain ? 1 : 2));
        if (!uncertain) {
          expect(transfers.last['params'], {
            'cwd': worktreeCwd,
            'targetPath': localCwd,
          });
        }
        expect(
          remote.calls.where((c) => c['method'] == 'thread/resume'),
          hasLength(1),
        );
        expect(
          remote.calls.where((c) => c['method'] == 'git/removeWorktree'),
          isEmpty,
        );
        expect(flow.error, contains('kept'));
        expect(desktop.thread?['cwd'], localCwd);
      },
    );
  }

  test(
    'missing associated worktree clears only that old association and never creates',
    () async {
      final remote = WorktreeTransport(PairingRepository(TestCredentials()))
        ..transferFailure = const RemoteRpcException(
          -32000,
          'Missing destination',
          {'errorCode': 'missing_handoff_target'},
        );
      final desktop = await rebindDesktop(remote);
      desktop.threadList.data.associatedWorktreePaths['same-chat'] =
          worktreeCwd;
      final flow = WorktreeFlowController(
        desktop,
        mode: WorktreeFlowMode.handoff,
      );
      addTearDown(() {
        flow.dispose();
        desktop.dispose();
      });
      expect(await flow.handoffAssociated(worktreeCwd), isFalse);
      expect(flow.missingAssociatedWorktree, isTrue);
      expect(desktop.threadList.data.associatedWorktreePaths, isEmpty);
      expect(remote.calls.map((c) => c['method']), [
        'git/transferManagedHandoff',
      ]);
    },
  );

  test(
    'Local return transfers then resumes the same ID and remembers its worktree',
    () async {
      final remote = WorktreeTransport(PairingRepository(TestCredentials()));
      final desktop = await rebindDesktop(remote);
      desktop.thread = {...desktop.thread!, 'cwd': worktreeCwd};
      desktop.threadList.data.upsert(desktop.thread!);
      final flow = WorktreeFlowController(
        desktop,
        mode: WorktreeFlowMode.handoff,
      );
      addTearDown(() {
        flow.dispose();
        desktop.dispose();
      });
      expect(await flow.handoffToLocal(), isTrue, reason: flow.error);
      expect(remote.calls.map((c) => c['method']), [
        'git/status',
        'git/branches',
        'git/transferManagedHandoff',
        'thread/resume',
      ]);
      expect(desktop.thread?['id'], 'same-chat');
      expect(desktop.thread?['cwd'], localCwd);
      expect(
        desktop.threadList.data.associatedWorktreePaths['same-chat'],
        worktreeCwd,
      );
    },
  );
}
