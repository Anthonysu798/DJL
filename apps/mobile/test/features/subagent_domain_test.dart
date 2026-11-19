import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/subagents/domain/subagent_action.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';

SubagentAction? decode(
  Map<String, dynamic> item, {
  String parent = 'parent',
  String turn = 'turn',
  String mac = 'mac',
}) => SubagentAction.decode(item, mac: mac, thread: parent, turn: turn);
void main() {
  test(
    'source agentStatuses identity enriches referenced children without creating extra references',
    () {
      final action = decode({
        'id': 'call',
        'type': 'collabToolCall',
        'tool': 'wait',
        'receiverThreadId': 'child',
        'agent_statuses': [
          {
            'thread_id': 'child',
            'agent_nickname': 'Aux',
            'agent_role': 'reviewer',
          },
          {'thread_id': 'unreferenced', 'agent_nickname': 'Other'},
        ],
      })!;
      expect(action.children, hasLength(1));
      expect(action.children.single.nickname, 'Aux');
      expect(action.children.single.role, 'reviewer');
    },
  );

  test('status dictionaries also preserve source identity metadata', () {
    final child = decode({
      'id': 'call',
      'type': 'collabToolCall',
      'tool': 'wait',
      'receiverThreadId': 'child',
      'statuses': {
        'child': {
          'status': 'completed',
          'agent_id': 'agent',
          'agent_nickname': 'Fox',
          'agent_type': 'reviewer',
          'message': 'Latest',
        },
      },
    })!.children.single;
    expect(child.nickname, 'Fox');
    expect(child.agentId, 'agent');
    expect(child.role, 'reviewer');
    expect(child.prompt, isNull);
    expect(child.message, 'Latest');
  });

  test('singular item ID and tool name never become child agent identity', () {
    final child = decode({
      'id': 'call',
      'type': 'collabToolCall',
      'name': 'spawn_agent',
      'receiverThreadId': 'child',
    })!.children.single;
    expect(child.agentId, isNull);
    expect(child.nickname, isNull);
  });

  test(
    'restored latest update never becomes fabricated instructions and failure stays terminal',
    () {
      final a = decode({
        'id': 'x',
        'type': 'collabToolCall',
        'tool': 'wait',
        'receiverAgents': [
          {'threadId': 'child', 'nickname': 'Ada'},
        ],
        'agentsStates': {
          'child': {'status': 'failed', 'message': 'Latest only'},
        },
      })!;
      final restored = SubagentAction.decode(
        a.toRow(),
        mac: 'mac',
        thread: 'parent',
        turn: 'turn',
      )!;
      expect(restored.children.single.prompt, isNull);
      final store = SubagentActions();
      store.merge(a);
      store.merge(
        decode({
          'id': 'x',
          'type': 'collabToolCall',
          'tool': 'wait',
          'status': 'completed',
          'receiverThreadId': 'child',
        })!,
      );
      expect(a.children.single.status, 'failed');
    },
  );

  test(
    'plural aliases preserve ordered unique IDs and per-child identity/state',
    () {
      final a = decode({
        'id': 'call',
        'type': 'collabAgentToolCall',
        'tool': 'wait',
        'status': 'completed',
        'receiver_thread_ids': ['b', 'a', 'b', ' '],
        'receiver_agents': [
          {
            'thread_id': 'b',
            'agent_id': 'ab',
            'nickname': 'Bee',
            'agent_type': 'explorer',
            'model': 'gpt',
            'instructions': 'Inspect B',
          },
          {'thread_id': 'a', 'agentNickname': 'Ay', 'agentRole': 'worker'},
        ],
        'agents_states': {
          'b': {'status': 'completed', 'message': 'Done B'},
          'a': {'status': 'in_progress', 'message': 'Working'},
        },
      })!;
      expect(a.children.map((c) => c.thread), ['b', 'a']);
      expect(a.children.first.toJson(), containsPair('agentId', 'ab'));
      expect(a.children.first.nickname, 'Bee');
      expect(a.children.first.role, 'explorer');
      expect(a.children.first.prompt, 'Inspect B');
      expect(a.children.first.status, 'completed');
      expect(a.children.last.status, 'running');
      expect(a.children.last.message, 'Working');
    },
  );
  for (final alias in [
    'receiverThreadId',
    'receiver_thread_id',
    'threadId',
    'thread_id',
    'newThreadId',
    'new_thread_id',
  ]) {
    test('singular $alias keeps explicit role and requested model', () {
      final a = decode({
        'id': 'call',
        'type': 'collabToolCall',
        'tool': 'spawn_agent',
        alias: 'child',
        'new_agent_id': 'agent',
        'new_agent_nickname': 'Ada',
        'new_agent_role': 'researcher',
        'model': 'o4',
        'task': 'Inspect',
      })!;
      expect(a.tool, 'spawnagent');
      expect(a.children.single.thread, 'child');
      expect(a.children.single.role, 'researcher');
      expect(a.children.single.model, 'o4');
      expect(a.children.single.requestedModel, true);
    });
  }
  for (final name in [
    'collab_agent_spawn_end',
    'collab_waiting_begin',
    'collab_close_end',
    'collab_resume_end',
    'collab_agent_interaction_end',
  ]) {
    test('normalizes $name without treating event type as role', () {
      final a = decode({
        'id': 'call',
        'type': name,
        'receiver_thread_id': 'child',
      })!;
      expect(a.children.single.role, isNull);
      expect(a.children.single.label, 'Subagent');
      expect(
        a.tool,
        name.contains('spawn')
            ? 'spawnagent'
            : name.contains('waiting')
            ? 'wait'
            : name.contains('close')
            ? 'closeagent'
            : name.contains('resume')
            ? 'resumeagent'
            : 'sendinput',
      );
    });
  }
  test(
    'state-only children unknown metadata and malformed values are honest',
    () {
      final a = decode({
        'id': 'x',
        'type': 'collabToolCall',
        'tool': 'wait',
        'statuses': {
          'child': {'status': 'future', 'summary': 'Update'},
        },
      })!;
      expect(a.children.single.label, 'Subagent');
      expect(a.children.single.status, 'unknown');
      expect(
        decode({'id': 'x', 'type': 'commandExecution', 'threadId': 'child'}),
        isNull,
      );
      expect(
        decode({
          'id': 'x',
          'type': 'collabToolCall',
          'receiverAgents': [
            4,
            {'threadId': false},
          ],
        })!.children,
        isEmpty,
      );
    },
  );
  test(
    'scoped sparse late start cannot erase terminal rows or leak identity across parents/mac',
    () {
      final store = SubagentActions();
      final full = {
        'id': 'same',
        'type': 'collabToolCall',
        'tool': 'spawnAgent',
        'status': 'completed',
        'receiverAgents': [
          {
            'threadId': 'child',
            'nickname': 'Ada',
            'agentRole': 'worker',
            'model': 'gpt',
          },
        ],
      };
      final a = store.merge(decode(full)!);
      store.merge(
        decode({
          'id': 'same',
          'type': 'collabToolCall',
          'tool': 'spawnAgent',
          'status': 'inProgress',
          'receiverThreadId': 'child',
        })!,
      );
      expect(a.status, 'completed');
      expect(a.children.single.nickname, 'Ada');
      final b = store.merge(
        decode({
          ...full,
          'receiverAgents': [
            {'threadId': 'child'},
          ],
        }, parent: 'other')!,
      );
      expect(b.children.single.nickname, isNull);
      expect(decode(full, mac: 'other')!.id, isNot(a.id));
      expect(decode(full, turn: 'other')!.id, isNot(a.id));
    },
  );
  test(
    'cached subagent projections whitelist data and strip arbitrary secrets nested in threads/timelines',
    () {
      final raw = {
        'id': 'call',
        'type': 'collabToolCall',
        'tool': 'wait',
        'receiverThreadId': 'child',
        'authToken': 'SECRET',
        'receiverAgents': [
          {'threadId': 'child', 'nickname': 'Ada', 'apiKey': 'SECRET'},
        ],
      };
      final state = ThreadLocalState.fromJson({
        'threads': [
          {
            'id': 'parent',
            'turns': [
              {
                'id': 'turn',
                'items': [raw],
              },
            ],
          },
        ],
        'timelines': {
          'parent': [raw],
        },
      });
      final json = jsonEncode(state.toJson());
      expect(json, isNot(contains('SECRET')));
      expect(json, contains('Ada'));
    },
  );
}
