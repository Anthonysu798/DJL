import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_history_reconciliation_test.dart' show historyDesktop;
import 'desktop_plan_runtime_fallback_test.dart'
    show PlanFallbackTransport, planRuntimeNotice;
import 'desktop_reasoning_controller_test.dart' show ReasoningPairings;

const legacyAnswerBody = '1. Which path?\n- A\n- B';
const legacyAnswerValues = {
  'inferred_plan_q_1': ['A'],
};

class LegacyAnswerTransport extends PlanFallbackTransport {
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) {
    if (method == 'thread/turns/list' && activeReadGate == null) {
      calls.add({'method': method, 'params': Map.of(params)});
      return Future.value({
        'threadId': params['threadId'],
        'data': (history?['turns'] as List? ?? []).reversed.toList(),
      });
    }
    return super.request(method, params, timeout: timeout);
  }
}

Future<DesktopController> legacyAnswerDesktop(PlanFallbackTransport t) async {
  final d = await historyDesktop(t, [
    {
      'id': 'question',
      'type': 'agentMessage',
      'turnId': 'ended',
      'text': legacyAnswerBody,
    },
  ]);
  d.models = [
    {'id': 'qa', 'model': 'provider-model'},
  ];
  d.model = 'qa';
  d.threadList.data.planSessions['thread'] = {
    'identityPin': d.active!.data['macIdentityPublicKey'],
    'source': 'compatibilityFallback',
  };
  return d;
}

void main() {
  test(
    'explicit rejected legacy Plan answers finish the owned normal fallback',
    () async {
      final t = LegacyAnswerTransport()
        ..replies.add(
          const RemoteRpcException(
            -32602,
            'Unsupported collaborationMode field',
            null,
          ),
        );
      final d = await legacyAnswerDesktop(t);
      addTearDown(d.dispose);
      expect(
        await d.answerInferredPlanQuestionnaire('question', legacyAnswerValues),
        isTrue,
        reason: d.error,
      );
      expect(t.actions, hasLength(2));
      final original = Map<String, dynamic>.of(t.actions.first)
        ..remove('collaborationMode');
      expect(t.actions.last, original);
      expect(d.threadList.data.planSessions, isEmpty);
      expect(d.timeline.where((r) => r['type'] == 'userMessage'), hasLength(1));
      expect(
        d.timeline.where((r) => r['type'] == 'systemMessage').single['text'],
        planRuntimeNotice,
      );
    },
  );

  test(
    'a newer native prompt prevents rejected legacy answers from downgrading it',
    () async {
      final t = LegacyAnswerTransport()
        ..replies.add(
          const RemoteRpcException(
            -32602,
            'Unsupported collaborationMode field',
            null,
          ),
        );
      final d = await legacyAnswerDesktop(t);
      addTearDown(d.dispose);
      t.beforeReply = () {
        t.events.add({
          'id': 83,
          'method': 'item/tool/requestUserInput',
          'params': {
            'threadId': 'thread',
            'questions': [
              {
                'id': 'native',
                'header': 'Scope',
                'question': 'Which scope?',
                'options': [],
              },
            ],
          },
        });
      };
      expect(
        await d.answerInferredPlanQuestionnaire('question', legacyAnswerValues),
        isFalse,
      );
      expect(t.actions, hasLength(1));
      expect(d.threadList.data.planSessions['thread']?['source'], 'native');
      expect(d.supportsPlan, isTrue);
      expect(d.timeline.where((r) => r['type'] == 'systemMessage'), isEmpty);
    },
  );
  test(
    'a removed selected model cannot silently send legacy answers without Plan',
    () async {
      final t = LegacyAnswerTransport();
      final d = await legacyAnswerDesktop(t);
      addTearDown(d.dispose);
      d.models = [];
      expect(
        await d.answerInferredPlanQuestionnaire('question', legacyAnswerValues),
        isFalse,
      );
      expect(t.actions, isEmpty);
      expect(
        d.threadList.data.planSessions['thread']?['source'],
        'compatibilityFallback',
      );
    },
  );
  test(
    'malformed native signature data cannot crash legacy prose rendering',
    () async {
      final t = LegacyAnswerTransport();
      final d = await legacyAnswerDesktop(t);
      addTearDown(d.dispose);
      d.userInputs.add({
        'id': 'stored-native',
        'method': 'item/tool/requestUserInput',
        'params': {
          'threadId': 'thread',
          'questions': [
            {
              'question': 37,
              'options': [
                {'label': 42},
              ],
            },
          ],
        },
      });
      expect(d.inferredPlanQuestionnaire(d.timeline.single), isNotNull);
    },
  );

  test(
    'matching native prompts win within their turn but not another turn',
    () async {
      final t = LegacyAnswerTransport();
      final d = await legacyAnswerDesktop(t);
      addTearDown(d.dispose);
      d.timeline.add({
        'id': 'native',
        'type': 'userInputPrompt',
        'turnId': 'ended',
        'questions': [
          {'question': 'A different native question?', 'options': []},
        ],
      });
      expect(d.inferredPlanQuestionnaire(d.timeline.first), isNull);
      d.timeline.last['turnId'] = 'another-turn';
      expect(d.inferredPlanQuestionnaire(d.timeline.first), isNotNull);
    },
  );

  test(
    'a native prompt without turn IDs only matches its plan window and signature',
    () async {
      final t = LegacyAnswerTransport();
      final d = await legacyAnswerDesktop(t);
      addTearDown(d.dispose);
      d.timeline.first.remove('turnId');
      d.timeline.first['type'] = 'plan';
      final questions = d
          .inferredPlanQuestionnaire(d.timeline.first)!
          .questions;
      d.timeline.add({
        'id': 'next-plan',
        'type': 'plan',
        'text': 'Another plan',
      });
      d.timeline.add({
        'id': 'native',
        'type': 'userInputPrompt',
        'questions': questions,
      });
      expect(d.inferredPlanQuestionnaire(d.timeline.first), isNotNull);
      d.timeline.removeAt(1);
      expect(d.inferredPlanQuestionnaire(d.timeline.first), isNull);
    },
  );

  test(
    'unpublished server work blocks inferred Start and retains answers',
    () async {
      final t = LegacyAnswerTransport();
      final d = await legacyAnswerDesktop(t);
      addTearDown(d.dispose);
      t.history = {
        'id': 'thread',
        'turns': [
          {'status': 'inProgress', 'items': []},
        ],
      };
      expect(
        await d.answerInferredPlanQuestionnaire('question', legacyAnswerValues),
        isFalse,
      );
      expect(d.error, contains('not published its ID'));
      expect(t.actions, isEmpty);
    },
  );

  test(
    'duplicate inferred presses share one pending active-turn lookup',
    () async {
      final t = LegacyAnswerTransport();
      final d = await legacyAnswerDesktop(t);
      addTearDown(d.dispose);
      final gate = Completer<RemoteJson>();
      t.activeReadGate = gate;
      final first = d.answerInferredPlanQuestionnaire(
        'question',
        legacyAnswerValues,
      );
      await t.activeReadRequested.future;
      expect(
        await d.answerInferredPlanQuestionnaire('question', legacyAnswerValues),
        isFalse,
      );
      expect(t.actions, isEmpty);
      gate.complete({
        'thread': {'id': 'thread', 'turns': []},
      });
      expect(await first, isTrue, reason: d.error);
      expect(t.actions, hasLength(1));
    },
  );

  test('a newer live turn fences an older inferred active-turn read', () async {
    final t = LegacyAnswerTransport();
    final d = await legacyAnswerDesktop(t);
    addTearDown(d.dispose);
    final gate = Completer<RemoteJson>();
    t.activeReadGate = gate;
    final first = d.answerInferredPlanQuestionnaire(
      'question',
      legacyAnswerValues,
    );
    await t.activeReadRequested.future;
    t.events.add({
      'method': 'turn/started',
      'params': {'threadId': 'thread', 'turnId': 'new-live'},
    });
    gate.complete({
      'thread': {'id': 'thread', 'turns': []},
    });
    expect(await first, isFalse);
    expect(t.actions, isEmpty);
    expect(d.turnId, 'new-live');
  });

  test(
    'an inferred answer resolves the server active turn before choosing Steer',
    () async {
      final t = LegacyAnswerTransport();
      final d = await legacyAnswerDesktop(t);
      addTearDown(d.dispose);
      t.history = {
        'id': 'thread',
        'cwd': '/qa',
        'turns': [
          {'id': 'server-live', 'status': 'inProgress', 'items': []},
        ],
      };
      expect(d.turnId, isNull);
      expect(
        await d.answerInferredPlanQuestionnaire('question', legacyAnswerValues),
        isTrue,
        reason: d.error,
      );
      expect(t.calls.where((c) => c['method'] == 'turn/start'), isEmpty);
      expect(t.calls.last['method'], 'turn/steer');
      expect(t.actions.single['expectedTurnId'], 'server-live');
      expect((t.actions.single['collaborationMode'] as Map)['mode'], 'plan');
    },
  );

  test('foreign identity and streaming answers cannot dispatch', () async {
    final t = LegacyAnswerTransport();
    final d = await legacyAnswerDesktop(t);
    addTearDown(d.dispose);
    d.threadList.data.planSessions['thread']!['identityPin'] = 'foreign';
    expect(
      await d.answerInferredPlanQuestionnaire('question', legacyAnswerValues),
      isFalse,
    );
    d.threadList.data.planSessions['thread']!['identityPin'] =
        d.active!.data['macIdentityPublicKey'];
    d.timeline.single['isStreaming'] = true;
    expect(
      await d.answerInferredPlanQuestionnaire('question', legacyAnswerValues),
      isFalse,
    );
    expect(t.actions, isEmpty);
  });

  test(
    'invalid answers preserve the existing composer draft and dispatch nothing',
    () async {
      final t = LegacyAnswerTransport();
      final d = await legacyAnswerDesktop(t);
      addTearDown(d.dispose);
      d.threadList.data.setComposerDraft(
        'thread',
        DesktopComposerDraft(text: 'Unsent original draft'),
      );
      for (final answers in <Map<String, List<String>>>[
        {},
        {
          'other': ['A'],
        },
        {
          'inferred_plan_q_1': [' '],
        },
        {
          'inferred_plan_q_1': ['A', 'B'],
        },
      ]) {
        expect(
          await d.answerInferredPlanQuestionnaire('question', answers),
          isFalse,
        );
      }
      expect(t.actions, isEmpty);
      expect(
        d.threadList.data.composerDraft('thread').text,
        'Unsent original draft',
      );
    },
  );

  test(
    'an uncertain inferred send is never retried and retains the ordinary draft',
    () async {
      final t = LegacyAnswerTransport()
        ..replies.add(TimeoutException('Lost answer reply'));
      final d = await legacyAnswerDesktop(t);
      addTearDown(d.dispose);
      d.threadList.data.setComposerDraft(
        'thread',
        DesktopComposerDraft(text: 'Unsent original draft'),
      );
      expect(
        await d.answerInferredPlanQuestionnaire('question', legacyAnswerValues),
        isFalse,
      );
      expect(t.actions, hasLength(1));
      expect(d.error, contains('unknown'));
      expect(
        d.threadList.data.composerDraft('thread').text,
        'Unsent original draft',
      );
    },
  );

  test(
    'a replacement connection cancels an inferred active-turn lookup',
    () async {
      final t = LegacyAnswerTransport();
      final d = await legacyAnswerDesktop(t);
      addTearDown(d.dispose);
      final gate = Completer<RemoteJson>();
      t.activeReadGate = gate;
      final sending = d.answerInferredPlanQuestionnaire(
        'question',
        legacyAnswerValues,
      );
      await Future.any([
        t.activeReadRequested.future,
        t.actionRequested.future,
      ]);
      t.activeReadGate = null;
      await d.disconnect();
      await d.connect((t.pairings as ReasoningPairings).pair);
      await d.openThread({
        'id': 'thread',
        'cwd': '/qa',
      }, readOnlyNavigation: true);
      gate.complete({
        'thread': {'id': 'thread', 'turns': []},
      });
      expect(await sending, isFalse);
      expect(t.actions, isEmpty);
    },
  );
}
