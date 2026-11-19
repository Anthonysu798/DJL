import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'desktop_conversation_fidelity_test.dart' show showConversation;
import 'desktop_new_chat_draft_test.dart' show finishDraft;
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop;

void main() {
  for (final longHistory in [false, true]) {
    testWidgets(
      'actual Page renders a completed canonical summary with long history=$longHistory',
      (tester) async {
        tester.view.physicalSize = const Size(393, 881);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final transport = ReasoningTransport()
          ..history = {
            'id': 'thread',
            'modelProvider': 'codex',
            'model': 'gpt-6.1-terra',
            'turns': [
              if (longHistory)
                {
                  'id': 'older',
                  'status': 'completed',
                  'items': [
                    {
                      'id': 'old-answer',
                      'type': 'agentMessage',
                      'text': List.generate(
                        1000,
                        (i) => '${i + 1}. Public desk tip.',
                      ).join('\n'),
                    },
                  ],
                },
              {
                'id': 'prompt-turn',
                'status': 'completed',
                'items': [
                  {
                    'id': 'prompt',
                    'type': 'userMessage',
                    'content': [
                      {
                        'type': 'inputText',
                        'text': 'Public modular arithmetic question',
                      },
                    ],
                  },
                ],
              },
              {
                'id': 'actual-turn',
                'status': 'completed',
                'items': [
                  {
                    'id': 'reasoning-public-id',
                    'type': 'reasoning',
                    'summary': ['**Computing the modular solution**'],
                    'content': <String>[],
                    'createdAt': '2026-11-18T00:34:57.791Z',
                  },
                  {
                    'id': 'answer',
                    'type': 'agentMessage',
                    'content': [
                      {'type': 'outputText', 'text': 'n = 840,256'},
                    ],
                    'createdAt': '2026-11-18T00:34:57.797Z',
                  },
                ],
              },
            ],
          };
        final desktop = await reasoningDesktop(transport);
        try {
          await showConversation(tester, desktop);
          final disclosure = find.text('1 previous message');
          expect(disclosure, findsOneWidget);
          expect(
            tester.getRect(disclosure).top,
            greaterThan(
              tester
                  .getRect(find.text('Public modular arithmetic question'))
                  .bottom,
            ),
          );
          await tester.tap(disclosure);
          await tester.pumpAndSettle();
          expect(find.text('Computing the modular solution'), findsOneWidget);
          expect(tester.takeException(), isNull);
        } finally {
          await finishDraft(tester, desktop);
        }
      },
    );
  }
}
