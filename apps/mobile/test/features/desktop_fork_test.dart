import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_requests_test.dart' show TestTransport;
import '../core/cloud_client_test.dart' show TestCredentials;

class ForkTransport extends TestTransport {
  ForkTransport(super.pairings);
  int forkCalls = 0;
  bool rejectPolicy = false;
  Object? forkFailure;
  Completer<void>? mutationGate, resumeGate;
  bool emptyFirstHistory = false;
  bool populatedFork = false, emptyHydration = false;
  int historyCalls = 0;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': params});
    if (method == 'thread/fork') {
      forkCalls++;
      await mutationGate?.future;
      if (forkFailure != null) {
        throw forkFailure!;
      }
      if (rejectPolicy && params.containsKey('sandboxPolicy')) {
        throw const RemoteRpcException(
          -32602,
          'Unknown sandboxPolicy parameter',
          null,
        );
      }
      return {
        'thread': {
          'id': 'forked',
          if (populatedFork)
            'turns': [
              {
                'id': 'seed-turn',
                'status': 'completed',
                'items': [
                  {
                    'id': 'seed-item',
                    'type': 'agentMessage',
                    'text': 'Known fork history',
                  },
                ],
              },
            ],
        },
        'approvalsReviewer': 'auto_review',
        'approvalPolicy': 'on-request',
        'sandbox': {'type': 'workspaceWrite', 'networkAccess': true},
      };
    }
    if (method == 'thread/resume' || method == 'thread/read') {
      if (method == 'thread/resume') await resumeGate?.future;
      if (emptyHydration ||
          (method == 'thread/read' &&
              emptyFirstHistory &&
              historyCalls++ == 0)) {
        return {
          'thread': {'id': 'forked', 'turns': []},
          'approvalsReviewer': 'auto_review',
          'approvalPolicy': 'on-request',
          'sandbox': {'type': 'workspaceWrite', 'networkAccess': true},
        };
      }
      return {
        'thread': {
          'id': 'forked',
          'cwd': '/old/source',
          'turns': [
            {
              'id': 'past',
              'status': 'completed',
              'items': [
                {
                  'id': 'm1',
                  'type': 'agentMessage',
                  'text': 'Inherited conversation',
                },
              ],
            },
          ],
        },
        'approvalsReviewer': 'auto_review',
        'approvalPolicy': 'on-request',
        'sandbox': {'type': 'workspaceWrite', 'networkAccess': true},
      };
    }
    if (method == 'thread/list') {
      return {
        'data': [
          {'id': 'source', 'cwd': '/old/source'},
          {'id': 'forked', 'cwd': '/old/source'},
        ],
      };
    }
    return {};
  }
}

DesktopController controller(ForkTransport transport) =>
    DesktopController(transport.pairings, connection: transport)
      ..thread = {
        'id': 'source',
        'cwd': '/old/source',
        'model': 'raw-model',
        'modelProvider': 'codex',
      }
      ..models = [
        {
          'id': 'codex::raw-model',
          'model': 'raw-model',
          'djlProvider': 'codex',
        },
      ]
      ..model = 'codex::raw-model'
      ..access = 'auto-review';
void main() {
  test('empty rollout hydration preserves known fork history', () async {
    final transport = ForkTransport(PairingRepository(TestCredentials()))
      ..populatedFork = true
      ..emptyHydration = true;
    final desktop = controller(transport);
    expect(await desktop.forkThread(), isTrue, reason: desktop.error);
    expect(desktop.timeline.single['text'], 'Known fork history');
    desktop.dispose();
  });
  for (final duringMutation in [true, false]) {
    test(
      'switching chats during fork ${duringMutation ? 'creation' : 'hydration'} never rebinds or replaces the other chat',
      () async {
        final transport = ForkTransport(PairingRepository(TestCredentials()));
        final gate = Completer<void>();
        if (duringMutation) {
          transport.mutationGate = gate;
        } else {
          transport.emptyFirstHistory = true;
        }
        final desktop = controller(transport);
        desktop.userInputs.add({'id': 'question', '_submitted': true});
        final pending = desktop.forkThread(cwd: '/selected/worktree');
        while (!transport.calls.any(
          (call) =>
              call['method'] ==
              (duringMutation ? 'thread/fork' : 'thread/read'),
        )) {
          await Future<void>.delayed(Duration.zero);
        }
        if (!duringMutation) {
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
        desktop.thread = {'id': 'other', 'cwd': '/other/project', 'turns': []};
        desktop.timeline = [
          {'id': 'other-item', 'text': 'Other conversation'},
        ];
        gate.complete();
        await pending;
        expect(desktop.thread?['id'], 'other');
        expect(desktop.thread?['cwd'], '/other/project');
        expect(desktop.timeline.single['text'], 'Other conversation');
        final cachedQuestion = desktop.threadList.data.userInputs.single;
        expect(cachedQuestion['_submitted'], isNull);
        expect(cachedQuestion['_responseUnknown'], isTrue);
        expect(
          transport.calls
              .where((c) => c['method'] == 'thread/resume')
              .every((c) => (c['params'] as Map)['threadId'] == 'forked'),
          isTrue,
        );
        expect(
          desktop.threadList.data.projectBindings['forked'],
          '/selected/worktree',
        );
        desktop.dispose();
      },
    );
  }
  test(
    'forking a subagent creates an independent chat rather than copying its parent relationship',
    () async {
      final transport = ForkTransport(PairingRepository(TestCredentials()));
      final desktop = controller(transport);
      desktop.thread!['parentThreadId'] = 'parent-agent';
      expect(await desktop.forkThread(), isTrue);
      expect(desktop.thread?['parentThreadId'], isNull);
      expect(desktop.thread?['forkedFromThreadId'], 'source');
      desktop.dispose();
    },
  );
  test(
    'fork hydrates a new thread, retains source provider and target binding, and uses safe sandbox fallback',
    () async {
      final transport = ForkTransport(PairingRepository(TestCredentials()))
        ..rejectPolicy = true;
      final desktop = controller(transport);
      expect(await desktop.forkThread(cwd: '/selected/worktree'), isTrue);
      expect(transport.forkCalls, 2);
      final fork =
          (transport.calls
                  .where((c) => c['method'] == 'thread/fork')
                  .last['params']
              as Map);
      expect(fork['threadId'], 'source');
      expect(fork['sandbox'], 'workspace-write');
      expect(fork['approvalsReviewer'], 'auto_review');
      final resume =
          (transport.calls.firstWhere(
                (c) => c['method'] == 'thread/resume',
              )['params']
              as Map);
      expect(resume['cwd'], '/selected/worktree');
      expect(resume['model'], 'raw-model');
      expect(resume['djlProvider'], 'codex');
      expect(desktop.thread?['id'], 'forked');
      expect(desktop.thread?['forkedFromThreadId'], 'source');
      expect(desktop.thread?['cwd'], '/selected/worktree');
      expect(desktop.thread?['modelProvider'], 'codex');
      expect(desktop.timeline.single['text'], 'Inherited conversation');
      await desktop.refreshThreads();
      expect(desktop.thread?['cwd'], '/selected/worktree');
      desktop.dispose();
    },
  );
  test(
    'uncertain fork outcomes never retry the mutation and unsupported runtimes are remembered',
    () async {
      final transport = ForkTransport(PairingRepository(TestCredentials()))
        ..forkFailure = TimeoutException('Reply lost');
      final desktop = controller(transport);
      expect(await desktop.forkThread(), isFalse);
      expect(transport.forkCalls, 1);
      expect(desktop.thread?['id'], 'source');
      transport.forkFailure = const RemoteRpcException(
        -32601,
        'Method not found',
        null,
      );
      expect(await desktop.forkThread(), isFalse);
      expect(desktop.supportsFork, isFalse);
      final count = transport.forkCalls;
      expect(await desktop.forkThread(), isFalse);
      expect(transport.forkCalls, count);
      desktop.dispose();
    },
  );
}
