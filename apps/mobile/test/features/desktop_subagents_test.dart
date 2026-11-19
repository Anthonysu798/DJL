import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/subagents/domain/subagent_action.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'guardian_review_test.dart' show GuardianTransport;
import 'desktop_activity_test.dart' show ActivityCacheStore;

class SubagentTransport extends GuardianTransport {
  SubagentTransport() : super(PairingRepository(TestCredentials()));
  final histories = <String, RemoteJson>{};
  final gates = <String, Completer<RemoteJson>>{};
  Object? readFailure;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'thread/read' || method == 'thread/resume') {
      calls.add({'method': method, 'params': params});
      final id = params['threadId'] as String;
      if (method == 'thread/read' && gates[id] != null) {
        return gates[id]!.future;
      }
      if (method == 'thread/read' && readFailure != null) throw readFailure!;
      return {
        'thread': histories[id] ?? {'id': id, 'turns': []},
      };
    }
    return super.request(method, params, timeout: timeout);
  }
}

DesktopController subagentDesktop(
  SubagentTransport t, {
  ActivityCacheStore? store,
}) =>
    DesktopController(
        t.pairings,
        connection: t,
        localStore: store ?? ActivityCacheStore(),
      )
      ..active = Pairing({'macDeviceId': t.mac, 'sessionId': t.session})
      ..thread = {'id': 'parent', 'title': 'Parent'};
void emitSubagent(
  SubagentTransport t, {
  String item = 'spawn',
  String parent = 'parent',
  String tool = 'spawnAgent',
  bool known = false,
  String status = 'completed',
  String turn = 'turn',
}) => t.events.add({
  'method': 'item/completed',
  'params': {
    'threadId': parent,
    'turnId': turn,
    'item': {
      'id': item,
      'type': 'collabAgentToolCall',
      'tool': tool,
      'status': status,
      'receiverAgents': [
        {'threadId': 'child', if (known) 'agentNickname': 'Ada'},
      ],
    },
  },
});
List<SubagentAction> actions(DesktopController d) => d.timeline
    .map(
      (r) => SubagentAction.decode(
        r,
        mac: d.active!.macDeviceId,
        thread: d.thread!['id'] as String,
        turn: r['turnId'] as String? ?? '',
      ),
    )
    .whereType<SubagentAction>()
    .toList();
Future<void> settleReads() => Future<void>.delayed(Duration.zero);
void main() {
  for (final refresh in [
    'turn/completed',
    'djl/bufferedReplay/gap',
    'djl/bufferedReplay/reset',
  ]) {
    test(
      'pending explicit child open survives automatic same-parent $refresh refresh',
      () async {
        final t = SubagentTransport()..gates['child'] = Completer();
        final d = subagentDesktop(t);
        await d.threadList.attach('mac-a');
        d.models = [
          {
            'id': 'parent-model',
            'model': 'parent-wire',
            'djlProvider': 'codex',
          },
          {'id': 'child-model', 'model': 'child-wire', 'djlProvider': 'codex'},
        ];
        d.model = 'parent-model';
        d.access = 'full-access';
        d.plan = true;
        d.serviceTier = 'fast';
        d.effort = 'medium';
        d.threadList.data.setComposerDraft(
          'parent',
          DesktopComposerDraft(text: 'Intended parent draft'),
        );
        t.histories['parent'] = {
          'id': 'parent',
          'turns': [
            {
              'id': 'turn',
              'status': 'completed',
              'items': [
                {
                  'id': 'parent-answer',
                  'type': 'agentMessage',
                  'text': 'Refreshed parent answer',
                },
              ],
            },
          ],
        };
        emitSubagent(t);
        final action = actions(d).single;
        final opening = d.openSubagent(action, action.children.single);
        await settleReads();
        t.events.add({
          'method': refresh,
          'params': {
            'threadId': 'parent',
            'turn': {'id': 'turn', 'status': 'completed'},
          },
        });
        await settleReads();
        expect(d.thread!['id'], 'parent');
        expect(d.timeline.any((row) => row['id'] == 'parent-answer'), isTrue);
        expect(
          t.calls.where(
            (call) =>
                call['method'] == 'thread/resume' &&
                (call['params'] as Map)['threadId'] == 'parent',
          ),
          hasLength(1),
        );
        expect(
          t.calls.where(
            (call) =>
                call['method'] == 'thread/read' &&
                (call['params'] as Map)['threadId'] == 'child',
          ),
          hasLength(1),
        );
        expect(d.model, 'parent-model');
        expect(d.access, 'full-access');
        expect(d.plan, isTrue);
        expect(d.serviceTier, 'fast');
        expect(d.effort, 'medium');
        t.gates['child']!.complete({
          'thread': {
            'id': 'child',
            'agentNickname': 'Ready',
            'model': 'child-wire',
            'modelProvider': 'codex',
            'runtimeMode': 'approval-required',
            'turns': [],
          },
        });
        await opening;
        expect(d.thread!['id'], 'child');
        expect(d.model, 'child-model');
        expect(d.access, 'on-request');
        expect(
          t.calls.where(
            (call) =>
                call['method'] == 'thread/resume' &&
                (call['params'] as Map)['threadId'] == 'child',
          ),
          hasLength(1),
        );
        expect(
          d.threadList.data.composerDraft('parent').text,
          'Intended parent draft',
        );
        expect(
          d.threadList.data.runtimes['parent'],
          containsPair('model', 'parent-model'),
        );
        expect(
          d.threadList.data.runtimes['parent'],
          containsPair('access', 'full-access'),
        );
        expect(
          d.threadList.data.runtimes['parent'],
          containsPair('plan', true),
        );
        expect(
          d.threadList.data.runtimes['parent'],
          containsPair('serviceTier', 'fast'),
        );
        await d.returnToSubagentParent();
        expect(d.thread!['id'], 'parent');
        expect(d.model, 'parent-model');
        expect(d.access, 'full-access');
        expect(d.plan, isTrue);
        expect(d.serviceTier, 'fast');
        expect(d.effort, 'medium');
        expect(
          d.threadList.data.composerDraft('parent').text,
          'Intended parent draft',
        );
        expect(d.timeline.any((row) => row['id'] == 'parent-answer'), isTrue);
        expect(
          t.calls.where(
            (call) =>
                call['method'] == 'thread/resume' &&
                (call['params'] as Map)['threadId'] == 'child',
          ),
          hasLength(1),
        );
        expect(
          t.calls.where(
            (call) =>
                !{'thread/read', 'thread/resume'}.contains(call['method']),
          ),
          isEmpty,
        );
        expect(t.sent, isEmpty);
        d.dispose();
      },
    );
  }

  test(
    'a newer different-child intent supersedes a pending open before either selects',
    () async {
      final t = SubagentTransport()
        ..gates['child'] = Completer()
        ..gates['second-child'] = Completer();
      final d = subagentDesktop(t);
      emitSubagent(t);
      final firstAction = actions(d).single;
      final secondAction = SubagentAction.decode(
        {
          'id': 'second-open',
          'type': 'collabToolCall',
          'tool': 'wait',
          'receiverThreadId': 'second-child',
        },
        mac: 'mac-a',
        thread: 'parent',
        turn: 'turn',
      )!;
      d.model = 'keep-parent';
      final first = d.openSubagent(firstAction, firstAction.children.single);
      final second = d.openSubagent(secondAction, secondAction.children.single);
      await settleReads();
      t.gates['child']!.complete({
        'thread': {'id': 'child', 'agentNickname': 'Obsolete', 'turns': []},
      });
      await first;
      expect(d.thread!['id'], 'parent');
      expect(d.model, 'keep-parent');
      expect(t.calls.where((c) => c['method'] == 'thread/resume'), isEmpty);
      t.gates['second-child']!.complete({
        'thread': {
          'id': 'second-child',
          'agentNickname': 'Latest',
          'turns': [],
        },
      });
      await second;
      expect(d.thread!['id'], 'second-child');
      expect(
        t.calls
            .where((c) => c['method'] == 'thread/resume')
            .map((c) => (c['params'] as Map)['threadId']),
        ['second-child'],
      );
      d.dispose();
    },
  );
  test(
    'explicit child selection retries an incomplete identity in the same session',
    () async {
      final t = SubagentTransport();
      final d = subagentDesktop(t);
      emitSubagent(t);
      await settleReads();
      expect(d.subagentMetadataState('child'), 'Agent identity unknown');
      t.gates['child'] = Completer();
      final action = actions(d).single;
      final opening = d.openSubagent(action, action.children.single);
      await settleReads();
      expect(t.calls, hasLength(2));
      t.gates['child']!.complete({
        'thread': {
          'id': 'child',
          'agentNickname': 'Materialized',
          'runtimeMode': 'approval-required',
          'turns': [],
        },
      });
      await opening;
      expect(d.thread!['id'], 'child');
      expect(d.threadList.data.find('child')?['agentNickname'], 'Materialized');
      expect(
        t.calls.where((c) => c['method'] == 'thread/resume'),
        hasLength(1),
      );
      expect(t.sent, isEmpty);
      d.dispose();
    },
  );

  for (final firstOutcome in ['transient failure', 'incomplete identity']) {
    test(
      'same-session later reference retries $firstOutcome with one concurrent read',
      () async {
        final t = SubagentTransport()..gates['child'] = Completer();
        final d = subagentDesktop(t);
        d.model = 'parent-model';
        d.access = 'full-access';
        d.plan = true;
        d.serviceTier = 'fast';
        d.threadList.data.setComposerDraft(
          'parent',
          DesktopComposerDraft(text: 'Keep parent draft'),
        );
        emitSubagent(t);
        emitSubagent(t, item: 'first-wait', tool: 'wait');
        await settleReads();
        expect(t.calls, hasLength(1));
        if (firstOutcome == 'transient failure') {
          t.gates['child']!.completeError(
            StateError('temporarily not materialized'),
          );
        } else {
          t.gates['child']!.complete({
            'thread': {'id': 'child', 'turns': []},
          });
        }
        await settleReads();
        expect(
          d.subagentMetadataState('child'),
          firstOutcome == 'transient failure'
              ? 'Could not load agent details'
              : 'Agent identity unknown',
        );
        t.gates['child'] = Completer();
        emitSubagent(t, item: 'later-wait', tool: 'wait');
        emitSubagent(t, item: 'later-update', tool: 'sendInput');
        await settleReads();
        expect(t.calls, hasLength(2));
        t.gates['child']!.complete({
          'thread': {
            'id': 'child',
            'agentNickname': 'Materialized',
            'agentRole': 'worker',
            'turns': [],
          },
        });
        await settleReads();
        expect(
          d.threadList.data.find('child')?['agentNickname'],
          'Materialized',
        );
        emitSubagent(t, item: 'known-wait', tool: 'wait');
        await settleReads();
        expect(
          t.calls,
          List.filled(2, {
            'method': 'thread/read',
            'params': {'threadId': 'child', 'includeTurns': true},
          }),
        );
        expect(t.sent, isEmpty);
        expect(d.thread!['id'], 'parent');
        expect(d.model, 'parent-model');
        expect(d.access, 'full-access');
        expect(d.plan, isTrue);
        expect(d.serviceTier, 'fast');
        expect(
          d.threadList.data.composerDraft('parent').text,
          'Keep parent draft',
        );
        d.dispose();
      },
    );
  }
  for (final change in [
    'session',
    'cache',
    'device round trip',
    'generation',
    'navigation round trip',
  ]) {
    test(
      'gated explicit child open is canceled by $change even back on same Mac and parent',
      () async {
        final t = SubagentTransport()..gates['child'] = Completer();
        final d = subagentDesktop(t);
        await d.threadList.attach('mac-a');
        emitSubagent(t);
        final action = actions(d).single;
        final opening = d.openSubagent(action, action.children.single);
        await settleReads();
        expect(
          t.calls.where(
            (c) =>
                c['method'] == 'thread/read' &&
                (c['params'] as Map)['threadId'] == 'child',
          ),
          hasLength(1),
        );
        switch (change) {
          case 'session':
            t.session = 'replacement-session';
          case 'cache':
            await d.threadList.attach('mac-b');
            await d.threadList.attach('mac-a');
          case 'device round trip':
            t.mac = 'mac-b';
            d.active = const Pairing({'macDeviceId': 'mac-b'});
            await d.threadList.attach('mac-b');
            t.mac = 'mac-a';
            d.active = const Pairing({'macDeviceId': 'mac-a'});
            await d.threadList.attach('mac-a');
          case 'generation':
            d.suspend();
            d.resume();
          case 'navigation round trip':
            await d.openThread({'id': 'other'});
            await d.openThread({'id': 'parent'});
        }
        // The restored parent is the current user's state when the obsolete read finishes.
        d.model = 'restored-parent';
        d.access = 'full-access';
        d.plan = true;
        d.serviceTier = 'fast';
        d.timeline = [
          {
            'id': 'restored-row',
            'type': 'agentMessage',
            'text': 'Restored parent',
          },
        ];
        d.threadList.data.setComposerDraft(
          'parent',
          DesktopComposerDraft(text: 'Restored unsent draft'),
        );
        t.gates['child']!.complete({
          'thread': {
            'id': 'child',
            'agentNickname': 'Old response',
            'model': 'obsolete-model',
            'runtimeMode': 'approval-required',
            'turns': [],
          },
        });
        await opening;
        await settleReads();
        expect(d.thread!['id'], 'parent');
        expect(d.subagentParent, isNull);
        expect(d.timeline.single['text'], 'Restored parent');
        expect(d.model, 'restored-parent');
        expect(d.access, 'full-access');
        expect(d.plan, isTrue);
        expect(d.serviceTier, 'fast');
        expect(
          d.threadList.data.composerDraft('parent').text,
          'Restored unsent draft',
        );
        expect(
          t.calls.where(
            (c) =>
                c['method'] == 'thread/resume' &&
                (c['params'] as Map)['threadId'] == 'child',
          ),
          isEmpty,
        );
        expect(
          t.calls.where(
            (c) => !{
              'thread/read',
              'thread/resume',
              // Foreground status is independent of child navigation.
              'account/status/read',
            }.contains(c['method']),
          ),
          isEmpty,
        );
        expect(t.sent, isEmpty);
        d.dispose();
      },
    );
  }
  test(
    'newer concurrent child-open intent coalesces the read and selects only once',
    () async {
      final t = SubagentTransport()..gates['child'] = Completer();
      final d = subagentDesktop(t);
      emitSubagent(t);
      final action = actions(d).single;
      final first = d.openSubagent(action, action.children.single);
      final second = d.openSubagent(action, action.children.single);
      await settleReads();
      expect(t.calls, hasLength(1));
      t.gates['child']!.complete({
        'thread': {'id': 'child', 'agentNickname': 'Current', 'turns': []},
      });
      await Future.wait([first, second]);
      expect(d.thread!['id'], 'child');
      expect(
        t.calls.where((c) => c['method'] == 'thread/resume'),
        hasLength(1),
      );
      expect(t.sent, isEmpty);
      d.dispose();
    },
  );

  test(
    'old child completion cannot replace a newer active turn status',
    () async {
      final t = SubagentTransport();
      final d = subagentDesktop(t);
      emitSubagent(t, known: true);
      for (final rpc in [
        {
          'method': 'turn/completed',
          'params': {
            'threadId': 'child',
            'turn': {'id': 'old', 'status': 'completed'},
          },
        },
        {
          'method': 'turn/started',
          'params': {
            'threadId': 'child',
            'turn': {'id': 'new'},
          },
        },
        {
          'method': 'turn/completed',
          'params': {
            'threadId': 'child',
            'turn': {'id': 'old', 'status': 'failed'},
          },
        },
      ]) {
        t.events.add(rpc);
      }
      expect(
        d.resolvedSubagent(actions(d).single.children.single).status,
        'running',
      );
      t.events.add({
        'method': 'turn/completed',
        'params': {
          'threadId': 'child',
          'turn': {'id': 'new', 'status': 'failed'},
        },
      });
      expect(
        d.resolvedSubagent(actions(d).single.children.single).status,
        'failed',
      );
      d.dispose();
    },
  );
  test(
    'historical action identity cannot overwrite canonical child metadata on repeated wait',
    () async {
      final t = SubagentTransport();
      final d = subagentDesktop(t);
      emitSubagent(t, known: true);
      d.threadList.data.upsert({
        'id': 'child',
        'agentNickname': 'Canonical',
        'agentRole': 'researcher',
      });
      emitSubagent(t, item: 'wait', tool: 'wait');
      await settleReads();
      expect(d.threadList.data.find('child')?['agentNickname'], 'Canonical');
      expect(
        d.resolvedSubagent(actions(d).first.children.single).label,
        'Canonical',
      );
      expect(t.calls, isEmpty);
      d.dispose();
    },
  );

  test(
    'canonical thread name and ID are never fabricated as agent identity',
    () async {
      final t = SubagentTransport();
      t.histories['child'] = {
        'id': 'child',
        'name': 'Renamed chat',
        'modelProvider': 'codex',
      };
      final d = subagentDesktop(t);
      emitSubagent(t);
      await settleReads();
      final child = d.resolvedSubagent(actions(d).single.children.single);
      expect(child.nickname, isNull);
      expect(child.agentId, isNull);
      expect(child.model, isNull);
      expect(d.subagentMetadataState('child'), 'Agent identity unknown');
      d.dispose();
    },
  );

  for (final envelope in ['msg', 'event']) {
    test(
      'generic legacy $envelope begin/end uses exact IDs and ordered aliases once',
      () async {
        final t = SubagentTransport();
        final d = subagentDesktop(t);
        for (final phase in ['begin', 'end', 'begin']) {
          t.events.add({
            'method': 'codex/event',
            'params': {
              'conversation_id': 'parent',
              'id': 'turn',
              envelope: {
                'type': 'collab_agent_spawn_$phase',
                'call_id': 'legacy',
                'new_thread_id': 'child',
                'new_agent_nickname': 'Legacy',
                'new_agent_role': 'worker',
                'model': 'requested',
              },
            },
          });
        }
        await settleReads();
        expect(actions(d), hasLength(1));
        expect(actions(d).single.status, 'completed');
        expect(actions(d).single.children.single.role, 'worker');
        expect(t.calls, isEmpty);
        d.dispose();
      },
    );
  }
  test(
    'outer lifecycle item/turn IDs and canonical history project one stable action',
    () async {
      final t = SubagentTransport();
      final d = subagentDesktop(t);
      t.events.add({
        'method': 'item/started',
        'params': {
          'threadId': 'parent',
          'turn': {'id': 'turn'},
          'itemId': 'call',
          'item': {
            'type': 'collabToolCall',
            'tool': 'wait',
            'receiverThreadId': 'child',
            'receiverAgentNickname': 'Ada',
          },
        },
      });
      t.histories['parent'] = {
        'id': 'parent',
        'turns': [
          {
            'id': 'turn',
            'status': 'completed',
            'items': [
              {
                'id': 'call',
                'type': 'collabToolCall',
                'tool': 'wait',
                'status': 'completed',
                'receiverThreadId': 'child',
                'receiverAgentNickname': 'Ada',
              },
            ],
          },
        ],
      };
      await d.openThread({'id': 'parent'});
      expect(actions(d), hasLength(1));
      expect(actions(d).single.status, 'completed');
      d.dispose();
    },
  );
  test(
    'passive wrong child response is rejected and unrelated selected timeline/runtime remain unchanged',
    () async {
      final t = SubagentTransport()..gates['child'] = Completer();
      final d = subagentDesktop(t);
      emitSubagent(t);
      await settleReads();
      d.thread = {'id': 'other'};
      d.timeline = [
        {'id': 'keep', 'type': 'agentMessage', 'text': 'Keep'},
      ];
      d.model = 'preserve';
      d.access = 'full-access';
      t.gates['child']!.complete({
        'thread': {'id': 'wrong', 'agentNickname': 'False'},
      });
      await settleReads();
      expect(d.thread!['id'], 'other');
      expect(d.timeline.single['text'], 'Keep');
      expect(d.model, 'preserve');
      expect(d.access, 'full-access');
      expect(d.threadList.data.find('wrong'), isNull);
      expect(d.threadList.data.find('child')?['agentNickname'], isNull);
      expect(d.subagentMetadataState('child'), 'Could not load agent details');
      d.dispose();
    },
  );
  test(
    'cached child terminal turn status survives recreation and late replayed start',
    () async {
      final t = SubagentTransport();
      final cache = ActivityCacheStore();
      final d = subagentDesktop(t, store: cache);
      await d.threadList.attach('mac-a');
      emitSubagent(t, known: true);
      t.events.add({
        'method': 'turn/completed',
        'params': {
          'threadId': 'child',
          'turn': {'id': 'child-turn', 'status': 'failed'},
        },
      });
      await d.threadList.saveNow();
      d.dispose();
      final nextTransport = SubagentTransport();
      final next = subagentDesktop(nextTransport, store: cache);
      await next.threadList.attach('mac-a');
      nextTransport.events.add({
        'method': 'turn/started',
        'params': {
          'threadId': 'child',
          'turn': {'id': 'child-turn'},
        },
      });
      expect(next.threadList.data.find('child')?['subagentStatus'], 'failed');
      next.dispose();
    },
  );
  test(
    'source nested identity and metadata policy are loaded without treating title/type as identity',
    () async {
      final t = SubagentTransport();
      final d = subagentDesktop(t);
      t.histories['child'] = {
        'id': 'child',
        'name': 'User renamed chat',
        'type': 'collabToolCall',
        'metadata': {
          'runtime_mode': 'approval-required',
          'model_provider': 'claudeAgent',
        },
        'source': {
          'subAgent': {
            'thread_spawn': {
              'agent_id': 'agent',
              'name': 'Nested',
              'agent_type': 'researcher',
            },
          },
        },
      };
      emitSubagent(t);
      await settleReads();
      expect(d.threadList.data.find('child')?['agentNickname'], 'Nested');
      expect(d.threadList.data.find('child')?['agentRole'], 'researcher');
      expect(
        d.threadList.data.find('child')?['runtimeMode'],
        'approval-required',
      );
      expect(d.threadList.data.find('child')?['modelProvider'], 'claudeAgent');
      d.dispose();
    },
  );
  test(
    'new active Mac before cache attach cannot hydrate old cached metadata or rows',
    () async {
      final t = SubagentTransport();
      final d = subagentDesktop(t);
      await d.threadList.attach('mac-a');
      emitSubagent(t, known: true);
      final before = d.threadList.data.toJson().toString();
      t.mac = 'mac-b';
      d.active = const Pairing({'macDeviceId': 'mac-b'});
      emitSubagent(t, item: 'stale');
      await settleReads();
      expect(d.threadList.data.toJson().toString(), before);
      expect(t.calls, isEmpty);
      d.dispose();
    },
  );

  test(
    'live spawn projects typed card and coalesces repeated references using only read-only exact RPC',
    () async {
      final t = SubagentTransport()..gates['child'] = Completer();
      final d = subagentDesktop(t);
      emitSubagent(t);
      emitSubagent(t, item: 'wait', tool: 'wait');
      emitSubagent(t, item: 'update', tool: 'sendInput');
      await settleReads();
      expect(actions(d), hasLength(3));
      expect(t.calls, [
        {
          'method': 'thread/read',
          'params': {'threadId': 'child', 'includeTurns': true},
        },
      ]);
      t.gates['child']!.complete({
        'thread': {
          'id': 'child',
          'agentNickname': 'Ada',
          'agentRole': 'worker',
          'model': 'child-model',
          'runtimeMode': 'approval-required',
          'apiKey': 'SECRET',
          'turns': [],
        },
      });
      await settleReads();
      expect(d.thread!['id'], 'parent');
      expect(d.thread!['model'], isNull);
      expect(d.threadList.data.find('child')?['agentNickname'], 'Ada');
      expect(d.threadList.data.find('child')?['apiKey'], isNull);
      emitSubagent(t, item: 'again', tool: 'wait');
      await settleReads();
      expect(t.calls, hasLength(1));
      expect(d.threadList.data.find('child')?['parentThreadId'], 'parent');
      d.dispose();
    },
  );
  test(
    'known identity skips eager reads and wait from a second parent cannot reparent child or independent fork',
    () async {
      final t = SubagentTransport();
      final d = subagentDesktop(t);
      emitSubagent(t, known: true);
      emitSubagent(t, parent: 'other', item: 'wait', tool: 'wait', known: true);
      await settleReads();
      expect(t.calls, isEmpty);
      expect(d.threadList.data.find('child')?['parentThreadId'], 'parent');
      d.threadList.data.upsert({'id': 'fork', 'forkedFromThreadId': 'parent'});
      expect(d.threadList.data.find('fork')?['parentThreadId'], isNull);
      d.dispose();
    },
  );
  test(
    'unselected history cached terminal seeds before live sparse replay and remains in reconciled history',
    () async {
      final t = SubagentTransport();
      final cache = ActivityCacheStore();
      cache.records['mac-a'] = {
        'threads': [
          {'id': 'parent'},
          {'id': 'other'},
        ],
        'timelines': {
          'other': [
            {
              'id': 'call',
              'type': 'collabToolCall',
              'tool': 'wait',
              'turnId': 'turn',
              'status': 'completed',
              'receiverAgents': [
                {
                  'threadId': 'child',
                  'nickname': 'Cached',
                  'agentRole': 'worker',
                },
              ],
            },
          ],
        },
      };
      final d = subagentDesktop(t, store: cache);
      await d.threadList.attach('mac-a');
      emitSubagent(
        t,
        parent: 'other',
        item: 'call',
        tool: 'wait',
        status: 'inProgress',
      );
      await settleReads();
      final row = d.threadList.data.timelines['other']!.single;
      final a = SubagentAction.decode(
        row,
        mac: 'mac-a',
        thread: 'other',
        turn: 'turn',
      )!;
      expect(a.status, 'completed');
      expect(a.children.single.nickname, 'Cached');
      expect(t.calls, isEmpty);
      await d.openThread({'id': 'other'});
      expect(actions(d), hasLength(1));
      expect(actions(d).single.children.single.nickname, 'Cached');
      d.dispose();
    },
  );
  for (final replacement in [false, true]) {
    test(
      'late passive read cannot cross ${replacement ? 'device replacement' : 'cache replacement'} or change parent selection',
      () async {
        final t = SubagentTransport()..gates['child'] = Completer();
        final d = subagentDesktop(t);
        emitSubagent(t);
        await settleReads();
        if (replacement) {
          t.mac = 'mac-b';
          t.session = 'secure-b';
          d.active = const Pairing({'macDeviceId': 'mac-b'});
          await d.threadList.attach('mac-b');
        } else {
          await d.threadList.attach('mac-a');
        }
        t.gates['child']!.complete({
          'thread': {'id': 'child', 'agentNickname': 'STALE', 'turns': []},
        });
        await settleReads();
        expect(d.threadList.data.find('child'), isNull);
        expect(d.thread!['id'], 'parent');
        d.dispose();
      },
    );
  }
  test(
    'wrong-device replay and ambiguous missing parent do not hydrate or guess scope',
    () async {
      final t = SubagentTransport();
      final d = subagentDesktop(t);
      t.events.add({
        '_macDeviceId': 'mac-b',
        'method': 'item/completed',
        'params': {
          'threadId': 'parent',
          'turnId': 'turn',
          'item': {
            'id': 'x',
            'type': 'collabToolCall',
            'receiverThreadId': 'child',
          },
        },
      });
      t.events.add({
        'method': 'item/completed',
        'params': {
          'turnId': 'turn',
          'item': {
            'id': 'x',
            'type': 'collabToolCall',
            'receiverThreadId': 'child',
          },
        },
      });
      await settleReads();
      expect(t.calls, isEmpty);
      expect(actions(d), isEmpty);
      d.dispose();
    },
  );
  test(
    'offline card stays usable and reconnect allows missing metadata read again without mutation retry',
    () async {
      final t = SubagentTransport()..online = false;
      final d = subagentDesktop(t)
        ..timeline = [
          {
            'id': 'x',
            'type': 'collabToolCall',
            'tool': 'wait',
            'receiverThreadId': 'child',
            'turnId': 'turn',
          },
        ];
      await d.hydrateSubagents(actions(d).single);
      expect(t.calls, isEmpty);
      t.online = true;
      t.readFailure = StateError('offline');
      await d.hydrateSubagents(actions(d).single);
      expect(d.subagentMetadataState('child'), 'Could not load agent details');
      t.session = 'secure-b';
      t.readFailure = null;
      t.histories['child'] = {'id': 'child', 'agentNickname': 'Back'};
      await d.hydrateSubagents(actions(d).single);
      expect(d.threadList.data.find('child')?['agentNickname'], 'Back');
      expect(t.calls.map((c) => c['method']), ['thread/read', 'thread/read']);
      d.dispose();
    },
  );
  test(
    'explicit child open and send use child saved policy and return restores parent draft/runtime/timeline',
    () async {
      final t = SubagentTransport();
      final d = subagentDesktop(t);
      await d.threadList.attach('mac-a');
      d.models = [
        {'id': 'codex:parent', 'model': 'parent-model', 'djlProvider': 'codex'},
        {
          'id': 'claude:child',
          'model': 'child-model',
          'djlProvider': 'claudeAgent',
        },
      ];
      d.model = 'codex:parent';
      d.access = 'full-access';
      d.plan = true;
      d.serviceTier = 'fast';
      d.threadList.data.setComposerDraft(
        'parent',
        DesktopComposerDraft(text: 'Parent unsent'),
      );
      d.threadList.data.runtimes['child'] = {
        'model': 'claude:child',
        'wireModel': 'child-model',
        'provider': 'claudeAgent',
        'access': 'on-request',
        'plan': false,
        'effort': 'low',
        'serviceTier': 'default',
      };
      emitSubagent(t, known: true);
      await settleReads();
      final a = actions(d).single;
      t.histories['child'] = {
        'id': 'child',
        'parentThreadId': 'parent',
        'model': 'child-model',
        'modelProvider': 'claudeAgent',
        'turns': [],
      };
      await d.openSubagent(a, a.children.single);
      expect(d.thread!['id'], 'child');
      expect(d.model, 'claude:child');
      expect(d.access, 'on-request');
      expect(d.plan, false);
      expect(d.serviceTier, 'default');
      final resume = t.calls.firstWhere((c) => c['method'] == 'thread/resume');
      expect((resume['params'] as Map)['approvalPolicy'], 'on-request');
      expect((resume['params'] as Map)['sandboxPolicy'], {
        'type': 'workspaceWrite',
        'networkAccess': true,
      });
      await d.sendDraft(DesktopComposerDraft(text: 'Child followup'));
      final send = t.calls.firstWhere((c) => c['method'] == 'turn/start');
      expect((send['params'] as Map)['threadId'], 'child');
      expect((send['params'] as Map)['model'], 'child-model');
      expect((send['params'] as Map)['djlProvider'], 'claudeAgent');
      await d.returnToSubagentParent();
      expect(d.thread!['id'], 'parent');
      expect(d.model, 'codex:parent');
      expect(d.access, 'full-access');
      expect(d.plan, true);
      expect(d.serviceTier, 'fast');
      expect(d.threadList.data.composerDraft('parent').text, 'Parent unsent');
      expect(actions(d), hasLength(1));
      expect(t.calls.where((c) => c['method'] == 'turn/start'), hasLength(1));
      d.dispose();
    },
  );
  test(
    'unknown child policy falls back to globals not active parent privileges',
    () async {
      final t = SubagentTransport();
      final d = subagentDesktop(t);
      d.models = [
        {'id': 'codex:g', 'model': 'global', 'djlProvider': 'codex'},
      ];
      d.access = 'full-access';
      d.plan = true;
      d.serviceTier = 'fast';
      emitSubagent(t, known: true);
      final a = actions(d).single;
      await d.openSubagent(a, a.children.single);
      expect(d.access, 'on-request');
      expect(d.plan, false);
      expect(d.serviceTier, 'default');
      expect(d.model, 'codex:g');
      expect(
        (t.calls.firstWhere((c) => c['method'] == 'thread/resume')['params']
            as Map)['approvalPolicy'],
        'on-request',
      );
      d.dispose();
    },
  );
}
