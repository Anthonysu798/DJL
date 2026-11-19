import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop, reasoningEvent;

class PreflightTransport extends ReasoningTransport {
  Completer<Map<String, dynamic>>? startGate;
  Completer<Map<String, dynamic>>? checkpointGate;
  final checkpointStarted = Completer<void>();
  @override
  Future<Map<String, dynamic>> request(
    String method,
    Map<String, dynamic> params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'workspace/checkpointCapture' && checkpointGate != null) {
      calls.add({'method': method, 'params': params});
      if (!checkpointStarted.isCompleted) checkpointStarted.complete();
      return checkpointGate!.future;
    }
    if (method == 'turn/start') {
      calls.add({'method': method, 'params': params});
      return startGate?.future ??
          {
            'turn': {'id': 'next'},
          };
    }
    return super.request(method, params, timeout: timeout);
  }
}

Future<DesktopController> preflightDesktop(PreflightTransport t) async {
  t.history = {
    'id': 'thread',
    'cwd': '/qa',
    'turns': [
      {
        'id': 'previous',
        'status': 'completed',
        'items': [
          {'id': 'answer', 'type': 'agentMessage', 'text': 'Previous answer'},
        ],
      },
    ],
  };
  final d = await reasoningDesktop(t);
  d.model = 'test-model';
  t.calls.clear();
  return d;
}

void main() {
  for (final change in ['folder', 'cache', 'pending', 'published']) {
    test(
      'checkpoint preparation cannot dispatch after a newer $change state',
      () async {
        final t = PreflightTransport()..checkpointGate = Completer();
        final d = await preflightDesktop(t);
        addTearDown(d.dispose);
        final oldTimeline = d.timeline;
        final sending = d.send('prepared input');
        await t.checkpointStarted.future.timeout(const Duration(seconds: 2));
        expect(
          d.selectedResponseFooter.pending,
          isFalse,
          reason: 'Local snapshot preparation is not a dispatched turn',
        );
        switch (change) {
          case 'folder':
            d.thread = {'id': 'thread', 'cwd': '/other'};
          case 'cache':
            d.threadList.data = ThreadLocalState();
          case 'pending':
            reasoningEvent(t, 'turn/started', extra: {'turnId': null});
          case 'published':
            reasoningEvent(t, 'turn/started', turn: 'server-new');
        }
        d.error = 'new checkpoint owner notice';
        t.checkpointGate!.complete({});
        expect(await sending, isFalse);
        expect(
          oldTimeline.where((row) => row['type'] == 'userMessage'),
          isEmpty,
          reason:
              'A never-dispatched draft must not leave a pending user bubble',
        );
        expect(
          t.calls.where(
            (c) => {'turn/start', 'turn/steer'}.contains(c['method']),
          ),
          isEmpty,
        );
        expect(d.error, 'new checkpoint owner notice');
        if (change == 'cache') {
          expect(d.threadList.data.timelines, isEmpty);
        }
        if (change == 'pending') {
          expect(d.selectedResponseFooter.pending, isTrue);
        }
        if (change == 'published') expect(d.turnId, 'server-new');
      },
    );
  }

  test('a dispatched timeout stays uncertain and is never replayed', () async {
    final t = PreflightTransport()..startGate = Completer();
    final d = await preflightDesktop(t);
    addTearDown(d.dispose);
    final sending = d.send('lost acknowledgement');
    await Future<void>.delayed(Duration.zero);
    t.startGate!.completeError(TimeoutException('lost turn reply'));
    expect(await sending, isFalse);
    expect(t.calls.where((c) => c['method'] == 'turn/start'), hasLength(1));
    expect(d.selectedResponseFooter.pending, isTrue);
    expect(d.shouldQueueComposer, isTrue);
    expect(d.error, contains('send result may be unknown'));
  });

  test(
    'local rejection preserves an existing server ID-less pending run',
    () async {
      final t = PreflightTransport();
      final d = await preflightDesktop(t);
      addTearDown(d.dispose);
      reasoningEvent(t, 'turn/started', extra: {'turnId': null});
      d.model = null;
      expect(await d.send('invalid model during server run'), isFalse);
      expect(d.selectedResponseFooter.pending, isTrue);
      expect(d.turnId, isNull);
      expect(d.shouldQueueComposer, isTrue);
      expect(d.canStopTurn, isTrue);
      expect(
        t.calls.where(
          (c) => {'turn/start', 'turn/steer'}.contains(c['method']),
        ),
        isEmpty,
      );
    },
  );

  for (final change in ['folder', 'cache', 'pending', 'published']) {
    test(
      'send notification cannot submit into a newer $change owner or run',
      () async {
        final t = PreflightTransport();
        final d = await preflightDesktop(t);
        addTearDown(d.dispose);
        var changed = false;
        d.addListener(() {
          if (changed || !d.busy) return;
          changed = true;
          switch (change) {
            case 'folder':
              d.thread = {'id': 'thread', 'cwd': '/other'};
            case 'cache':
              d.threadList.data = ThreadLocalState();
            case 'pending':
              reasoningEvent(t, 'turn/started', extra: {'turnId': null});
            case 'published':
              reasoningEvent(t, 'turn/started', turn: 'server-new');
          }
          d.error = 'new owner notice';
        });
        expect(await d.send('old input snapshot'), isFalse);
        expect(changed, isTrue);
        expect(
          t.calls.where(
            (c) => {'turn/start', 'turn/steer'}.contains(c['method']),
          ),
          isEmpty,
        );
        expect(d.error, 'new owner notice');
        if (change == 'cache') {
          expect(d.threadList.data.timelines, isEmpty);
        }
        if (change == 'pending') {
          expect(d.selectedResponseFooter.pending, isTrue);
        }
        if (change == 'published') expect(d.turnId, 'server-new');
      },
    );
  }

  for (final failure in ['model', 'images', 'context', 'folder']) {
    test(
      'local $failure rejection leaves the previous run idle and draft raw',
      () async {
        final t = PreflightTransport();
        final d = await preflightDesktop(t);
        addTearDown(d.dispose);
        if (failure == 'model') d.model = null;
        final draft = DesktopComposerDraft(
          text: '  keep this raw draft  ',
          cwd: failure == 'folder' ? '/other' : '/qa',
          images: failure == 'images'
              ? List.generate(
                  5,
                  (i) => DesktopComposerImage(
                    id: 'image-$i',
                    name: 'public.png',
                    dataUrl: 'data:image/png;base64,YQ==',
                  ),
                )
              : const [],
          contexts: failure == 'context' || failure == 'folder'
              ? [
                  DesktopComposerContext(
                    kind: DesktopContextKind.file,
                    id: failure == 'context' ? '' : 'hello.txt',
                    name: 'hello.txt',
                    path: 'hello.txt',
                  ),
                ]
              : const [],
        );
        d.threadList.data.setComposerDraft('thread', draft);
        expect(await d.submitComposerDraft(draft), isFalse);
        expect(
          t.calls.where(
            (c) => {'turn/start', 'turn/steer'}.contains(c['method']),
          ),
          isEmpty,
        );
        expect(
          d.threadList.data.composerDraft('thread').toJson(),
          draft.toJson(),
        );
        expect(d.selectedResponseFooter.pending, isFalse);
        expect(d.selectedResponseFooter.outcome('previous').name, 'completed');
        expect(d.shouldQueueComposer, isFalse);
        expect(d.canStopTurn, isFalse);
        expect(d.error, isNot(contains('send result may be unknown')));
      },
    );
  }

  test(
    'correcting a local model rejection starts once instead of phantom queueing',
    () async {
      final t = PreflightTransport();
      final d = await preflightDesktop(t);
      addTearDown(d.dispose);
      d.model = null;
      final draft = DesktopComposerDraft(text: 'corrected retry');
      expect(await d.submitComposerDraft(draft), isFalse);
      d.model = 'test-model';
      expect(await d.submitComposerDraft(draft), isTrue);
      expect(t.calls.where((c) => c['method'] == 'turn/start'), hasLength(1));
      expect(d.queuedDrafts, isEmpty);
      expect(d.turnId, 'next');
    },
  );

  test(
    'valid dispatched start remains pending before its acknowledgement',
    () async {
      final t = PreflightTransport()..startGate = Completer();
      final d = await preflightDesktop(t);
      addTearDown(d.dispose);
      final sending = d.send('valid request');
      await Future<void>.delayed(Duration.zero);
      expect(d.selectedResponseFooter.pending, isTrue);
      expect(t.calls.where((c) => c['method'] == 'turn/start'), hasLength(1));
      t.startGate!.complete({
        'turn': {'id': 'next'},
      });
      expect(await sending, isTrue);
      expect(d.selectedResponseFooter.pending, isFalse);
      expect(d.turnId, 'next');
    },
  );

  test('local invalid input preserves a server-owned running turn', () async {
    final t = PreflightTransport();
    final d = await preflightDesktop(t);
    addTearDown(d.dispose);
    reasoningEvent(t, 'turn/started', turn: 'server-run');
    d.model = null;
    expect(await d.send('direct invalid follow-up'), isFalse);
    expect(d.turnId, 'server-run');
    expect(d.selectedResponseFooter.outcome('server-run').name, 'running');
    expect(d.shouldQueueComposer, isTrue);
    expect(
      t.calls.where((c) => {'turn/start', 'turn/steer'}.contains(c['method'])),
      isEmpty,
    );
  });
}
