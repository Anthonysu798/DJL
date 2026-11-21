import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:djl_mobile/main.dart' as application;
import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_overview.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';

// Retained QA devices: manually install a verified same-signer update, then use
// flutter drive --use-existing-app=<VM URI> --keep-app-running. Driver cleanup
// for a directly launched application binary uninstalls it and deletes its data.
Future<void> until(
  WidgetTester tester,
  bool Function() ready, {
  int seconds = 60,
}) async {
  final deadline = DateTime.now().add(Duration(seconds: seconds));
  while (!ready() && DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  expect(ready(), isTrue, reason: 'Real desktop checkpoint did not arrive.');
  await tester.pump();
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  const enabled = bool.fromEnvironment('DJL_REAL_DESKTOP_QA');
  testWidgets(
    'real desktop saved pairing, Stop and active-turn steering',
    (tester) async {
      const expectedMac = String.fromEnvironment('DJL_QA_EXPECTED_MAC_ID');
      const expectedKey = String.fromEnvironment(
        'DJL_QA_EXPECTED_DESKTOP_PUBLIC_KEY',
      );
      expect(expectedMac.isNotEmpty && expectedKey.isNotEmpty, isTrue);
      final credentials = PlatformCredentialStore();
      final activeId = await credentials.read('desktop.active');
      final trusted = await PairingRepository(
        credentials,
        allowLocal: true,
      ).trusted();
      expect(
        trusted.any(
          (p) =>
              p.macDeviceId == activeId &&
              p.macDeviceId == expectedMac &&
              p.publicKey == expectedKey &&
              {'127.0.0.1', '10.0.2.2', 'localhost'}.contains(p.relay.host) &&
              p.relay.port == 8898,
        ),
        isTrue,
        reason:
            'Only the approved saved local desktop QA pairing may run this test.',
      );
      application.main();
      await tester.pump();
      if (Platform.isAndroid) await binding.convertFlutterSurfaceToImage();
      await until(
        tester,
        () => find.byType(DesktopOverview).evaluate().isNotEmpty,
      );
      final desktop = tester
          .widget<DesktopOverview>(find.byType(DesktopOverview))
          .desktop;
      await until(tester, () => desktop.runtimeReady);
      expect(
        desktop.active?.macDeviceId == expectedMac &&
            desktop.active?.publicKey == expectedKey,
        isTrue,
      );
      await tester.tap(find.byTooltip('New chat').hitTestable());
      await until(
        tester,
        () => find.byType(DesktopChatPage).evaluate().isNotEmpty,
      );
      expect(
        tester.widget<DesktopChatPage>(find.byType(DesktopChatPage)).controller,
        same(desktop),
      );
      expect(desktop.selectedModel?['djlProvider'], 'codex');
      final tag =
          'DJL_REAL174_${Platform.operatingSystem}_${DateTime.now().millisecondsSinceEpoch}';
      debugPrint('DJL_REAL_QA_RUN=$tag');
      final field = find.byKey(const Key('desktop_composer'));
      await tester.enterText(
        field,
        '${tag}_STOP. Start STOP174_PARTIAL, then write 80 numbered desk tips. No tools or file changes.',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop').hitTestable());
      await until(
        tester,
        () =>
            desktop.turnId != null &&
            desktop.timeline.any(
              (r) =>
                  r['type'] == 'agentMessage' &&
                  r['turnId'] == desktop.turnId &&
                  desktopItemText(r).length > 20,
            ),
      );
      final threadId = desktop.thread!['id'] as String;
      final stopTurn = desktop.turnId!;
      debugPrint('DJL_REAL_QA_STOP_THREAD=$threadId TURN=$stopTurn');
      expect(find.byTooltip('Stop turn').hitTestable(), findsOneWidget);
      await binding.takeScreenshot('real-desktop174-before-stop');
      await tester.tap(find.byTooltip('Stop turn').hitTestable());
      await until(
        tester,
        () => desktop.turnId == null && !desktop.stoppingTurn,
      );
      await until(
        tester,
        () => tester.widget<TextField>(field).controller!.text.isEmpty,
      );
      await binding.takeScreenshot('real-desktop174-stopped');
      await tester.enterText(
        field,
        '${tag}_STEER_START. Start STEER174_PARTIAL, then write 100 numbered desk tips. No tools or file changes.',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop').hitTestable());
      await until(
        tester,
        () =>
            desktop.turnId != null &&
            desktop.timeline.any(
              (r) =>
                  r['type'] == 'agentMessage' &&
                  r['turnId'] == desktop.turnId &&
                  desktopItemText(r).length >= 1200,
            ),
      );
      final steerTurn = desktop.turnId!;
      debugPrint('DJL_REAL_QA_STEER_THREAD=$threadId TURN=$steerTurn');
      final response = 'STEER174_OK_${Platform.operatingSystem}';
      await tester.enterText(
        field,
        '${tag}_STEER. Stop the list and reply exactly $response.',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop').hitTestable());
      await until(tester, () => desktop.queuedDrafts.length == 1);
      await tester.tap(find.byTooltip('Open navigation').hitTestable());
      await tester.pump(const Duration(milliseconds: 550));
      final visibleScrim = tester
          .getRect(find.byKey(const Key('navigation.scrim')))
          .intersect(
            Offset.zero &
                (tester.view.physicalSize / tester.view.devicePixelRatio),
          );
      expect(visibleScrim.isEmpty, isFalse);
      await tester.tapAt(visibleScrim.center);
      await tester.pump(const Duration(milliseconds: 550));
      expect(find.byTooltip('Queued messages').hitTestable(), findsOneWidget);
      await tester.tap(find.byTooltip('Queued messages').hitTestable());
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Steer').hitTestable(), findsOneWidget);
      await tester.tap(find.text('Steer').hitTestable());
      await until(tester, () => desktop.queuedDrafts.isEmpty);
      await until(
        tester,
        () =>
            desktop.turnId == null &&
            desktop.timeline.any(
              (r) =>
                  r['type'] == 'agentMessage' &&
                  r['turnId'] == steerTurn &&
                  desktopItemText(r).contains(response),
            ),
        seconds: 120,
      );
      await binding.takeScreenshot('real-desktop174-steered');
      binding.reportData = {
        ...?binding.reportData,
        'runTag': tag,
        'threadId': threadId,
        'stopTurnId': stopTurn,
        'steerTurnId': steerTurn,
        'model': desktop.selectedModel?['model'],
        'provider': 'real-desktop-codex',
        'input': 'instrumented Flutter UI over normal app main',
      };
      expect(tester.takeException(), isNull);
    },
    skip: !enabled,
    timeout: const Timeout(Duration(minutes: 6)),
  );
}
