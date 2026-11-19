import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'desktop_subagents_test.dart' show SubagentTransport, subagentDesktop;

class PassiveReconnectTransport extends SubagentTransport {
  @override
  Future<void> connect(Pairing pair, {required bool bootstrap}) async {
    online = true;
  }

  @override
  Future<void> disconnect() async {
    online = false;
  }
}

void main() {
  test(
    'qualified status link waits for exact saved host choice and rejects wrong or changed pin',
    () async {
      final transport = PassiveReconnectTransport();
      final controller = subagentDesktop(transport);
      Pairing pair(String mac, int byte) => Pairing({
        'macDeviceId': mac,
        'sessionId': 's',
        'macIdentityPublicKey': base64Encode(List.filled(32, byte)),
        'relay': 'wss://relay.test/relay',
      });
      final a = pair('mac-a', 1), b = pair('mac-b', 2);
      controller.active = b;
      controller.trusted = [a, b];
      transport.mac = 'mac-b';
      await controller.threadList.attach('mac-b');
      final target = DesktopLinkTarget.parse(
        DesktopLinkTarget.statusUri(
          'same-id',
          'mac-a',
          DesktopLinkTarget.keyFingerprint(a.publicKey)!,
        )!,
      )!;
      controller.queueNavigation(target);
      await controller.routeNavigation();
      expect(controller.navigationNeedsHost, true);
      expect(transport.calls, isEmpty);
      await controller.selectSaved(b);
      expect(controller.active, b);
      expect(controller.navigationNeedsHost, true);
      await controller.selectSaved(pair('mac-a', 3));
      expect(controller.active, b);
      expect(controller.navigationNeedsHost, true);
      controller.trusted = [b];
      controller.queueNavigation(const DesktopLinkTarget('temporary'));
      controller.queueNavigation(target);
      expect(controller.navigationError, contains('unavailable'));
      await controller.selectSaved(a);
      expect(controller.active, b);
      expect(controller.navigationNeedsHost, true);
      controller.trusted = [a, b];
      // The full connect path is not needed to prove host-choice eligibility;
      // routing on its matching current trusted identity stays read-only.
      controller.active = a;
      transport.mac = 'mac-a';
      await controller.threadList.attach('mac-a');
      controller.cancelNavigation();
      controller.queueNavigation(target);
      await controller.routeNavigation();
      expect(controller.navigationDisplayTarget, target);
      expect(
        transport.calls.where((c) => c['method'] == 'thread/resume'),
        isEmpty,
      );
      expect(
        transport.calls.where((c) => c['method'] == 'thread/read').length,
        1,
      );
      controller.dispose();
    },
  );
  for (final action in ['model', 'access', 'plan']) {
    test(
      'explicit $action choice authorizes ordinary refresh after passive link',
      () async {
        final transport = PassiveReconnectTransport();
        final controller = subagentDesktop(transport);
        controller.active = Pairing({
          ...controller.active!.data,
          'macIdentityPublicKey': 'pin',
          'relay': 'wss://relay.example.test/relay',
        });
        controller.trusted = [controller.active!];
        await controller.threadList.attach('mac-a');
        controller.models = [
          {'id': 'qa', 'model': 'qa', 'djlProvider': 'codex'},
        ];
        controller.queueNavigation(const DesktopLinkTarget('linked'));
        await controller.routeNavigation();
        if (action == 'model') {
          controller.setModel('qa');
        } else if (action == 'access') {
          await controller.setAccess('on-request');
        } else {
          controller.setPlan(false);
        }
        transport.calls.clear();
        transport.events.add({
          'method': 'djl/bufferedReplay/gap',
          'params': {'threadId': 'linked'},
        });
        await Future<void>.delayed(Duration.zero);
        await Future<void>.delayed(Duration.zero);
        expect(
          transport.calls
              .where((call) => call['method'] == 'thread/resume')
              .length,
          1,
        );
        controller.dispose();
      },
    );
  }

  test(
    'passive linked chat still permits explicit Send and later ordinary refresh',
    () async {
      final transport = PassiveReconnectTransport();
      final desktop = subagentDesktop(transport);
      desktop.active = Pairing({
        ...desktop.active!.data,
        'macIdentityPublicKey': 'pin',
        'relay': 'wss://relay.example.test/relay',
      });
      desktop.trusted = [desktop.active!];
      await desktop.threadList.attach('mac-a');
      desktop.models = [
        {'id': 'qa', 'model': 'qa', 'djlProvider': 'codex'},
      ];
      transport.histories['linked'] = {
        'id': 'linked',
        'model': 'qa',
        'modelProvider': 'codex',
        'runtimeMode': 'approval-required',
        'turns': [],
      };
      desktop.queueNavigation(const DesktopLinkTarget('linked'));
      await desktop.routeNavigation();
      expect(await desktop.send(''), isFalse);
      transport.events.add({
        'method': 'djl/bufferedReplay/gap',
        'params': {'threadId': 'linked'},
      });
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      expect(
        transport.calls.where((call) => call['method'] == 'thread/resume'),
        isEmpty,
      );
      expect(await desktop.send('Explicit authorized message'), isTrue);
      expect(
        transport.calls.where((call) => call['method'] == 'turn/start').length,
        1,
      );
      transport.events.add({
        'method': 'djl/bufferedReplay/reset',
        'params': {'threadId': 'linked'},
      });
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      expect(
        transport.calls
            .where((call) => call['method'] == 'thread/resume')
            .length,
        1,
      );
      desktop.dispose();
    },
  );

  for (final metadata in ['missing', 'different']) {
    for (final trigger in [
      'turn/completed',
      'djl/bufferedReplay/gap',
      'djl/bufferedReplay/reset',
      'reconnect',
    ]) {
      test(
        'successful passive link retains read-only lifetime through $trigger with $metadata metadata',
        () async {
          final transport = PassiveReconnectTransport();
          final passive = subagentDesktop(transport);
          passive.active = Pairing({
            ...passive.active!.data,
            'macIdentityPublicKey': 'pin',
            'relay': 'wss://relay.example.test/relay',
          });
          passive.trusted = [passive.active!];
          await passive.threadList.attach('mac-a');
          if (metadata == 'different') {
            transport.histories['linked'] = {
              'id': 'linked',
              'runtimeMode': 'full-access',
              'turns': [],
            };
          }
          passive.queueNavigation(const DesktopLinkTarget('linked'));
          await passive.routeNavigation();
          expect(passive.navigationTarget, isNull);
          expect(
            passive.access,
            metadata == 'different' ? 'full-access' : 'on-request',
          );
          transport.calls.clear();
          if (trigger == 'reconnect') {
            await passive.connect(passive.active!, resolve: false);
          } else {
            transport.events.add({
              'method': trigger,
              'params': {'threadId': 'linked', 'turnId': 'turn'},
            });
            await Future<void>.delayed(Duration.zero);
            await Future<void>.delayed(Duration.zero);
          }
          expect(
            transport.calls.where((call) => call['method'] == 'thread/read'),
            isNotEmpty,
          );
          expect(
            transport.calls.where(
              (call) => [
                'thread/resume',
                'djl/thread/runtimeMode/set',
                'turn/start',
                'turn/steer',
              ].contains(call['method']),
            ),
            isEmpty,
          );
          await passive.openThread({'id': 'ordinary'});
          expect(
            transport.calls.where((call) => call['method'] == 'thread/resume'),
            isNotEmpty,
          );
          passive.dispose();
        },
      );
    }
  }
  for (final message in [
    'Thread not found',
    'Unknown thread',
    'Thread not found: not yet materialized',
  ]) {
    test('fresh not-found classification is precise: $message', () async {
      final transport = SubagentTransport()
        ..readFailure = RemoteRpcException(-32000, message, null);
      final desktop = subagentDesktop(transport);
      desktop.active = Pairing({
        ...desktop.active!.data,
        'macIdentityPublicKey': 'pin',
        'relay': 'wss://relay.example.test/relay',
      });
      desktop.trusted = [desktop.active!];
      await desktop.threadList.attach('mac-a');
      desktop.queueNavigation(const DesktopLinkTarget('t'));
      await desktop.routeNavigation();
      expect(
        desktop.navigationTarget == null,
        !message.contains('materialized'),
      );
      desktop.dispose();
    });
  }

  test(
    'privacy gate retains queued target and never begins its history read',
    () async {
      final transport = SubagentTransport();
      final desktop = subagentDesktop(transport);
      desktop.active = Pairing({
        ...desktop.active!.data,
        'macIdentityPublicKey': 'pin',
        'relay': 'wss://relay.example.test/relay',
      });
      desktop.trusted = [desktop.active!];
      await desktop.threadList.attach('mac-a');
      desktop.queueNavigation(const DesktopLinkTarget('private'));
      desktop.setRoutingAllowed(false);
      await desktop.routeNavigation();
      expect(
        transport.calls.where((call) => call['method'] == 'thread/read'),
        isEmpty,
      );
      expect(desktop.navigationTarget?.thread, 'private');
      desktop.setRoutingAllowed(true);
      await desktop.routeNavigation();
      expect(desktop.thread?['id'], 'private');
      desktop.dispose();
    },
  );
  test(
    'linked open reads exact selected host without resume or policy writes',
    () async {
      final transport = SubagentTransport();
      final desktop = subagentDesktop(transport);
      desktop.active = Pairing({
        ...desktop.active!.data,
        'macIdentityPublicKey': 'pin',
        'relay': 'wss://relay.example.test/relay',
      });
      desktop.trusted = [desktop.active!];
      await desktop.threadList.attach('mac-a');
      transport.histories['linked'] = {
        'id': 'linked',
        'title': 'Linked',
        'turns': [],
      };
      desktop.queueNavigation(const DesktopLinkTarget('linked', message: 'm'));
      await desktop.routeNavigation();
      expect(desktop.thread?['id'], 'linked');
      expect(desktop.navigationDisplayTarget?.message, 'm');
      expect(desktop.navigationTarget, isNull);
      expect(
        transport.calls
            .where((call) => (call['method'] as String).startsWith('thread/'))
            .map((call) => call['method']),
        ['thread/read'],
      );
      desktop.dispose();
    },
  );
  test(
    'offline target survives omission and reconnect retries read only',
    () async {
      final transport = SubagentTransport()..online = false;
      final desktop = subagentDesktop(transport);
      desktop.active = Pairing({
        ...desktop.active!.data,
        'macIdentityPublicKey': 'pin',
        'relay': 'wss://relay.example.test/relay',
      });
      desktop.trusted = [desktop.active!];
      await desktop.threadList.attach('mac-a');
      desktop.queueNavigation(const DesktopLinkTarget('omitted'));
      await desktop.routeNavigation();
      expect(desktop.thread?['id'], 'omitted');
      expect(desktop.navigationTarget?.thread, 'omitted');
      transport.online = true;
      transport.readFailure = const RemoteRpcException(-32000, 'Offline', null);
      await desktop.routeNavigation(retry: true);
      expect(desktop.navigationTarget?.thread, 'omitted');
      transport.readFailure = null;
      await desktop.routeNavigation(retry: true);
      expect(desktop.navigationTarget, isNull);
      desktop.dispose();
    },
  );
  test(
    'host round trip while read waits cancels old intent and late history',
    () async {
      final transport = SubagentTransport()..gates['linked'] = Completer();
      final desktop = subagentDesktop(transport);
      desktop.active = Pairing({
        ...desktop.active!.data,
        'macIdentityPublicKey': 'pin',
        'relay': 'wss://relay.example.test/relay',
      });
      desktop.trusted = [desktop.active!];
      await desktop.threadList.attach('mac-a');
      desktop.queueNavigation(const DesktopLinkTarget('linked'));
      final read = desktop.routeNavigation();
      await Future<void>.delayed(Duration.zero);
      desktop.cancelNavigation();
      desktop.active = Pairing({'macDeviceId': 'other', 'sessionId': 'other'});
      desktop.active = desktop.trusted.single;
      transport.gates['linked']!.complete({
        'thread': {'id': 'linked', 'title': 'Stale', 'turns': []},
      });
      await read;
      expect(desktop.navigationDisplayTarget, isNull);
      expect(desktop.thread?['title'], isNot('Stale'));
      desktop.dispose();
    },
  );
  test(
    'authoritative missing retires target while generic failures retain it',
    () async {
      final transport = SubagentTransport()
        ..readFailure = const RemoteRpcException(
          -32001,
          'Thread not found',
          null,
        );
      final desktop = subagentDesktop(transport);
      desktop.active = Pairing({
        ...desktop.active!.data,
        'macIdentityPublicKey': 'pin',
        'relay': 'wss://relay.example.test/relay',
      });
      desktop.trusted = [desktop.active!];
      await desktop.threadList.attach('mac-a');
      desktop.queueNavigation(const DesktopLinkTarget('missing'));
      await desktop.routeNavigation();
      expect(desktop.navigationTarget, isNull);
      expect(desktop.navigationError, contains('unavailable'));
      desktop.dispose();
    },
  );
}
