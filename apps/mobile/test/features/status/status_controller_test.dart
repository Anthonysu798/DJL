import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/status/domain/run_status.dart';
import 'package:djl_mobile/core/security/remote_crypto.dart';
import '../desktop_subagents_test.dart' show SubagentTransport, subagentDesktop;

void main() {
  test(
    'real raw observer covers other known threads before selected filter, prunes metadata, rejects stale session/trust/replay',
    () async {
      final remote = SubagentTransport();
      final controller = subagentDesktop(remote);
      final pair = Pairing({
        'macDeviceId': 'mac-a',
        'sessionId': 'secure-a',
        'macIdentityPublicKey': base64Encode(List.filled(32, 1)),
        'relay': 'wss://relay.test/relay',
      });
      controller.active = pair;
      controller.trusted = [pair];
      await controller.threadList.attach('mac-a');
      for (final id in ['selected', 'a', 'b']) {
        controller.threadList.data.upsert({'id': id, 'title': id});
      }
      controller.thread = {'id': 'selected'};
      final now = DateTime.utc(2026);
      final status = RunStatusProjector(now: () => now);
      controller.attachRunStatus(status);
      Future<void> emit(
        String method,
        String thread,
        String turn, {
        Map<String, dynamic> extra = const {},
        String? session,
      }) async {
        remote.events.add({
          'method': method,
          '_sessionId': ?session,
          'params': {'threadId': thread, 'turnId': turn, ...extra},
        });
        await Future<void>.delayed(Duration.zero);
      }

      await emit('turn/started', 'a', 'ta');
      await emit('turn/started', 'b', 'tb');
      expect(status.project().rows.length, 2);
      await emit(
        'item/agentMessage/delta',
        'a',
        'ta',
        extra: {
          'itemId': 'i',
          'delta': 'private reply',
          'phase': 'final_answer',
        },
      );
      expect(status.project().running.first.state, RunState.finishing);
      await emit('turn/completed', 'a', 'ta');
      await emit('turn/failed', 'b', 'tb');
      expect(
        [status.project().failedCount, status.project().readyCount],
        [1, 1],
      );
      await emit('turn/completed', 'selected', 'ts');
      await controller.openThread({'id': 'a'});
      expect(status.project().ready, isEmpty);
      await emit('turn/completed', 'unknown', 'u');
      await emit('turn/started', 'selected', 'stale', session: 'old');
      await emit(
        'turn/started',
        'selected',
        'replay',
        extra: {'djlReplayedEvent': true},
      );
      expect(status.project().running, isEmpty);
      controller.threadList.data.archive('b', true);
      controller.threadList.filter(search: '');
      expect(status.project().rows, isEmpty);
      await emit('turn/started', 'selected', 'live');
      await emit(
        'djl/hostPresence',
        'unselected',
        'unused',
        extra: {'online': false},
      );
      expect(status.project().rows.single.state, RunState.paused);
      await emit(
        'djl/hostPresence',
        'unselected',
        'unused',
        extra: {'online': true},
      );
      expect(status.project().rows.single.state, RunState.running);
      remote.online = false;
      controller.closeThread('a');
      expect(status.project().rows.single.state, RunState.paused);
      remote.online = true;
      remote.session = 'new-session';
      await emit('turn/started', 'selected', 'live');
      expect(status.project().rows.single.startedAt, now);
      remote.onDisconnected?.call(
        const RemoteSecurityException('Identity mismatch'),
        4005,
      );
      expect(status.project().rows, isEmpty);
      controller.trusted = [];
      await emit('turn/completed', 'selected', 'live');
      controller.closeThread('selected');
      expect(status.project().rows, isEmpty);
      controller.attachRunStatus(null);
      controller.dispose();
      status.dispose();
    },
  );
}
