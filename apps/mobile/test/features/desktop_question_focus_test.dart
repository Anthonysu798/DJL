import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_composer_panel.dart';
import 'desktop_question_cancellation_test.dart'
    show QuestionCancelTransport, questionPrompt;
import 'desktop_history_reconciliation_test.dart' show historyDesktop;
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';

bool composerFocused(WidgetTester tester) {
  final finder = find.descendant(
    of: find.byType(DesktopComposerPanel),
    matching: find.byType(TextField),
  );
  return finder.evaluate().isNotEmpty &&
      tester.widget<TextField>(finder).focusNode!.hasFocus;
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final resolvedFirst in [false, true]) {
    testWidgets(
      'explicit successful ESC restores focus resolvedFirst=$resolvedFirst',
      (tester) async {
        final t = QuestionCancelTransport()..interrupt = Completer();
        final d = (await tester.runAsync(
          () => historyDesktop(t, [], running: true),
        ))!;
        final q = questionPrompt(t, d);
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox());
          d.dispose();
        });
        await tester.pumpWidget(
          MaterialApp(home: DesktopChatPage(controller: d)),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('ESC'));
        await tester.pump();
        if (resolvedFirst) {
          t.events.add({
            'method': 'serverRequest/resolved',
            'params': {'requestId': q['id']},
          });
          await tester.pumpAndSettle();
          expect(composerFocused(tester), isFalse);
        }
        t.interrupt!.complete({});
        await tester.pumpAndSettle();
        expect(composerFocused(tester), isTrue);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'spontaneous question resolution does not request composer focus',
    (tester) async {
      final t = QuestionCancelTransport();
      final d = (await tester.runAsync(
        () => historyDesktop(t, [], running: true),
      ))!;
      final q = questionPrompt(t, d);
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        d.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: d)),
      );
      await tester.pumpAndSettle();
      t.events.add({
        'method': 'serverRequest/resolved',
        'params': {'requestId': q['id']},
      });
      await tester.pumpAndSettle();
      expect(composerFocused(tester), isFalse);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('a route opened during ESC keeps its focus after ACK', (
    tester,
  ) async {
    final t = QuestionCancelTransport()..interrupt = Completer();
    final d = (await tester.runAsync(
      () => historyDesktop(t, [], running: true),
    ))!;
    questionPrompt(t, d);
    final nav = GlobalKey<NavigatorState>();
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox());
      d.dispose();
    });
    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: nav,
        home: DesktopChatPage(controller: d),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('ESC'));
    await tester.pump();
    final focus = FocusNode();
    addTearDown(focus.dispose);
    unawaited(
      nav.currentState!.push(
        MaterialPageRoute<void>(
          builder: (_) =>
              Scaffold(body: TextField(focusNode: focus, autofocus: true)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(focus.hasFocus, isTrue);
    t.interrupt!.complete({});
    await tester.pumpAndSettle();
    expect(focus.hasFocus, isTrue);
    nav.currentState!.pop();
    await tester.pumpAndSettle();
    expect(composerFocused(tester), isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('completed ESC focus is not replayed after a later route visit', (
    tester,
  ) async {
    final t = QuestionCancelTransport()..interrupt = Completer();
    final d = (await tester.runAsync(
      () => historyDesktop(t, [], running: true),
    ))!;
    questionPrompt(t, d);
    final nav = GlobalKey<NavigatorState>();
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox());
      d.dispose();
    });
    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: nav,
        home: DesktopChatPage(controller: d),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('ESC'));
    t.interrupt!.complete({});
    await tester.pumpAndSettle();
    expect(composerFocused(tester), isTrue);
    final input = tester.widget<TextField>(
      find.descendant(
        of: find.byType(DesktopComposerPanel),
        matching: find.byType(TextField),
      ),
    );
    input.focusNode!.unfocus();
    await tester.pumpAndSettle();
    expect(composerFocused(tester), isFalse);
    unawaited(
      nav.currentState!.push(
        MaterialPageRoute<void>(
          builder: (_) => const Scaffold(body: Text('Other page')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    nav.currentState!.pop();
    await tester.pumpAndSettle();
    expect(composerFocused(tester), isFalse);
    expect(tester.takeException(), isNull);
  });

  for (final outcome in ['rejected', 'new question', 'other thread']) {
    testWidgets('ESC completion does not steal focus after $outcome', (
      tester,
    ) async {
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
        MaterialApp(home: DesktopChatPage(controller: d)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('ESC'));
      await tester.pump();
      if (outcome == 'rejected') {
        t.interrupt!.completeError(StateError('QA focus rejection'));
      } else {
        if (outcome == 'new question') {
          questionPrompt(t, d, id: 'q2', turn: 'new-turn');
        } else {
          d.thread = {'id': 'replacement', 'cwd': '/qa'};
          d.setPlan(false);
        }
        t.interrupt!.complete({});
      }
      await tester.pumpAndSettle();
      expect(composerFocused(tester), isFalse);
      if (outcome != 'other thread') {
        expect(find.byType(DesktopComposerPanel), findsNothing);
      }
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets(
    'restored focused composer stays safe with large text and keyboard',
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
            data: MediaQuery.of(context).copyWith(
              textScaler: TextScaler.linear(2.2),
              viewInsets: const EdgeInsets.only(bottom: 300),
            ),
            child: child!,
          ),
          home: DesktopChatPage(controller: d),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('ESC'));
      await tester.tap(find.text('ESC'));
      t.interrupt!.complete({});
      await tester.pumpAndSettle();
      expect(composerFocused(tester), isTrue);
      expect(tester.takeException(), isNull);
    },
  );
}
