import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/structured_question_card.dart';

void main() {
  testWidgets(
    'question options respect selection limit and secret text is obscured',
    (tester) async {
      Map<String, List<String>>? result;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: StructuredQuestionCard(
                request: {
                  'id': 'request',
                  'params': {
                    'questions': [
                      {
                        'id': 'choice',
                        'question': 'Choose one',
                        'options': [
                          {'label': 'A', 'description': 'First'},
                          {'label': 'B', 'description': 'Second'},
                        ],
                        'selectionLimit': 1,
                      },
                      {
                        'id': 'secret',
                        'question': 'Test secret',
                        'isSecret': true,
                        'options': [],
                      },
                    ],
                  },
                },
                onAnswer: (answers) async {
                  result = answers;
                },
                onCancel: () async {},
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('A'));
      await tester.pump();
      await tester.tap(find.text('B'));
      await tester.pump();
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      final field = find.byType(TextField);
      await tester.enterText(field, 'disposable-test-value');
      await tester.pump();
      expect(tester.widget<TextField>(field).obscureText, isTrue);
      await tester.ensureVisible(find.text('Send'));
      await tester.tap(find.text('Send'));
      await tester.pumpAndSettle();
      expect(result, {
        'choice': ['B'],
        'secret': ['disposable-test-value'],
      });
      expect(tester.takeException(), isNull);
    },
  );
}
