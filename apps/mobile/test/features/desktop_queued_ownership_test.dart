import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_queued_delivery_test.dart'
    show
        QueueDeliveryTransport,
        deliveryDesktop,
        finishQueueRun,
        queueMutations;
import 'desktop_reasoning_controller_test.dart' show reasoningEvent;
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';

class CheckpointQueueTransport extends QueueDeliveryTransport {
  final captureStarted = Completer<void>();
  final capture = Completer<RemoteJson>();
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'workspace/checkpointCapture' &&
        params['checkpointKind'] == 'messageStart') {
      calls.add({'method': method, 'params': params});
      if (!captureStarted.isCompleted) captureStarted.complete();
      return capture.future;
    }
    return super.request(method, params, timeout: timeout);
  }
}

void main() {
  for (final mismatch in ['pin', 'wire']) {
    test(
      'a $mismatch mismatch against the validated response connection cannot flush queued intent',
      () async {
        final transport = QueueDeliveryTransport();
        final desktop = await deliveryDesktop(transport);
        if (mismatch == 'pin') {
          desktop.active = Pairing({
            ...desktop.active!.data,
            'macIdentityPublicKey': 'changed-pin',
          });
        } else {
          transport.mac = 'another-wire-host';
        }
        await desktop.submitComposerDraft(
          DesktopComposerDraft(text: 'current displayed owner'),
        );
        desktop.turnId = null;
        await desktop.flushQueuedDrafts();
        expect(queueMutations(transport), isEmpty);
        expect(
          desktop.queuedDrafts.single.draft.text,
          'current displayed owner',
        );
        desktop.dispose();
      },
    );
  }
  test(
    'a chat change during checkpoint preparation removes only the unsent optimistic row',
    () async {
      final transport = CheckpointQueueTransport();
      final desktop = await deliveryDesktop(transport);
      desktop.thread = {...desktop.thread!, 'cwd': '/qa'};
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'owned head'),
      );
      await finishQueueRun(transport, desktop);
      expect(desktop.thread?['cwd'], '/qa');
      final flushing = desktop.flushQueuedDrafts();
      await transport.captureStarted.future.timeout(const Duration(seconds: 2));
      final cache = desktop.threadList.data;
      expect(
        cache.timelines['thread']!.where((row) => row['type'] == 'userMessage'),
        hasLength(1),
      );
      desktop.thread = {'id': 'other'};
      desktop.turnId = null;
      desktop.timeline = [];
      desktop.error = 'other chat error';
      cache.setComposerDraft(
        'other',
        DesktopComposerDraft(text: 'other draft'),
      );
      transport.capture.complete({});
      await flushing;
      expect(queueMutations(transport), isEmpty);
      expect(
        cache.timelines['thread']!.where((row) => row['type'] == 'userMessage'),
        isEmpty,
      );
      expect(cache.composerDraft('other').text, 'other draft');
      expect(desktop.error, 'other chat error');
      desktop.thread = {'id': 'thread', 'cwd': '/qa'};
      expect(desktop.queuedDrafts.single.draft.text, 'owned head');
      expect(desktop.queuePauseMessage, isNotNull);
      desktop.dispose();
    },
  );

  test(
    'a new ID-less running event during checkpoint preparation cannot start another run',
    () async {
      final transport = CheckpointQueueTransport();
      final desktop = await deliveryDesktop(transport);
      desktop.thread = {...desktop.thread!, 'cwd': '/qa'};
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'owned head'),
      );
      await finishQueueRun(transport, desktop);
      final flushing = desktop.flushQueuedDrafts();
      await transport.captureStarted.future.timeout(const Duration(seconds: 2));
      reasoningEvent(
        transport,
        'turn/started',
        extra: {
          'turnId': null,
          'turn': {'status': 'inProgress'},
        },
      );
      transport.capture.complete({});
      await flushing;
      expect(queueMutations(transport), isEmpty);
      expect(desktop.turnId, isNull);
      expect(desktop.queuedDrafts.single.draft.text, 'owned head');
      expect(
        desktop.threadList.data.timelines['thread']!.where(
          (row) => row['type'] == 'userMessage',
        ),
        isEmpty,
      );
      desktop.dispose();
    },
  );

  test(
    'an older duplicate completion during preparation does not cancel a fresh queued send',
    () async {
      final transport = CheckpointQueueTransport();
      final desktop = await deliveryDesktop(transport);
      desktop.thread = {...desktop.thread!, 'cwd': '/qa'};
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'once'));
      await finishQueueRun(transport, desktop);
      final flushing = desktop.flushQueuedDrafts();
      await transport.captureStarted.future.timeout(const Duration(seconds: 2));
      reasoningEvent(
        transport,
        'turn/completed',
        turn: 'running',
        extra: {
          'turn': {'id': 'running', 'status': 'completed'},
        },
      );
      transport.capture.complete({});
      await flushing;
      expect(queueMutations(transport), hasLength(1));
      expect(desktop.queuedDrafts, isEmpty);
      desktop.dispose();
    },
  );

  test(
    'pending explicit Steer locks its row and restore while other rows remain deletable',
    () async {
      final reply = Completer<RemoteJson>();
      final transport = QueueDeliveryTransport()..replies.add(reply);
      final desktop = await deliveryDesktop(transport);
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'chosen'));
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'other'));
      final chosen = desktop.queuedDrafts.first.id,
          other = desktop.queuedDrafts.last.id;
      final steering = desktop.steerQueuedDraft(chosen);
      await Future<void>.delayed(Duration.zero);
      expect(desktop.steeringQueuedDraftId, chosen);
      expect(desktop.removeQueuedDraft(chosen), isFalse);
      var restored = false;
      expect(
        desktop.restoreQueuedDraft(other, (_) {
          restored = true;
          return true;
        }),
        isFalse,
      );
      expect(restored, isFalse);
      expect(desktop.removeQueuedDraft(other), isTrue);
      reply.complete({'turnId': 'running'});
      expect(await steering, isTrue);
      expect(desktop.queuedDrafts, isEmpty);
      expect(desktop.steeringQueuedDraftId, isNull);
      expect(queueMutations(transport), hasLength(1));
      desktop.dispose();
    },
  );

  test(
    'explicit queued Steer while idle never substitutes a new start',
    () async {
      final transport = QueueDeliveryTransport();
      final desktop = await deliveryDesktop(transport);
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'waiting'));
      final id = desktop.queuedDrafts.single.id;
      await finishQueueRun(transport, desktop);
      expect(await desktop.steerQueuedDraft(id), isFalse);
      expect(queueMutations(transport), isEmpty);
      expect(desktop.queuedDrafts.single.id, id);
      desktop.dispose();
    },
  );

  test(
    'a changed remote project folder cannot qualify paused Resume',
    () async {
      final transport = QueueDeliveryTransport()
        ..replies.add(TimeoutException('lost reply'));
      final desktop = await deliveryDesktop(transport);
      desktop.thread = {...desktop.thread!, 'cwd': '/qa'};
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'original project'),
      );
      await finishQueueRun(transport, desktop);
      await desktop.flushQueuedDrafts();
      expect(queueMutations(transport), hasLength(1));
      transport.history = {
        'id': 'thread',
        'cwd': '/other',
        'turns': [
          {'id': 'running', 'status': 'completed', 'items': []},
        ],
      };
      await desktop.resumeQueuedDrafts();
      expect(queueMutations(transport), hasLength(1));
      expect(desktop.queuePauseMessage, isNotNull);
      expect(desktop.queuedDrafts.single.draft.text, 'original project');
      expect(desktop.thread?['cwd'], '/qa');
      desktop.dispose();
    },
  );

  test(
    'a late old-host acknowledgement cannot remove a new-host queue and leaves the old attempt qualified as unknown',
    () async {
      final reply = Completer<RemoteJson>();
      final transport = QueueDeliveryTransport()..replies.add(reply);
      final desktop = await deliveryDesktop(transport);
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'old host'));
      await finishQueueRun(transport, desktop);
      final oldCache = desktop.threadList.data;
      final flushing = desktop.flushQueuedDrafts();
      await Future<void>.delayed(Duration.zero);
      expect(queueMutations(transport), hasLength(1));
      desktop.active = const Pairing({
        'macDeviceId': 'mac-b',
        'macIdentityPublicKey': 'pin-b',
        'sessionId': 'secure-b',
      });
      transport.mac = 'mac-b';
      transport.session = 'secure-b';
      await desktop.threadList.attach('mac-b');
      desktop.thread = {'id': 'other'};
      desktop.timeline = [];
      desktop.turnId = 'new-host-running';
      desktop.busy = false;
      expect(desktop.queuedDrafts, isEmpty);
      desktop.threadList.data.setComposerDraft(
        'other',
        DesktopComposerDraft(text: 'new host draft'),
      );
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'new host queued'),
      );
      reply.complete({
        'turn': {'id': 'old-host-accepted'},
      });
      await flushing;
      expect(desktop.queuedDrafts.single.draft.text, 'new host queued');
      expect(
        desktop.threadList.data.composerDraft('other').text,
        'new host draft',
      );
      expect(desktop.timeline, isEmpty);
      expect(
        oldCache.timelines['thread']!
            .where((row) => row['type'] == 'userMessage')
            .single['delivery'],
        'unknown',
      );
      expect(queueMutations(transport), hasLength(1));
      desktop.dispose();
    },
  );
}
