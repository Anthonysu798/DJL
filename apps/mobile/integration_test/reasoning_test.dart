// QA-only native journey. Root owns actual install, unlock, attachment and cold
// OS-process replacement. This target never seeds product state or reconnects cold.
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
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/reasoning/domain/desktop_reasoning.dart';
import 'threads_test.dart' show macs, securePairingEntry, reveal, type;
import 'composer_test.dart' show hostFrame;
import 'support/native_acceptance.dart';
import 'support/native_app_ready.dart';

const _run = String.fromEnvironment('DJL_QA_REASONING_RUN_ID');
const _input = '[reasoning] native disclosure';
const _answer = 'Reasoning native fixture complete.';
const _version = 'reasoning-native-v1';
const _summary = [
  {
    'type': 'summary_text',
    'text': '**Reading files**\nCanonical completion detail.',
  },
  {
    'type': 'summary_text',
    'text': '**Verifying response**\nCanonical verification detail.',
  },
];
const _content = [
  {'type': 'reasoning_text', 'text': 'Canonical content detail.'},
];

Future<dynamic> _qa(String path, [Map<String, dynamic>? body]) async {
  final url = Uri.parse('http://127.0.0.1:8852/qa/$path');
  final response = body == null
      ? await http.get(url).timeout(const Duration(seconds: 5))
      : await http
            .post(
              url,
              headers: {'Content-Type': 'application/json'},
              body: jsonEncode(body),
            )
            .timeout(const Duration(seconds: 5));
  expect(response.statusCode, 200, reason: 'Owned QA control refused.');
  return jsonDecode(response.body);
}

Future<Map<String, dynamic>> _state() async =>
    Map<String, dynamic>.from(await _qa('state') as Map);
Future<void> _until(WidgetTester tester, bool Function() ready) async {
  final deadline = DateTime.now().add(const Duration(seconds: 45));
  while (!ready() && DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 200));
  }
  expect(ready(), isTrue, reason: 'Reasoning native checkpoint timed out.');
  await tester.pump();
}

Future<Map<String, dynamic>> _upstream(
  WidgetTester tester,
  bool Function(Map<String, dynamic>) ready,
) async {
  final deadline = DateTime.now().add(const Duration(seconds: 45));
  var value = await _state();
  while (!ready(value) && DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 200));
    value = await _state();
  }
  expect(
    ready(value),
    isTrue,
    reason: 'Upstream reasoning checkpoint timed out.',
  );
  return value;
}

Future<void> _capture(WidgetTester tester, String phase) async {
  debugPrint('DJL_REASONING_READY $_run $phase');
  final deadline = DateTime.now().add(const Duration(seconds: 45));
  var ack = false;
  while (!ack && DateTime.now().isBefore(deadline)) {
    final response = await http
        .get(Uri.parse('http://127.0.0.1:8855/?run=$_run&phase=$phase'))
        .timeout(const Duration(seconds: 5));
    expect(response.statusCode, 200);
    final value = jsonDecode(response.body) as Map;
    ack =
        value['driverConnected'] == true &&
        value['ack'] == true &&
        value['runId'] == _run &&
        value['phase'] == phase;
    await tester.pump(const Duration(milliseconds: 200));
  }
  expect(ack, isTrue, reason: 'Exact native run/phase capture ACK required.');
}

Map<String, dynamic> _quiet(Map<String, dynamic> state) => {
  for (final key in [
    'requestSequence',
    'applicationMessageCount',
    'threadStartAttemptCount',
    'threadCount',
    'turnStartCount',
    'turnCount',
    'threadReadCount',
    'threadResumeCount',
  ])
    key: state[key],
};
List<Map> _trace(Map<String, dynamic> before, Map<String, dynamic> after) {
  final rows = (after['requests'] as List)
      .cast<Map>()
      .where((r) => (r['sequence'] as int) > (before['requestSequence'] as int))
      .toList();
  expect(
    rows.length,
    (after['requestSequence'] as int) - (before['requestSequence'] as int),
  );
  for (var i = 0; i < rows.length; i++) {
    expect(rows[i]['sequence'], (before['requestSequence'] as int) + i + 1);
  }
  return rows;
}

List<Map<String, dynamic>> _rows(DesktopController desktop) =>
    desktop.timeline.where((r) => r.containsKey(reasoningMetadataKey)).toList();
Map<String, dynamic> _detail(DesktopController desktop, String itemId) => _rows(
  desktop,
).singleWhere((r) => (r[reasoningMetadataKey] as Map)['item'] == itemId);

// Reasoning stays on the desktop: the phone keeps the rows as data and never
// draws their titles or details.
void _reasoningHidden() {
  for (final text in [
    'Checking request',
    'Reading files',
    'Verifying response',
    'detail.',
  ]) {
    expect(find.textContaining(text), findsNothing);
  }
}

Future<void> _panel(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Open navigation'));
  await _until(
    tester,
    () => find.byKey(const Key('navigation.scrim')).evaluate().isNotEmpty,
  );
  await tester.pump(const Duration(milliseconds: 300));
}

Future<void> _open(
  WidgetTester tester,
  DesktopController desktop,
  String id,
) async {
  await _panel(tester);
  final target = find.byKey(ValueKey('navigation.thread.$id'));
  await reveal(tester, target);
  await tester.tap(target);
  await _until(
    tester,
    () =>
        desktop.thread?['id'] == id &&
        find.byType(DesktopChatPage).evaluate().isNotEmpty &&
        !desktop.busy,
  );
  await tester.pump(const Duration(milliseconds: 400));
}

void _canonical(DesktopController desktop, Map expected) {
  expect(desktop.thread?['id'] == expected['threadId'], isTrue);
  expect(desktop.turnId, isNull);
  final rows = _rows(desktop);
  expect(rows.length, 2);
  expect(rows.map((r) => (r[reasoningMetadataKey] as Map)['item']).toList(), [
    expected['summaryId'],
    expected['itemId'],
  ]);
  for (final row in rows) {
    final meta = row[reasoningMetadataKey] as Map;
    expect(
      meta['thread'] == expected['threadId'] &&
          meta['turn'] == expected['turnId'],
      isTrue,
    );
    expect(
      meta['mac'] == desktop.active?.macDeviceId &&
          meta['pin'] == desktop.active?.publicKey,
      isTrue,
    );
    expect(meta['terminal'] == true && meta['turnTerminal'] == true, isTrue);
  }
  expect(rows.first['summary'], [
    {'type': 'summary_text', 'text': '**Checking request**'},
  ]);
  final detail = _detail(desktop, expected['itemId'] as String);
  expect(detail['summary'], _summary);
  expect(detail['content'], _content);
  expect(
    detail['text'],
    '${_summary.map((s) => s['text']).join('\n')}\n\nCanonical content detail.',
  );
  expect((detail['text'] as String).contains('Live summary detail.'), isFalse);
  expect(
    (detail['text'] as String).contains('Second summary detail.'),
    isFalse,
  );
  expect(
    (detail['text'] as String).contains('Content stream detail.'),
    isFalse,
  );
  expect(
    desktop.timeline
        .where((r) => r['type'] == 'agentMessage' && r['text'] == _answer)
        .length,
    1,
  );
  final types = desktop.timeline
      .where((r) => r['turnId'] == expected['turnId'])
      .map((r) => r['type'])
      .toList();
  expect(types, ['userMessage', 'reasoning', 'reasoning', 'agentMessage']);
}

Future<void> _canonicalAnswer(WidgetTester tester) async {
  await _until(tester, () => find.text(_answer).evaluate().length == 1);
  _reasoningHidden();
  expect(find.byType(ExpansionTile), findsNothing);
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.shouldPropagateDevicePointerEvents = true;
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets(
    'real reasoning stream, canonical history and same-artifact cold cache',
    (tester) async {
      expect(RegExp(r'^[A-Za-z0-9_-]{1,64}$').hasMatch(_run), isTrue);
      final pair =
          jsonDecode(
                utf8.decode(
                  base64Decode(
                    const String.fromEnvironment('DJL_QA_PAIRING_BASE64'),
                  ),
                ),
              )
              as Map;
      final fresh = await _qa('pairing') as Map;
      expect(
        fresh['macDeviceId'] == pair['macDeviceId'] &&
            fresh['macIdentityPublicKey'] == pair['macIdentityPublicKey'],
        isTrue,
        reason: 'Artifact pairing must match the current owned gateway epoch.',
      );
      final saved =
          await _qa('restore-fixture?platform=${Platform.operatingSystem}')
              as Map?;
      if (saved != null) {
        expect(
          saved['version'] == _version && saved['runId'] == _run,
          isTrue,
          reason:
              'A fresh gateway and public nonce are required for live preparation.',
        );
        expect(
          saved['processId'] != pid,
          isTrue,
          reason: 'Cold proof requires a different actual OS process.',
        );
      }
      final startupGateway = await _state();
      final recorder = ConversationRequestRecorder(http.Client());
      runApp(
        DjlApp(
          client: CloudClient(
            baseUrl: nativeAcceptanceApi(
              const String.fromEnvironment('DJL_CLOUD_API_URL'),
            ),
            credentials: PlatformCredentialStore(),
            client: recorder,
          ),
        ),
      );
      await tester.pump();
      await hostFrame(tester, 'driverConnected');
      await waitForNativeAppReady(tester, 'DJL_REASONING');
      final semantics = tester.ensureSemantics();
      addTearDown(semantics.dispose);
      final desktop = await macs(tester);
      if (saved != null) {
        await _until(
          tester,
          () =>
              desktop.active?.macDeviceId == pair['macDeviceId'] &&
              desktop.threads.any((t) => t['id'] == saved['threadId']),
        );
        expect(
          desktop.active?.publicKey == pair['macIdentityPublicKey'],
          isTrue,
        );
        expect(desktop.connected, isFalse);
        expect(desktop.runtimeReady, isFalse);
        expect(_quiet(startupGateway), _quiet(await _state()));
        expect(_quiet(await _state()), saved['gateway']);
        final cloudBefore = recorder.totalRequestAttempts;
        await _open(tester, desktop, saved['threadId'] as String);
        _canonical(desktop, saved);
        await _canonicalAnswer(tester);
        // The host harness still expects both cold phases in this order.
        await _capture(tester, 'COLD_COLLAPSED');
        await _capture(tester, 'COLD_EXPANDED');
        expect(desktop.connected, isFalse);
        _canonical(desktop, saved);
        expect(_quiet(await _state()), saved['gateway']);
        expect(recorder.totalRequestAttempts, cloudBefore);
        expect(recorder.conversationMutationAttempts, 0);
        expect(tester.takeException(), isNull);
        debugPrint('DJL_REASONING_FINISHED $_run cold');
        return;
      }
      final known = desktop.trusted
          .where((p) => p.macDeviceId == pair['macDeviceId'])
          .toList();
      expect(known.length, lessThanOrEqualTo(1));
      if (known.isNotEmpty) {
        expect(known.single.publicKey == pair['macIdentityPublicKey'], isTrue);
        final index = desktop.trusted.indexOf(known.single);
        await tester.tap(find.byTooltip('More actions'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Connections').last);
        await tester.pumpAndSettle();
        final forget = find.byTooltip('Forget desktop').at(index);
        await reveal(tester, forget);
        await tester.tap(forget);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Forget'));
        await _until(
          tester,
          () =>
              !desktop.trusted.any((p) => p.macDeviceId == pair['macDeviceId']),
        );
        await tester.tap(find.text('Close'));
        await tester.pumpAndSettle();
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
      expect(
        desktop.active?.macDeviceId == pair['macDeviceId'] &&
            desktop.active?.publicKey == pair['macIdentityPublicKey'],
        isTrue,
      );
      await reveal(tester, find.bySemanticsLabel('New chat'));
      await tester.tap(find.bySemanticsLabel('New chat'));
      await _until(
        tester,
        () => find.byType(DesktopChatPage).evaluate().isNotEmpty,
      );
      expect(desktop.thread, isNull);
      expect(desktop.newChatDraft?.cwd, isNull);
      if (desktop.selectedModel?['model'] != 'qa-model') {
        await tester.tap(find.byKey(const Key('desktop_composer')));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Chat controls'));
        await tester.pumpAndSettle();
        final models = find.byKey(const Key('desktop_runtime_model'));
        await reveal(tester, models);
        await tester.tap(models);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Local test runtime').last);
        await _until(
          tester,
          () => desktop.selectedModel?['model'] == 'qa-model',
        );
        await tester.pumpAndSettle();
      }
      expect(desktop.selectedModel?['model'], 'qa-model');
      final before = await _state();
      final cloudBefore = recorder.totalRequestAttempts;
      final field = find.byKey(const Key('desktop_composer'));
      await type(tester, field, _input);
      await _until(
        tester,
        () =>
            find.byTooltip('Send to desktop').evaluate().isNotEmpty &&
            tester
                    .widget<IconButton>(find.byTooltip('Send to desktop'))
                    .onPressed !=
                null,
      );
      await tester.tap(find.byTooltip('Send to desktop')); // the only Send
      var state = await _upstream(
        tester,
        (s) => (s['reasoning'] as Map?)?['stage'] == 'STREAM_INITIAL',
      );
      final first = Map<String, dynamic>.from(state['reasoning'] as Map);
      final expected = <String, dynamic>{
        'threadId': first['threadId'],
        'turnId': first['turnId'],
        'itemId': first['itemId'],
        'summaryId': 'reasoning-summary-${first['turnId']}',
      };
      for (final key in [
        'threadStartAttemptCount',
        'threadCount',
        'turnStartCount',
        'turnCount',
      ]) {
        expect(state[key], (before[key] as int) + 1);
      }
      final trace = _trace(before, state);
      expect(trace.where((r) => r['method'] == 'thread/start').length, 1);
      expect(
        trace
            .where(
              (r) =>
                  r['method'] == 'turn/start' &&
                  r['threadId'] == first['threadId'],
            )
            .length,
        1,
      );
      expect(
        trace.where(
          (r) =>
              r['threadId'] == first['threadId'] &&
              ['thread/read', 'thread/resume'].contains(r['method']),
        ),
        isEmpty,
      );
      expect((state['lastTurn'] as Map)['threadId'], first['threadId']);
      await _until(tester, () => _rows(desktop).length == 2);
      expect(desktop.thread?['id'], first['threadId']);
      expect(desktop.turnId, first['turnId']);
      expect(first['pending'], isTrue);
      expect(first['detailCompletedCount'], 0);
      expect(first['turnCompletedCount'], 0);
      final row = _detail(desktop, first['itemId'] as String);
      final stableId = row['id'];
      expect(row['text'], '**Reading files**\nLive summary detail.');
      expect((row[reasoningMetadataKey] as Map)['terminal'], isFalse);
      _reasoningHidden();
      expect(find.text(_input), findsOneWidget);
      expect(find.text(_answer), findsNothing);
      // The host harness still expects both stream phases in this order.
      await _capture(tester, 'STREAM_COLLAPSED');
      await _capture(tester, 'STREAM_EXPANDED');
      // Recheck stream provenance after both captures, before the real producer release.
      state = await _state();
      expect(state['reasoning'], first);
      expect(
        _trace(before, state).where(
          (r) =>
              r['threadId'] == first['threadId'] &&
              ['thread/read', 'thread/resume'].contains(r['method']),
        ),
        isEmpty,
      );
      await _qa('reasoning/advance', first);
      state = await _upstream(
        tester,
        (s) => (s['reasoning'] as Map)['stage'] == 'STREAM_UPDATED',
      );
      final second = Map<String, dynamic>.from(state['reasoning'] as Map);
      await _until(
        tester,
        () =>
            ((_detail(desktop, first['itemId'] as String)[reasoningMetadataKey]
                        as Map)['summaryParts']
                    as Map?)
                ?.length ==
            2,
      );
      expect(_rows(desktop).length, 2);
      expect(
        _detail(desktop, first['itemId'] as String)['id'] == stableId,
        isTrue,
      );
      final meta =
          _detail(desktop, first['itemId'] as String)[reasoningMetadataKey]
              as Map;
      expect((meta['summaryParts'] as Map).keys.toList(), ['0', '1']);
      expect(meta['contentText'], 'Content stream detail.');
      for (final key in [
        'summaryPartAddedCount',
        'summaryTextDeltaCount',
        'textDeltaCount',
      ]) {
        expect(second[key] as int, greaterThan(0));
      }
      expect(second['detailCompletedCount'], 0);
      expect(second['turnCompletedCount'], 0);
      expect(desktop.turnId, first['turnId']);
      expect(
        DesktopReasoning.fromRow(
          _detail(desktop, first['itemId'] as String),
        )!.text,
        allOf(
          contains('Second summary detail.'),
          contains('Content stream detail.'),
        ),
      );
      _reasoningHidden();
      expect(find.text(_answer), findsNothing);
      await _capture(tester, 'STREAM_UPDATED');
      state = await _state();
      expect(state['reasoning'], second);
      expect(desktop.thread?['id'], first['threadId']);
      expect(
        _trace(before, state).where(
          (r) =>
              r['threadId'] == first['threadId'] &&
              ['thread/read', 'thread/resume'].contains(r['method']),
        ),
        isEmpty,
      );
      await _qa('reasoning/advance', second);
      await _upstream(
        tester,
        (s) => (s['reasoning'] as Map)['stage'] == 'COMPLETE',
      );
      await _until(
        tester,
        () =>
            desktop.turnId == null &&
            !desktop.busy &&
            _detail(desktop, first['itemId'] as String)['summary'].toString() ==
                _summary.toString(),
      );
      await tester.pump(const Duration(milliseconds: 500));
      _canonical(desktop, expected);
      state = await _state();
      expect((state['reasoning'] as Map)['detailCompletedCount'], 1);
      expect((state['reasoning'] as Map)['turnCompletedCount'], 1);
      expect(
        _trace(before, state).any(
          (r) =>
              r['method'] == 'thread/read' &&
              r['threadId'] == first['threadId'] &&
              r['includeTurns'] == true,
        ),
        isTrue,
      );
      final watermark = state;
      await _panel(tester);
      await reveal(tester, find.text('Remote'));
      await tester.tap(find.text('Remote'));
      await _until(
        tester,
        () => find.byType(DesktopChatPage).evaluate().isEmpty,
      );
      await _open(tester, desktop, first['threadId'] as String);
      _canonical(desktop, expected);
      final reopened = await _state();
      final reads = _trace(watermark, reopened)
          .where(
            (r) =>
                r['threadId'] == first['threadId'] &&
                ['thread/resume', 'thread/read'].contains(r['method']),
          )
          .toList();
      expect(reads.map((r) => r['method']).toList(), [
        'thread/resume',
        'thread/read',
      ]);
      expect(reads.last['includeTurns'], isTrue);
      final reopenTrace = _trace(watermark, reopened);
      final resumeIndex = reopenTrace.indexWhere(
        (r) =>
            r['method'] == 'thread/resume' &&
            r['threadId'] == first['threadId'],
      );
      expect(resumeIndex, greaterThanOrEqualTo(0));
      expect(reopenTrace[resumeIndex + 1]['method'], 'thread/read');
      expect(reopenTrace[resumeIndex + 1]['threadId'], first['threadId']);
      await _canonicalAnswer(tester);
      _canonical(desktop, expected);
      await _capture(tester, 'HISTORY');
      expect(recorder.totalRequestAttempts, cloudBefore);
      expect(recorder.conversationMutationAttempts, 0);
      state = await _state();
      for (final key in [
        'threadStartAttemptCount',
        'threadCount',
        'turnStartCount',
        'turnCount',
      ]) {
        expect(state[key], (before[key] as int) + 1);
      }
      await desktop.threadList.saveNow();
      await desktop.threadList.store.flush();
      expect(desktop.threadList.localError, isNull);
      expect(tester.takeException(), isNull);
      await _qa('restore-fixture', {
        'platform': Platform.operatingSystem,
        'expected': {
          ...expected,
          'version': _version,
          'runId': _run,
          'processId': pid,
          'gateway': _quiet(state),
        },
      });
      debugPrint('DJL_REASONING_PREPARED $_run');
      debugPrint('DJL_REASONING_FINISHED $_run live');
    },
    timeout: const Timeout(Duration(seconds: 180)),
  );
}
