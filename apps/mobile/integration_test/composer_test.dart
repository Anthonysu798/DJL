import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:djl_mobile/main.dart' as application;
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_composer_widgets.dart';
import 'package:djl_mobile/features/workspace/presentation/project_picker_page.dart';
import 'cloud_test.dart' show waitFor;
import 'threads_test.dart'
    show securePairingEntry, macs, reveal, projectDraftPicker;
import 'support/native_app_ready.dart';

Future<void> hostFrame(
  WidgetTester tester,
  String field, {
  Duration timeout = const Duration(seconds: 45),
}) async {
  var ready = false;
  final deadline = DateTime.now().add(timeout);
  while (!ready && DateTime.now().isBefore(deadline)) {
    final status =
        jsonDecode((await http.get(Uri.parse('http://127.0.0.1:8855/'))).body)
            as Map;
    ready = status[field] == true;
    await tester.pump(const Duration(milliseconds: 200));
  }
  expect(
    ready,
    isTrue,
    reason: 'The native host must attach or capture the actual frame.',
  );
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  Future<void> capture(String name) async {
    if (Platform.isIOS) await binding.takeScreenshot(name);
  }

  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets(
    'native desktop discovery and phone gallery mixed input',
    (tester) async {
      application.main();
      await tester.pump();
      await hostFrame(tester, 'driverConnected');
      await waitForNativeAppReady(tester, 'DJL_COMPOSER');
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
      final fresh =
          jsonDecode(
                (await http.get(
                  Uri.parse('http://127.0.0.1:8852/qa/pairing'),
                )).body,
              )
              as Map;
      expect(fresh['macDeviceId'], expected['macDeviceId']);
      expect(fresh['macIdentityPublicKey'], expected['macIdentityPublicKey']);
      final fixturePairs = desktop.trusted
          .where((pair) => pair.macDeviceId == expected['macDeviceId'])
          .toList();
      for (final pair in fixturePairs) {
        expect(pair.publicKey, expected['macIdentityPublicKey']);
      }
      for (final pair in fixturePairs) {
        await desktop.forget(pair);
      }
      expect(await securePairingEntry(tester), same(desktop));
      await reveal(tester, find.byKey(const Key('pairing_payload')));
      await tester.enterText(
        find.byKey(const Key('pairing_payload')),
        jsonEncode(fresh),
      );
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await reveal(tester, find.text('Pair securely'));
      await tester.tap(find.text('Pair securely'));
      await waitFor(tester, () => desktop.runtimeReady);
      await projectDraftPicker(
        tester,
        const String.fromEnvironment('DJL_QA_DESKTOP_CWD'),
      );
      await waitFor(
        tester,
        () => find.byType(ProjectPickerPage).evaluate().isNotEmpty,
      );
      await tester.tap(find.text('Use'));
      await waitFor(
        tester,
        () => find.byType(DesktopChatPage).evaluate().isNotEmpty,
      );
      final composer = tester
          .widget<DesktopComposerAttachments>(
            find.byType(DesktopComposerAttachments),
          )
          .controller;
      Future<void> context(String kind, String item, {String? query}) async {
        await tester.tap(find.byTooltip('Composer options'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Add desktop context'));
        await tester.pumpAndSettle();
        if (kind != 'Skills') {
          await tester.tap(find.text(kind));
          await tester.pumpAndSettle();
        }
        if (query != null) {
          await tester.enterText(
            find.byKey(const Key('desktop_context_search')),
            query,
          );
        }
        await waitFor(tester, () => find.text(item).evaluate().isNotEmpty);
        await tester.tap(find.text(item));
        await tester.pumpAndSettle();
      }

      await context('Skills', 'qa-review');
      await context('Plugins', 'QA tools');
      await context('Files', 'hello.txt', query: 'hello');
      expect(composer.contexts, hasLength(3));
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        '[echo] Native mixed context acceptance',
      );
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await capture('composer-contexts-selected');
      debugPrint('DJL_COMPOSER_GALLERY_READY');
      await tester.tap(find.byTooltip('Composer options'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Photo library'));
      await waitFor(
        tester,
        () => composer.slots.any((slot) => slot.image != null),
      );
      expect(composer.slots, hasLength(1));
      expect(composer.slots.single.error, isNull);
      expect(composer.slots.single.image!.dataUrl, startsWith('data:image/'));
      final renderedPreview = find.descendant(
        of: find.byType(DesktopComposerAttachments),
        matching: find.byWidgetPredicate(
          (widget) => widget is RawImage && widget.image != null,
        ),
      );
      await waitFor(tester, () => renderedPreview.evaluate().length == 1);
      await tester.pumpAndSettle();
      expect(renderedPreview, findsOneWidget);
      await capture('composer-native-photo-preview');
      debugPrint('DJL_COMPOSER_FRAME_READY');
      await hostFrame(tester, 'captured', timeout: const Duration(seconds: 30));
      await tester.tap(find.byTooltip('Send to desktop'));
      await waitFor(
        tester,
        () =>
            desktop.turnId == null &&
            desktop.timeline.any((item) => item['type'] == 'agentMessage'),
      );
      final oracle =
          jsonDecode(
                (await http.get(
                  Uri.parse('http://127.0.0.1:8852/qa/state'),
                )).body,
              )
              as Map;
      final input = (oracle['lastInput'] as List).cast<Map>();
      expect(
        input.map((part) => part['type']),
        containsAll(['image', 'text', 'skill', 'mention']),
      );
      expect(
        input.where((part) => part['type'] == 'image').single['inlineImage'],
        isTrue,
      );
      final text =
          input.where((part) => part['type'] == 'text').single['text']
              as String;
      expect(text, contains('@hello.txt'));
      expect(text, contains(r'$qa-review'));
      expect(text, contains('@qa-tools'));
      expect(composer.slots, isEmpty);
      expect(composer.contexts, isEmpty);
      expect(composer.text, isEmpty);
      await capture('composer-mixed-turn-complete');
      expect(tester.takeException(), isNull);
      expect(desktop.active?.macDeviceId, expected['macDeviceId']);
      expect(desktop.active?.publicKey, expected['macIdentityPublicKey']);
      await desktop.forget(desktop.active!);
      debugPrint('DJL_COMPOSER_FINISHED');
    },
    timeout: const Timeout(Duration(minutes: 4)),
  );
}
