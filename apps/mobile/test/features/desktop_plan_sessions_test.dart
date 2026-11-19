import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_plan_widgets_test.dart' show PlanActionTransport;
import 'desktop_history_reconciliation_test.dart'
    show historyDesktop, historyPage;
import 'desktop_reasoning_controller_test.dart'
    show reasoningDesktop, ReasoningPairings;
import 'desktop_activity_test.dart' show ActivityCacheStore;

final _proposal = {
  'id': 'assistant',
  'type': 'agentMessage',
  'turnId': 'ended',
  'text': '<proposed_plan>Saved proposal</proposed_plan>',
};

void _native(
  PlanActionTransport t, {
  String thread = 'thread',
  int request = 17,
}) {
  t.events.add({
    'id': request,
    'method': 'item/tool/requestUserInput',
    'params': {
      'threadId': thread,
      'questions': [
        {
          'id': 'q',
          'header': 'Scope',
          'question': 'Choose scope',
          'options': [
            {'label': 'Continue', 'description': ''},
          ],
        },
      ],
    },
  });
  t.events.add({
    'method': 'serverRequest/resolved',
    'params': {'requestId': request},
  });
}

void main() {
  test(
    'a plan request without a model preserves its draft without dispatch',
    () async {
      final t = PlanActionTransport();
      final d = await historyDesktop(t, [_proposal]);
      addTearDown(d.dispose);
      d.models = [];
      d.model = null;
      d.setPlan(true);
      d.threadList.data.setComposerDraft(
        'thread',
        DesktopComposerDraft(text: 'Plan this first'),
      );
      expect(await d.send('Plan this first'), isFalse);
      expect(t.calls.where((c) => c['method'] == 'turn/start'), isEmpty);
      expect(d.threadList.data.composerDraft('thread').text, 'Plan this first');
      expect(d.threadList.data.planSessions, isEmpty);
      expect(d.timeline.any((r) => r['type'] == 'userMessage'), isFalse);
    },
  );

  test(
    'a replacement connection cannot inherit an old default acknowledgement',
    () async {
      final store = ActivityCacheStore();
      final t = PlanActionTransport()..history = historyPage([_proposal]);
      final d = await reasoningDesktop(t, store: store);
      addTearDown(d.dispose);
      d.models = [
        {'id': 'qa', 'model': 'provider-model'},
      ];
      d.model = 'qa';
      _native(t);
      final gate = Completer<RemoteJson>();
      t.actionGate = gate;
      final sending = d.send('Continue normally');
      await t.actionRequested.future;
      try {
        await d.disconnect();
        await d.connect((t.pairings as ReasoningPairings).pair);
        await d.openThread({
          'id': 'thread',
          'cwd': '/qa',
        }, readOnlyNavigation: true);
        expect(d.threadList.data.planSessions['thread']?['source'], 'native');
      } finally {
        gate.complete({
          'turn': {'id': 'old-connection-turn'},
        });
      }
      expect(await sending, isFalse);
      expect(d.threadList.data.planSessions['thread']?['source'], 'native');
      expect(
        d.responsePlanProposal(
          d.timeline.firstWhere((r) => r['id'] == 'assistant'),
        ),
        isNull,
      );
    },
  );

  test(
    'a locally cancelled plan request does not create a plan session',
    () async {
      final t = PlanActionTransport();
      final d = await historyDesktop(t, [_proposal]);
      addTearDown(d.dispose);
      d.models = [
        {'id': 'qa', 'model': 'provider-model'},
      ];
      d.model = 'qa';
      d.setPlan(true);
      expect(
        await d.sendDraft(
          DesktopComposerDraft(text: 'Never dispatch'),
          canContinue: () => false,
        ),
        isFalse,
      );
      expect(t.calls.where((c) => c['method'] == 'turn/start'), isEmpty);
      expect(d.threadList.data.planSessions, isEmpty);
      expect(
        d.responsePlanProposal(
          d.timeline.firstWhere((r) => r['id'] == 'assistant'),
        ),
        isNotNull,
      );
    },
  );

  test(
    'a lost default reply retains session knowledge and never retries the input',
    () async {
      final t = PlanActionTransport();
      final d = await historyDesktop(t, [_proposal]);
      addTearDown(d.dispose);
      d.models = [
        {'id': 'qa', 'model': 'provider-model'},
      ];
      d.model = 'qa';
      _native(t);
      final gate = Completer<RemoteJson>();
      t.actionGate = gate;
      final sending = d.send('Continue normally');
      await t.actionRequested.future;
      gate.completeError(TimeoutException('Lost mode reply'));
      expect(await sending, isFalse);
      expect(
        d.responsePlanProposal(
          d.timeline.firstWhere((r) => r['id'] == 'assistant'),
        ),
        isNull,
      );
      expect(t.calls.where((c) => c['method'] == 'turn/start'), hasLength(1));
    },
  );

  test(
    'a newer native prompt survives an older default-mode acknowledgement',
    () async {
      final t = PlanActionTransport();
      final d = await historyDesktop(t, [_proposal]);
      addTearDown(d.dispose);
      d.models = [
        {'id': 'qa', 'model': 'provider-model'},
      ];
      d.model = 'qa';
      _native(t);
      final gate = Completer<RemoteJson>();
      t.actionGate = gate;
      final sending = d.send('Continue normally');
      await t.actionRequested.future;
      _native(t, request: 18);
      gate.complete({
        'turn': {'id': 'implemented'},
      });
      expect(await sending, isTrue, reason: d.error);
      expect(
        d.responsePlanProposal(
          d.timeline.firstWhere((r) => r['id'] == 'assistant'),
        ),
        isNull,
      );
      expect(d.threadList.data.planSessions['thread']?['source'], 'native');
    },
  );

  test(
    'accepted default mode clears its captured chat and retains another chat',
    () async {
      final t = PlanActionTransport();
      final d = await historyDesktop(t, [_proposal]);
      addTearDown(d.dispose);
      d.models = [
        {'id': 'qa', 'model': 'provider-model'},
      ];
      d.model = 'qa';
      d.threadList.data.upsert({'id': 'other', 'cwd': '/qa'});
      _native(t);
      _native(t, thread: 'other', request: 18);
      expect(await d.send('Continue normally'), isTrue, reason: d.error);
      expect(d.threadList.data.planSessions.containsKey('thread'), isFalse);
      expect(d.threadList.data.planSessions['other']?['source'], 'native');
      expect(
        d.responsePlanProposal(
          d.timeline.firstWhere((r) => r['id'] == 'assistant'),
        ),
        isNotNull,
      );
    },
  );

  test(
    'missing default-mode model keeps the draft and session without dispatch',
    () async {
      final t = PlanActionTransport();
      final d = await historyDesktop(t, [_proposal]);
      addTearDown(d.dispose);
      _native(t);
      d.models = [];
      d.model = null;
      d.threadList.data.setComposerDraft(
        'thread',
        DesktopComposerDraft(text: 'Keep this draft'),
      );
      expect(await d.send('Keep this draft'), isFalse);
      expect(t.calls.where((c) => c['method'] == 'turn/start'), isEmpty);
      expect(d.threadList.data.composerDraft('thread').text, 'Keep this draft');
      expect(d.timeline.any((r) => r['type'] == 'userMessage'), isFalse);
      expect(d.threadList.data.planSessions['thread']?['source'], 'native');
    },
  );

  test(
    'cache decoding retains valid session data and deletion removes only its own entry',
    () {
      final state = ThreadLocalState.fromJson({
        'threads': [
          {'id': 'thread'},
          {'id': 'other'},
        ],
        'planSessions': {
          'thread': {'identityPin': 'pin', 'source': 'native'},
          'other': {'identityPin': 'pin', 'source': 'requested'},
          'bad-kind': {'identityPin': 'pin', 'source': 'unexpected'},
          'bad-pin': {'identityPin': 17, 'source': 'native'},
          'bad-entry': false,
        },
      });
      expect(state.planSessions.keys, unorderedEquals(['thread', 'other']));
      final restored = ThreadLocalState.fromJson(state.toJson());
      restored.remove('thread');
      expect(restored.planSessions.keys, ['other']);
      expect(restored.find('other'), isNotNull);
    },
  );

  for (final changed in ['identity', 'desktop']) {
    test(
      'saved plan knowledge does not transfer to a changed $changed',
      () async {
        final store = ActivityCacheStore();
        final t = PlanActionTransport()..history = historyPage([_proposal]);
        final d = await reasoningDesktop(t, store: store);
        _native(t);
        await d.threadList.saveNow();
        d.dispose();
        final next = PlanActionTransport()..history = historyPage([_proposal]);
        final pairings = next.pairings as ReasoningPairings;
        pairings.pair = Pairing({
          ...pairings.pair.data,
          if (changed == 'identity') 'macIdentityPublicKey': 'replacement-pin',
          if (changed == 'desktop') 'macDeviceId': 'replacement-desktop',
        });
        final restored = await reasoningDesktop(next, store: store);
        addTearDown(restored.dispose);
        expect(
          restored.responsePlanProposal(
            restored.timeline.firstWhere((r) => r['id'] == 'assistant'),
          ),
          isNotNull,
        );
      },
    );
  }

  for (final steer in [false, true]) {
    test(
      'normal ${steer ? 'Steer' : 'Start'} explicitly exits a known plan session',
      () async {
        final t = PlanActionTransport();
        final d = await historyDesktop(t, []);
        addTearDown(d.dispose);
        d.models = [
          {'id': 'qa', 'model': 'provider-model'},
        ];
        d.model = 'qa';
        d.effort = 'high';
        d.setPlan(true);
        expect(await d.send('Plan first'), isTrue, reason: d.error);
        if (steer) {
          t.history = {
            'id': 'thread',
            'cwd': '/qa',
            'turns': [
              {'id': 'implemented', 'status': 'inProgress', 'items': []},
            ],
          };
          t.events.add({
            'method': 'turn/started',
            'params': {'threadId': 'thread', 'turnId': 'implemented'},
          });
        }
        d.setPlan(false);
        if (steer) {
          expect(d.shouldQueueComposer, isTrue);
          expect(
            await d.submitComposerDraft(
              DesktopComposerDraft(text: 'Continue normally'),
            ),
            isTrue,
          );
          expect(d.queuedDrafts, hasLength(1));
          expect(
            await d.steerQueuedDraft(d.queuedDrafts.single.id),
            isTrue,
            reason: d.error,
          );
        } else {
          t.events.add({
            'method': 'turn/completed',
            'params': {
              'threadId': 'thread',
              'turn': {'id': 'implemented', 'status': 'completed', 'items': []},
            },
          });
          expect(d.turnId, isNull);
          expect(await d.send('Continue normally'), isTrue, reason: d.error);
        }
        final action = t.calls.lastWhere(
          (c) => c['method'] == (steer ? 'turn/steer' : 'turn/start'),
        );
        expect((action['params'] as Map)['collaborationMode'], {
          'mode': 'default',
          'settings': {
            'model': 'provider-model',
            'reasoning_effort': 'high',
            'developer_instructions': null,
          },
        });
      },
    );
  }

  test(
    'an unknown session preserves the existing no-mode normal payload',
    () async {
      final t = PlanActionTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      d.models = [
        {'id': 'qa', 'model': 'provider-model'},
      ];
      d.model = 'qa';
      expect(await d.send('Normal request'), isTrue, reason: d.error);
      final action = t.calls.lastWhere((c) => c['method'] == 'turn/start');
      expect(
        (action['params'] as Map).containsKey('collaborationMode'),
        isFalse,
      );
    },
  );

  for (final native in [false, true]) {
    test(
      '${native ? 'native' : 'requested'} plan knowledge survives controller restart',
      () async {
        final store = ActivityCacheStore();
        final t = PlanActionTransport();
        final rows = [
          {
            'id': 'assistant',
            'type': 'agentMessage',
            'turnId': 'ended',
            'text': '<proposed_plan>Saved proposal</proposed_plan>',
          },
        ];
        t.history = historyPage(rows);
        final d = await reasoningDesktop(t, store: store);
        if (native) {
          t.events.add({
            'id': 17,
            'method': 'item/tool/requestUserInput',
            'params': {
              'threadId': 'thread',
              'questions': [
                {
                  'id': 'q',
                  'header': 'Scope',
                  'question': 'Choose scope',
                  'options': [
                    {'label': 'Continue', 'description': ''},
                  ],
                },
              ],
            },
          });
          t.events.add({
            'method': 'serverRequest/resolved',
            'params': {'requestId': 17},
          });
        } else {
          d.models = [
            {'id': 'qa', 'model': 'provider-model'},
          ];
          d.model = 'qa';
          d.setPlan(true);
          expect(await d.send('Plan first'), isTrue, reason: d.error);
        }
        expect(
          d.responsePlanProposal(
            d.timeline.firstWhere((r) => r['id'] == 'assistant'),
          ),
          isNull,
        );
        await d.threadList.saveNow();
        d.dispose();
        final reopened = PlanActionTransport()..history = historyPage(rows);
        final restored = await reasoningDesktop(reopened, store: store);
        addTearDown(restored.dispose);
        expect(
          restored.responsePlanProposal(
            restored.timeline.firstWhere((r) => r['id'] == 'assistant'),
          ),
          isNull,
        );
      },
    );
  }
}
