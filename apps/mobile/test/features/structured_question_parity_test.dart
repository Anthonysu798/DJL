import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/structured_question_card.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';

RemoteJson parityRequest({
  String prompt = 'Choose a path',
  String description = 'First choice',
}) => {
  'id': 'same-request',
  'params': {
    'questions': [
      {
        'id': 'choice',
        'header': 'Direction',
        'question': prompt,
        'options': [
          {'label': 'A', 'description': description},
          {'label': 'B', 'description': 'Second choice'},
        ],
      },
      {
        'id': 'secret',
        'header': 'Details',
        'question': 'Disposable test value',
        'isSecret': true,
        'options': [],
      },
    ],
  },
};

Widget parityHost(
  RemoteJson request, {
  bool enabled = true,
  bool submitted = false,
  Future<void> Function(Map<String, List<String>>)? answer,
}) => MaterialApp(
  home: Scaffold(
    body: SingleChildScrollView(
      child: StructuredQuestionCard(
        key: const ValueKey('same-card'),
        request: request,
        enabled: enabled,
        submitted: submitted,
        onAnswer: answer ?? (_) async {},
        onCancel: () async {},
      ),
    ),
  ),
);

void main() {
  testWidgets(
    'a typed Other answer keeps source precedence over selected options',
    (tester) async {
      final q = Map<String, dynamic>.from(
        (parityRequest()['params']['questions'] as List).first,
      )..['isOther'] = true;
      Map<String, List<String>>? sent;
      await tester.pumpWidget(
        parityHost(
          {
            'params': {
              'questions': [q],
            },
          },
          answer: (answers) async {
            sent = answers;
          },
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('A'));
      await tester.enterText(find.byType(TextField), '  Other detail  ');
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Send'));
      await tester.tap(find.text('Send'));
      await tester.pumpAndSettle();
      expect(sent, {
        'choice': ['Other detail'],
      });
    },
  );

  testWidgets(
    'a pending answer locks fields and cancellation and sends only once',
    (tester) async {
      final gate = Completer<void>();
      var sent = 0;
      final request = <String, dynamic>{
        'params': {
          'questions': [
            {'id': 'free', 'question': 'Your detail?', 'options': []},
          ],
        },
      };
      await tester.pumpWidget(
        parityHost(
          request,
          answer: (_) async {
            sent++;
            await gate.future;
          },
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Disposable detail');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Send'));
      await tester.pump();
      expect(sent, 1);
      expect(find.text('Sending...'), findsOneWidget);
      expect(tester.widget<TextField>(find.byType(TextField)).readOnly, isTrue);
      expect(
        tester
            .widget<TextButton>(find.widgetWithText(TextButton, 'ESC'))
            .onPressed,
        isNull,
      );
      expect(
        tester
            .widget<TextButton>(find.widgetWithText(TextButton, 'Sending...'))
            .onPressed,
        isNull,
      );
      gate.complete();
      await tester.pumpAndSettle();
      expect(sent, 1);
      expect(tester.takeException(), isNull);
    },
  );

  for (final profile in [
    (const Size(320, 500), 2.2, 200.0),
    (const Size(280, 480), 3.0, 0.0),
  ]) {
    for (final brightness in Brightness.values) {
      testWidgets('paged controls stay reachable at $profile $brightness', (
        tester,
      ) async {
        tester.view.physicalSize = profile.$1;
        tester.view.devicePixelRatio = 1;
        tester.view.viewInsets = FakeViewPadding(bottom: profile.$3);
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.view.resetViewInsets);
        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(
              brightness: brightness,
              platform: TargetPlatform.iOS,
            ),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: TextScaler.linear(profile.$2),
                disableAnimations: true,
              ),
              child: child!,
            ),
            home: Scaffold(
              body: SingleChildScrollView(
                child: StructuredQuestionCard(
                  request: parityRequest(),
                  onAnswer: (_) async {},
                  onCancel: () async {},
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('A'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('A'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Next'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Next'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.byType(TextField));
        await tester.enterText(find.byType(TextField), 'QA value');
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Send'));
        await tester.pumpAndSettle();
        expect(
          tester.getRect(find.text('Send')).bottom,
          lessThanOrEqualTo(profile.$1.height - profile.$3 + 1),
        );
        expect(tester.takeException(), isNull);
      });
    }
  }
  testWidgets('a refreshed secret prompt clears its previous typed value', (
    tester,
  ) async {
    RemoteJson request(String prompt) => {
      'id': 'same-request',
      'params': {
        'questions': [
          {'id': 'secret', 'question': prompt, 'isSecret': true, 'options': []},
        ],
      },
    };
    await tester.pumpWidget(parityHost(request('Old prompt')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'old disposable value');
    await tester.pumpWidget(parityHost(request('Refreshed prompt')));
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      isEmpty,
    );
  });

  testWidgets(
    'a locked single choice cannot enable submission after unlocking',
    (tester) async {
      final request = parityRequest();
      request['params'] = <String, dynamic>{
        'questions': <dynamic>[(request['params']['questions'] as List).first],
      };
      await tester.pumpWidget(parityHost(request, enabled: false));
      await tester.pumpAndSettle();
      await tester.tap(find.text('A'));
      await tester.pumpAndSettle();
      await tester.pumpWidget(parityHost(request));
      await tester.pumpAndSettle();
      final label = find.text('Send').evaluate().isEmpty
          ? 'Send answers'
          : 'Send';
      final button = find
          .ancestor(
            of: find.text(label),
            matching: find.byWidgetPredicate((w) => w is ButtonStyleButton),
          )
          .first;
      expect(tester.widget<ButtonStyleButton>(button).onPressed, isNull);
    },
  );
  testWidgets(
    'source paging retains both answers and never sends while navigating',
    (tester) async {
      Map<String, List<String>>? sent;
      await tester.pumpWidget(
        parityHost(
          parityRequest(),
          answer: (answers) async {
            sent = answers;
          },
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Questions'), findsOneWidget);
      expect(find.text('1 of 2'), findsOneWidget);
      expect(find.text('Disposable test value'), findsNothing);
      await tester.tap(find.text('A'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      expect(find.text('2 of 2'), findsOneWidget);
      expect(find.text('Choose a path'), findsNothing);
      await tester.enterText(find.byType(TextField), '  disposable-value  ');
      expect(
        tester.widget<TextField>(find.byType(TextField)).obscureText,
        isTrue,
      );
      await tester.tap(find.text('Back'));
      await tester.pumpAndSettle();
      expect(sent, isNull);
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        '  disposable-value  ',
      );
      await tester.ensureVisible(find.text('Send'));
      await tester.tap(find.text('Send'));
      await tester.pumpAndSettle();
      expect(sent, {
        'choice': ['A'],
        'secret': ['disposable-value'],
      });
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'authoritative question refresh resets page, selection and typed input',
    (tester) async {
      await tester.pumpWidget(parityHost(parityRequest()));
      await tester.pumpAndSettle();
      await tester.tap(find.text('A'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'old disposable value');
      await tester.pumpWidget(
        parityHost(
          parityRequest(
            prompt: 'Updated path',
            description: 'Updated first choice',
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('1 of 2'), findsOneWidget);
      expect(find.text('Updated path'), findsOneWidget);
      expect(
        tester
            .widget<TextButton>(find.widgetWithText(TextButton, 'Next'))
            .onPressed,
        isNull,
      );
      await tester.tap(find.text('B'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('locked questions cannot acquire an answer before unlocking', (
    tester,
  ) async {
    await tester.pumpWidget(parityHost(parityRequest(), enabled: false));
    await tester.pumpAndSettle();
    await tester.tap(find.text('A'));
    await tester.pumpAndSettle();
    await tester.pumpWidget(parityHost(parityRequest()));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<TextButton>(find.widgetWithText(TextButton, 'Next'))
          .onPressed,
      isNull,
    );
    expect(find.text('1 of 2'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
