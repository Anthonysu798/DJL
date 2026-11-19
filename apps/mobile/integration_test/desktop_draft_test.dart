import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_composer_widgets.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/workspace/presentation/project_picker_page.dart';
import 'threads_test.dart'
    show macs, securePairingEntry, reveal, type, projectDraftPicker;
import 'composer_test.dart' show hostFrame;
import 'support/native_acceptance.dart';
import 'support/native_app_ready.dart';
import 'support/native_draft_acceptance.dart';
import 'support/native_draft_interactions.dart';

const _frameworkBack = bool.fromEnvironment('DJL_QA_DRAFT_FRAMEWORK_BACK');
const _retainVerifiedPairing = bool.fromEnvironment(
  'DJL_QA_DRAFT_RETAIN_VERIFIED_PAIRING',
);
const _cwd = String.fromEnvironment('DJL_QA_DESKTOP_CWD');

// Bounded pumping works while the actual starting-run spinner is animating.
Future<void> _until(WidgetTester tester, bool Function() ready) async {
  final deadline = DateTime.now().add(const Duration(seconds: 45));
  while (!ready() && DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 200));
  }
  expect(ready(), isTrue, reason: 'Draft native checkpoint did not arrive.');
  await tester.pump();
}

Future<void> _gatewayUntil(
  WidgetTester tester,
  bool Function(Map<String, dynamic>) ready,
  ConversationRequestRecorder recorder,
) async {
  final deadline = DateTime.now().add(const Duration(seconds: 45));
  var snapshot = await nativeDraftSnapshot(recorder.totalRequestAttempts);
  while (!ready(snapshot.state) && DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 200));
    snapshot = await nativeDraftSnapshot(recorder.totalRequestAttempts);
  }
  expect(ready(snapshot.state), isTrue);
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.shouldPropagateDevicePointerEvents = true;
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets(
    'real local draft entry cancellation and first Send',
    (tester) async {
      expect(_cwd, isNotEmpty);
      final recorder = ConversationRequestRecorder(http.Client());
      final cloud = CloudClient(
        baseUrl: nativeAcceptanceApi(
          const String.fromEnvironment('DJL_CLOUD_API_URL'),
        ),
        credentials: PlatformCredentialStore(),
        client: recorder,
      );
      runApp(DjlApp(client: cloud));
      await tester.pump();
      debugPrint('DJL_DRAFT_APP_MOUNTED');
      await hostFrame(tester, 'driverConnected');
      await waitForNativeAppReady(tester, 'DJL_DRAFT');
      final desktop = await macs(tester);
      final expected =
          jsonDecode(
                utf8.decode(
                  base64Decode(
                    const String.fromEnvironment('DJL_QA_PAIRING_BASE64'),
                  ),
                ),
              )
              as Map;
      final response = await http.get(
        Uri.parse('http://127.0.0.1:8852/qa/pairing'),
      );
      expect(response.statusCode, 200);
      final fresh = jsonDecode(response.body) as Map;
      expect(fresh['macDeviceId'], expected['macDeviceId']);
      expect(fresh['macIdentityPublicKey'], expected['macIdentityPublicKey']);
      for (final pair in List.of(desktop.trusted)) {
        if (pair.macDeviceId == expected['macDeviceId']) {
          await desktop.forget(pair);
        }
      }
      expect(await securePairingEntry(tester), same(desktop));
      await type(
        tester,
        find.byKey(const Key('pairing_payload')),
        jsonEncode(fresh),
      );
      await reveal(tester, find.text('Pair securely'));
      await tester.tap(find.text('Pair securely'));
      await _until(
        tester,
        () => desktop.runtimeReady && desktop.models.isNotEmpty,
      );
      await tester.pump(const Duration(milliseconds: 400));
      expect(desktop.active?.macDeviceId, expected['macDeviceId']);
      expect(desktop.active?.publicKey, expected['macIdentityPublicKey']);
      final cloudBaseline = recorder.totalRequestAttempts;
      Future<NativeDraftSnapshot> snapshot() =>
          nativeDraftSnapshot(recorder.totalRequestAttempts);
      Set<String> history() =>
          desktop.threads.map((t) => t['id'] as String).toSet();
      final page = find.byType(DesktopChatPage);
      final field = find.byKey(const Key('desktop_composer'));
      final scrim = find.byKey(const Key('navigation.scrim'));
      Future<void> openPanel() async {
        await tester.tap(find.byTooltip('Open navigation'));
        await _until(tester, () => scrim.evaluate().isNotEmpty);
        await tester.pump(const Duration(milliseconds: 400));
      }

      Future<void> remote() async {
        await openPanel();
        await reveal(tester, find.text('Remote'));
        await tester.tap(find.text('Remote'));
        await _until(tester, () => page.evaluate().isEmpty);
        await tester.pump(const Duration(milliseconds: 400));
      }

      DesktopNewChatDraft owner({required bool project}) {
        expect(page, findsOneWidget);
        expect(desktop.thread, isNull);
        final value = desktop.newChatDraft!;
        expect(desktop.isCurrentNewChatDraft(value), isTrue);
        expect(
          value.source,
          project
              ? DesktopDraftSource.folderChat
              : DesktopDraftSource.generalChat,
        );
        expect(value.cwd, project ? _cwd : null);
        expect(history(), isNot(contains(value.id)));
        return value;
      }

      Future<DesktopNewChatDraft> rootless() async {
        await reveal(tester, find.text('Studio'));
        await tester.tap(find.text('Studio'));
        await tester.pumpAndSettle();
        await reveal(tester, find.bySemanticsLabel('New chat'));
        await tester.tap(find.bySemanticsLabel('New chat'));
        await _until(tester, () => page.evaluate().isNotEmpty);
        await tester.pump(const Duration(milliseconds: 400));
        return owner(project: false);
      }

      Future<DesktopNewChatDraft> project() async {
        final before = await snapshot();
        await projectDraftPicker(tester, _cwd);
        await _until(
          tester,
          () =>
              find.byType(ProjectPickerPage).evaluate().isNotEmpty &&
              find.text(_cwd).evaluate().isNotEmpty &&
              find.byType(LinearProgressIndicator).evaluate().isEmpty,
        );
        await tester.pump(const Duration(milliseconds: 400));
        before.expectPicker(await snapshot());
        expect(find.text(_cwd), findsOneWidget);
        final picker = await snapshot();
        await tester.tap(find.text('Use'));
        await _until(tester, () => page.evaluate().isNotEmpty);
        await tester.pump(const Duration(milliseconds: 400));
        final value = owner(project: true);
        picker.expectQuiet(await snapshot());
        return value;
      }

      Future<void> exitDraft(String checkpoint) async {
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pump(const Duration(milliseconds: 400));
        if (_frameworkBack) {
          debugPrint('DJL_DRAFT_FRAMEWORK_ROUTE_BACK_$checkpoint');
          await binding.handlePopRoute();
        } else if (Platform.isAndroid) {
          // Root performs actual adb/device OS Back after this safe marker.
          debugPrint('DJL_DRAFT_NATIVE_ROUTE_BACK_${checkpoint}_READY');
        } else {
          // iOS has no hardware Back; the real drawer Remote action owns exit.
          await remote();
        }
        await _until(tester, () => page.evaluate().isEmpty);
        await tester.pump(const Duration(milliseconds: 400));
      }

      Future<void> send(String text) async {
        await type(tester, field, text);
        await tester.tap(find.byTooltip('Send to desktop'));
        await tester.pump(const Duration(milliseconds: 200));
      }

      Future<void> promotion(
        NativeDraftSnapshot before,
        DesktopNewChatDraft local,
        String text, {
        required bool project,
      }) async {
        await _until(
          tester,
          () =>
              desktop.thread != null &&
              !desktop.busy &&
              desktop.turnId == null &&
              desktop.timeline.any(
                (item) =>
                    item['type'] == 'agentMessage' &&
                    (item['text'] as String? ?? '').contains(text),
              ),
        );
        await tester.pump(const Duration(milliseconds: 400));
        final id = desktop.thread!['id'] as String;
        expect(id, isNotEmpty);
        expect(id, isNot(local.id));
        if (project) expect(desktop.thread!['cwd'], _cwd);
        before.expectPromotion(await snapshot(), thread: id, project: project);
        expect(desktop.newChatDraft, isNull);
        expect(
          desktop.threadList.data.composerDrafts.containsKey(local.storageKey),
          isFalse,
        );
        expect(
          desktop.threadList.data.drafts.containsKey(local.storageKey),
          isFalse,
        );
        expect(desktop.threads.where((row) => row['id'] == id), hasLength(1));
        expect(
          desktop.timeline.where((item) => item['type'] == 'userMessage'),
          hasLength(1),
        );
        expect(
          desktop.timeline.where(
            (item) =>
                item['type'] == 'agentMessage' &&
                (item['text'] as String? ?? '').contains(text),
          ),
          hasLength(1),
        );
      }

      final initial = await snapshot(), initialHistory = history();
      final canceled = await rootless();
      await verifyNativeDraftInitialComposer(tester);
      expect(desktop.newChatDraft, same(canceled));
      expect(desktop.isCurrentNewChatDraft(canceled), isTrue);
      expect(desktop.thread, isNull);
      expect(history(), initialHistory);
      initial.expectQuiet(await snapshot());
      await type(tester, field, 'Disposable rootless draft');
      final pageState = tester.state(page);
      final composer = tester
          .widget<DesktopComposerAttachments>(
            find.byType(DesktopComposerAttachments),
          )
          .controller;
      final input = tester.widget<TextField>(field).controller;
      await tester.tap(field);
      await tester.pump(const Duration(milliseconds: 400));
      await tester.tap(find.byKey(const Key('composer.access')));
      await tester.pump(const Duration(milliseconds: 400));
      final desired = desktop.access == 'on-request'
          ? 'Approve for me'
          : 'Ask for approval';
      await tester.tap(find.text(desired).last);
      await tester.pump(const Duration(milliseconds: 400));
      expect(
        desktop.access,
        desired == 'Ask for approval' ? 'on-request' : 'auto-review',
      );
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pump(const Duration(milliseconds: 400));
      await openPanel();
      await openNativeDraftSearch(tester);
      await type(
        tester,
        find.byKey(const Key('navigation.search')),
        'draft-local-search',
      );
      await tester.tap(find.byTooltip('Settings'));
      await _until(tester, () => find.text('Done').evaluate().isNotEmpty);
      await tester.tap(find.text('Done'));
      await tester.pump(const Duration(milliseconds: 400));
      expect(desktop.newChatDraft, same(canceled));
      expect(tester.state(page), same(pageState));
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pump(const Duration(milliseconds: 400));
      if (_frameworkBack) {
        debugPrint('DJL_DRAFT_FRAMEWORK_PANEL_BACK');
        await binding.handlePopRoute();
      } else if (Platform.isAndroid) {
        debugPrint('DJL_DRAFT_NATIVE_PANEL_BACK_READY');
      } else {
        debugPrint('DJL_DRAFT_IOS_PANEL_CLOSE');
        await tapNativeDraftPanelScrim(tester);
      }
      await _until(tester, () => scrim.evaluate().isEmpty);
      await tester.pump(const Duration(milliseconds: 400));
      expect(desktop.newChatDraft, same(canceled));
      expect(tester.state(page), same(pageState));
      expect(
        tester
            .widget<DesktopComposerAttachments>(
              find.byType(DesktopComposerAttachments),
            )
            .controller,
        same(composer),
      );
      expect(tester.widget<TextField>(field).controller, same(input));
      expect(input!.text, 'Disposable rootless draft');
      initial.expectQuiet(await snapshot());
      expect(history(), initialHistory);
      await exitDraft('ROOTLESS');
      expect(desktop.isCurrentNewChatDraft(canceled), isFalse);
      expect(desktop.thread, isNull);
      initial.expectQuiet(await snapshot());

      final projectBefore = await snapshot(), projectHistory = history();
      final folderCanceled = await project();
      final projectQuiet = await snapshot();
      await type(tester, field, 'Disposable project draft');
      expect(desktop.newChatDraft, same(folderCanceled));
      expect(folderCanceled.cwd, _cwd);
      await exitDraft('PROJECT');
      expect(desktop.isCurrentNewChatDraft(folderCanceled), isFalse);
      expect(desktop.thread, isNull);
      expect(history(), projectHistory);
      projectQuiet.expectQuiet(await snapshot());
      projectBefore.expectPicker(await snapshot());

      final rootBefore = await snapshot(), rootHistory = history();
      final root = await rootless();
      expect(root.id, isNot(canceled.id));
      expect(root.id, isNot(folderCanceled.id));
      rootBefore.expectQuiet(await snapshot());
      final rootText =
          '[echo] draft root ${DateTime.now().microsecondsSinceEpoch}';
      await send(rootText);
      await promotion(rootBefore, root, rootText, project: false);
      expect(history().difference(rootHistory), {desktop.thread!['id']});
      await remote();

      final folder = await project();
      final folderBefore = await snapshot(), folderHistory = history();
      final folderText =
          '[echo] draft project ${DateTime.now().microsecondsSinceEpoch}';
      await send(folderText);
      await promotion(folderBefore, folder, folderText, project: true);
      expect(history().difference(folderHistory), {desktop.thread!['id']});
      await remote();

      // Accepted footer Chat must also create a fresh rootless owner.
      await rootless();
      final footerBefore = await snapshot();
      final footerOld = desktop.newChatDraft!;
      await openPanel();
      final footerOldState = tester.state(page);
      await tapNativeDraftFooterChat(tester);
      await waitForNativeDraftReplacement(
        tester,
        oldState: footerOldState,
        desktop: desktop,
      );
      final heldOwner = owner(project: false);
      expect(tester.widget<DesktopChatPage>(page).draft, same(heldOwner));
      expect(heldOwner.id, isNot(footerOld.id));
      expect(desktop.isCurrentNewChatDraft(footerOld), isFalse);
      footerBefore.expectQuiet(await snapshot());
      await nativeDraftStartBarrier('arm');
      final heldBefore = await snapshot();
      await send('[echo] canceled late reply');
      await _gatewayUntil(
        tester,
        (s) => s['threadStartReplyPending'] == true,
        recorder,
      );
      expect(
        (await snapshot()).count('threadStartAttemptCount'),
        heldBefore.count('threadStartAttemptCount') + 1,
      );
      await exitDraft('HELD_START');
      expect(desktop.isCurrentNewChatDraft(heldOwner), isFalse);
      // The shipping busy guard prevents a newer owner until this reply returns.
      expect(page, findsNothing);
      expect(desktop.thread, isNull);
      await nativeDraftStartBarrier('release');
      await _gatewayUntil(
        tester,
        (s) => s['threadStartReplyPending'] == false,
        recorder,
      );
      await _until(tester, () => !desktop.busy);
      await tester.pump(const Duration(milliseconds: 400));
      expect(page, findsNothing);
      expect(desktop.thread, isNull);
      final released = await snapshot();
      expect(
        released.count('threadCount'),
        heldBefore.count('threadCount') + 1,
      );
      expect(
        released.count('threadStartAttemptCount'),
        heldBefore.count('threadStartAttemptCount') + 1,
      );
      expect(
        released.count('turnStartCount'),
        heldBefore.count('turnStartCount'),
      );
      expect(released.count('turnCount'), heldBefore.count('turnCount'));
      expect(
        heldBefore
            .methodsSince(released)
            .where((m) => m == 'turn/start' || m == 'turn/steer'),
        isEmpty,
      );
      final freshBefore = await snapshot();
      final newer = await rootless();
      expect(newer.id, isNot(heldOwner.id));
      await type(tester, field, 'Newer route must remain unsent');
      expect(desktop.newChatDraft, same(newer));
      expect(
        tester.widget<TextField>(field).controller!.text,
        'Newer route must remain unsent',
      );
      expect(desktop.thread, isNull);
      freshBefore.expectQuiet(await snapshot());
      expect(recorder.totalRequestAttempts, cloudBaseline);
      debugPrint('DJL_DRAFT_FRAME_READY');
      await hostFrame(tester, 'captured', timeout: const Duration(seconds: 30));
      expect(tester.takeException(), isNull);
      await remote();
      if (_retainVerifiedPairing) {
        final handoffBefore = await snapshot();
        expect(desktop.connected && desktop.runtimeReady, isTrue);
        expect(desktop.active?.macDeviceId == fresh['macDeviceId'], isTrue);
        expect(
          desktop.active?.publicKey == fresh['macIdentityPublicKey'],
          isTrue,
        );
        expect(desktop.transport.macDeviceId == fresh['macDeviceId'], isTrue);
        expect(desktop.thread == null, isTrue);
        expect(desktop.newChatDraft == null, isTrue);
        expect(desktop.busy, isFalse);
        expect(desktop.turnId == null, isTrue);
        expect(handoffBefore.state['threadStartReplyPending'] == false, isTrue);
        final trustedBefore = await desktop.pairings.trusted();
        final matchingBefore = trustedBefore.where(
          (pair) => pair.macDeviceId == fresh['macDeviceId'],
        );
        expect(matchingBefore.length == 1, isTrue);
        expect(
          matchingBefore.single.publicKey == fresh['macIdentityPublicKey'],
          isTrue,
        );
        final recordsBefore = await desktop.pairings.credentials.read(
          'desktop.trusted',
        );
        final activeBefore = await desktop.pairings.credentials.read(
          'desktop.active',
        );
        expect(activeBefore == fresh['macDeviceId'], isTrue);
        await desktop.disconnect();
        await desktop.threadList.store.flush();
        await tester.pump(const Duration(milliseconds: 400));
        expect(desktop.connected, isFalse);
        expect(desktop.thread == null, isTrue);
        expect(desktop.newChatDraft == null, isTrue);
        expect(desktop.busy, isFalse);
        expect(desktop.turnId == null, isTrue);
        final trustedAfter = await desktop.pairings.trusted();
        final matchingAfter = trustedAfter.where(
          (pair) => pair.macDeviceId == fresh['macDeviceId'],
        );
        expect(matchingAfter.length == 1, isTrue);
        expect(
          matchingAfter.single.publicKey == fresh['macIdentityPublicKey'],
          isTrue,
        );
        expect(
          await desktop.pairings.credentials.read('desktop.trusted') ==
              recordsBefore,
          isTrue,
        );
        expect(
          await desktop.pairings.credentials.read('desktop.active') ==
              activeBefore,
          isTrue,
        );
        final handoffAfter = await snapshot();
        expect(handoffAfter.state['threadStartReplyPending'] == false, isTrue);
        handoffBefore.expectQuiet(handoffAfter);
      } else {
        await desktop.forget(desktop.active!);
      }
      expect(tester.takeException(), isNull);
      if (_retainVerifiedPairing) {
        debugPrint('DJL_DRAFT_VERIFIED_PAIRING_RETAINED');
      }
      debugPrint('DJL_DRAFT_FINISHED');
    },
    timeout: const Timeout(Duration(minutes: 6)),
  );
}
