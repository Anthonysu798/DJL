import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:djl_mobile/main.dart' as application;
import 'package:djl_mobile/features/activity/presentation/activity_card.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/guardian/presentation/guardian_review_card.dart';
import 'package:djl_mobile/features/subagents/presentation/subagent_card.dart';
import 'package:djl_mobile/features/workspace/presentation/project_picker_page.dart';
import 'cloud_test.dart' show waitFor;
import 'threads_test.dart'
    show securePairingEntry, macs, reveal, state, type, projectDraftPicker;
import 'support/native_advanced_acceptance.dart';
import 'support/native_app_ready.dart';

Future<void> sendComposer(WidgetTester tester, String text) async {
  final field = find.byKey(const Key('desktop_composer'));
  await type(tester, field, text);
  final send = find.byWidgetPredicate(
    (widget) => widget is IconButton && widget.tooltip == 'Send to desktop',
  );
  await waitFor(
    tester,
    () =>
        send.evaluate().isNotEmpty &&
        tester.widget<IconButton>(send).onPressed != null,
  );
  await reveal(tester, send);
  expect(tester.widget<IconButton>(send).onPressed, isNotNull);
  await tester.tap(send);
  await tester.pump(const Duration(milliseconds: 200));
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  Future<void> capture(String name) async {
    if (Platform.isIOS) await binding.takeScreenshot(name);
  }

  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets('native guardian activity and editable child with parent draft', (
    tester,
  ) async {
    application.main();
    await tester.pump();
    var attached = false;
    final deadline = DateTime.now().add(const Duration(seconds: 45));
    while (!attached && DateTime.now().isBefore(deadline)) {
      final status =
          jsonDecode((await http.get(Uri.parse('http://127.0.0.1:8855/'))).body)
              as Map;
      attached = status['driverConnected'] == true;
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(attached, isTrue);
    await waitForNativeAppReady(tester, 'DJL_ADVANCED');
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
    for (final pair in List.of(desktop.trusted)) {
      if (pair.macDeviceId == expected['macDeviceId']) {
        await desktop.forget(pair);
      }
    }
    expect(await macs(tester), same(desktop));
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
    const cwd = String.fromEnvironment('DJL_QA_DESKTOP_CWD');
    expect(desktop.thread, isNull);
    expect(desktop.newChatDraft?.cwd, cwd);
    expect(desktop.newChatDraft?.source.name, 'folderChat');
    await tester.tap(find.byKey(const Key('desktop_composer')));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Chat controls'));
    await tester.pumpAndSettle();
    // Select distinct parent model and access through their actual controls.
    final models = find.byKey(const Key('desktop_runtime_model'));
    await reveal(tester, models);
    await tester.tap(models);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Local test runtime').last);
    await waitFor(tester, () => desktop.selectedModel?['model'] == 'qa-model');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('composer.access')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ask for approval').last);
    await waitFor(
      tester,
      () => desktop.access == 'on-request' && desktop.error == null,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('composer.access')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Approve for me').last);
    await waitFor(
      tester,
      () => desktop.access == 'auto-review' && desktop.error == null,
    );
    await tester.pumpAndSettle();
    final parentModel = desktop.model;
    final parentAccess = desktop.access;
    expect(parentModel, 'codex::qa-model');
    expect(parentAccess, 'auto-review');
    final baseline = await state();
    await sendComposer(tester, '[advanced] native acceptance');
    await waitFor(
      tester,
      () => desktop.thread?['cwd'] == cwd && desktop.thread?['id'] is String,
    );
    final parent = desktop.thread!['id'] as String;
    expect(parent, isNotEmpty);
    await waitFor(
      tester,
      () =>
          desktop.turnId == null &&
          desktop.subagents.items.values.any(
            (action) => action.thread == parent,
          ),
    );
    final action = desktop.subagents.items.values
        .where((action) => action.thread == parent)
        .single;
    expect(action.children, hasLength(1));
    final child = action.children.single;
    await reveal(tester, find.byType(SubagentActionCard));
    await waitFor(
      tester,
      () => desktop.resolvedSubagent(child).nickname == 'Fixture Scout',
    );
    final passive = await state();
    // Completion can reload the parent; passive safety is scoped to the child.
    expect(
      passive['threadReadCount'],
      greaterThan(baseline['threadReadCount'] as int),
    );
    expect(passive['turnStartCount'], (baseline['turnStartCount'] as int) + 1);
    expect(
      passiveChildReadOnly(
        passive,
        childId: child.thread,
        afterSequence: baseline['requestSequence'] as int,
      ),
      isTrue,
    );
    expect(passive['lastTurn'], {
      'threadId': parent,
      'model': 'qa-model',
      'djlProvider': 'codex',
      'approvalsReviewer': 'auto_review',
      'approvalPolicy': 'on-request',
      'sandboxPolicy': {'type': 'workspaceWrite', 'networkAccess': true},
    });
    expect(desktop.thread!['id'], parent);
    expect(desktop.model, parentModel);
    expect(desktop.access, parentAccess);
    await capture('advanced-child-card');
    await reveal(tester, find.byType(GuardianReviewCard));
    await tester.tap(find.text('Auto-review · Denied'));
    await tester.pumpAndSettle();
    expect(find.text('Disposable native review fixture.'), findsOneWidget);
    await reveal(tester, find.text('Approve one retry'));
    await tester.tap(find.text('Approve one retry'));
    await waitFor(
      tester,
      () => find
          .text('Approval recorded; the retry will still be reviewed')
          .evaluate()
          .isNotEmpty,
    );
    final approved = await state();
    expect(
      approved['guardianRetryAttemptCount'],
      (baseline['guardianRetryAttemptCount'] as int) + 1,
    );
    expect(
      approved['guardianRetryCount'],
      (baseline['guardianRetryCount'] as int) + 1,
    );
    expect(find.text('Approve one retry'), findsNothing);
    await capture('advanced-guardian-approved');
    final previous = find.text('2 previous messages');
    await reveal(tester, previous);
    await tester.tap(previous);
    await tester.pumpAndSettle();
    final command = find.byWidgetPredicate(
      (widget) => widget is ActivityCard && widget.activity.kind == 'command',
    );
    await reveal(tester, command);
    await tester.tap(command);
    await tester.pumpAndSettle();
    expect(find.text('Command details'), findsOneWidget);
    expect(find.text('Exit code: 0'), findsOneWidget);
    expect(find.text('QA command output\n'), findsOneWidget);
    await capture('advanced-command-details');
    Navigator.of(tester.element(find.text('Command details'))).pop();
    await tester.pumpAndSettle();
    final toolCard = find.byWidgetPredicate(
      (widget) => widget is ActivityCard && widget.activity.kind == 'tool',
    );
    await reveal(tester, toolCard);
    await tester.tap(toolCard);
    await tester.pumpAndSettle();
    expect(find.text('Tool details'), findsOneWidget);
    expect(find.textContaining('Structured QA tool output'), findsOneWidget);
    await capture('advanced-structured-tool-details');
    Navigator.of(tester.element(find.text('Tool details'))).pop();
    await tester.pumpAndSettle();
    await type(
      tester,
      find.byKey(const Key('desktop_composer')),
      'Unsent native parent draft',
    );
    await reveal(tester, find.text('Open child chat'));
    final beforeOpen = await state();
    expect(
      passiveChildReadOnly(
        beforeOpen,
        childId: child.thread,
        afterSequence: baseline['requestSequence'] as int,
      ),
      isTrue,
    );
    expect(desktop.model, parentModel);
    expect(desktop.access, parentAccess);
    await tester.tap(find.text('Open child chat'));
    await waitFor(tester, () => desktop.thread?['id'] == child.thread);
    expect(desktop.selectedModel?['model'], 'qa-child-model');
    expect(desktop.access, 'on-request');
    expect(find.text('Read-only child history loaded.'), findsOneWidget);
    await sendComposer(tester, '[echo] Native child follow-up');
    await waitFor(
      tester,
      () =>
          desktop.turnId == null &&
          desktop.timeline.any(
            (item) => (item['text'] as String? ?? '').contains(
              'Saved native conversation history.',
            ),
          ),
    );
    final sent = await state();
    final policy = sent['lastTurn'] as Map;
    expect(policy, {
      'threadId': child.thread,
      'model': 'qa-child-model',
      'djlProvider': 'codex',
      'approvalsReviewer': 'user',
      'approvalPolicy': 'on-request',
      'sandboxPolicy': {'type': 'workspaceWrite', 'networkAccess': true},
    });
    expect(sent['turnStartCount'], (baseline['turnStartCount'] as int) + 2);
    await capture('advanced-child-followup');
    await tester.tap(find.byTooltip('Return to parent chat'));
    await waitFor(tester, () => desktop.thread?['id'] == parent);
    expect(
      tester
          .widget<TextField>(find.byKey(const Key('desktop_composer')))
          .controller!
          .text,
      'Unsent native parent draft',
    );
    expect(desktop.model, parentModel);
    expect(desktop.access, parentAccess);
    final returned = await state();
    expect(returned['turnStartCount'], sent['turnStartCount']);
    expect(
      returned['guardianRetryAttemptCount'],
      (baseline['guardianRetryAttemptCount'] as int) + 1,
    );
    expect(
      returned['guardianRetryCount'],
      (baseline['guardianRetryCount'] as int) + 1,
    );
    await capture('advanced-parent-draft-restored');
    debugPrint('DJL_ADVANCED_FRAME_READY');
    var captured = false;
    final captureDeadline = DateTime.now().add(const Duration(seconds: 30));
    while (!captured && DateTime.now().isBefore(captureDeadline)) {
      captured =
          (jsonDecode(
                (await http.get(Uri.parse('http://127.0.0.1:8855/'))).body,
              )
              as Map)['captured'] ==
          true;
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(captured, isTrue);
    expect(tester.takeException(), isNull);
    await desktop.forget(desktop.active!);
    debugPrint('DJL_ADVANCED_FINISHED');
  });
}
