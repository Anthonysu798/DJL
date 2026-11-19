import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_attention.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';

Map<String, dynamic> approval(Object id, String? thread, {String? reason}) => {
  'id': id,
  'method': 'item/commandExecution/requestApproval',
  'params': {
    'threadId': ?thread,
    'turnId': 'approval-turn',
    'itemId': 'approval-item',
    'command': 'git diff',
    'reason': ?reason,
  },
};

Map<String, dynamic> question(Object id, String thread) => {
  'id': id,
  'method': 'item/tool/requestUserInput',
  'params': {
    'threadId': thread,
    'turnId': 'question-turn',
    'itemId': 'question-item',
    'questions': [
      {
        'id': 'direction',
        'header': 'Direction',
        'question': 'Which direction should we take?',
        'isOther': false,
        'isSecret': false,
        'options': [],
      },
    ],
  },
};

void main() {
  test('question arrival dates outrank unrelated thread recency', () {
    final data = ThreadLocalState.fromJson({
      'threads': [
        {'id': 'older-question', 'updatedAt': 900},
        {'id': 'newer-question', 'updatedAt': 100},
      ],
    });
    final older = question('older', 'older-question')..['_receivedAt'] = 200;
    final newer = question('newer', 'newer-question')..['_receivedAt'] = 300;
    final items = projectDesktopAttention(data, userInputs: [older, newer]);
    expect(items.map((item) => item.requestId), ['newer', 'older']);
    expect(items.map((item) => item.date), [300.0, 200.0]);
  });
  test(
    'internal request focus preserves RPC ID type and is never accepted from a URL',
    () {
      const integer = DesktopLinkTarget('chat', request: 17);
      const string = DesktopLinkTarget('chat', request: '17');
      expect(integer, isNot(string));
      expect(integer.hasFocus, isTrue);
      expect(
        DesktopLinkTarget.parse(
          Uri.parse('djl://thread/chat?request=17'),
        )!.request,
        isNull,
      );
    },
  );
  test('projects all five kinds with exact review and request targets', () {
    final data = ThreadLocalState.fromJson({
      'threads': [
        for (final id in ['approval', 'question', 'failed', 'goal', 'ready'])
          {'id': id, 'title': '$id chat', 'cwd': '/workspace/$id'},
      ],
      'timelines': {
        'failed': [
          {
            'id': 'failure-item',
            'role': 'system',
            'type': 'commandExecution',
            'text': 'Error: permission denied\n at runner.js:42',
            'turnId': 'failure-turn',
            'itemId': 'failure-item',
            'createdAt': 100,
            'orderIndex': 2,
          },
        ],
        'ready': [
          {
            'id': 'ready-message',
            'role': 'assistant',
            'type': 'agentMessage',
            'text': 'Changes are ready to review.',
            'turnId': 'ready-turn',
            'itemId': 'ready-item',
            'createdAt': 200,
            'orderIndex': 3,
          },
        ],
      },
      'goals': {
        'goal': {'threadId': 'goal', 'status': 'blocked'},
      },
    });
    final items = projectDesktopAttention(
      data,
      approvals: [approval('approval-request', 'approval')],
      userInputs: [question('question-request', 'question')],
      failed: {'failed'},
      ready: {'ready'},
    );
    expect(items.map((item) => item.kind), DesktopAttentionKind.values);
    expect(items.first.requestId, 'approval-request');
    expect(items.first.target.thread, 'approval');
    expect(items.first.target.turn, 'approval-turn');
    expect(items.first.target.item, 'approval-item');
    expect(items.first.summary, 'Allow Codex to run “git diff”?');
    expect(items[1].requestId, 'question-request');
    expect(items[1].summary, 'Which direction should we take?');
    expect(
      items[2].target.message,
      'activity:["","failed","failure-turn","failure-item"]',
    );
    expect(items[2].target.item, 'failure-item');
    expect(
      items[2].summary,
      "Review the requested access or change this chat's access mode, then retry the run.",
    );
    expect(
      items[3].summary,
      'The goal is blocked. Open the chat to review what the agent needs.',
    );
    expect(items.last.target.message, 'ready-message');
    expect(items.last.projectTitle, 'ready');
    expect(items.last.section, DesktopAttentionSection.readyToReview);
    expect(
      items.take(4).every((v) => v.section == DesktopAttentionSection.needsYou),
      isTrue,
    );
  });

  test('approval arrival and urgency outrank newer thread dates', () {
    final data = ThreadLocalState.fromJson({
      'threads': [
        {'id': 'old', 'updatedAt': 100},
        {'id': 'new', 'updatedAt': 200},
        {'id': 'question', 'updatedAt': 300},
      ],
    });
    final items = projectDesktopAttention(
      data,
      approvals: [approval(1, 'old'), approval(2, 'new')],
      userInputs: [question(3, 'question')],
    );
    expect(items.map((v) => v.requestId), [1, 2, 3]);
  });

  test(
    'JSON number and string request IDs stay distinct; no response data leaks',
    () {
      final data = ThreadLocalState.fromJson({
        'threads': [
          {'id': 'thread'},
        ],
      });
      final items = projectDesktopAttention(
        data,
        approvals: [
          approval(17, 'thread'),
          approval('17', 'thread'),
          approval(17.5, 'thread'),
        ],
        userInputs: [
          question('pending', 'thread')..['_responseUnknown'] = true,
          question('answered', 'thread')
            ..['_submitted'] = true
            ..['answers'] = {
              'direction': ['private answer'],
            },
          question('sending', 'thread')..['_submitting'] = true,
        ],
      );
      expect(items.map((v) => v.requestId), [17, '17', 17.5, 'pending']);
      expect(items.map((v) => v.id).toSet(), hasLength(4));
      expect(items.any((v) => v.summary.contains('private answer')), isFalse);
    },
  );

  test(
    'excludes archived, removed, unknown and ambiguous requests; includes children',
    () {
      final data = ThreadLocalState.fromJson({
        'threads': [
          {'id': 'parent'},
          {'id': 'child', 'parent_thread_id': 'parent'},
          {'id': 'archived', 'syncState': 'archivedLocal'},
          {'id': 'override'},
          {'id': 'removed'},
        ],
      });
      data.archive('override', true);
      data.remove('removed');
      final conflict = approval('conflict', 'parent');
      (conflict['params'] as Map)['thread_id'] = 'child';
      final items = projectDesktopAttention(
        data,
        approvals: [
          approval('child', 'child'),
          approval('archived', 'archived'),
          approval('override', 'override'),
          approval('removed', 'removed'),
          approval('unknown', 'unknown'),
          approval('fallback', null),
          conflict,
          approval(false, 'parent'),
        ],
        activeThreadId: 'parent',
      );
      expect(items.map((v) => v.requestId), ['child', 'fallback']);
      expect(items.map((v) => v.target.thread), ['child', 'parent']);
    },
  );

  test('historical completion alone never invents unread review work', () {
    final data = ThreadLocalState.fromJson({
      'threads': [
        {'id': 'quiet', 'status': 'completed'},
      ],
      'timelines': {
        'quiet': [
          {
            'id': 'old',
            'role': 'assistant',
            'text': 'Done',
            'status': 'completed',
          },
        ],
      },
      'goals': {
        'quiet': {'threadId': 'quiet', 'status': 'active'},
      },
    });
    expect(projectDesktopAttention(data), isEmpty);
    expect(projectDesktopAttention(data, query: 'anything'), isEmpty);
    for (final status in ['paused', 'complete', 'active']) {
      data.goals['quiet']!['status'] = status;
      expect(projectDesktopAttention(data), isEmpty);
    }
    for (final status in ['blocked', 'usageLimited', 'budgetLimited']) {
      data.goals['quiet']!['status'] = status;
      expect(
        projectDesktopAttention(data).single.kind,
        DesktopAttentionKind.blockedGoal,
      );
    }
  });

  test(
    'query matches title, project, status and summary without mutating cache',
    () {
      final data = ThreadLocalState.fromJson({
        'threads': [
          {
            'id': 'thread',
            'name': 'Choose direction',
            'cwd': '/workspace/Alpha',
          },
        ],
      });
      final request = approval(
        'request',
        'thread',
        reason: '  Review\n  the patch  ',
      );
      for (final query in [
        'choose',
        'ALPHA',
        'approval needed',
        'the patch',
        '  ',
      ]) {
        final items = projectDesktopAttention(
          data,
          approvals: [request],
          query: query,
        );
        expect(items, hasLength(1));
        expect(items.single.summary, 'Review the patch');
      }
      expect(
        projectDesktopAttention(data, approvals: [request], query: 'missing'),
        isEmpty,
      );
      expect((request['params'] as Map)['reason'], '  Review\n  the patch  ');
      expect(data.snapshots.single['name'], 'Choose direction');
    },
  );

  test(
    'date aliases and units retain descending recency and stable ID ties',
    () {
      final data = ThreadLocalState.fromJson({
        'threads': [
          {'id': 'missing-z'},
          {'id': 'missing-a'},
          {'id': 'iso', 'updatedAt': '2026-01-01T00:00:00Z'},
          {'id': 'seconds', 'updated_at': 1800000000},
          {'id': 'millis', 'updatedAt': '1800000000000'},
          {'id': 'micros', 'updatedAt': 1800000000000000},
          {'id': 'nanos', 'updated_at': '1800000000000000000'},
          {
            'id': 'fallback',
            'updatedAt': 'invalid',
            'created_at': '2030-01-01T00:00:00Z',
          },
        ],
      });
      final order = data.snapshots.map((v) => v['id']).toList();
      final items = projectDesktopAttention(
        data,
        ready: order.cast<String>().toSet(),
      );
      expect(items.map((v) => v.target.thread), [
        'fallback',
        'micros',
        'millis',
        'nanos',
        'seconds',
        'iso',
        'missing-a',
        'missing-z',
      ]);
      expect(data.snapshots.map((v) => v['id']), order);
    },
  );

  test(
    'concise summaries keep complete Unicode graphemes at the source limit',
    () {
      const family = '👨‍👩‍👧‍👦';
      final data = ThreadLocalState.fromJson({
        'threads': [
          {'id': 'thread'},
        ],
      });
      final items = projectDesktopAttention(
        data,
        approvals: [
          approval(
            'request',
            'thread',
            reason: List.filled(170, family).join(),
          ),
        ],
      );
      expect(items.single.summary, '${List.filled(159, family).join()}…');
    },
  );
}
