// Group chat on a phone paired over real encryption to the scripted Mac
// (integration_test/support/groups_fixture.ts). Start the bridge with
// `DJL_QA_GROUPS=1 bun integration_test/support/start_desktop.ts`, then run
// `flutter test integration_test/groups_test.dart -d <device>
// --dart-define-from-file=/tmp/djl-mobile-qa/desktop-native-config.json`.
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:http/http.dart' as http;
import 'package:djl_mobile/main.dart' as application;
import 'package:djl_mobile/features/groups/presentation/group_chat_page.dart';
import 'cloud_test.dart' show waitFor;
import 'threads_test.dart' show macs, securePairingEntry, type, reveal;

Future<Map<String, dynamic>> _fixture() async =>
    jsonDecode(
          (await http.get(Uri.parse('http://127.0.0.1:8852/qa/groups'))).body,
        )
        as Map<String, dynamic>;

// Agent replies (live drafts and finished ones) only, never the sent message.
Finder _reply(String text) => find.descendant(
  of: find.byType(GroupChatPage),
  matching: find.byWidgetPredicate(
    (widget) => widget is MarkdownBody && widget.data.contains(text),
  ),
);

Future<void> _send(WidgetTester tester, String text) async {
  final input = find.byKey(const Key('group-composer-input'));
  await tester.tap(input);
  await tester.enterText(input, text);
  await tester.pump();
  await tester.tap(find.byKey(const Key('group-composer-action')));
  await tester.pump();
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets(
    'group chat: replies stream in, Stop halts them, a group is created',
    (tester) async {
      application.main();
      if (Platform.isAndroid) await binding.convertFlutterSurfaceToImage();

      final desktop = await macs(tester);
      final expected =
          jsonDecode(
                utf8.decode(
                  base64Decode(
                    const String.fromEnvironment('DJL_QA_PAIRING_BASE64'),
                  ),
                ),
              )
              as Map<String, dynamic>;
      final pairing = jsonEncode(
        jsonDecode(
          (await http.get(Uri.parse('http://127.0.0.1:8852/qa/pairing'))).body,
        ),
      );
      await desktop.restore();
      for (final saved in List.of(desktop.trusted)) {
        if (saved.macDeviceId == expected['macDeviceId']) {
          await desktop.forget(saved);
        }
      }
      await tester.pumpAndSettle();
      expect(await securePairingEntry(tester), same(desktop));
      await type(tester, find.byKey(const Key('pairing_payload')), pairing);
      await reveal(tester, find.text('Pair securely'));
      await tester.tap(find.text('Pair securely'));
      await waitFor(tester, () => desktop.runtimeReady);

      // The Groups switch on the My Macs home lists the fixture's group.
      await waitFor(
        tester,
        () => find.byTooltip('Groups').evaluate().isNotEmpty,
      );
      await tester.tap(find.byTooltip('Groups'));
      await waitFor(
        tester,
        () => find.text('Launch plan').evaluate().isNotEmpty,
      );
      await tester.tap(find.text('Launch plan'));
      await waitFor(
        tester,
        () => find.byType(GroupChatPage).evaluate().isNotEmpty,
      );

      // Every member answers, and each answer arrives word by word: the first
      // words show while the last are still on the way. Words are unique per
      // run because the scripted Mac keeps earlier runs' history.
      final run = DateTime.now().millisecondsSinceEpoch % 1000000;
      final first = 'alpha$run', last = 'echo$run';
      await _send(
        tester,
        '@Everyone reply only: $first bravo charlie delta $last',
      );
      await waitFor(
        tester,
        () =>
            _reply(first).evaluate().isNotEmpty &&
            _reply(last).evaluate().isEmpty,
        timeout: const Duration(seconds: 20),
      );
      await waitFor(
        tester,
        () => _reply('$first bravo charlie delta $last').evaluate().length == 3,
        timeout: const Duration(seconds: 30),
      );
      expect(
        ((await _fixture())['sent'] as List).last['text'],
        '@Everyone reply only: $first bravo charlie delta $last',
      );
      await binding.takeScreenshot('groups-replies');

      // A long answer can be stopped part way.
      const ending =
          'written one word at a time so the phone can show it arriving';
      final endingsBefore = _reply(ending).evaluate().length;
      final startsBefore = _reply('Claude here.').evaluate().length;
      await _send(tester, '@Claude tell me about the plan');
      await waitFor(
        tester,
        () => _reply('Claude here.').evaluate().length > startsBefore,
        timeout: const Duration(seconds: 20),
      );
      await tester.tap(find.byKey(const Key('group-composer-action')));
      await tester.pump(const Duration(seconds: 3));
      expect(_reply(ending).evaluate().length, endingsBefore);

      // A new group can be made from the phone.
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('New group'));
      await waitFor(tester, () => find.text('Codex').evaluate().isNotEmpty);
      await tester.tap(find.text('Claude'));
      await tester.tap(find.text('Codex'));
      await tester.enterText(
        find.byKey(const Key('group-name')),
        'Phone made $run',
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('group-create')));
      await waitFor(
        tester,
        () => find.text('Phone made $run').evaluate().isNotEmpty,
      );
      final made = ((await _fixture())['groups'] as List)
          .cast<Map>()
          .singleWhere((group) => group['name'] == 'Phone made $run');
      expect((made['members'] as List).map((member) => member['provider']), [
        'claudeAgent',
        'codex',
      ]);
      expect(tester.takeException(), isNull);
    },
  );
}
