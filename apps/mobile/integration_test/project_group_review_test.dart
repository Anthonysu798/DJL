import 'dart:convert';
import 'dart:io';
import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:djl_mobile/main.dart' as application;
import 'support/native_acceptance.dart';
import 'cloud_test.dart' show waitFor;
import 'threads_test.dart' show macs;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  // Navigator cancels the held pointer when the menu route opens. The live
  // test binding must deliver that queued device-source cancellation too.
  binding.shouldPropagateDevicePointerEvents = true;
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets(
    'native project reviews cancel without changing saved chats',
    (tester) async {
      application.main();
      await tester.pump();
      final desktop = await macs(tester);
      final pair = desktop.active;
      expect(pair, isNotNull, reason: 'Prepare the saved isolated QA fixture.');
      expect(pair!.macDeviceId.startsWith('desktop-qa-'), isTrue);
      final endpoint = nativeAcceptanceApi(
        pair.relay.replace(scheme: 'http', path: '').toString(),
      );
      Future<Map> state() async =>
          jsonDecode((await http.get(endpoint.replace(path: '/qa/state'))).body)
              as Map;
      Future<Map> host() async =>
          jsonDecode(
                (await http.get(
                  nativeAcceptanceDriverHost(isAndroid: Platform.isAndroid),
                )).body,
              )
              as Map;
      var attached = false;
      final deadline = DateTime.now().add(const Duration(seconds: 60));
      while (!attached && DateTime.now().isBefore(deadline)) {
        attached = (await host())['driverConnected'] == true;
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(attached, isTrue);
      await waitFor(tester, () => desktop.runtimeReady);
      final before = await state();
      final drafts = Map.of(desktop.threadList.data.drafts);
      final deleted = Set.of(desktop.threadList.data.deleted);
      final archiveOverrides = Map.of(desktop.threadList.data.archiveOverrides);
      await tester.ensureVisible(find.text('Projects'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Projects'));
      await tester.pumpAndSettle();
      final header = find.bySemanticsLabel(
        RegExp(r'^(Expand|Collapse) project workspace$'),
      );
      Future<void> menu() async {
        await tester.ensureVisible(header);
        await tester.pumpAndSettle();
        await waitFor(
          tester,
          () =>
              find.byType(CupertinoActionSheet).evaluate().isEmpty &&
              find.byType(CupertinoAlertDialog).evaluate().isEmpty &&
              ModalRoute.of(tester.element(header))?.isCurrent == true,
        );
        final began = DateTime.now();
        final center = tester.getCenter(
          header,
          warnIfMissed: true,
          callee: 'native project hold',
        );
        final hold = await tester.startGesture(center);
        try {
          await waitFor(
            tester,
            () => find.text('Archive Project').evaluate().isNotEmpty,
            timeout: const Duration(seconds: 5),
          );
        } finally {
          await hold.up();
        }
        debugPrint(
          'DJL_PROJECT_REVIEW_HOLD_MS=${DateTime.now().difference(began).inMilliseconds}',
        );
        await tester.pumpAndSettle();
        expect(find.text('Archive Project'), findsOneWidget);
        expect(find.text('Remove from Phone'), findsOneWidget);
      }

      await menu();
      await tester.tap(find.text('Archive Project'));
      await tester.pumpAndSettle();
      expect(find.byType(CupertinoActionSheet), findsOneWidget);
      expect(find.text('Archive "workspace"?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      await waitFor(
        tester,
        () => find.byType(CupertinoActionSheet).evaluate().isEmpty,
      );
      expect(desktop.threadList.data.archiveOverrides, archiveOverrides);
      await menu();
      await tester.tap(find.text('Remove from Phone'));
      await tester.pumpAndSettle();
      expect(find.byType(CupertinoAlertDialog), findsOneWidget);
      expect(find.text('Remove "workspace" from this phone?'), findsOneWidget);
      final removal = tester.widget<CupertinoDialogAction>(
        find.widgetWithText(CupertinoDialogAction, 'Remove from Phone'),
      );
      expect(removal.isDestructiveAction, isTrue);
      debugPrint('DJL_PROJECT_REVIEW_FRAME_READY');
      var captured = false;
      final captureDeadline = DateTime.now().add(const Duration(seconds: 60));
      while (!captured && DateTime.now().isBefore(captureDeadline)) {
        captured = (await host())['captured'] == true;
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(captured, isTrue);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(desktop.threadList.data.drafts, drafts);
      expect(desktop.threadList.data.deleted, deleted);
      expect(desktop.threadList.data.archiveOverrides, archiveOverrides);
      final after = await state();
      for (final key in [
        'archiveCount',
        'turnStartCount',
        'threadStartAttemptCount',
        'forkCount',
      ]) {
        expect(
          after[key],
          before[key],
          reason: 'Review/Cancel must not mutate $key.',
        );
      }
      expect(desktop.active?.macDeviceId, pair.macDeviceId);
      expect(tester.takeException(), isNull);
      debugPrint('DJL_PROJECT_REVIEW_FINISHED');
    },
    timeout: const Timeout(Duration(minutes: 5)),
  );
}
