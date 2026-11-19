import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_svg/flutter_svg.dart';
import 'package:djl_mobile/main.dart' as application;
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/workspace/data/workspace_repository.dart';
import 'package:djl_mobile/features/workspace/presentation/project_picker_page.dart';
import 'package:djl_mobile/features/workspace/presentation/workspace_file_page.dart';
import 'package:djl_mobile/features/workspace/presentation/checkpoint_page.dart';
import 'cloud_test.dart' show waitFor;
import 'threads_test.dart'
    show securePairingEntry, reveal, macs, projectDraftPicker;

class _LifecycleTrace with WidgetsBindingObserver {
  final states = <AppLifecycleState>[];
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    states.add(state);
    debugPrint('DJL_DESKTOP_LIFECYCLE_${state.name}');
  }
}

Future<void> menu(WidgetTester tester, String label) async {
  await tester.tap(find.byTooltip('Workspace tools'));
  await tester.pumpAndSettle();
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets(
    'native encrypted desktop approval, project, files, checkpoint restore and recovery',
    (tester) async {
      final lifecycle = _LifecycleTrace();
      WidgetsBinding.instance.addObserver(lifecycle);
      addTearDown(() => WidgetsBinding.instance.removeObserver(lifecycle));
      application.main();
      await tester.pump();
      debugPrint('DJL_DESKTOP_APP_MOUNTED');
      if (Platform.isAndroid) {
        await binding.convertFlutterSurfaceToImage();
      }
      const syncUrl = String.fromEnvironment('DJL_QA_NATIVE_SYNC_URL');
      if (syncUrl.isNotEmpty) {
        var ready = false;
        final deadline = DateTime.now().add(const Duration(seconds: 45));
        while (!ready && DateTime.now().isBefore(deadline)) {
          ready =
              (jsonDecode((await http.get(Uri.parse(syncUrl))).body)
                  as Map)['driverConnected'] ==
              true;
          await tester.pump(const Duration(milliseconds: 200));
        }
        expect(
          ready,
          isTrue,
          reason: 'Attach the host driver before running the native journey.',
        );
        debugPrint('DJL_DESKTOP_DRIVER_READY');
      }
      final expectedPair =
          jsonDecode(
                utf8.decode(
                  base64Decode(
                    const String.fromEnvironment('DJL_QA_PAIRING_BASE64'),
                  ),
                ),
              )
              as Map<String, dynamic>;
      final freshPair =
          jsonDecode(
                (await http.get(
                  Uri.parse('http://127.0.0.1:8852/qa/pairing'),
                )).body,
              )
              as Map<String, dynamic>;
      expect(freshPair['macDeviceId'], expectedPair['macDeviceId']);
      expect(
        freshPair['macIdentityPublicKey'],
        expectedPair['macIdentityPublicKey'],
      );
      final payload = jsonEncode(freshPair);
      const cwd = String.fromEnvironment('DJL_QA_DESKTOP_CWD');
      expect(cwd, isNotEmpty);
      final desktop = await macs(tester);
      await desktop.restore();
      for (final pair in List.of(desktop.trusted)) {
        if (pair.macDeviceId == expectedPair['macDeviceId']) {
          await desktop.forget(pair);
        }
      }
      await tester.pumpAndSettle();
      expect(await securePairingEntry(tester), same(desktop));
      await reveal(tester, find.byKey(const Key('pairing_payload')));
      await tester.enterText(find.byKey(const Key('pairing_payload')), payload);
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await reveal(tester, find.text('Pair securely'));
      await tester.tap(find.text('Pair securely'));
      await waitFor(
        tester,
        () => desktop.connected && !desktop.busy && desktop.models.isNotEmpty,
      );
      await projectDraftPicker(tester, cwd);
      await waitFor(
        tester,
        () =>
            find.byType(ProjectPickerPage).evaluate().isNotEmpty &&
            find.text(cwd).evaluate().isNotEmpty,
      );
      await binding.takeScreenshot('desktop-project-picker');
      await tester.tap(find.text('Use'));
      await waitFor(
        tester,
        () =>
            find.byType(DesktopChatPage).evaluate().isNotEmpty &&
            desktop.newChatDraft?.cwd == cwd &&
            desktop.thread == null,
      );
      expect(desktop.newChatDraft?.source.name, 'folderChat');
      await tester.tap(find.byKey(const Key('desktop_composer')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Native approval acceptance ${Platform.operatingSystem}',
      );
      await tester.pumpAndSettle();
      await binding.takeScreenshot('desktop-composer-keyboard');
      debugPrint('DJL_DESKTOP_KEYBOARD_READY');
      if (syncUrl.isEmpty) {
        await Future<void>.delayed(const Duration(seconds: 4));
      } else {
        var captured = false;
        final deadline = DateTime.now().add(const Duration(seconds: 45));
        while (!captured && DateTime.now().isBefore(deadline)) {
          final response = await http.get(Uri.parse(syncUrl));
          captured =
              (jsonDecode(response.body) as Map)['keyboardCaptured'] == true;
          await tester.pump(const Duration(milliseconds: 200));
        }
        expect(
          captured,
          isTrue,
          reason:
              'The host must capture the native keyboard before the test hides it.',
        );
      }
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Send to desktop'));
      await waitFor(tester, () => desktop.pendingApprovals.isNotEmpty);
      expect(desktop.thread?['cwd'], cwd);
      expect(
        desktop.thread?['id'],
        isA<String>().having((id) => id.isNotEmpty, 'nonempty', true),
      );
      final repository = WorkspaceRepository(
        desktop.transport,
        cwd: cwd,
        threadId: desktop.thread!['id'] as String,
      );

      expect(
        desktop.timeline.where((item) => item['type'] == 'userMessage'),
        hasLength(1),
      );
      await binding.takeScreenshot('desktop-approval');
      await reveal(tester, find.text('Approve once'));
      await tester.tap(find.text('Approve once'));
      await waitFor(tester, () => desktop.pendingUserInputs.isNotEmpty);
      await reveal(tester, find.text('Continue'));
      await tester.tap(find.text('Continue'));
      await tester.pump();
      final secret = find.byWidgetPredicate(
        (w) => w is TextField && w.obscureText,
      );
      await reveal(tester, secret);
      await tester.enterText(secret, 'disposable-native-test');
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await binding.takeScreenshot('desktop-structured-input');
      await reveal(tester, find.text('Send answers'));
      await tester.tap(find.text('Send answers'));
      await waitFor(
        tester,
        () =>
            desktop.turnId == null &&
            desktop.timeline.any(
              (item) =>
                  item['text']?.toString().contains(
                    'Approved workflow complete',
                  ) ==
                  true,
            ),
      );
      expect(
        desktop.timeline.where((i) => i['type'] == 'userMessage'),
        hasLength(1),
      );
      await binding.takeScreenshot('desktop-approved-complete');
      expect(
        (await repository.readTextFile('hello.txt')).content,
        contains('native-fixture-change'),
      );
      await menu(tester, 'Workspace files');
      expect(find.byType(WorkspaceFilePage), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('workspace_file_path')),
        'hello.txt',
      );
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open'));
      await waitFor(
        tester,
        () => find
            .byWidgetPredicate(
              (w) =>
                  w is SelectableText &&
                  w.data?.contains('native-fixture-change') == true,
            )
            .evaluate()
            .isNotEmpty,
      );
      await binding.takeScreenshot('desktop-workspace-text');
      await tester.tap(find.text('Image'));
      await tester.pump();
      await tester.tap(find.byKey(const Key('workspace_file_path')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('workspace_file_path')),
        'preview.svg',
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('workspace_file_path')))
            .controller!
            .text,
        'preview.svg',
      );
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open'));
      await waitFor(
        tester,
        () => find.byType(SvgPicture).evaluate().isNotEmpty,
      );
      await binding.takeScreenshot('desktop-workspace-svg');
      await tester.pageBack();
      await tester.pumpAndSettle();
      await menu(tester, 'Turn changes and restore');
      expect(find.byType(CheckpointPage), findsOneWidget);
      await waitFor(
        tester,
        () => find
            .byWidgetPredicate(
              (w) =>
                  w is SelectableText &&
                  w.data?.contains('+native-fixture-change') == true,
            )
            .evaluate()
            .isNotEmpty,
      );
      await tester.tap(find.text('Preview restore before this turn'));
      await tester.pumpAndSettle();
      await waitFor(
        tester,
        () => find.text('Restore files').evaluate().isNotEmpty,
      );
      await binding.takeScreenshot('desktop-restore-preview');
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(
        (await repository.readTextFile('hello.txt')).content,
        contains('native-fixture-change'),
      );
      await tester.tap(find.text('Preview restore before this turn'));
      await tester.pumpAndSettle();
      await waitFor(
        tester,
        () => find.text('Restore files').evaluate().isNotEmpty,
      );
      await tester.tap(find.text('Restore files'));
      await waitFor(
        tester,
        () => find.textContaining('Restored ').evaluate().isNotEmpty,
      );
      expect(
        (await repository.readTextFile('hello.txt')).content,
        'native-baseline\n',
      );
      await tester.pageBack();
      await tester.pumpAndSettle();
      await http.post(Uri.parse('http://127.0.0.1:8852/qa/drop'));
      await waitFor(tester, () => !desktop.connected);
      await waitFor(tester, () => desktop.connected && !desktop.busy);
      expect(
        desktop.timeline.where((i) => i['type'] == 'userMessage'),
        hasLength(1),
      );
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        '[hold] Verify interrupted stream recovery',
      );
      await tester.tap(find.byTooltip('Send to desktop'));
      await waitFor(tester, () => desktop.turnId != null);
      final before =
          jsonDecode(
                (await http.get(
                  Uri.parse('http://127.0.0.1:8852/qa/state'),
                )).body,
              )
              as Map;
      debugPrint('DJL_DESKTOP_BACKGROUND_READY');
      await waitFor(
        tester,
        () => lifecycle.states.contains(AppLifecycleState.paused),
      );
      await waitFor(
        tester,
        () =>
            WidgetsBinding.instance.lifecycleState ==
                AppLifecycleState.resumed &&
            desktop.connected &&
            !desktop.busy,
      );
      final after =
          jsonDecode(
                (await http.get(
                  Uri.parse('http://127.0.0.1:8852/qa/state'),
                )).body,
              )
              as Map;
      expect(after['turnCount'], before['turnCount']);
      await tester.tap(find.byTooltip('Stop turn'));
      await waitFor(tester, () => desktop.turnId == null);
      await binding.takeScreenshot('desktop-recovered-stopped');
      expect(tester.takeException(), isNull);
      await desktop.forget(desktop.active!);
      debugPrint('DJL_DESKTOP_FINISHED');
    },
    timeout: const Timeout(Duration(minutes: 5)),
  );
}
