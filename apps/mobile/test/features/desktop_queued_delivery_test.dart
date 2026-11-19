import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_composer_send_test.dart' show mixed;
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop, reasoningEvent;

class QueueDeliveryTransport extends ReasoningTransport {
  final replies = <Object>[];
  Completer<void>? observeRead;
  int nextTurn = 0;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'thread/read' && observeRead?.isCompleted == false) {
      observeRead!.complete();
    }
    if (!{'turn/start', 'turn/steer'}.contains(method)) {
      return super.request(method, params, timeout: timeout);
    }
    calls.add({'method': method, 'params': params});
    if (replies.isNotEmpty) {
      final result = replies.removeAt(0);
      if (result is Completer<RemoteJson>) return result.future;
      if (result is RemoteJson) return result;
      throw result;
    }
    return {
      'turn': {'id': 'queued-run-${++nextTurn}'},
    };
  }
}

Future<DesktopController> deliveryDesktop(
  QueueDeliveryTransport transport,
) async {
  transport.history = {
    'id': 'thread',
    'turns': [
      {'id': 'running', 'status': 'inProgress', 'items': []},
    ],
  };
  final desktop = await reasoningDesktop(transport);
  desktop.models = [
    {'id': 'qa', 'model': 'qa-wire', 'djlProvider': 'codex'},
    {'id': 'next', 'model': 'next-wire', 'djlProvider': 'codex'},
  ];
  desktop.model = 'qa';
  transport.calls.clear();
  return desktop;
}

Future<void> finishQueueRun(
  QueueDeliveryTransport transport,
  DesktopController desktop, {
  String turn = 'running',
}) async {
  transport.history = {
    'id': 'thread',
    'turns': [
      {'id': turn, 'status': 'completed', 'items': []},
    ],
  };
  reasoningEvent(
    transport,
    'turn/completed',
    turn: turn,
    extra: {
      'turn': {'id': turn, 'status': 'completed'},
    },
  );
  for (var i = 0; i < 12; i++) {
    await Future<void>.delayed(Duration.zero);
  }
  expect(desktop.turnId, isNull);
  expect(desktop.busy, isFalse);
}

List<RemoteJson> queueMutations(QueueDeliveryTransport transport) => transport
    .calls
    .where((call) => {'turn/start', 'turn/steer'}.contains(call['method']))
    .toList();

Future<void> settleQueuedDelivery() async {
  for (var i = 0; i < 12; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  for (final invalid in [
    'missing item ID',
    'missing turn ID',
    'foreign connection',
  ]) {
    test('$invalid cannot consume a queue row after a lost reply', () async {
      final reply = Completer<RemoteJson>();
      final transport = QueueDeliveryTransport()..replies.add(reply);
      final desktop = await deliveryDesktop(transport);
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'chosen'));
      final id = desktop.queuedDrafts.single.id;
      final steering = desktop.steerQueuedDraft(id);
      await Future<void>.delayed(Duration.zero);
      transport.events.add({
        'method': 'item/started',
        if (invalid == 'foreign connection') '_macDeviceId': 'foreign',
        'params': {
          'threadId': 'thread',
          if (invalid != 'missing turn ID') 'turnId': 'running',
          'item': {
            if (invalid != 'missing item ID') 'id': 'canonical-chosen',
            'type': 'userMessage',
            'content': [
              {'type': 'text', 'text': 'chosen'},
            ],
          },
        },
      });
      reply.completeError(TimeoutException('lost reply'));
      expect(await steering, isFalse);
      expect(desktop.queuedDrafts.single.id, id);
      expect(desktop.queuePauseMessage, isNotNull);
      expect(queueMutations(transport), hasLength(1));
      desktop.dispose();
    });
  }
  for (final replay in [false, true]) {
    test(
      '${replay ? 'replayed' : 'live'} canonical receipt before a lost reply cannot cause queued replay',
      () async {
        final reply = Completer<RemoteJson>();
        final transport = QueueDeliveryTransport()..replies.add(reply);
        final desktop = await deliveryDesktop(transport);
        await desktop.submitComposerDraft(DesktopComposerDraft(text: 'chosen'));
        await desktop.submitComposerDraft(DesktopComposerDraft(text: 'next'));
        final id = desktop.queuedDrafts.first.id;
        final steering = desktop.steerQueuedDraft(id);
        await Future<void>.delayed(Duration.zero);
        transport.events.add({
          'method': 'item/started',
          'params': {
            'threadId': 'thread',
            'turnId': 'running',
            if (replay) 'djlReplayedEvent': true,
            'item': {
              'id': 'canonical-chosen',
              'type': 'userMessage',
              'content': [
                {'type': 'text', 'text': 'chosen'},
              ],
            },
          },
        });
        reply.completeError(TimeoutException('reply lost after user echo'));
        expect(await steering, !replay);
        expect(
          desktop.queuedDrafts.map((row) => row.draft.text),
          replay ? ['chosen', 'next'] : ['next'],
        );
        expect(desktop.queuePauseMessage, isNotNull);
        await finishQueueRun(transport, desktop);
        await desktop.flushQueuedDrafts();
        expect(queueMutations(transport), hasLength(1));
        desktop.dispose();
      },
    );
  }
  test(
    'a queued plan remains explicit when Steer uses a different current composer mode',
    () async {
      final transport = QueueDeliveryTransport()
        ..replies.add({'turnId': 'running'});
      final desktop = await deliveryDesktop(transport);
      desktop.plan = true;
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'planned follow-up'),
      );
      desktop.plan = false;
      desktop.effort = 'high';
      expect(
        await desktop.steerQueuedDraft(desktop.queuedDrafts.single.id),
        isTrue,
      );
      expect(
        (queueMutations(transport).single['params']
            as Map)['collaborationMode'],
        {
          'mode': 'plan',
          'settings': {
            'model': 'qa-wire',
            'reasoning_effort': 'high',
            'developer_instructions': null,
          },
        },
      );
      expect(desktop.plan, isFalse);
      desktop.dispose();
    },
  );

  test(
    'an unavailable queued plan pauses intact without sending a downgraded turn',
    () async {
      final transport = QueueDeliveryTransport();
      final desktop = await deliveryDesktop(transport);
      desktop.plan = true;
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'must stay planned'),
      );
      desktop.plan = false;
      desktop.supportsPlan = false;
      await finishQueueRun(transport, desktop);
      await desktop.flushQueuedDrafts();
      expect(queueMutations(transport), isEmpty);
      expect(desktop.queuedDrafts.single.plan, isTrue);
      expect(desktop.queuedDrafts.single.draft.text, 'must stay planned');
      expect(desktop.queuePauseMessage, isNotNull);
      desktop.dispose();
    },
  );
  test(
    'normal Send while provisionally paused appends then resumes the older head after an idle refresh',
    () async {
      final transport = QueueDeliveryTransport()
        ..replies.add(TimeoutException('lost reply'));
      final desktop = await deliveryDesktop(transport);
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'older'));
      await finishQueueRun(transport, desktop);
      await desktop.flushQueuedDrafts();
      expect(
        await desktop.submitComposerDraft(DesktopComposerDraft(text: 'newer')),
        isTrue,
      );
      await settleQueuedDelivery();
      expect(queueMutations(transport), hasLength(2));
      expect((queueMutations(transport).last['params'] as Map)['input'], [
        {'type': 'text', 'text': 'older'},
      ]);
      expect(desktop.queuedDrafts.single.draft.text, 'newer');
      desktop.dispose();
    },
  );

  test(
    'normal Send while paused and newly observed busy retains the pause and both rows',
    () async {
      final transport = QueueDeliveryTransport()
        ..replies.add(TimeoutException('lost reply'));
      final desktop = await deliveryDesktop(transport);
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'older'));
      await finishQueueRun(transport, desktop);
      await desktop.flushQueuedDrafts();
      transport.history = {
        'id': 'thread',
        'turns': [
          {'id': 'another-run', 'status': 'inProgress', 'items': []},
        ],
      };
      expect(
        await desktop.submitComposerDraft(DesktopComposerDraft(text: 'newer')),
        isTrue,
      );
      await settleQueuedDelivery();
      expect(queueMutations(transport), hasLength(1));
      expect(desktop.turnId, 'another-run');
      expect(desktop.queuePauseMessage, isNotNull);
      expect(desktop.queuedDrafts.map((row) => row.draft.text), [
        'older',
        'newer',
      ]);
      desktop.dispose();
    },
  );

  test(
    'deleting the last paused row does not bypass paused-send recovery for the next draft',
    () async {
      final transport = QueueDeliveryTransport()
        ..replies.add(TimeoutException('lost reply'));
      final desktop = await deliveryDesktop(transport);
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'older'));
      await finishQueueRun(transport, desktop);
      await desktop.flushQueuedDrafts();
      final id = desktop.queuedDrafts.single.id;
      reasoningEvent(transport, 'turn/started', turn: 'published');
      await finishQueueRun(transport, desktop, turn: 'published');
      expect(desktop.removeQueuedDraft(id), isTrue);
      expect(desktop.queuedDrafts, isEmpty);
      transport.replies.add(
        const RemoteRpcException(-32602, 'invalid model', null),
      );
      expect(
        await desktop.submitComposerDraft(
          DesktopComposerDraft(text: 'new draft'),
        ),
        isTrue,
      );
      await settleQueuedDelivery();
      expect(desktop.queuedDrafts.single.draft.text, 'new draft');
      expect(desktop.queuePauseMessage, contains('invalid model'));
      desktop.dispose();
    },
  );
  test(
    'Resume observes an existing running turn instead of issuing another start',
    () async {
      final transport = QueueDeliveryTransport()
        ..replies.add(TimeoutException('lost reply'));
      final desktop = await deliveryDesktop(transport);
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'uncertain head'),
      );
      await finishQueueRun(transport, desktop);
      await desktop.flushQueuedDrafts();
      transport.history = {
        'id': 'thread',
        'turns': [
          {'id': 'accepted-run', 'status': 'inProgress', 'items': []},
        ],
      };
      await desktop.resumeQueuedDrafts();
      expect(queueMutations(transport), hasLength(1));
      expect(desktop.turnId, 'accepted-run');
      expect(desktop.selectedResponseFooter.pending, isFalse);
      expect(desktop.queuedDrafts.single.draft.text, 'uncertain head');
      desktop.dispose();
    },
  );

  test(
    'a fresh idle Resume snapshot cannot clear a newer live start',
    () async {
      final transport = QueueDeliveryTransport()
        ..replies.add(TimeoutException('lost reply'));
      final desktop = await deliveryDesktop(transport);
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'uncertain head'),
      );
      await finishQueueRun(transport, desktop);
      await desktop.flushQueuedDrafts();
      final read = Completer<RemoteJson>();
      transport.readGate = read;
      transport.observeRead = Completer<void>();
      final resuming = desktop.resumeQueuedDrafts();
      for (var i = 0; i < 5; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      reasoningEvent(transport, 'turn/started', turn: 'new-live');
      read.complete({
        'thread': {
          'id': 'thread',
          'turns': [
            {'id': 'running', 'status': 'completed', 'items': []},
          ],
        },
      });
      await resuming;
      expect(transport.observeRead!.isCompleted, isTrue);
      expect(desktop.turnId, 'new-live');
      expect(queueMutations(transport), hasLength(1));
      expect(desktop.queuedDrafts, hasLength(1));
      desktop.dispose();
    },
  );

  for (final snapshot in [
    <String, dynamic>{'id': 'other', 'turns': []},
    <String, dynamic>{
      'id': 'thread',
      'turns': [
        {'id': 'unknown', 'status': 'unknown'},
      ],
    },
  ]) {
    test(
      'unqualified Resume history retains the pause without resending: $snapshot',
      () async {
        final transport = QueueDeliveryTransport()
          ..replies.add(TimeoutException('lost reply'));
        final desktop = await deliveryDesktop(transport);
        await desktop.submitComposerDraft(
          DesktopComposerDraft(text: 'uncertain head'),
        );
        await finishQueueRun(transport, desktop);
        await desktop.flushQueuedDrafts();
        transport.history = snapshot;
        await desktop.resumeQueuedDrafts();
        expect(desktop.queuePauseMessage, isNotNull);
        expect(desktop.queuedDrafts, hasLength(1));
        expect(queueMutations(transport), hasLength(1));
        desktop.dispose();
      },
    );
  }
  test(
    'idle FIFO flush sends one queued head and waits for its terminal event',
    () async {
      final transport = QueueDeliveryTransport();
      final desktop = await deliveryDesktop(transport);
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'first'));
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'second'));
      await desktop.flushQueuedDrafts();
      expect(queueMutations(transport), isEmpty);
      await finishQueueRun(transport, desktop);
      await desktop.flushQueuedDrafts();
      expect(queueMutations(transport).map((call) => call['method']), [
        'turn/start',
      ]);
      expect((queueMutations(transport).single['params'] as Map)['input'], [
        {'type': 'text', 'text': 'first'},
      ]);
      expect(desktop.queuedDrafts.single.draft.text, 'second');
      await desktop.flushQueuedDrafts();
      expect(queueMutations(transport), hasLength(1));
      await finishQueueRun(transport, desktop, turn: desktop.turnId!);
      await desktop.flushQueuedDrafts();
      expect(queueMutations(transport), hasLength(2));
      expect((queueMutations(transport).last['params'] as Map)['input'], [
        {'type': 'text', 'text': 'second'},
      ]);
      expect(desktop.queuedDrafts, isEmpty);
      desktop.dispose();
    },
  );

  test(
    'unknown flush outcome restores the head and pauses until explicit Resume',
    () async {
      final transport = QueueDeliveryTransport()
        ..replies.add(TimeoutException('lost reply'));
      final desktop = await deliveryDesktop(transport);
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'first'));
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'second'));
      await finishQueueRun(transport, desktop);
      await desktop.flushQueuedDrafts();
      expect(queueMutations(transport), hasLength(1));
      expect(desktop.queuedDrafts.map((row) => row.draft.text), [
        'first',
        'second',
      ]);
      expect(desktop.queuePauseMessage, contains('lost reply'));
      expect(
        desktop.timeline
            .where((row) => row['type'] == 'userMessage')
            .single['delivery'],
        'unknown',
      );
      await desktop.flushQueuedDrafts();
      expect(queueMutations(transport), hasLength(1));
      await desktop.resumeQueuedDrafts();
      expect(queueMutations(transport), hasLength(2));
      expect(desktop.queuePauseMessage, isNull);
      expect(desktop.queuedDrafts.single.draft.text, 'second');
      desktop.dispose();
    },
  );

  test('offline flush retains its draft without any mutation', () async {
    final transport = QueueDeliveryTransport();
    final desktop = await deliveryDesktop(transport);
    await desktop.submitComposerDraft(
      DesktopComposerDraft(text: 'offline pending'),
    );
    await finishQueueRun(transport, desktop);
    transport.online = false;
    await desktop.flushQueuedDrafts();
    expect(desktop.queuedDrafts.single.draft.text, 'offline pending');
    expect(queueMutations(transport), isEmpty);
    desktop.dispose();
  });

  test(
    'queued plan uses the current model but never clears a newly typed identical composer',
    () async {
      final transport = QueueDeliveryTransport();
      final desktop = await deliveryDesktop(transport);
      desktop.plan = true;
      final draft = mixed();
      await desktop.submitComposerDraft(draft);
      desktop.plan = false;
      desktop.model = 'next';
      desktop.effort = 'high';
      desktop.threadList.data.setComposerDraft('thread', draft);
      await finishQueueRun(transport, desktop);
      await desktop.flushQueuedDrafts();
      expect(queueMutations(transport), hasLength(1));
      final params = queueMutations(transport).single['params'] as Map;
      expect(params['model'], 'next-wire');
      expect(params['collaborationMode'], {
        'mode': 'plan',
        'settings': {
          'model': 'next-wire',
          'reasoning_effort': 'high',
          'developer_instructions': null,
        },
      });
      expect(desktop.plan, isFalse);
      expect(desktop.model, 'next');
      expect(
        desktop.threadList.data.composerDraft('thread').toJson(),
        draft.toJson(),
      );
      desktop.dispose();
    },
  );

  test(
    'explicit Steer consumes only the chosen queued row and preserves the live input',
    () async {
      final transport = QueueDeliveryTransport()
        ..replies.add({'turnId': 'running'});
      final desktop = await deliveryDesktop(transport);
      for (final text in ['first', 'chosen', 'last']) {
        await desktop.submitComposerDraft(DesktopComposerDraft(text: text));
      }
      final chosen = desktop.queuedDrafts[1].id;
      final current = DesktopComposerDraft(text: 'chosen');
      desktop.threadList.data.setComposerDraft('thread', current);
      expect(await desktop.steerQueuedDraft(chosen), isTrue);
      expect(queueMutations(transport).single['method'], 'turn/steer');
      expect((queueMutations(transport).single['params'] as Map)['input'], [
        {'type': 'text', 'text': 'chosen'},
      ]);
      expect(desktop.queuedDrafts.map((row) => row.draft.text), [
        'first',
        'last',
      ]);
      expect(desktop.queuePauseMessage, isNull);
      expect(desktop.threadList.data.composerDraft('thread').text, 'chosen');
      desktop.dispose();
    },
  );

  test(
    'rejected queued Steer retains its row, removes only its failed optimistic echo and does not pause',
    () async {
      final transport = QueueDeliveryTransport()
        ..replies.add(
          const RemoteRpcException(-32601, 'Steer unavailable', null),
        );
      final desktop = await deliveryDesktop(transport);
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'retry this intentionally'),
      );
      final id = desktop.queuedDrafts.single.id;
      expect(await desktop.steerQueuedDraft(id), isFalse);
      expect(queueMutations(transport), hasLength(1));
      expect(desktop.queuedDrafts.single.id, id);
      expect(
        desktop.timeline.where((row) => row['type'] == 'userMessage'),
        isEmpty,
      );
      expect(desktop.queuePauseMessage, isNull);
      desktop.dispose();
    },
  );

  test(
    'an uncertain queued Steer pauses automatic delivery after the active run ends',
    () async {
      final transport = QueueDeliveryTransport()
        ..replies.add(TimeoutException('steer reply lost'));
      final desktop = await deliveryDesktop(transport);
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'possibly accepted'),
      );
      final id = desktop.queuedDrafts.single.id;
      expect(await desktop.steerQueuedDraft(id), isFalse);
      expect(desktop.queuePauseMessage, isNotNull);
      await finishQueueRun(transport, desktop);
      await desktop.flushQueuedDrafts();
      expect(queueMutations(transport), hasLength(1));
      expect(desktop.queuedDrafts.single.id, id);
      desktop.dispose();
    },
  );

  test(
    'restoration removes a row only after an atomic successful composer restore',
    () async {
      final transport = QueueDeliveryTransport();
      final desktop = await deliveryDesktop(transport);
      await desktop.submitComposerDraft(mixed());
      final queued = desktop.queuedDrafts.single;
      expect(desktop.restoreQueuedDraft(queued.id, (_) => false), isFalse);
      expect(desktop.queuedDrafts.single.id, queued.id);
      DesktopComposerDraft? restored;
      expect(
        desktop.restoreQueuedDraft(queued.id, (row) {
          restored = row.draft;
          return true;
        }),
        isTrue,
      );
      expect(restored!.toJson(), mixed().toJson());
      expect(desktop.queuedDrafts, isEmpty);
      expect(queueMutations(transport), isEmpty);
      desktop.dispose();
    },
  );

  test(
    'reentrant flush and a second explicit flush never send the pending head twice',
    () async {
      final reply = Completer<RemoteJson>();
      final transport = QueueDeliveryTransport()..replies.add(reply);
      final desktop = await deliveryDesktop(transport);
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'once'));
      await finishQueueRun(transport, desktop);
      desktop.addListener(() {
        unawaited(desktop.flushQueuedDrafts());
      });
      final first = desktop.flushQueuedDrafts();
      await Future<void>.delayed(Duration.zero);
      await desktop.flushQueuedDrafts();
      final before = queueMutations(transport).length;
      reply.complete({
        'turn': {'id': 'one-active-run'},
      });
      await first;
      expect(before, 1);
      expect(queueMutations(transport), hasLength(1));
      expect(desktop.queuedDrafts, isEmpty);
      desktop.dispose();
    },
  );
}
