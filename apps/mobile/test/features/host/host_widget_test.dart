import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/host/presentation/host_controller.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/host/presentation/host_controls.dart';
import 'host_controller_test.dart' show HostStore, HostTransport;

void main() {
  testWidgets(
    'status, explicit update confirmation and reconnect expectation are visible at large text',
    (tester) async {
      final transport = HostTransport(), store = HostStore();
      final host = HostController(transport, store: store);
      addTearDown(host.dispose);
      host.bind(device: 'a', session: 's1', connected: true, trusted: true);
      await host.loadPreference();
      await host.refresh();
      await tester.binding.setSurfaceSize(const Size(360, 460));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: HostPage(controller: host),
        ),
      );
      expect(find.text('Your Mac'), findsOneWidget);
      expect(find.textContaining('ChatGPT'), findsNothing);
      expect(find.text('DJL version'), findsOneWidget);
      expect(find.text('1.0'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Update DJL'), 120);
      await tester.ensureVisible(find.text('Update DJL'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Update DJL'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Your Mac has DJL 1.0.'), findsOneWidget);
      expect(find.textContaining('reconnects by itself'), findsOneWidget);
      expect(
        transport.calls.where((c) => c.$1 == 'desktop/bridge/updateAndRestart'),
        isEmpty,
      );
      await tester.tap(find.text('Update'));
      await tester.pumpAndSettle();
      expect(
        transport.calls
            .where((c) => c.$1 == 'desktop/bridge/updateAndRestart')
            .length,
        1,
      );
      await tester.scrollUntilVisible(
        find.textContaining('DJL is updating on your Mac'),
        120,
      );
      expect(
        find.textContaining('DJL is updating on your Mac'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('continue confirms exact selected thread and displays failure', (
    tester,
  ) async {
    final transport = HostTransport();
    final host = HostController(transport, store: HostStore());
    addTearDown(host.dispose);
    host.bind(device: 'a', session: 's1', connected: true, trusted: true);
    await host.refresh();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HostContinueAction(controller: host, threadId: '  selected  '),
        ),
      ),
    );
    await tester.tap(find.byTooltip('Continue on desktop'));
    await tester.pumpAndSettle();
    expect(transport.calls.where((c) => c.$1.startsWith('desktop/')), isEmpty);
    transport.handler = (m, p) async => {'success': false};
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(transport.calls.last.$1, 'desktop/continueOnDesktop');
    expect(transport.calls.last.$2, {'threadId': 'selected'});
    expect(find.textContaining('did not confirm'), findsOneWidget);
  });
  testWidgets(
    'offline stale status, capability disable and preference retry stay usable',
    (tester) async {
      final host = HostController(
        HostTransport(),
        store: HostStore()..fail = true,
      );
      addTearDown(host.dispose);
      host.bind(device: 'a', session: 's1', connected: true, trusted: true);
      await host.loadPreference();
      await host.refresh();
      host.bind(device: 'a', session: null, connected: false, trusted: true);
      await host.setKeepAwake(true);
      await tester.pumpWidget(MaterialApp(home: HostPage(controller: host)));
      expect(find.text('Not connected'), findsOneWidget);
      expect(find.textContaining('Open DJL on your Mac'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Try again'), 200);
      expect(find.textContaining('Could not save'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('old handoff result never posts feedback on another host', (
    tester,
  ) async {
    final transport = HostTransport();
    final host = HostController(transport, store: HostStore());
    addTearDown(host.dispose);
    host.bind(device: 'a', session: 's1', connected: true, trusted: true);
    await host.refresh();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HostContinueAction(controller: host, threadId: 'selected'),
        ),
      ),
    );
    await tester.tap(find.byTooltip('Continue on desktop'));
    await tester.pumpAndSettle();
    final pending = Completer<Map<String, dynamic>>();
    transport.handler = (m, p) => pending.future;
    await tester.tap(find.text('Continue'));
    await tester.pump();
    host.bind(device: 'b', session: 's2', connected: true, trusted: true);
    pending.complete({'success': true});
    await tester.pumpAndSettle();
    expect(find.byType(SnackBar), findsNothing);
  });
  testWidgets('status loading is shown and unsupported controls are hidden', (
    tester,
  ) async {
    final transport = HostTransport();
    final host = HostController(transport, store: HostStore());
    addTearDown(host.dispose);
    host.bind(device: 'a', session: 's1', connected: true, trusted: true);
    final pending = Completer<Map<String, dynamic>>();
    transport.handler = (m, p) => pending.future;
    final refresh = host.refresh();
    await tester.pumpWidget(MaterialApp(home: HostPage(controller: host)));
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    pending.complete({
      'status': 'not_logged_in',
      'hostPlatform': 'linux',
      'hostCapabilities': {
        'desktopHandoff': false,
        'displayWake': false,
        'keepAwake': false,
        'bridgeUpdate': false,
      },
    });
    await refresh;
    await tester.pumpAndSettle();
    expect(find.byType(LinearProgressIndicator), findsNothing);
    expect(find.text('Wake the screen'), findsNothing);
    expect(find.text('Keep Mac awake'), findsNothing);
    expect(find.text('Update DJL'), findsNothing);
    expect(transport.calls.where((c) => c.$1.startsWith('desktop/')), isEmpty);
  });
  testWidgets('stale host status shows checking and offers a fresh read', (
    tester,
  ) async {
    final transport = HostTransport();
    final host = HostController(transport, store: HostStore());
    addTearDown(host.dispose);
    host.bind(device: 'a', session: 's1', connected: true, trusted: true);
    await host.loadPreference();
    await host.refresh();
    transport.handler = (m, p) async => throw TimeoutException('offline');
    await host.refresh();
    await tester.pumpWidget(MaterialApp(home: HostPage(controller: host)));
    expect(host.canSyncPreference, isFalse);
    expect(find.text('Connected · checking'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });
  for (final rejection in <(String, Object)>[
    (
      'unsupported',
      const RemoteRpcException(-32000, 'unsupported', {
        'errorCode': 'unsupported_bridge_update',
      }),
    ),
    (
      'refused',
      const RemoteRpcException(-32000, 'refused', {
        'errorCode': 'bridge_update_failed',
      }),
    ),
    ('false result', <String, dynamic>{'success': false}),
  ]) {
    testWidgets(
      'updater ${rejection.$1} shows error and a usable explicit retry without waiting for restart',
      (tester) async {
        final transport = HostTransport();
        final host = HostController(transport, store: HostStore());
        addTearDown(host.dispose);
        host.bind(device: 'a', session: 's1', connected: true, trusted: true);
        await host.refresh();
        transport.handler = (method, params) async {
          if (rejection.$2 is RemoteRpcException) throw rejection.$2;
          return rejection.$2 as Map<String, dynamic>;
        };
        await tester.pumpWidget(MaterialApp(home: HostPage(controller: host)));
        Future<void> openConfirmation() async {
          await tester.scrollUntilVisible(find.text('Update DJL'), 120);
          await tester.ensureVisible(find.text('Update DJL'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Update DJL'));
          await tester.pumpAndSettle();
        }

        await openConfirmation();
        await tester.tap(find.text('Update'));
        await tester.pumpAndSettle();
        expect(find.text(host.actionError!.message), findsOneWidget);
        expect(
          find.textContaining('DJL is updating on your Mac'),
          findsNothing,
        );
        expect(host.canUpdate, isTrue);
        expect(
          transport.calls
              .where((c) => c.$1 == 'desktop/bridge/updateAndRestart')
              .length,
          1,
        );
        transport.handler = null;
        await openConfirmation();
        expect(
          transport.calls
              .where((c) => c.$1 == 'desktop/bridge/updateAndRestart')
              .length,
          1,
        );
        await tester.tap(find.text('Update'));
        await tester.pumpAndSettle();
        expect(
          transport.calls
              .where((c) => c.$1 == 'desktop/bridge/updateAndRestart')
              .length,
          2,
        );
        expect(
          find.textContaining('DJL is updating on your Mac'),
          findsOneWidget,
        );
      },
    );
  }
}
