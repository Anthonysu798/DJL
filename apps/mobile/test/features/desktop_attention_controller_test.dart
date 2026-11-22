import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_attention.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_attention_projection_test.dart' show approval, question;
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop, reasoningEvent;

void main() {
  test(
    'question receipt time is local and stable across duplicate delivery',
    () async {
      final transport = ReasoningTransport();
      final desktop = await reasoningDesktop(transport);
      final request = question('request', 'thread')..['_receivedAt'] = 0;
      final before = DateTime.now().millisecondsSinceEpoch / 1000;
      transport.events.add(request);
      final date = desktop.attentionItems.single.date;
      expect(date, greaterThanOrEqualTo(before));
      expect(
        date,
        lessThanOrEqualTo(DateTime.now().millisecondsSinceEpoch / 1000),
      );
      transport.events.add(
        question('request', 'thread')..['_receivedAt'] = 999,
      );
      expect(desktop.attentionItems.single.date, date);
      desktop.dispose();
    },
  );
  test(
    'a stale review navigation cannot select, read or consume unread work',
    () async {
      final transport = ReasoningTransport();
      final desktop = await reasoningDesktop(transport);
      desktop.threadList.data.upsert({'id': 'other'});
      reasoningEvent(
        transport,
        'turn/completed',
        thread: 'other',
        extra: {'status': 'completed'},
      );
      final before = transport.calls.length;
      await desktop.openThread(
        {'id': 'other'},
        readOnlyNavigation: true,
        isCurrent: () => false,
      );
      expect(desktop.thread?['id'], 'thread');
      expect(
        desktop.attentionItems.single.kind,
        DesktopAttentionKind.completedRun,
      );
      expect(transport.calls, hasLength(before));
      desktop.dispose();
    },
  );
  for (final boundary in ['pin', 'missing-pin', 'cache', 'session']) {
    test(
      '$boundary invalidates live unread projection even if chat metadata remains',
      () async {
        final transport = ReasoningTransport();
        final desktop = await reasoningDesktop(transport);
        desktop.threadList.data.upsert({'id': 'other'});
        reasoningEvent(
          transport,
          'turn/completed',
          thread: 'other',
          extra: {'status': 'completed'},
        );
        expect(
          desktop.attentionItems.single.kind,
          DesktopAttentionKind.completedRun,
        );
        switch (boundary) {
          case 'pin':
            desktop.active = const Pairing({
              'macDeviceId': 'mac-a',
              'sessionId': 'secure-a',
              'macIdentityPublicKey': 'new-trusted-pin',
            });
            desktop.trusted = [desktop.active!];
          case 'missing-pin':
            desktop.active = Pairing(
              Map<String, dynamic>.from(desktop.active!.data)
                ..remove('macIdentityPublicKey'),
            );
            transport.online = false;
            desktop.state = 'disconnected';
          case 'cache':
            desktop.threadList.data = ThreadLocalState.fromJson(
              desktop.threadList.data.toJson(),
            );
          case 'session':
            transport.session = 'new-session';
        }
        expect(desktop.attentionItems, isEmpty);
        desktop.dispose();
      },
    );
  }
  test(
    'only new off-screen live outcomes become unread; viewing consumes them',
    () async {
      final transport = ReasoningTransport();
      final desktop = await reasoningDesktop(transport);
      desktop.threadList.data.upsert({'id': 'other', 'title': 'Other chat'});
      reasoningEvent(transport, 'turn/started', thread: 'other', turn: 'one');
      reasoningEvent(
        transport,
        'turn/completed',
        thread: 'other',
        turn: 'one',
        extra: {'status': 'completed'},
      );
      expect(
        desktop.attentionItems.single.kind,
        DesktopAttentionKind.completedRun,
      );
      expect(desktop.attentionItems.single.target.thread, 'other');

      await desktop.openThread({'id': 'other'}, readOnlyNavigation: true);
      expect(desktop.attentionItems, isEmpty);
      await desktop.openThread({'id': 'thread'}, readOnlyNavigation: true);
      reasoningEvent(
        transport,
        'turn/completed',
        thread: 'other',
        turn: 'one',
        extra: {'status': 'completed'},
      );
      expect(
        desktop.attentionItems,
        isEmpty,
        reason: 'duplicate terminal must not resurrect viewed work',
      );

      reasoningEvent(transport, 'turn/started', thread: 'other', turn: 'two');
      reasoningEvent(transport, 'turn/failed', thread: 'other', turn: 'two');
      expect(
        desktop.attentionItems.single.kind,
        DesktopAttentionKind.failedRun,
      );
      reasoningEvent(transport, 'turn/started', thread: 'other', turn: 'three');
      expect(desktop.attentionItems, isEmpty);
      reasoningEvent(
        transport,
        'turn/completed',
        thread: 'other',
        turn: 'three',
        extra: {'status': 'interrupted'},
      );
      expect(
        desktop.attentionItems,
        isEmpty,
        reason: 'stopped work is not completed review work',
      );
      desktop.dispose();
    },
  );

  test(
    'current, replayed, conflicting, foreign and unknown outcomes do not create unread items',
    () async {
      final transport = ReasoningTransport();
      final desktop = await reasoningDesktop(transport);
      desktop.threadList.data.upsert({'id': 'other'});
      reasoningEvent(
        transport,
        'turn/completed',
        extra: {'status': 'completed'},
      );
      expect(desktop.attentionItems, isEmpty);
      reasoningEvent(
        transport,
        'turn/completed',
        thread: 'other',
        extra: {'status': 'completed', 'djlReplayedEvent': true},
      );
      reasoningEvent(
        transport,
        'turn/completed',
        thread: 'other',
        extra: {
          'status': 'completed',
          'event': {'threadId': 'wrong', 'turnId': 'turn'},
        },
      );
      transport.events.add({
        'method': 'turn/completed',
        '_macDeviceId': 'foreign-mac',
        '_sessionId': 'foreign-session',
        'params': {
          'threadId': 'other',
          'turnId': 'foreign',
          'status': 'completed',
        },
      });
      reasoningEvent(
        transport,
        'turn/completed',
        thread: 'unknown',
        extra: {'status': 'completed'},
      );
      expect(desktop.attentionItems, isEmpty);
      desktop.threadList.data.upsert({'id': 'unknown'});
      expect(
        desktop.attentionItems,
        isEmpty,
        reason: 'unknown event cannot become unread after later discovery',
      );
      desktop.dispose();
    },
  );

  test(
    'old terminal and reordered start cannot replace a newer unread outcome',
    () async {
      final transport = ReasoningTransport();
      final desktop = await reasoningDesktop(transport);
      desktop.threadList.data.upsert({'id': 'other'});
      reasoningEvent(transport, 'turn/started', thread: 'other', turn: 'old');
      reasoningEvent(
        transport,
        'turn/completed',
        thread: 'other',
        turn: 'old',
        extra: {'status': 'completed'},
      );
      reasoningEvent(transport, 'turn/started', thread: 'other', turn: 'new');
      reasoningEvent(
        transport,
        'turn/completed',
        thread: 'other',
        turn: 'old',
        extra: {'status': 'completed'},
      );
      expect(desktop.attentionItems, isEmpty);
      reasoningEvent(transport, 'turn/failed', thread: 'other', turn: 'new');
      expect(
        desktop.attentionItems.single.kind,
        DesktopAttentionKind.failedRun,
      );
      reasoningEvent(transport, 'turn/started', thread: 'other', turn: 'old');
      expect(
        desktop.attentionItems.single.kind,
        DesktopAttentionKind.failedRun,
      );
      desktop.dispose();
    },
  );

  test(
    'projection keeps recovered questions review-only and excludes another host cache',
    () async {
      final transport = ReasoningTransport();
      final desktop = await reasoningDesktop(transport);
      desktop.threadList.data.upsert({'id': 'other'});
      final recovered = question('recovered', 'other')
        ..['_macDeviceId'] = 'mac-a'
        ..['_sessionId'] = 'expired-session'
        ..['_responseUnknown'] = true;
      desktop.userInputs.add(recovered);
      desktop.approvals.add(
        approval('foreign', 'other')
          ..['_macDeviceId'] = 'other-mac'
          ..['_sessionId'] = 'other-session',
      );
      final before = transport.calls.length;
      expect(desktop.attentionItems.single.requestId, 'recovered');
      expect(desktop.canRespond(recovered), isFalse);
      expect(
        transport.calls,
        hasLength(before),
        reason: 'review projection never sends or grants authority',
      );
      await desktop.threadList.attach('other-mac');
      expect(desktop.attentionItems, isEmpty);
      desktop.dispose();
    },
  );
}
