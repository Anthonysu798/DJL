import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_composer_panel.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_history_reconciliation_test.dart' show historyDesktop;
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, ReasoningPairings;

class QuestionCancelTransport extends ReasoningTransport {
  Completer<RemoteJson>? interrupt;
  Object? failure;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method != 'turn/interrupt') {
      return super.request(method, params, timeout: timeout);
    }
    calls.add({'method': method, 'params': Map<String, dynamic>.from(params)});
    if (failure != null) throw failure!;
    return interrupt?.future ?? {};
  }
}

RemoteJson questionPrompt(
  QuestionCancelTransport t,
  DesktopController d, {
  Object id = 'q1',
  String? turn = 'question-turn',
}) {
  t.events.add({
    'id': id,
    'method': 'item/tool/requestUserInput',
    'params': {
      'threadId': 'thread',
      'turnId': ?turn,
      'questions': [
        {
          'id': 'choice',
          'header': 'Scope',
          'question': 'Choose scope',
          'options': [
            {'label': 'Only local QA', 'description': ''},
          ],
        },
      ],
    },
  });
  return d.pendingUserInputs.last;
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  test(
    'ESC removes owned prompts/session only after ACK and disarms Plan',
    () async {
      final t = QuestionCancelTransport()..interrupt = Completer();
      final d = await historyDesktop(t, [], running: true);
      addTearDown(d.dispose);
      final q = questionPrompt(t, d);
      d.setPlan(true);
      final closing = d.cancelQuestion(q);
      expect(d.pendingUserInputs, contains(q));
      expect(d.plan, isFalse);
      expect(d.threadList.data.planSessions['thread'], isNotNull);
      t.interrupt!.complete({});
      await closing;
      expect(d.pendingUserInputs, isEmpty);
      expect(d.threadList.data.planSessions['thread'], isNull);
      expect(
        t.calls.where((c) => c['method'] == 'turn/interrupt').single['params'],
        {'threadId': 'thread', 'turnId': 'question-turn'},
      );
    },
  );

  test('duplicate ESC sends only one interrupt', () async {
    final t = QuestionCancelTransport()..interrupt = Completer();
    final d = await historyDesktop(t, [], running: true);
    addTearDown(d.dispose);
    final q = questionPrompt(t, d);
    final first = d.cancelQuestion(q), second = d.cancelQuestion(q);
    t.interrupt!.complete({});
    await Future.wait([first, second]);
    expect(t.calls.where((c) => c['method'] == 'turn/interrupt'), hasLength(1));
  });

  test('answer cannot race an in-flight ESC', () async {
    final t = QuestionCancelTransport()..interrupt = Completer();
    final d = await historyDesktop(t, [], running: true);
    addTearDown(d.dispose);
    final q = questionPrompt(t, d);
    final closing = d.cancelQuestion(q);
    expect(d.isClosingQuestion(q), isTrue);
    expect(d.canRespond(q), isFalse);
    await d.answer(q, {
      'choice': ['Only local QA'],
    });
    expect(t.sent.where((rpc) => rpc.containsKey('id')), isEmpty);
    t.interrupt!.complete({});
    await closing;
    expect(d.isClosingQuestion(q), isFalse);
  });

  test(
    'foreign-thread cancellation cannot interrupt the selected thread',
    () async {
      final t = QuestionCancelTransport();
      final d = await historyDesktop(t, [], running: true);
      addTearDown(d.dispose);
      final q = questionPrompt(t, d);
      (q['params'] as Map)['threadId'] = 'other';
      await d.cancelQuestion(q);
      expect(t.calls.where((c) => c['method'] == 'turn/interrupt'), isEmpty);
    },
  );

  for (final failure in [
    StateError('rejected'),
    TimeoutException('unknown ACK'),
  ]) {
    test('failed cancellation retains prompt/session: $failure', () async {
      final t = QuestionCancelTransport()..failure = failure;
      final d = await historyDesktop(t, [], running: true);
      addTearDown(d.dispose);
      final q = questionPrompt(t, d);
      final session = d.threadList.data.planSessions['thread'];
      await d.cancelQuestion(q);
      expect(d.pendingUserInputs.single, same(q));
      expect(d.threadList.data.planSessions['thread'], same(session));
      expect(d.error, contains(failure.toString()));
    });
  }

  test(
    'foreign session and absent request cannot dispatch cancellation',
    () async {
      final t = QuestionCancelTransport();
      final d = await historyDesktop(t, [], running: true);
      addTearDown(d.dispose);
      final q = questionPrompt(t, d)..['_sessionId'] = 'different-session';
      await d.cancelQuestion(q);
      await d.cancelQuestion({
        'id': 'missing',
        'params': {'threadId': 'thread', 'turnId': 'old'},
      });
      expect(t.calls.where((c) => c['method'] == 'turn/interrupt'), isEmpty);
      expect(d.pendingUserInputs.single, same(q));
    },
  );

  test('new prompt/session arriving before old ACK survives', () async {
    final t = QuestionCancelTransport()..interrupt = Completer();
    final d = await historyDesktop(t, [], running: true);
    addTearDown(d.dispose);
    final closing = d.cancelQuestion(questionPrompt(t, d));
    final next = questionPrompt(t, d, id: 'q2', turn: 'new-turn');
    final session = d.threadList.data.planSessions['thread'];
    t.interrupt!.complete({});
    await closing;
    expect(d.pendingUserInputs, [next]);
    expect(d.threadList.data.planSessions['thread'], same(session));
  });

  test('same-ID replacement is not removed by old ACK', () async {
    final t = QuestionCancelTransport()..interrupt = Completer();
    final d = await historyDesktop(t, [], running: true);
    addTearDown(d.dispose);
    final closing = d.cancelQuestion(questionPrompt(t, d));
    final next = questionPrompt(t, d, turn: 'replacement-turn');
    t.interrupt!.complete({});
    await closing;
    expect(d.pendingUserInputs.single, same(next));
  });

  test(
    'resolved event before interrupt ACK still clears matching Plan session',
    () async {
      final t = QuestionCancelTransport()..interrupt = Completer();
      final d = await historyDesktop(t, [], running: true);
      addTearDown(d.dispose);
      final q = questionPrompt(t, d);
      final closing = d.cancelQuestion(q);
      t.events.add({
        'method': 'serverRequest/resolved',
        'params': {'requestId': q['id']},
      });
      expect(d.pendingUserInputs, isEmpty);
      expect(d.threadList.data.planSessions['thread'], isNotNull);
      t.interrupt!.complete({});
      await closing;
      expect(d.threadList.data.planSessions['thread'], isNull);
    },
  );

  test(
    'thread navigation prevents stale error changing replacement state',
    () async {
      final t = QuestionCancelTransport()..interrupt = Completer();
      final d = await historyDesktop(t, [], running: true);
      addTearDown(d.dispose);
      final closing = d.cancelQuestion(questionPrompt(t, d));
      d.thread = {'id': 'replacement', 'cwd': '/qa'};
      d.error = 'replacement error';
      t.interrupt!.completeError(StateError('old failure'));
      await closing;
      expect(d.error, 'replacement error');
    },
  );

  test(
    'connection replacement prevents stale ACK clearing restored prompt',
    () async {
      final t = QuestionCancelTransport()..interrupt = Completer();
      final d = await historyDesktop(t, [], running: true);
      addTearDown(d.dispose);
      final closing = d.cancelQuestion(questionPrompt(t, d));
      await d.disconnect();
      await d.connect((t.pairings as ReasoningPairings).pair);
      await d.openThread({
        'id': 'thread',
        'cwd': '/qa',
      }, readOnlyNavigation: true);
      final next = questionPrompt(t, d, turn: 'replacement-turn');
      t.interrupt!.complete({});
      await closing;
      expect(d.pendingUserInputs.single, same(next));
    },
  );

  test(
    'authoritative idle lookup permits local cleanup without interrupt',
    () async {
      final t = QuestionCancelTransport();
      final d = await historyDesktop(t, []);
      addTearDown(d.dispose);
      final q = questionPrompt(t, d, turn: null);
      d.turnId = null;
      await d.cancelQuestion(q);
      expect(
        t.calls.any(
          (c) => {'thread/read', 'thread/turns/list'}.contains(c['method']),
        ),
        isTrue,
      );
      expect(t.calls.where((c) => c['method'] == 'turn/interrupt'), isEmpty);
      expect(d.pendingUserInputs, isEmpty);
      expect(d.error, isNull);
    },
  );

  testWidgets(
    'native question replaces composer; ESC locks then restores draft',
    (tester) async {
      final t = QuestionCancelTransport()..interrupt = Completer();
      final d = (await tester.runAsync(
        () => historyDesktop(t, [], running: true),
      ))!;
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        d.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: d)),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.descendant(
          of: find.byType(DesktopComposerPanel),
          matching: find.byType(TextField),
        ),
        'Keep original draft',
      );
      final q = questionPrompt(t, d);
      await tester.pumpAndSettle();
      expect(find.byType(DesktopComposerPanel), findsNothing);
      expect(find.text('ESC'), findsOneWidget);
      await tester.tap(find.text('Only local QA'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('ESC'));
      await tester.pump();
      expect(find.text('Closing...'), findsOneWidget);
      expect(find.byType(DesktopComposerPanel), findsNothing);
      expect(d.pendingUserInputs, contains(q));
      t.interrupt!.complete({});
      await tester.pumpAndSettle();
      expect(find.byType(DesktopComposerPanel), findsOneWidget);
      expect(find.text('Keep original draft'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  for (final scale in [1.0, 2.2]) {
    testWidgets(
      'failed ESC retains selected answers and scroll-safe form at scale $scale',
      (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final t = QuestionCancelTransport()..interrupt = Completer();
        final d = (await tester.runAsync(
          () => historyDesktop(t, [], running: true),
        ))!;
        questionPrompt(t, d);
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox());
          d.dispose();
        });
        await tester.pumpWidget(
          MaterialApp(
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(scale)),
              child: child!,
            ),
            home: DesktopChatPage(controller: d),
          ),
        );
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Only local QA'));
        await tester.tap(find.text('Only local QA'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('ESC'));
        await tester.tap(find.text('ESC'));
        await tester.pump();
        expect(find.text('Closing...'), findsOneWidget);
        t.interrupt!.completeError(StateError('QA cancellation rejected'));
        await tester.pumpAndSettle();
        expect(find.text('ESC'), findsOneWidget);
        expect(find.textContaining('QA cancellation rejected'), findsOneWidget);
        expect(find.byType(DesktopComposerPanel), findsNothing);
        expect(
          find.widgetWithText(TextButton, 'Send').evaluate().single.widget,
          isA<TextButton>().having(
            (b) => b.onPressed,
            'retained answer enables Send',
            isNotNull,
          ),
        );
        expect(t.sent.where((rpc) => rpc.containsKey('id')), isEmpty);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
