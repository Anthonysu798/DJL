import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/desktop_local_store.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/reasoning/domain/desktop_reasoning.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'guardian_review_test.dart' show GuardianTransport;
import 'desktop_activity_test.dart' show ActivityCacheStore;

const reasoningPair = Pairing({
  'macDeviceId': 'mac-a',
  'sessionId': 'secure-a',
  'macIdentityPublicKey': 'trusted-pin',
});

class ReasoningPairings extends PairingRepository {
  ReasoningPairings() : super(TestCredentials());
  Pairing pair = reasoningPair;
  @override
  Future<List<Pairing>> trusted() async => [pair];
  @override
  Future<Pairing> resolveTrusted(Pairing value) async => pair;
}

class ReasoningTransport extends GuardianTransport {
  ReasoningTransport() : super(ReasoningPairings()) {
    online = false;
  }
  Completer<RemoteJson>? readGate, resumeGate, forkGate;
  Completer<void>? connectGate;
  void Function()? early;
  @override
  Future<void> connect(Pairing pair, {required bool bootstrap}) async {
    mac = pair.macDeviceId;
    session = pair.sessionId;
    online = true;
    early?.call();
    await connectGate?.future;
  }

  @override
  Future<void> disconnect() async {
    online = false;
  }

  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': params});
    if (method == 'thread/fork') {
      return forkGate == null
          ? {
              'thread': {'id': 'forked'},
            }
          : forkGate!.future;
    }
    if (method == 'thread/resume' && resumeGate != null) {
      return resumeGate!.future;
    }
    if (method == 'thread/read' && readGate != null) return readGate!.future;
    if (method == 'thread/read' || method == 'thread/resume') {
      return {
        'thread': history ?? {'id': params['threadId'], 'turns': []},
      };
    }
    return {'data': [], 'items': []};
  }
}

void reasoningEvent(
  ReasoningTransport t,
  String method, {
  String thread = 'thread',
  String turn = 'turn',
  String item = 'item',
  String? delta,
  int? index,
  RemoteJson? snapshot,
  RemoteJson extra = const {},
}) => t.events.add({
  'method': method,
  'params': {
    'threadId': thread,
    'turnId': turn,
    'itemId': item,
    'delta': ?delta,
    'summaryIndex': ?index,
    if (snapshot != null)
      'item': {'id': item, 'type': 'reasoning', ...snapshot},
    ...extra,
  },
});
Future<DesktopController> reasoningDesktop(
  ReasoningTransport t, {
  DesktopLocalStore? store,
}) async {
  final d = DesktopController(
    t.pairings,
    connection: t,
    localStore: store ?? ActivityCacheStore(),
  );
  await d.connect((t.pairings as ReasoningPairings).pair);
  expect(d.error, isNull);
  await d.openThread({'id': 'thread'}, readOnlyNavigation: true);
  return d;
}

String rowText(DesktopController d) => d.timeline.single['text'] as String;
void start(
  ReasoningTransport t, {
  String thread = 'thread',
  String turn = 'turn',
}) => reasoningEvent(t, 'turn/started', thread: thread, turn: turn);
void delta(
  ReasoningTransport t,
  String text, {
  String thread = 'thread',
  String turn = 'turn',
  String item = 'item',
}) => reasoningEvent(
  t,
  'item/reasoning/summaryTextDelta',
  delta: text,
  thread: thread,
  turn: turn,
  item: item,
);
void main() {
  test(
    'a later canonical gateway summary hydrates an already completed cached turn across reconnect',
    () async {
      final t = ReasoningTransport();
      final answer = <String, dynamic>{
        'id': 'answer',
        'type': 'agentMessage',
        'content': [
          {'type': 'outputText', 'text': 'Public answer'},
        ],
        'createdAt': '2026-11-18T00:34:57.797Z',
      };
      final summary = <String, dynamic>{
        'id': 'provider-reasoning-public-id',
        'type': 'reasoning',
        'summary': ['**Computing the modular solution**'],
        'content': <String>[],
        'createdAt': '2026-11-18T00:34:57.791Z',
      };
      RemoteJson history(List<RemoteJson> items) => {
        'id': 'thread',
        'modelProvider': 'codex',
        'model': 'gpt-6.1-terra',
        'turns': [
          {'id': 'actual-turn', 'status': 'completed', 'items': items},
        ],
      };
      t.history = history([answer]);
      final d = await reasoningDesktop(t);
      try {
        expect(
          d.timeline.where((r) => r.containsKey(reasoningMetadataKey)),
          isEmpty,
        );
        t.history = history([summary, answer]);
        await d.openThread(
          {'id': 'thread'},
          userSelection: false,
          readOnlyNavigation: true,
        );
        final rows = d.timeline.where(
          (r) => r.containsKey(reasoningMetadataKey),
        );
        expect(rows, hasLength(1));
        expect(
          DesktopReasoning.fromRow(rows.single)!.text,
          '**Computing the modular solution**',
        );
        (t.pairings as ReasoningPairings).pair = Pairing({
          ...reasoningPair.data,
          'sessionId': 'rotated',
        });
        await d.reconnect();
        expect(
          d.timeline.where((r) => r.containsKey(reasoningMetadataKey)),
          hasLength(1),
        );
      } finally {
        d.dispose();
      }
    },
  );

  for (final completed in [false, true]) {
    for (final background in [false, true]) {
      test(
        'pending fork preserves pre-response ${completed ? 'completion' : 'delta'} with background=$background after empty hydration',
        () async {
          final t = ReasoningTransport();
          final d = await reasoningDesktop(t);
          t.forkGate = Completer();
          final pending = d.forkThread();
          await Future<void>.delayed(Duration.zero);
          if (background) {
            await d.openThread({'id': 'other'}, readOnlyNavigation: true);
          }
          start(t, thread: 'forked');
          delta(t, 'Live full', thread: 'forked');
          if (completed) {
            reasoningEvent(
              t,
              'item/completed',
              thread: 'forked',
              snapshot: {'summary': 'Live final'},
            );
          }
          t.history = {'id': 'forked', 'turns': []};
          t.forkGate!.complete({
            'thread': {
              'id': 'forked',
              'turns': [
                {
                  'id': 'turn',
                  'status': 'running',
                  'items': [
                    {'id': 'item', 'type': 'reasoning', 'summary': 'Seed'},
                  ],
                },
              ],
            },
          });
          expect(await pending, isTrue, reason: d.error);
          final rows = background
              ? d.threadList.data.timelines['forked']!
              : d.timeline;
          expect(rows.single['text'], completed ? 'Live final' : 'Live full');
          expect(d.thread?['id'], background ? 'other' : 'forked');
          if (completed) {
            expect(DesktopReasoning.fromRow(rows.single)!.terminal, isTrue);
          }
          d.dispose();
        },
      );
    }
  }
  for (final canonical in [false, true]) {
    test(
      'newer terminal history with canonical=$canonical protects text from older running response',
      () async {
        final t = ReasoningTransport();
        final d = await reasoningDesktop(t);
        start(t);
        delta(t, 'Full text');
        final oldGate = t.readGate = Completer();
        final oldRead = d.openThread({
          'id': 'thread',
        }, readOnlyNavigation: true);
        await Future<void>.delayed(Duration.zero);
        final newGate = t.readGate = Completer();
        final newRead = d.openThread({
          'id': 'thread',
        }, readOnlyNavigation: true);
        newGate.complete({
          'thread': {
            'id': 'thread',
            'turns': [
              {
                'id': 'turn',
                'status': 'completed',
                'items': [
                  if (canonical)
                    {
                      'id': 'item',
                      'type': 'reasoning',
                      'summary': 'Canonical final',
                    },
                ],
              },
            ],
          },
        });
        await newRead;
        expect(rowText(d), canonical ? 'Canonical final' : 'Full text');
        oldGate.complete({
          'thread': {
            'id': 'thread',
            'turns': [
              {
                'id': 'turn',
                'status': 'running',
                'items': [
                  {'id': 'item', 'type': 'reasoning', 'summary': 'Full'},
                ],
              },
            ],
          },
        });
        await oldRead;
        expect(rowText(d), canonical ? 'Canonical final' : 'Full text');
        expect(DesktopReasoning.fromRow(d.timeline.single)!.terminal, isTrue);
        d.dispose();
      },
    );
  }
  test(
    'fresh child reasoning then answer retain canonical order through encrypted cold reopen',
    () async {
      final root = await Directory.systemTemp.createTemp('reasoning-order-');
      final t = ReasoningTransport();
      final store = DesktopLocalStore(t.pairings.credentials, root: root);
      final d = await reasoningDesktop(t, store: store);
      DesktopController? cold;
      try {
        t.readGate = Completer();
        t.events.add({
          'method': 'item/completed',
          'params': {
            'threadId': 'thread',
            'turnId': 'parent-turn',
            'item': {
              'id': 'spawn',
              'type': 'collabAgentToolCall',
              'tool': 'spawnAgent',
              'status': 'completed',
              'receiverAgents': [
                {'threadId': 'child'},
              ],
            },
          },
        });
        await Future<void>.delayed(Duration.zero);
        t.readGate!.complete({
          'thread': {
            'id': 'child',
            'turns': [
              {
                'id': 'turn',
                'status': 'completed',
                'items': [
                  {
                    'id': 'item',
                    'type': 'reasoning',
                    'summary': 'Reasoning first',
                  },
                  {
                    'id': 'answer',
                    'type': 'agentMessage',
                    'text': 'Answer second',
                  },
                ],
              },
            ],
          },
        });
        await d.hydrateSubagents(d.subagents.items.values.single);
        expect(
          d.threadList.data.timelines['child']!.map((row) => row['text']),
          ['Reasoning first', 'Answer second'],
        );
        await d.threadList.saveNow();
        await store.flush();
        cold =
            DesktopController(
                t.pairings,
                connection: ReasoningTransport(),
                localStore: store,
              )
              ..active = reasoningPair
              ..trusted = [reasoningPair];
        await cold.threadList.attach('mac-a');
        await cold.openThread({'id': 'child'});
        expect(cold.timeline.map((row) => row['text']), [
          'Reasoning first',
          'Answer second',
        ]);
      } finally {
        cold?.dispose();
        d.dispose();
        await store.flush();
        await root.delete(recursive: true);
      }
    },
  );

  test(
    'trusted empty running history supplies authority and terminal empty history removes it',
    () async {
      final t = ReasoningTransport();
      final d = await reasoningDesktop(t);
      t.history = {
        'id': 'thread',
        'turns': [
          {'id': 'turn', 'status': 'running', 'items': []},
        ],
      };
      await d.openThread({'id': 'thread'}, readOnlyNavigation: true);
      delta(t, 'History running');
      expect(rowText(d), 'History running');
      (t.history!['turns'] as List).first['status'] = 'completed';
      await d.openThread({'id': 'thread'}, readOnlyNavigation: true);
      start(t);
      delta(t, 'unknown', item: 'unknown');
      expect(d.timeline, hasLength(1));
      expect(DesktopReasoning.fromRow(d.timeline.single)!.terminal, isTrue);
      d.dispose();
    },
  );
  test(
    'retained fork seed keeps request watermark when hydration omits turns',
    () async {
      final t = ReasoningTransport();
      final d = await reasoningDesktop(t);
      t.forkGate = Completer()
        ..complete({
          'thread': {
            'id': 'forked',
            'turns': [
              {
                'id': 'turn',
                'status': 'running',
                'items': [
                  {'id': 'item', 'type': 'reasoning', 'summary': 'Seed'},
                ],
              },
            ],
          },
        });
      t.readGate = Completer();
      final fork = d.forkThread();
      while (!t.calls.any(
        (call) =>
            call['method'] == 'thread/read' &&
            (call['params'] as Map)['threadId'] == 'forked',
      )) {
        await Future<void>.delayed(Duration.zero);
      }
      delta(t, ' newer', thread: 'forked');
      t.readGate!.complete({
        'thread': {'id': 'forked', 'turns': []},
      });
      expect(await fork, isTrue, reason: d.error);
      expect(rowText(d), 'Seed newer');
      d.dispose();
    },
  );
  test(
    'same Mac rekey does not adopt previous pin rows and new identity is distinct',
    () async {
      final t = ReasoningTransport();
      final d = await reasoningDesktop(t);
      start(t);
      delta(t, 'Old pin');
      final oldId = d.timeline.single['id'];
      await d.disconnect();
      final pair = const Pairing({
        'macDeviceId': 'mac-a',
        'sessionId': 'secure-new',
        'macIdentityPublicKey': 'new-pin',
      });
      (t.pairings as ReasoningPairings).pair = pair;
      await d.connect(pair);
      expect(d.timeline, isEmpty);
      start(t);
      delta(t, 'New pin');
      expect(rowText(d), 'New pin');
      expect(d.timeline.single['id'], isNot(oldId));
      d.dispose();
    },
  );
  test(
    'snake identities inside event envelope reach live row with exact delta precedence',
    () async {
      final t = ReasoningTransport();
      final d = await reasoningDesktop(t);
      t.events.add({
        'method': 'turn/started',
        'params': {
          'event': {'thread_id': 'thread', 'turn_id': 'turn'},
        },
      });
      t.events.add({
        'method': 'item/reasoning/summaryTextDelta',
        'params': {
          'textDelta': ' first',
          'event': {
            'thread_id': 'thread',
            'turn_id': 'turn',
            'item_id': 'item',
            'delta': 'wrong',
          },
        },
      });
      t.events.add({
        'method': 'item/reasoning/summaryPartAdded',
        'params': {
          'msg': {
            'thread_id': 'thread',
            'turn_id': 'turn',
            'item_id': 'item',
            'summary_index': 1,
            'text': 'second',
          },
        },
      });
      expect(rowText(d), ' first\nsecond');
      d.dispose();
    },
  );
  test(
    'background fork history racing a delta preserves it without selecting the fork',
    () async {
      final t = ReasoningTransport();
      final d = await reasoningDesktop(t);
      t.forkGate = Completer();
      final fork = d.forkThread();
      await Future<void>.delayed(Duration.zero);
      await d.openThread({'id': 'other'}, readOnlyNavigation: true);
      t.readGate = Completer();
      t.forkGate!.complete({
        'thread': {'id': 'forked'},
      });
      await Future<void>.delayed(Duration.zero);
      start(t, thread: 'forked');
      delta(t, 'Newer fork', thread: 'forked');
      t.readGate!.complete({
        'thread': {
          'id': 'forked',
          'turns': [
            {
              'id': 'turn',
              'status': 'running',
              'items': [
                {'id': 'item', 'type': 'reasoning', 'summary': 'old fork'},
              ],
            },
          ],
        },
      });
      expect(await fork, isTrue, reason: d.error);
      expect(d.thread?['id'], 'other');
      expect(d.timeline, isEmpty);
      expect(
        d.threadList.data.timelines['forked']!.single['text'],
        'Newer fork',
      );
      d.dispose();
    },
  );
  test(
    'metadata child history validates legacy row once while preserving newer delta',
    () async {
      final t = ReasoningTransport();
      final d = await reasoningDesktop(t);
      d.threadList.data.timelines['child'] = [
        {
          'id': 'item',
          'type': 'reasoning',
          'turnId': 'turn',
          'summary': 'legacy',
        },
      ];
      t.readGate = Completer();
      t.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread',
          'turnId': 'parent-turn',
          'item': {
            'id': 'spawn',
            'type': 'collabAgentToolCall',
            'tool': 'spawnAgent',
            'status': 'completed',
            'receiverAgents': [
              {'threadId': 'child'},
            ],
          },
        },
      });
      await Future<void>.delayed(Duration.zero);
      start(t, thread: 'child');
      delta(t, 'Newer child', thread: 'child');
      t.readGate!.complete({
        'thread': {
          'id': 'child',
          'turns': [
            {
              'id': 'turn',
              'status': 'running',
              'items': [
                {'id': 'item', 'type': 'reasoning', 'summary': 'old child'},
              ],
            },
          ],
        },
      });
      await d.hydrateSubagents(d.subagents.items.values.single);
      expect(d.thread?['id'], 'thread');
      expect(d.threadList.data.timelines['child'], hasLength(1));
      expect(
        d.threadList.data.timelines['child']!.single['text'],
        'Newer child',
      );
      d.dispose();
    },
  );
  test(
    'cancelled connection generation cannot regain reasoning authority',
    () async {
      final t = ReasoningTransport()..connectGate = Completer();
      final d = DesktopController(
        t.pairings,
        connection: t,
        localStore: ActivityCacheStore(),
      );
      final connecting = d.connect(reasoningPair);
      while (!t.online) {
        await Future<void>.delayed(Duration.zero);
      }
      await d.disconnect();
      t.connectGate!.complete();
      await connecting;
      t.online = true;
      start(t);
      delta(t, 'Rejected old generation');
      expect(d.threadList.data.timelines['thread'], isNull);
      d.dispose();
    },
  );
  test(
    'cold unfinished legacy cache alone grants no authority under reconnect',
    () async {
      final t = ReasoningTransport();
      final d = await reasoningDesktop(t);
      d.threadList.data.timelines['background'] = [
        {
          'id': 'legacy',
          'type': 'reasoning',
          'turnId': 'turn',
          'summary': 'Old raw',
        },
      ];
      await d.disconnect();
      await d.connect(reasoningPair);
      delta(t, 'Ignored', thread: 'background', item: 'legacy');
      expect(
        d.threadList.data.timelines['background']!.single.containsKey(
          reasoningMetadataKey,
        ),
        isFalse,
      );
      d.dispose();
    },
  );
  for (final fence in [
    'pin',
    'mac',
    'session',
    'disconnect',
    'cache',
    'trust',
    'deleted',
  ]) {
    test(
      '$fence change rejects ingress and does not leak current reasoning',
      () async {
        final t = ReasoningTransport();
        final d = await reasoningDesktop(t);
        start(t);
        delta(t, 'Before');
        switch (fence) {
          case 'pin':
            d.active = const Pairing({
              'macDeviceId': 'mac-a',
              'sessionId': 'secure-a',
              'macIdentityPublicKey': 'another-pin',
            });
          case 'mac':
            t.mac = 'another-mac';
          case 'session':
            t.session = 'another-session';
          case 'disconnect':
            await d.disconnect();
          case 'cache':
            d.threadList.data = ThreadLocalState();
          case 'trust':
            d.trusted = [];
          case 'deleted':
            d.threadList.data.deleted.add('thread');
        }
        delta(t, ' forbidden');
        expect(rowText(d), 'Before');
        if (fence == 'pin' || fence == 'deleted') {
          expect(d.reasoningRowMatchesHost(d.timeline.single), isFalse);
        }
        d.dispose();
      },
    );
  }
  test(
    'background thread updates cache without changing selection composer or runtime',
    () async {
      final t = ReasoningTransport();
      final d = await reasoningDesktop(t);
      d.model = 'unchanged';
      d.effort = 'high';
      final runtimes = Map.of(d.threadList.data.runtimes);
      final calls = t.calls.length;
      start(t, thread: 'background');
      delta(t, 'Background', thread: 'background');
      expect(d.timeline, isEmpty);
      expect(d.thread?['id'], 'thread');
      expect(d.model, 'unchanged');
      expect(d.effort, 'high');
      expect(d.threadList.data.runtimes, runtimes);
      expect(t.calls.length, calls);
      expect(
        d.threadList.data.timelines['background']!.single['text'],
        'Background',
      );
      d.dispose();
    },
  );
  test('watermark precedes resume as well as the subsequent read', () async {
    final t = ReasoningTransport();
    final d = await reasoningDesktop(t);
    start(t);
    delta(t, 'First');
    t.resumeGate = Completer();
    final reading = d.openThread({'id': 'thread'});
    await Future<void>.delayed(Duration.zero);
    delta(t, ' later');
    t.history = {
      'id': 'thread',
      'turns': [
        {
          'id': 'turn',
          'status': 'running',
          'items': [
            {
              'id': 'item',
              'type': 'reasoning',
              'summary': ['First'],
            },
          ],
        },
      ],
    };
    t.resumeGate!.complete({
      'thread': {'id': 'thread'},
    });
    await reading;
    expect(rowText(d), 'First later');
    d.dispose();
  });
  test('history arriving after active pin change is rejected', () async {
    final t = ReasoningTransport();
    final d = await reasoningDesktop(t);
    start(t);
    delta(t, 'Before');
    t.readGate = Completer();
    final reading = d.openThread({'id': 'thread'}, readOnlyNavigation: true);
    await Future<void>.delayed(Duration.zero);
    d.active = const Pairing({
      'macDeviceId': 'mac-a',
      'sessionId': 'secure-a',
      'macIdentityPublicKey': 'new-pin',
    });
    t.readGate!.complete({
      'thread': {
        'id': 'thread',
        'turns': [
          {
            'id': 'turn',
            'status': 'running',
            'items': [
              {'id': 'item', 'type': 'reasoning', 'summary': 'stale'},
            ],
          },
        ],
      },
    });
    await reading;
    expect(rowText(d), 'Before');
    expect(d.reasoningRowMatchesHost(d.timeline.single), isFalse);
    d.dispose();
  });
  test(
    'terminal turn, late known item and replay remain one terminal row',
    () async {
      final t = ReasoningTransport();
      final d = await reasoningDesktop(t);
      start(t);
      delta(t, 'Done');
      reasoningEvent(t, 'turn/completed');
      delta(t, ' late');
      delta(t, 'unknown', item: 'unknown');
      start(t);
      reasoningEvent(
        t,
        'item/started',
        snapshot: {
          'summary': ['bad'],
        },
      );
      await Future<void>.delayed(Duration.zero);
      expect(rowText(d), 'Done late');
      expect(DesktopReasoning.fromRow(d.timeline.single)!.terminal, isTrue);
      await d.disconnect();
      await d.connect(reasoningPair);
      start(t);
      delta(t, 'unknown', item: 'other');
      expect(d.timeline, hasLength(1));
      expect(DesktopReasoning.fromRow(d.timeline.single)!.terminal, isTrue);
      d.dispose();
    },
  );
  test(
    'history omission retains prior anchor then canonical item does not duplicate',
    () async {
      final t = ReasoningTransport();
      final d = await reasoningDesktop(t);
      start(t);
      delta(t, 'live');
      d.timeline.add({
        'id': 'answer',
        'type': 'agentMessage',
        'text': 'Answer',
      });
      t.history = {
        'id': 'thread',
        'turns': [
          {
            'id': 'turn',
            'status': 'running',
            'items': [
              {'id': 'answer', 'type': 'agentMessage', 'text': 'Answer'},
            ],
          },
        ],
      };
      await d.openThread({'id': 'thread'}, readOnlyNavigation: true);
      expect(d.timeline.map((row) => row['text']), ['live', 'Answer']);
      (t.history!['turns'] as List).first['items'].insert(0, {
        'id': 'item',
        'type': 'reasoning',
        'summary': 'canonical',
      });
      await d.openThread({'id': 'thread'}, readOnlyNavigation: true);
      expect(d.timeline.map((row) => row['text']), ['canonical', 'Answer']);
      d.dispose();
    },
  );
  test('history conflicting item turn identity is rejected', () async {
    final t = ReasoningTransport();
    final d = await reasoningDesktop(t);
    t.history = {
      'id': 'thread',
      'turns': [
        {
          'id': 'turn',
          'status': 'running',
          'items': [
            {
              'id': 'item',
              'type': 'reasoning',
              'turnId': 'other-turn',
              'summary': 'bad',
            },
          ],
        },
      ],
    };
    await d.openThread({'id': 'thread'}, readOnlyNavigation: true);
    expect(d.timeline, isEmpty);
    d.dispose();
  });
  test(
    'stale session envelope and missing or conflicting identities create nothing',
    () async {
      final t = ReasoningTransport();
      final d = await reasoningDesktop(t);
      start(t);
      for (final rpc in [
        {
          '_sessionId': 'stale',
          'params': {
            'threadId': 'thread',
            'turnId': 'turn',
            'itemId': 'item',
            'delta': 'bad',
          },
        },
        {
          'params': {'turnId': 'turn', 'itemId': 'item', 'delta': 'bad'},
        },
        {
          'params': {
            'threadId': 'thread',
            'turnId': 'turn',
            'itemId': 'item',
            'msg': {'item_id': 'other'},
            'delta': 'bad',
          },
        },
      ]) {
        t.events.add({'method': 'item/reasoning/summaryTextDelta', ...rpc});
      }
      expect(d.timeline, isEmpty);
      d.dispose();
    },
  );

  test('actual reasoning deltas update one row before completion', () async {
    final t = ReasoningTransport();
    final d = await reasoningDesktop(t);
    start(t);
    delta(t, '**Read');
    delta(t, 'ing**');
    reasoningEvent(t, 'item/reasoning/summaryPartAdded', index: 1);
    reasoningEvent(t, 'item/reasoning/summaryPartAdded', index: 1);
    reasoningEvent(
      t,
      'item/reasoning/summaryTextDelta',
      index: 1,
      delta: ' next',
    );
    reasoningEvent(t, 'item/reasoning/textDelta', delta: ' detail');
    expect(d.timeline, hasLength(1));
    expect(rowText(d), '**Reading**\n next\n\n detail');
    reasoningEvent(t, 'item/completed', snapshot: {'summary': []});
    expect(rowText(d), '**Reading**\n next\n\n detail');
    reasoningEvent(
      t,
      'item/completed',
      snapshot: {
        'summary': ['Canonical'],
      },
    );
    expect(rowText(d), 'Canonical');
    expect(d.timeline, hasLength(1));
    d.dispose();
  });
  for (final complete in [false, true]) {
    test(
      'history started before newer ${complete ? 'completion' : 'delta'} cannot truncate it',
      () async {
        final t = ReasoningTransport();
        final d = await reasoningDesktop(t);
        start(t);
        delta(t, 'First');
        t.readGate = Completer();
        final read = d.openThread({'id': 'thread'}, readOnlyNavigation: true);
        await Future<void>.delayed(Duration.zero);
        if (complete) {
          reasoningEvent(
            t,
            'item/completed',
            snapshot: {
              'summary': ['Final'],
            },
          );
        } else {
          delta(t, ' newer');
        }
        t.readGate!.complete({
          'thread': {
            'id': 'thread',
            'turns': [
              {
                'id': 'turn',
                'status': 'running',
                'items': [
                  {
                    'id': 'item',
                    'type': 'reasoning',
                    'summary': ['First'],
                  },
                ],
              },
            ],
          },
        });
        await read;
        expect(d.timeline, hasLength(1));
        expect(rowText(d), complete ? 'Final' : 'First newer');
        d.dispose();
      },
    );
  }
  test(
    'authenticated early replay is retained during actual connect',
    () async {
      final t = ReasoningTransport();
      t.early = () {
        start(t);
        delta(t, 'Early');
      };
      final d = DesktopController(
        t.pairings,
        connection: t,
        localStore: ActivityCacheStore(),
      );
      await d.connect(reasoningPair);
      expect(d.threadList.data.timelines['thread']?.single['text'], 'Early');
      d.dispose();
    },
  );
  test(
    'encrypted cold roundtrip retains raw snapshots and terminal row',
    () async {
      final root = await Directory.systemTemp.createTemp('reasoning-cache-');
      final t = ReasoningTransport();
      final store = DesktopLocalStore(t.pairings.credentials, root: root);
      final d = await reasoningDesktop(t, store: store);
      start(t);
      delta(t, 'stream');
      reasoningEvent(
        t,
        'item/completed',
        snapshot: {
          'summary': [
            {'text': '**Saved**'},
          ],
          'content': ['body'],
        },
      );
      final saved = Map<String, dynamic>.from(d.timeline.single);
      await d.threadList.saveNow();
      d.dispose();
      await store.flush();
      final cold =
          DesktopController(
              t.pairings,
              connection: ReasoningTransport(),
              localStore: store,
            )
            ..active = reasoningPair
            ..trusted = [reasoningPair];
      await cold.threadList.attach('mac-a');
      await cold.openThread({'id': 'thread'});
      expect(cold.timeline.single, saved);
      expect(cold.timeline.single['summary'], [
        {'text': '**Saved**'},
      ]);
      expect(cold.timeline.single['content'], ['body']);
      cold.dispose();
      await store.flush();
      await root.delete(recursive: true);
    },
  );
}
