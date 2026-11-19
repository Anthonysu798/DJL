import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/status/domain/run_status.dart';

void main() {
  test(
    'phone running projection is uncapped, immutable and exact-scope live only',
    () {
      var now = DateTime.utc(2026, 10, 29);
      final status = RunStatusProjector(now: () => now);
      addTearDown(status.dispose);
      final threads = {
        for (final id in ['a', 'b', 'c', 'd', 'e']) id: StatusThread(id, ''),
      };
      void bind({String pin = 'pin', bool connected = true}) =>
          status.setContext(
            mac: 'mac',
            fingerprint: pin,
            session: 'session',
            connected: connected,
            selectedThread: null,
            threads: threads,
          );
      Set<String> live({String mac = 'mac', String pin = 'pin'}) =>
          status.liveRunningThreads(mac: mac, fingerprint: pin).ids;
      bind();
      for (final id in threads.keys) {
        status.observe('turn/started', {'threadId': id, 'turnId': 'turn-$id'});
      }
      expect(live(), {'a', 'b', 'c', 'd', 'e'});
      expect(
        status.liveRunningThreads(mac: 'mac', fingerprint: 'pin').nextDeadline,
        now.add(const Duration(minutes: 30)),
      );
      expect(() => live().add('fake'), throwsUnsupportedError);
      expect(status.project().running, hasLength(3));
      expect(live(mac: 'other'), isEmpty);
      expect(live(pin: 'other'), isEmpty);
      bind(connected: false);
      expect(live(), isEmpty);
      bind();
      expect(live(), hasLength(5));
      now = now.add(const Duration(minutes: 30));
      expect(live(), isEmpty);
      status.observe('item/agentMessage/delta', {
        'threadId': 'a',
        'turnId': 'turn-a',
        'itemId': 'answer',
        'phase': 'final_answer',
        'delta': 'finishing',
      });
      expect(live(), {'a'});
      threads.remove('a');
      bind();
      expect(live(), isEmpty);
      status.observe('turn/completed', {'threadId': 'b', 'turnId': 'turn-b'});
      status.observe('turn/started', {
        'threadId': 'b',
        'turnId': 'replay',
        'djlReplayedEvent': true,
      });
      expect(live(), isEmpty);
      status.observe('item/agentMessage/delta', {
        'threadId': 'c',
        'turnId': 'turn-c',
        'itemId': 'answer',
        'delta': 'alive',
      });
      expect(live(), {'c'});
      now = DateTime.utc(2026, 10, 29, 4);
      status.observe('item/agentMessage/delta', {
        'threadId': 'c',
        'turnId': 'turn-c',
        'itemId': 'answer',
        'delta': 'too old',
      });
      expect(live(), isEmpty);
      bind(pin: 'replacement');
      expect(live(pin: 'replacement'), isEmpty);
    },
  );
  test(
    'phone evidence must belong to current session without changing OS projection',
    () {
      final status = RunStatusProjector(now: () => DateTime.utc(2026, 10, 29));
      addTearDown(status.dispose);
      void bind(String session) => status.setContext(
        mac: 'mac',
        fingerprint: 'pin',
        session: session,
        connected: true,
        selectedThread: null,
        threads: {'a': const StatusThread('A', '')},
      );
      bind('old');
      status.observe('turn/started', {'threadId': 'a', 'turnId': 'turn'});
      expect(status.liveRunningThreads(mac: 'mac', fingerprint: 'pin').ids, {
        'a',
      });
      bind('new');
      expect(status.project().running.single.state, RunState.running);
      expect(
        status.liveRunningThreads(mac: 'mac', fingerprint: 'pin').ids,
        isEmpty,
      );
      expect(
        status.liveRunningThreads(mac: 'mac', fingerprint: 'pin').nextDeadline,
        isNull,
      );
      status.observe('turn/started', {
        'threadId': 'a',
        'turnId': 'turn',
        'djlReplayedEvent': true,
      });
      expect(
        status.liveRunningThreads(mac: 'mac', fingerprint: 'pin').ids,
        isEmpty,
      );
      status.observe('item/agentMessage/delta', {
        'threadId': 'a',
        'turnId': 'turn',
        'itemId': 'fresh',
        'delta': 'fresh evidence',
      });
      expect(status.liveRunningThreads(mac: 'mac', fingerprint: 'pin').ids, {
        'a',
      });
      bind('third');
      status.observe('turn/completed', {'threadId': 'a', 'turnId': 'turn'});
      expect(
        status.liveRunningThreads(mac: 'mac', fingerprint: 'pin').ids,
        isEmpty,
      );
      expect(status.project().ready, hasLength(1));
    },
  );
}
