import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/status/domain/run_status.dart';

void main() {
  late DateTime now;
  late RunStatusProjector status;
  void context({
    String pin = 'a',
    String session = 's',
    bool online = true,
    String? selected,
    Map<String, StatusThread>? threads,
  }) {
    status.setContext(
      mac: 'private-mac',
      fingerprint: pin * 64,
      session: session,
      connected: online,
      selectedThread: selected,
      threads:
          threads ??
          {
            for (final id in ['a', 'b', 'c'])
              id: StatusThread('private-title-$id', '/secret/private-folder'),
          },
    );
  }

  void event(
    String method,
    String thread,
    String turn, [
    Map<String, dynamic> extra = const {},
  ]) => status.observe(method, {'threadId': thread, 'turnId': turn, ...extra});
  setUp(() {
    now = DateTime.utc(2026, 10, 28);
    status = RunStatusProjector(now: () => now);
    context();
  });
  tearDown(() => status.dispose());

  test('modern lifecycle accepts top-level id only for lifecycle events', () {
    status.observe('turn/started', {'threadId': 'a', 'id': 'one'});
    expect(status.project().running.single.turn, 'one');
    status.observe('turn/completed', {'threadId': 'a', 'id': 'one'});
    expect(status.project().ready.single.turn, 'one');
    event('turn/started', 'b', 'two');
    status.observe('turn/completed', {'threadId': 'b', 'id': 'two'});
    expect(status.project().ready.map((r) => r.turn), ['two', 'one']);
    status.observe('item/agentMessage/delta', {
      'threadId': 'c',
      'id': 'unscoped',
      'phase': 'final_answer',
      'delta': 'text',
    });
    status.observe('tool/completed', {'threadId': 'c', 'id': 'unscoped'});
    expect(status.project().running, isEmpty);
  });

  test(
    'modern id lifecycle consumes selected completion and replay without renewal',
    () {
      context(selected: 'a');
      status.observe('turn/started', {'threadId': 'a', 'id': 'selected'});
      expect(status.project().running.single.turn, 'selected');
      status.observe('turn/completed', {'threadId': 'a', 'id': 'selected'});
      context();
      status.observe('turn/completed', {'threadId': 'a', 'id': 'selected'});
      expect(status.project().rows, isEmpty);
      status.observe('turn/started', {
        'threadId': 'b',
        'id': 'replayed',
        'djlReplayedEvent': true,
      });
      expect(status.project().rows, isEmpty);
      status.observe('turn/started', {'threadId': 'b', 'id': 'one'});
      status.observe('turn/completed', {
        'threadId': 'b',
        'id': 'one',
        'djlReplayedEvent': true,
      });
      status.observe('turn/completed', {'threadId': 'b', 'id': 'one'});
      expect(status.project().rows, isEmpty);
    },
  );

  for (final envelope in ['suffix', 'generic']) {
    for (final alias in [
      'agent_message_content_delta',
      'agent_message_delta',
    ]) {
      test(
        'legacy $alias $envelope correlates params.id and msg message IDs to exact active turn',
        () {
          event('turn/started', 'a', 'one');
          void assistant(
            String turn,
            String message, {
            String text = 'text',
            String phase = 'final_answer',
            bool replay = false,
          }) {
            status.observe(
              envelope == 'suffix' ? 'codex/event/$alias' : 'codex/event',
              {
                'conversationId': 'a',
                'id': turn,
                if (replay) 'djlReplayedEvent': true,
                'msg': {
                  'type': alias,
                  'message_id': message,
                  'phase': phase,
                  'delta': text,
                },
              },
            );
          }

          assistant('wrong', 'message');
          assistant('one', 'replay', replay: true);
          assistant('one', 'empty', text: ' ');
          assistant('one', 'unknown', phase: 'final answer');
          expect(status.project().running.single.state, RunState.running);
          assistant('one', 'message');
          expect(status.project().running.single.state, RunState.finishing);
          status.observe(
            envelope == 'suffix' ? 'codex/event/agent_message' : 'codex/event',
            {
              'conversationId': 'a',
              'id': 'one',
              'msg': {
                'type': 'agent_message',
                'messageId': 'message',
                'message': 'done',
              },
            },
          );
          expect(status.project().running.single.state, RunState.running);
          assistant('one', 'message');
          expect(status.project().running.single.state, RunState.running);
          assistant('one', 'different-message');
          expect(status.project().running.single.state, RunState.finishing);
        },
      );
    }
    for (final completion in [
      'agent_message',
      'assistant_message',
      'final_answer',
    ]) {
      test(
        'legacy $completion $envelope tombstones supported item fields against late deltas',
        () {
          event('turn/started', 'a', 'one');
          void legacy(String alias, String item) => status.observe(
            envelope == 'suffix' ? 'codex/event/$alias' : 'codex/event',
            {
              'threadId': 'a',
              'turnId': 'one',
              'itemId': item,
              'phase': 'final_answer',
              'delta': 'text',
              'msg': {'type': alias},
            },
          );
          legacy('agent_message_delta', 'm');
          expect(status.project().running.single.state, RunState.finishing);
          legacy(completion, 'm');
          expect(status.project().running.single.state, RunState.running);
          legacy('agent_message_delta', 'm');
          expect(status.project().running.single.state, RunState.running);
          legacy('agent_message_delta', 'new-m');
          expect(status.project().running.single.state, RunState.finishing);
          expect(status.project().ready, isEmpty);
        },
      );
    }
  }

  test(
    'all states require scoped lifecycle and exact streaming final phase',
    () {
      event('turn/started', 'a', 'one');
      expect(status.project().rows.single.state, RunState.running);
      event('item/agentMessage/delta', 'a', 'wrong', {
        'itemId': 'i',
        'phase': 'final_answer',
        'delta': 'text',
      });
      event('item/agentMessage/delta', 'a', 'one', {
        'itemId': 'i',
        'phase': 'final answer',
        'delta': 'text',
      });
      expect(status.project().rows.single.state, RunState.running);
      event('item/agentMessage/delta', 'a', 'one', {
        'itemId': 'i',
        'phase': 'final-answer',
        'delta': 'text',
      });
      expect(status.project().rows.single.state, RunState.finishing);
      event('item/completed', 'a', 'one', {
        'item': {'id': 'i', 'type': 'agentMessage'},
      });
      expect(status.project().rows.single.state, RunState.running);
      context(online: false);
      expect(status.project().rows.single.state, RunState.paused);
      context();
      event('turn/completed', 'a', 'one');
      event('turn/started', 'b', 'two');
      event('turn/failed', 'b', 'two');
      expect(status.project().rows.map((r) => r.state), [
        RunState.failed,
        RunState.ready,
      ]);
    },
  );

  test('selected, replay, stopped and old turn never manufacture outcomes', () {
    context(selected: 'a');
    event('turn/completed', 'a', 'one');
    context();
    event('turn/completed', 'a', 'one');
    expect(status.project().rows, isEmpty);
    event('turn/started', 'b', 'old');
    event('turn/started', 'b', 'new');
    event('turn/completed', 'b', 'old');
    expect(status.project().rows.single.turn, 'new');
    event('turn/completed', 'b', 'new', {
      'turn': {'status': 'cancelled'},
    });
    event('turn/completed', 'c', 'replay', {'djlReplayedEvent': true});
    event('turn/started', 'c', 'replay');
    expect(status.project().rows, isEmpty);
  });

  test(
    'item completion cannot be reopened by late delta; replay terminal retires live run without outcome',
    () {
      event('turn/started', 'a', 'one');
      event('item/started', 'a', 'one', {
        'item': {
          'id': 'i',
          'type': 'assistantMessage',
          'phase': 'final_answer',
          'text': 'final',
        },
      });
      expect(status.project().rows.single.state, RunState.finishing);
      event('item/completed', 'a', 'one', {
        'item': {'id': 'i', 'type': 'assistantMessage'},
      });
      event('item/agentMessage/delta', 'a', 'one', {
        'itemId': 'i',
        'delta': 'late',
        'phase': 'final_answer',
      });
      expect(status.project().rows.single.state, RunState.running);
      event('turn/completed', 'a', 'one', {'djlReplayedEvent': true});
      event('turn/completed', 'a', 'one');
      expect(status.project().rows, isEmpty);
    },
  );

  test(
    'new turns with same terminal state have distinct age, failure and ready exact cutoffs',
    () {
      event('turn/completed', 'a', 'one');
      now = now.add(const Duration(minutes: 4));
      event('turn/completed', 'a', 'two');
      expect(status.project().rows.single.turn, 'two');
      now = now.add(const Duration(minutes: 1));
      expect(status.project().readyCount, 1);
      event('turn/completed', 'b', 'failed', {
        'status': {'status_type': 'turn_error'},
      });
      now = now.add(const Duration(minutes: 14, seconds: 59));
      expect(status.project().failedCount, 1);
      expect(status.project().readyCount, 0);
      now = now.add(const Duration(seconds: 1));
      expect(status.project().rows, isEmpty);
    },
  );
  test(
    'explicit failure message wins over stopped and empty error payload does not invent failure',
    () {
      event('turn/completed', 'a', 'failure', {
        'status': 'cancelled',
        'error': {'message': 'Turn failed'},
      });
      expect(status.project().failedCount, 1);
      event('turn/completed', 'b', 'success', {'error': {}});
      expect(status.project().readyCount, 1);
    },
  );

  test(
    'exact legacy aliases and envelopes, no tool/error/history status inference',
    () {
      for (final start in ['turn_started', 'turnstarted', 'task_started']) {
        for (final end in [
          'turncompleted',
          'task_complete',
          'turn_complete',
          'turn_completed',
        ]) {
          final turn = '$start-$end';
          status.observe('codex/event', {
            'msg': {'type': start, 'conversation_id': 'a', 'id': turn},
          });
          expect(status.project().running.single.turn, turn);
          status.observe('codex/event/$end', {
            'event': {'thread_id': 'a', 'id': turn},
          });
          expect(status.project().ready.single.turn, turn);
        }
      }
      event('turn/started', 'b', 'live');
      event('tool/task_complete', 'b', 'live');
      event('error', 'b', 'live');
      event('thread/status/changed', 'b', 'live', {'status': 'idle'});
      expect(status.project().running.single.state, RunState.running);
      context(threads: {'a': const StatusThread('A', '')});
      expect(status.project().running, isEmpty);
    },
  );

  test('fixed times, boundaries, reconnect, rename and pin scope', () {
    event('turn/started', 'a', 'one');
    final start = now;
    now = now.add(const Duration(minutes: 30));
    expect(status.project().rows.single.state, RunState.paused);
    context(session: 'next');
    event('turn/started', 'a', 'one');
    expect(status.project().rows.single.startedAt, start);
    event('turn/completed', 'a', 'one');
    final terminal = now;
    now = now.add(const Duration(minutes: 4));
    event('turn/completed', 'a', 'one');
    expect(
      status.project().rows.single.expiresAt,
      terminal.add(const Duration(minutes: 5)),
    );
    now = now.add(const Duration(minutes: 1));
    expect(status.project().rows, isEmpty);
    event('turn/started', 'b', 'two');
    context(threads: {'b': const StatusThread('Renamed', '/private/new')});
    expect(status.project().rows.single.title, 'Renamed');
    context(pin: 'b');
    expect(status.project().rows, isEmpty);
    event('turn/started', 'b', 'two');
    now = now.add(const Duration(hours: 4));
    expect(status.project().rows, isEmpty);
  });

  test('bounded buckets, display precedence, private payload allowlist', () {
    context(
      threads: {
        for (var n = 0; n < 12; n++)
          '$n': StatusThread('private-title-$n', '/secret/private-folder'),
      },
    );
    for (var n = 0; n < 12; n++) {
      event('turn/started', '$n', 'private-turn-$n');
      if (n >= 4) {
        event(
          n < 8 ? 'turn/failed' : 'turn/completed',
          '$n',
          'private-turn-$n',
        );
      }
    }
    final snapshot = status.project();
    expect(
      [snapshot.runningCount, snapshot.failedCount, snapshot.readyCount],
      [3, 3, 3],
    );
    expect(snapshot.rows.length, 3);
    expect(snapshot.failed.map((r) => r.thread), ['7', '6', '5']);
    expect(snapshot.ready.map((r) => r.thread), ['11', '10', '9']);
    final buckets = snapshot.toPayload(detailed: false)['buckets'] as Map;
    expect((buckets['failed'] as List).length, 3);
    expect((buckets['ready'] as List).length, 3);
    for (final detailed in [false, true]) {
      final encoded = jsonEncode(snapshot.toPayload(detailed: detailed));
      if (!detailed) {
        for (final secret in [
          'private',
          'secret',
          'djl://',
          'threadId',
          'turnId',
          'macId',
          'a' * 64,
        ]) {
          expect(encoded, isNot(contains(secret)));
        }
      } else {
        expect(encoded, contains('private-title-'));
        expect(encoded, contains('private-folder'));
        expect(encoded, isNot(contains('/secret/')));
        expect(encoded, contains('macKeySha256'));
      }
    }
  });

  test(
    'archive/delete consume active record; Unicode title and basename bounds apply only with safe URL',
    () {
      event('turn/started', 'a', 'one');
      context(threads: {});
      context();
      event('turn/started', 'a', 'one');
      expect(status.project().rows, isEmpty);
      context(
        threads: {
          'a': StatusThread('  ${'😀' * 130}  ', '/secret/${'🏠' * 90}/'),
        },
      );
      event('turn/started', 'a', 'two');
      final row = status.project().rows.single;
      expect(row.title.runes.length, 120);
      expect(row.detail.runes.length, 80);
      final payload = row.payload(true);
      expect(payload['url'], startsWith('djl://thread/a?'));
      expect(payload.keys, isNot(contains('turnId')));
    },
  );
}
