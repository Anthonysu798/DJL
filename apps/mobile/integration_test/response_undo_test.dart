import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:djl_mobile/main.dart' as application;
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/features/workspace/data/workspace_repository.dart';
import 'package:djl_mobile/features/workspace/domain/response_change_set.dart';
import 'package:djl_mobile/features/workspace/presentation/project_picker_page.dart';
import 'package:djl_mobile/features/workspace/presentation/response_undo_sheet.dart';
import 'advanced_test.dart' show sendComposer;
import 'cloud_test.dart' show waitFor;
import 'threads_test.dart'
    show securePairingEntry, macs, reveal, state, projectDraftPicker;
import 'support/native_app_ready.dart';
import 'support/native_undo_acceptance.dart';

const _cwd = String.fromEnvironment('DJL_QA_DESKTOP_CWD');
const _restoreOnly = bool.fromEnvironment('DJL_QA_UNDO_RESTORE_ONLY');

Future<Map> _frameHost() async =>
    jsonDecode((await http.get(Uri.parse('http://127.0.0.1:8855/'))).body)
        as Map;

Future<void> _frameBarrier(WidgetTester tester, String flag) async {
  var ready = false;
  final deadline = DateTime.now().add(const Duration(seconds: 45));
  while (!ready && DateTime.now().isBefore(deadline)) {
    ready = (await _frameHost())[flag] == true;
    await tester.pump(const Duration(milliseconds: 200));
  }
  expect(ready, isTrue, reason: 'Native frame host did not acknowledge $flag.');
}

Future<DesktopController> _macs(WidgetTester tester) => macs(tester);

WorkspaceRepository _workspace(DesktopController desktop, String thread) =>
    WorkspaceRepository(desktop.transport, cwd: _cwd, threadId: thread);

ResponseChangeSet _restoredEntry(DesktopController desktop, Map expected) {
  expect(desktop.active?.macDeviceId, expected['macDeviceId']);
  expect(desktop.threadList.macDeviceId, expected['macDeviceId']);
  final entry =
      desktop.threadList.data.responseChanges.entries[expected['entryId']];
  expect(entry, isNotNull);
  expect(entry!.thread, expected['threadId']);
  expect(entry.turn, expected['turnId']);
  expect(entry.id, expected['entryId']);
  expect(entry.assistant, expected['assistant']);
  expect(entry.cwd, expected['cwd']);
  expect(entry.terminal, isTrue);
  expect(entry.reverted, isTrue);
  expect(entry.uncertain, isFalse);
  return entry;
}

Future<void> _unchangedSinceSave(Map expected) async {
  final current = await state();
  expect(current['turnStartCount'], expected['turnStartCount']);
  expect(
    nativeUndoApplyCount(
      current,
      afterSequence: expected['startSequence'] as int,
    ),
    expected['applyCount'],
  );
  expect(
    nativeUndoApplyCount(
      current,
      afterSequence: expected['requestSequence'] as int,
    ),
    0,
  );
}

Future<void> _restore(
  WidgetTester tester,
  DesktopController desktop,
  Map pair,
) async {
  final response = await http.get(
    Uri.parse(
      'http://127.0.0.1:8852/qa/restore-fixture?platform=${Platform.operatingSystem}',
    ),
  );
  expect(response.statusCode, 200);
  final expected = jsonDecode(response.body) as Map;
  expect(
    nativeUndoRestoreFixtureMatches(
      expected,
      platform: Platform.operatingSystem,
      macId: pair['macDeviceId'] as String,
      cwd: _cwd,
    ),
    isTrue,
  );
  await waitFor(
    tester,
    () =>
        desktop.threadList.macDeviceId == expected['macDeviceId'] &&
        desktop.threadList.data.responseChanges.entries.containsKey(
          expected['entryId'],
        ),
  );
  // Inspect the cache tombstone before reconnecting or opening any conversation.
  _restoredEntry(desktop, expected);
  await _unchangedSinceSave(expected);
  final trusted = desktop.trusted
      .where((p) => p.macDeviceId == expected['macDeviceId'])
      .single;
  expect(trusted.publicKey, pair['macIdentityPublicKey']);
  if (!desktop.runtimeReady) await desktop.reconnect();
  await waitFor(tester, () => desktop.runtimeReady);
  _restoredEntry(desktop, expected);
  final beforeRead = await state();
  final row = desktop.threadList.data.find(expected['threadId'] as String);
  expect(row, isNotNull);
  // Use the real read-only history path and existing privacy-test navigation.
  await desktop.openThread(row!, readOnlyNavigation: true);
  unawaited(
    Navigator.of(tester.element(find.byType(PairingPage))).push<void>(
      MaterialPageRoute(builder: (_) => DesktopChatPage(controller: desktop)),
    ),
  );
  await waitFor(
    tester,
    () => find.byType(DesktopChatPage).evaluate().isNotEmpty,
  );
  expect(desktop.thread?['id'], expected['threadId']);
  expect(desktop.thread?['cwd'], _cwd);
  expect(
    desktop.timeline.any(
      (item) =>
          item['id'] == expected['assistant'] && item['type'] == 'agentMessage',
    ),
    isTrue,
  );
  _restoredEntry(desktop, expected);
  final afterRead = await state();
  nativeUndoApplyCount(
    afterRead,
    afterSequence: beforeRead['requestSequence'] as int,
  );
  expect(
    (afterRead['requests'] as List).cast<Map>().any(
      (request) =>
          (request['sequence'] as int) >
              (beforeRead['requestSequence'] as int) &&
          request['method'] == 'thread/read' &&
          request['threadId'] == expected['threadId'] &&
          request['includeTurns'] == true,
    ),
    isTrue,
  );
  await reveal(tester, find.text('Response undone'));
  expect(find.text('Response undone'), findsOneWidget);
  expect(
    (await _workspace(
      desktop,
      expected['threadId'] as String,
    ).readTextFile('hello.txt')).content,
    expected['beforeContent'],
  );
  await _unchangedSinceSave(expected);
}

Future<void> _normal(
  WidgetTester tester,
  DesktopController desktop,
  Map pair,
) async {
  final response = await http.get(
    Uri.parse('http://127.0.0.1:8852/qa/pairing'),
  );
  expect(response.statusCode, 200);
  final fresh = jsonDecode(response.body) as Map;
  expect(fresh['macDeviceId'], pair['macDeviceId']);
  expect(fresh['macIdentityPublicKey'], pair['macIdentityPublicKey']);
  final cleanupTargets = nativeUndoFixturePairs(
    List.of(desktop.trusted),
    macIdOf: (trusted) => trusted.macDeviceId,
    pinOf: (trusted) => trusted.publicKey,
    expectedMacId: pair['macDeviceId'] as String,
    expectedPin: pair['macIdentityPublicKey'] as String,
  );
  for (final trusted in cleanupTargets) {
    await desktop.forget(trusted);
  }
  expect(await securePairingEntry(tester), same(desktop));
  final field = find.byKey(const Key('pairing_payload'));
  await reveal(tester, field);
  await tester.enterText(field, jsonEncode(fresh));
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
  await reveal(tester, find.text('Pair securely'));
  await tester.tap(find.text('Pair securely'));
  await waitFor(tester, () => desktop.runtimeReady);
  expect(desktop.active?.macDeviceId, pair['macDeviceId']);
  final baselineFile = await desktop.transport.request('workspace/readFile', {
    'cwd': _cwd,
    'path': 'hello.txt',
    'includeContent': true,
  });
  expect(baselineFile['fileName'], 'hello.txt');
  expect(baselineFile['encoding'], 'utf-8');
  expect(baselineFile['path'], '$_cwd/hello.txt');
  expect(baselineFile['content'], isA<String>());
  expect(baselineFile['byteLength'], isA<int>());
  expect(baselineFile['notModified'], isNot(true));
  final before = baselineFile['content'] as String;
  await projectDraftPicker(tester, _cwd);
  await waitFor(
    tester,
    () =>
        find.byType(ProjectPickerPage).evaluate().isNotEmpty &&
        find.text(_cwd).evaluate().isNotEmpty,
  );
  await tester.tap(find.text('Use'));
  await waitFor(
    tester,
    () =>
        find.byType(DesktopChatPage).evaluate().isNotEmpty &&
        desktop.newChatDraft?.cwd == _cwd &&
        desktop.thread == null,
  );
  expect(desktop.newChatDraft?.source.name, 'folderChat');
  final baseline = await state();
  final startSequence = baseline['requestSequence'] as int;
  await sendComposer(tester, '[undo] native response acceptance');
  await waitFor(
    tester,
    () => desktop.thread?['cwd'] == _cwd && desktop.thread?['id'] is String,
  );
  final thread = desktop.thread!['id'] as String;
  expect(thread, isNotEmpty);
  final workspace = _workspace(desktop, thread);
  await waitFor(
    tester,
    () =>
        desktop.turnId == null &&
        !desktop.busy &&
        desktop.threadList.data.responseChanges.entries.values.any(
          (entry) => entry.thread == thread && entry.ready,
        ),
  );
  final entry = desktop.threadList.data.responseChanges.entries.values
      .singleWhere((entry) => entry.thread == thread && entry.ready);
  expect(entry.files, {'hello.txt'});
  expect(entry.evidence, {'hello.txt'});
  expect(entry.aggregate, isNotNull);
  expect(entry.terminal, isTrue);
  expect(
    desktop.timeline.any(
      (item) =>
          item['id'] == entry.assistant &&
          item['type'] == 'agentMessage' &&
          item['text'] == 'Response-owned native change applied.',
    ),
    isTrue,
  );
  final after = '${before}response-owned native change\n';
  expect((await workspace.readTextFile('hello.txt')).content, after);
  expect(nativeUndoApplyCount(await state(), afterSequence: startSequence), 0);

  Future<ResponseUndoSheet> openReview() async {
    final button = find.text('Undo this response');
    await reveal(tester, button);
    await tester.tap(button);
    await waitFor(
      tester,
      () => find.byType(ResponseUndoSheet).evaluate().isNotEmpty,
    );
    final sheet = tester.widget<ResponseUndoSheet>(
      find.byType(ResponseUndoSheet),
    );
    await waitFor(
      tester,
      () => sheet.controller.preview != null && sheet.controller.canApply,
    );
    expect(identical(sheet.controller.entry, entry), isTrue);
    expect(sheet.controller.preview!.files, ['hello.txt']);
    expect(sheet.controller.preview!.allowed, isTrue);
    return sheet;
  }

  final first = await openReview();
  expect(first.controller.entry.reverted, isFalse);
  expect((await workspace.readTextFile('hello.txt')).content, after);
  expect(nativeUndoApplyCount(await state(), afterSequence: startSequence), 0);
  await reveal(tester, find.widgetWithText(TextButton, 'Close'));
  await tester.tap(find.widgetWithText(TextButton, 'Close'));
  await waitFor(
    tester,
    () => find.byType(ResponseUndoSheet).evaluate().isEmpty,
  );
  expect((await workspace.readTextFile('hello.txt')).content, after);
  expect(nativeUndoApplyCount(await state(), afterSequence: startSequence), 0);
  final second = await openReview();
  final apply = find.widgetWithText(FilledButton, 'Undo response');
  await reveal(tester, apply);
  expect(tester.widget<FilledButton>(apply).onPressed, isNotNull);
  await tester.tap(apply);
  await waitFor(tester, () => entry.reverted && !second.controller.applying);
  expect((await workspace.readTextFile('hello.txt')).content, before);
  await reveal(tester, find.widgetWithText(TextButton, 'Close'));
  await tester.tap(find.widgetWithText(TextButton, 'Close'));
  await waitFor(
    tester,
    () => find.byType(ResponseUndoSheet).evaluate().isEmpty,
  );
  await reveal(tester, find.text('Response undone'));
  expect(find.text('Response undone'), findsOneWidget);
  final counts = await state();
  expect(nativeUndoApplyCount(counts, afterSequence: startSequence), 1);
  expect(counts['turnStartCount'], (baseline['turnStartCount'] as int) + 1);
  await desktop.threadList.saveNow();
  await desktop.threadList.store.flush();
  expect(desktop.threadList.localError, isNull);
  final saved = await http.post(
    Uri.parse('http://127.0.0.1:8852/qa/restore-fixture'),
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({
      'platform': Platform.operatingSystem,
      'expected': {
        'platform': Platform.operatingSystem,
        'threadId': thread,
        'turnId': entry.turn,
        'macDeviceId': desktop.active!.macDeviceId,
        'entryId': entry.id,
        'assistant': entry.assistant,
        'cwd': _cwd,
        'beforeContent': before,
        'turnStartCount': counts['turnStartCount'],
        'applyCount': 1,
        'startSequence': startSequence,
        'requestSequence': counts['requestSequence'],
      },
    }),
  );
  expect(saved.statusCode, 200);
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets(
    _restoreOnly
        ? 'native response undo cold-process tombstone restore'
        : 'native exact response undo preview, close and explicit apply',
    (tester) async {
      expect(_cwd, isNotEmpty);
      final pair =
          jsonDecode(
                utf8.decode(
                  base64Decode(
                    const String.fromEnvironment('DJL_QA_PAIRING_BASE64'),
                  ),
                ),
              )
              as Map;
      application.main();
      await tester.pump();
      await _frameBarrier(tester, 'driverConnected');
      await waitForNativeAppReady(tester, 'DJL_UNDO');
      final desktop = await _macs(tester);
      if (_restoreOnly) {
        await _restore(tester, desktop, pair);
      } else {
        await _normal(tester, desktop, pair);
      }
      if (Platform.isIOS) {
        await binding.takeScreenshot(
          _restoreOnly ? 'undo-cold-restored' : 'undo-response-reverted',
        );
      }
      debugPrint('DJL_UNDO_FRAME_READY');
      await _frameBarrier(tester, 'captured');
      expect(tester.takeException(), isNull);
      if (_restoreOnly) {
        final trusted = nativeUndoFixturePairs(
          List.of(desktop.trusted),
          macIdOf: (saved) => saved.macDeviceId,
          pinOf: (saved) => saved.publicKey,
          expectedMacId: pair['macDeviceId'] as String,
          expectedPin: pair['macIdentityPublicKey'] as String,
        ).single;
        await desktop.forget(trusted);
      }
      debugPrint('DJL_UNDO_FINISHED');
    },
    timeout: const Timeout(Duration(minutes: 8)),
  );
}
