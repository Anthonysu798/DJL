// Rendering/action-contract QA only. The injected executor and settings store
// are volatile; this target never starts DjlApp, opens credentials or connects
// a gateway, and never wakes, changes preferences or updates a real host.
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/host/presentation/host_controller.dart';
import 'package:djl_mobile/features/host/presentation/host_controls.dart';
import '../test/features/host/host_controller_test.dart'
    show HostStore, HostTransport;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.shouldPropagateDevicePointerEvents = true;
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets('native host controls with an isolated synthetic executor', (
    tester,
  ) async {
    final transport = HostTransport(), store = HostStore();
    transport.status.addAll({
      'status': 'not_authenticated',
      'authMethod': 'none',
      'tokenReady': false,
      'bridgeVersion': 'QA-1.0',
      'bridgeLatestVersion': 'QA-2.0',
    });
    var rejectRead = false;
    transport.handler = (method, params) async {
      switch (method) {
        case 'account/status/read':
          if (rejectRead) throw StateError('Synthetic host read failure');
          return Map.of(transport.status);
        case 'desktop/wakeDisplay':
        case 'desktop/preferences/update':
        case 'desktop/bridge/updateAndRestart':
          return {'success': true};
        default:
          throw StateError('Unexpected synthetic executor method: $method');
      }
    };
    final host = HostController(transport, store: store);
    final dark = ValueNotifier(false), scale = ValueNotifier(1.0);
    int calls(String method) =>
        transport.calls.where((call) => call.$1 == method).length;
    Future<void> tap(String label) async {
      await tester.ensureVisible(find.text(label));
      await tester.pumpAndSettle();
      await tester.tap(find.text(label));
      await tester.pumpAndSettle();
    }

    Future<void> capture(String name) async {
      expect(tester.takeException(), isNull);
      await binding.takeScreenshot('host-controls-native-$name');
    }

    try {
      host.bind(
        device: 'qa-injected-executor',
        session: 'qa-volatile-session-1',
        connected: true,
        trusted: true,
      );
      await host.loadPreference();
      await host.refresh();
      await host.syncPreference();
      await tester.pumpWidget(
        ValueListenableBuilder<bool>(
          valueListenable: dark,
          builder: (_, isDark, _) => MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: djlTheme(Brightness.light),
            darkTheme: djlTheme(Brightness.dark),
            themeMode: isDark ? ThemeMode.dark : ThemeMode.light,
            builder: (context, child) => ValueListenableBuilder<double>(
              valueListenable: scale,
              builder: (_, value, _) => Banner(
                message: 'QA ONLY',
                location: BannerLocation.topEnd,
                child: MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(textScaler: TextScaler.linear(value)),
                  child: child!,
                ),
              ),
            ),
            home: HostPage(controller: host),
          ),
        ),
      );
      await tester.pumpAndSettle();
      if (Platform.isAndroid) {
        await binding.convertFlutterSurfaceToImage();
        await tester.pumpAndSettle();
      }
      await capture('status');
      await tap('Wake display');
      expect(calls('desktop/wakeDisplay'), 1);
      expect(host.actionMessage, contains('confirmed'));
      await tap('Keep device reachable');
      expect(store.values[HostController.keepAwakeKey], true);
      expect(host.preferenceSynced, isTrue);
      await capture('preference');

      await tap('Update bridge');
      expect(calls('desktop/bridge/updateAndRestart'), 0);
      await capture('update-review');
      await tap('Cancel');
      expect(calls('desktop/bridge/updateAndRestart'), 0);
      await tap('Update bridge');
      await tap('Update and restart');
      expect(calls('desktop/bridge/updateAndRestart'), 1);
      expect(host.updateState, HostUpdateState.reconnecting);
      await capture('waiting');

      // Only the injected controller changes connection state. No real pairing
      // or network connection is read, disconnected, replaced or reconnected.
      host.bind(
        device: 'qa-injected-executor',
        session: null,
        connected: false,
        trusted: true,
      );
      host.bind(
        device: 'qa-injected-executor',
        session: 'qa-volatile-session-2',
        connected: true,
        trusted: true,
      );
      transport.status['bridgeVersion'] = 'QA-2.0';
      await host.refresh();
      await tester.pumpAndSettle();
      expect(host.updateState, HostUpdateState.verified);
      await capture('verified');

      rejectRead = true;
      await tap('Refresh host status');
      expect(host.stale, isTrue);
      expect(find.textContaining('Could not refresh'), findsOneWidget);
      await capture('read-failure');
      rejectRead = false;
      await tap('Refresh host status');
      expect(host.statusError, isNull);
      expect(calls('desktop/wakeDisplay'), 1);
      expect(calls('desktop/bridge/updateAndRestart'), 1);
      await tap('Keep device reachable');
      expect(store.values[HostController.keepAwakeKey], false);
      expect(host.preferenceSynced, isTrue);

      dark.value = true;
      scale.value = 2.2;
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Update bridge'));
      await capture('dark-large-text');
      await tap('Update bridge');
      await capture('dark-large-review');
      await tap('Cancel');
      expect(calls('desktop/bridge/updateAndRestart'), 1);
      debugPrint(
        'DJL_HOST_UI_QA_FINISHED injected executor only; no real host actions',
      );
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      host.dispose();
      await transport.dispose();
      dark.dispose();
      scale.dispose();
    }
  });
}
