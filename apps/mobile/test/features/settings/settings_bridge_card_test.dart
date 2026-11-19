import 'dart:async';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/settings/presentation/local_settings_page.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/settings/presentation/settings_bridge_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../desktop_recovery_test.dart' show RecoveryMemoryStore;
import '../host/host_controller_test.dart' show HostTransport;
import 'settings_controller_test.dart' show MemorySettingsStore;

Future<({DesktopController desktop, HostTransport transport})> showSettings(
  WidgetTester tester, {
  String? installed = '1.9',
  String? latest = '1.10',
  bool connected = true,
  bool capable = true,
  double scale = 1,
  bool fullPage = false,
  bool pushed = false,
}) async {
  final transport = HostTransport();
  transport.status['bridgeVersion'] = installed;
  transport.status['bridgeLatestVersion'] = latest;
  (transport.status['hostCapabilities'] as Map)['bridgeUpdate'] = capable;
  final settings = SettingsController(MemorySettingsStore());
  await settings.load();
  final desktop = DesktopController(
    transport.pairings,
    connection: transport,
    localStore: RecoveryMemoryStore(),
  );
  desktop.host.bind(
    device: 'a',
    session: connected ? 's1' : null,
    connected: connected,
    trusted: true,
  );
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox());
    desktop.dispose();
    settings.dispose();
  });
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(Brightness.light),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: pushed
          ? Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute<void>(
                      fullscreenDialog: true,
                      builder: (_) => LocalSettingsPage(
                        controller: settings,
                        desktop: desktop,
                        signedIn: false,
                        onCloud: () {},
                        onMyMacs: () {},
                        taskStatus: const Text('Task status unavailable'),
                      ),
                    ),
                  ),
                  child: const Text('Open Settings route'),
                ),
              ),
            )
          : fullPage
          ? LocalSettingsPage(
              controller: settings,
              desktop: desktop,
              signedIn: false,
              onCloud: () {},
              onMyMacs: () {},
              taskStatus: const Text('Task status unavailable'),
            )
          : Scaffold(
              body: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: SettingsBridgeCard(controller: desktop.host),
              ),
            ),
    ),
  );
  await tester.pumpAndSettle();
  return (desktop: desktop, transport: transport);
}

void main() {
  testWidgets('scrolled Settings Done closes the actual pushed route', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(402, 874);
    tester.view.devicePixelRatio = 1;
    tester.view.padding = const FakeViewPadding(top: 62, bottom: 34);
    tester.view.viewPadding = const FakeViewPadding(top: 62, bottom: 34);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPadding);
    addTearDown(tester.view.resetViewPadding);
    await showSettings(tester, connected: false, pushed: true);
    await tester.tap(find.text('Open Settings route'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Usage'));
    await tester.pumpAndSettle();
    expect(find.text('Done').hitTestable(), findsOneWidget);
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
    expect(find.text('Open Settings route').hitTestable(), findsOneWidget);
    expect(find.text('Done'), findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets('Bridge versions align to the trailing edge of each source row', (
    tester,
  ) async {
    await showSettings(tester);
    for (final text in ['1.9', '1.10', 'Update available']) {
      final value = find.text(text);
      final row = find.ancestor(of: value, matching: find.byType(Row)).first;
      expect(
        tester.getRect(value).right,
        closeTo(tester.getRect(row).right, .1),
      );
    }
  });
  testWidgets('Settings omits offline Bridge and keeps Usage available', (
    tester,
  ) async {
    final f = await showSettings(tester, fullPage: true, connected: false);
    await tester.ensureVisible(find.text('Usage'));
    await tester.pumpAndSettle();
    expect(find.text('Bridge'), findsNothing);
    expect(find.text('Composer Defaults'), findsNothing);
    expect(find.text('Usage').hitTestable(), findsOneWidget);
    expect(
      f.transport.calls.where((c) => c.$1.startsWith('desktop/')),
      isEmpty,
    );
    expect(tester.takeException(), isNull);
  });
  for (final row in <(String?, String?, String)>[
    (null, '1.10', 'Unknown'),
    ('  ', '1.10', 'Unknown'),
    ('1.9', null, 'Installed'),
    ('1.10', '1.10', 'Up to date'),
    ('1.10', '1.9', 'Different build'),
    ('1.9.2', '1.9.11', 'Update available'),
    ('v9-test', 'v10-test', 'Update available'),
  ]) {
    testWidgets('Bridge status derives ${row.$1}/${row.$2} as ${row.$3}', (
      tester,
    ) async {
      await showSettings(tester, installed: row.$1, latest: row.$2);
      expect(find.text('Bridge'), findsOneWidget);
      expect(find.text(row.$3), findsWidgets);
      expect(
        find.text('Reinstall Bridge on Device'),
        row.$3 == 'Update available' ? findsNothing : findsOneWidget,
      );
    });
  }
  testWidgets('offline and unsupported Bridge controls cannot update', (
    tester,
  ) async {
    final f = await showSettings(tester, connected: false);
    expect(find.text('Bridge'), findsOneWidget);
    expect(
      find.text(
        'Connect to your paired device to read the installed bridge version.',
      ),
      findsOneWidget,
    );
    expect(find.text('Update Bridge on Device'), findsNothing);
    expect(find.text('Reinstall Bridge on Device'), findsNothing);
    expect(f.transport.calls, isEmpty);
  });
  testWidgets(
    'capability refusal hides the mutation while versions remain readable',
    (tester) async {
      await showSettings(tester, capable: false);
      expect(find.text('1.9'), findsOneWidget);
      expect(find.text('Update Bridge on Device'), findsNothing);
    },
  );
  testWidgets(
    'Bridge refresh failure marks stale data and allows only explicit read retry',
    (tester) async {
      final f = await showSettings(tester);
      f.transport.handler = (_, _) async => throw TimeoutException('offline');
      await f.desktop.host.refresh();
      await tester.pumpAndSettle();
      expect(find.textContaining('Last known bridge status'), findsOneWidget);
      final update = find.widgetWithText(TextButton, 'Update Bridge on Device');
      expect(tester.widget<TextButton>(update).onPressed, isNull);
      await tester.ensureVisible(find.text('Refresh bridge status'));
      await tester.pumpAndSettle();
      f.transport.handler = null;
      await tester.tap(find.text('Refresh bridge status'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Last known bridge status'), findsNothing);
      expect(tester.widget<TextButton>(update).onPressed, isNotNull);
      expect(
        f.transport.calls.where((c) => c.$1.startsWith('desktop/')),
        isEmpty,
      );
    },
  );
  for (final outcome in ['cancel', 'confirm', 'new host', 'new revision']) {
    testWidgets('Bridge confirmation $outcome preserves update ownership', (
      tester,
    ) async {
      final f = await showSettings(tester);
      await tester.ensureVisible(find.text('Update Bridge on Device'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Update Bridge on Device'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Current: 1.9'), findsOneWidget);
      expect(find.textContaining('Latest reported: 1.10'), findsOneWidget);
      expect(
        f.transport.calls.where((c) => c.$1.startsWith('desktop/')),
        isEmpty,
      );
      if (outcome.startsWith('new')) {
        f.desktop.host.bind(
          device: outcome == 'new host' ? 'b' : 'a',
          session: 's2',
          connected: true,
          trusted: true,
        );
        await tester.pumpAndSettle();
      }
      await tester.tap(
        find.text(outcome == 'cancel' ? 'Cancel' : 'Update and restart'),
      );
      await tester.pumpAndSettle();
      expect(
        f.transport.calls
            .where((c) => c.$1 == 'desktop/bridge/updateAndRestart')
            .length,
        outcome == 'confirm' ? 1 : 0,
      );
      if (outcome == 'confirm') {
        expect(
          find.textContaining('Waiting for bridge reconnect'),
          findsOneWidget,
        );
        expect(find.text('Up to date'), findsNothing);
      }
    });
  }
  testWidgets(
    'foreground and replacement connection read once without preference writes',
    (tester) async {
      final f = await showSettings(tester);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      f.desktop.host.bind(
        device: 'a',
        session: 's2',
        connected: true,
        trusted: true,
      );
      await tester.pumpAndSettle();
      await tester.pumpAndSettle();
      expect(
        f.transport.calls.map((c) => c.$1),
        List.filled(3, 'account/status/read'),
      );
    },
  );
  testWidgets(
    'Bridge long versions and confirmation remain usable at narrow large text',
    (tester) async {
      tester.view.physicalSize = const Size(320, 740);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await showSettings(
        tester,
        installed: '1.9.12345678901234567890-custom-build',
        latest: '1.10.12345678901234567890-custom-build',
        scale: 2.2,
      );
      await tester.ensureVisible(find.text('Update Bridge on Device'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Update Bridge on Device'));
      await tester.pumpAndSettle();
      expect(find.text('Cancel').hitTestable(), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );
}
