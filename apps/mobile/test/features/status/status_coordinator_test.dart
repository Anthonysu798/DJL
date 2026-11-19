import 'dart:async';
import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/status/domain/run_status.dart';
import 'package:djl_mobile/features/status/data/status_surface.dart';
import 'package:djl_mobile/features/status/presentation/status_coordinator.dart';

class FakeSurface implements StatusSurface {
  final calls = <(String, Map<String, Object?>)>[];
  Completer<bool>? delay;
  bool available = true;
  @override
  Future<bool> end(Map<String, Object?> payload) async {
    calls.add(('end', payload));
    return available;
  }

  @override
  Future<bool> update(Map<String, Object?> payload) async {
    calls.add(('update', payload));
    final pending = delay;
    delay = null;
    return pending == null ? available : pending.future;
  }
}

void main() {
  testWidgets(
    'available surface coalesces at 350ms then projects stale deadline without claiming fresh work',
    (tester) async {
      var now = DateTime.utc(2026);
      final status = RunStatusProjector(now: () => now),
          surface = FakeSurface();
      final coordinator = StatusCoordinator(status, surface);
      status.setContext(
        mac: 'm',
        fingerprint: 'a' * 64,
        session: 's',
        connected: true,
        selectedThread: null,
        threads: {'t': const StatusThread('Title', '')},
      );
      status.observe('turn/started', {'threadId': 't', 'turnId': 'run'});
      await coordinator.flush();
      final before = surface.calls.length;
      for (var n = 0; n < 3; n++) {
        status.observe('item/agentMessage/delta', {
          'threadId': 't',
          'turnId': 'run',
          'itemId': 'i',
          'phase': 'final_answer',
          'delta': 'text$n',
        });
      }
      await tester.pump(const Duration(milliseconds: 349));
      expect(surface.calls.length, before);
      await tester.pump(const Duration(milliseconds: 1));
      await coordinator.done;
      expect(surface.calls.length, before + 1);
      expect(jsonEncode(surface.calls.last.$2), contains('finishing'));
      now = now.add(const Duration(minutes: 30));
      await tester.pump(const Duration(minutes: 30));
      await coordinator.done;
      expect(jsonEncode(surface.calls.last.$2), contains('paused'));
      final deadline =
          (surface.calls.last.$2['buckets'] as Map)['running'] as List;
      expect(
        (deadline.single as Map)['startedAt'],
        DateTime.utc(2026).millisecondsSinceEpoch,
      );
      coordinator.dispose();
      await coordinator.done;
      status.dispose();
    },
  );

  testWidgets('missing native consumer is explicitly unavailable', (
    tester,
  ) async {
    const channel = MethodChannel('app.djl/local_run_status');
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      channel,
      (_) async => throw MissingPluginException(),
    );
    expect(
      await const MethodChannelStatusSurface().end({
        'schemaVersion': 1,
        'epoch': 0,
        'instance': 'random',
      }),
      false,
    );
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      channel,
      null,
    );
  });
  testWidgets(
    'startup and enabled lock export generic even while unlocked; explicit disabled alone exports detail',
    (tester) async {
      final now = DateTime.utc(2026, 10, 28);
      final status = RunStatusProjector(now: () => now),
          surface = FakeSurface();
      final coordinator = StatusCoordinator(status, surface);
      status.setContext(
        mac: 'secret-host',
        fingerprint: 'a' * 64,
        session: 'secret-session',
        connected: true,
        selectedThread: null,
        threads: {
          'secret-thread': const StatusThread(
            'secret-title',
            '/secret/root/secret-folder',
          ),
        },
      );
      status.observe('turn/started', {
        'threadId': 'secret-thread',
        'turnId': 'secret-turn',
      });
      await coordinator.flush();
      coordinator.configure(settingsReady: true, lockEnabled: true);
      await coordinator.flush();
      for (final call in surface.calls) {
        expect(jsonEncode(call.$2), isNot(contains('secret')));
        expect(jsonEncode(call.$2), isNot(contains('a' * 64)));
      }
      coordinator.configure(settingsReady: true, lockEnabled: false);
      await coordinator.flush();
      expect(jsonEncode(surface.calls.last.$2), contains('secret-title'));
      expect(surface.calls.first.$1, 'end');
      coordinator.dispose();
      await coordinator.done;
      status.dispose();
      expect(surface.calls.last.$1, 'end');
    },
  );

  testWidgets(
    'privacy/host barrier drains delayed update before end then latest generic; stale responses do not grant availability',
    (tester) async {
      final status = RunStatusProjector(now: () => DateTime.utc(2026));
      final surface = FakeSurface(),
          coordinator = StatusCoordinator(status, FakeSurface());
      coordinator.dispose();
      await coordinator.done;
      final live = StatusCoordinator(status, surface);
      live.configure(settingsReady: true, lockEnabled: false);
      status.setContext(
        mac: 'old-host',
        fingerprint: 'a' * 64,
        session: 's',
        connected: true,
        selectedThread: null,
        threads: {'old-thread': const StatusThread('old-title', '/old-folder')},
      );
      status.observe('turn/started', {'threadId': 'old-thread', 'turnId': 't'});
      final gate = Completer<bool>();
      surface.delay = gate;
      final pending = live.flush();
      await tester.pump();
      live.configure(settingsReady: true, lockEnabled: true);
      status.setContext(
        mac: 'new-host',
        fingerprint: 'b' * 64,
        session: 'new',
        connected: true,
        selectedThread: null,
        threads: {'new-thread': const StatusThread('new-title', '/new-folder')},
      );
      status.observe('turn/started', {'threadId': 'new-thread', 'turnId': 't'});
      final latest = live.flush();
      gate.complete(true);
      await pending;
      await latest;
      final lastEnd = surface.calls.lastIndexWhere((c) => c.$1 == 'end');
      expect(lastEnd, greaterThan(0));
      for (final call in surface.calls.skip(lastEnd)) {
        expect(jsonEncode(call.$2), isNot(contains('old-')));
        expect(jsonEncode(call.$2), isNot(contains('new-')));
      }
      expect(surface.calls.last.$2['detailed'], false);
      live.dispose();
      await live.done;
      status.dispose();
    },
  );

  testWidgets(
    'coalesces 350ms, expiry deadline, unsupported is contained without retry spam',
    (tester) async {
      final status = RunStatusProjector(now: () => DateTime.utc(2026));
      final surface = FakeSurface()..available = false;
      final coordinator = StatusCoordinator(status, surface);
      await coordinator.flush();
      status.setContext(
        mac: 'm',
        fingerprint: 'a' * 64,
        session: 's',
        connected: true,
        selectedThread: null,
        threads: {'t': const StatusThread('Title', '')},
      );
      status.observe('turn/started', {'threadId': 't', 'turnId': 'run'});
      await tester.pump(const Duration(milliseconds: 350));
      await coordinator.flush();
      expect(coordinator.availability, StatusAvailability.unavailable);
      expect(surface.calls.length, 1);
      coordinator.dispose();
      await coordinator.done;
      status.dispose();
    },
  );
  testWidgets(
    'unavailable response after a possible detailed write still permits privacy removal only',
    (tester) async {
      final status = RunStatusProjector(now: () => DateTime.utc(2026)),
          surface = FakeSurface();
      final coordinator = StatusCoordinator(status, surface);
      coordinator.configure(settingsReady: true, lockEnabled: false);
      status.setContext(
        mac: 'private-host',
        fingerprint: 'a' * 64,
        session: 's',
        connected: true,
        selectedThread: null,
        threads: {
          'private-thread': const StatusThread(
            'private-title',
            '/private-folder',
          ),
        },
      );
      status.observe('turn/started', {
        'threadId': 'private-thread',
        'turnId': 'turn',
      });
      await coordinator.flush();
      surface.available = false;
      status.observe('item/agentMessage/delta', {
        'threadId': 'private-thread',
        'turnId': 'turn',
        'itemId': 'i',
        'phase': 'final_answer',
        'delta': 'answer',
      });
      await coordinator.flush();
      final before = surface.calls.length;
      status.observe('item/agentMessage/delta', {
        'threadId': 'private-thread',
        'turnId': 'turn',
        'itemId': 'i',
        'delta': 'more',
      });
      await coordinator.flush();
      expect(surface.calls.length, before);
      coordinator.configure(settingsReady: true, lockEnabled: true);
      await coordinator.flush();
      expect(surface.calls.last.$1, 'end');
      expect(surface.calls.length, before + 1);
      expect(jsonEncode(surface.calls.last.$2), isNot(contains('private')));
      coordinator.dispose();
      await coordinator.done;
      status.dispose();
    },
  );
}
