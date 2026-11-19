import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/host/presentation/host_controller.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/host/presentation/host_controls.dart';
import 'host_controller_test.dart' show HostStore, HostTransport;

void main() {
  testWidgets(
    'status, explicit confirmation and reconnect expectation are visible at large text',
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
      expect(find.textContaining('Paired ChatGPT'), findsOneWidget);
      expect(find.textContaining('1.0'), findsWidgets);
      for (
        var i = 0;
        i < 15 && find.text('Update bridge').hitTestable().evaluate().isEmpty;
        i++
      ) {
        await tester.drag(find.byType(ListView), const Offset(0, -280));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.text('Update bridge'));
      await tester.pumpAndSettle();
      expect(find.textContaining('reconnect'), findsWidgets);
      expect(find.textContaining('Current: 1.0'), findsOneWidget);
      expect(find.textContaining('Latest reported: 2.0'), findsOneWidget);
      expect(
        transport.calls.where((c) => c.$1 == 'desktop/bridge/updateAndRestart'),
        isEmpty,
      );
      await tester.tap(find.text('Update and restart'));
      await tester.pumpAndSettle();
      expect(
        transport.calls
            .where((c) => c.$1 == 'desktop/bridge/updateAndRestart')
            .length,
        1,
      );
      expect(
        find.textContaining('Waiting for bridge reconnect'),
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
      expect(find.textContaining('Offline'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Retry preference'), 200);
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
  testWidgets(
    'status loading is shown and unsupported controls send no mutations',
    (tester) async {
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
      final wake = tester.widget<OutlinedButton>(
        find.widgetWithText(OutlinedButton, 'Wake display'),
      );
      expect(wake.onPressed, isNull);
      expect(
        transport.calls.where((c) => c.$1.startsWith('desktop/')),
        isEmpty,
      );
    },
  );
  testWidgets('stale host status disables preference sync until a fresh read', (
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
    final sync = tester.widget<TextButton>(
      find.widgetWithText(TextButton, 'Sync preference'),
    );
    expect(sync.onPressed, isNull);
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
          for (
            var i = 0;
            i < 12 &&
                find.text('Update bridge').hitTestable().evaluate().isEmpty;
            i++
          ) {
            await tester.drag(find.byType(ListView), const Offset(0, -260));
            await tester.pumpAndSettle();
          }
          await tester.tap(find.text('Update bridge'));
          await tester.pumpAndSettle();
        }

        await openConfirmation();
        await tester.tap(find.text('Update and restart'));
        await tester.pumpAndSettle();
        expect(find.text(host.actionError!.message), findsOneWidget);
        expect(
          find.textContaining('Waiting for bridge reconnect'),
          findsNothing,
        );
        final retry = tester.widget<OutlinedButton>(
          find.widgetWithText(OutlinedButton, 'Update bridge'),
        );
        expect(retry.onPressed, isNotNull);
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
        await tester.tap(find.text('Update and restart'));
        await tester.pumpAndSettle();
        expect(
          transport.calls
              .where((c) => c.$1 == 'desktop/bridge/updateAndRestart')
              .length,
          2,
        );
        expect(
          find.textContaining('Waiting for bridge reconnect'),
          findsOneWidget,
        );
      },
    );
  }
}
