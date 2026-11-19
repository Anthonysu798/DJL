import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_test/flutter_test.dart';
import 'desktop_conversation_fidelity_test.dart' show showConversation;
import 'desktop_new_chat_draft_test.dart' show finishDraft;
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop;

void main() {
  for (final brightness in Brightness.values) {
    for (final scale in [1.0, 2.2]) {
      testWidgets(
        'settled paired Copy has source spacing at $brightness scale $scale',
        (tester) async {
          await tester.binding.setSurfaceSize(const Size(320, 844));
          final transport = ReasoningTransport()
            ..history = {
              'id': 'thread',
              'turns': [
                {
                  'id': 'turn',
                  'status': 'completed',
                  'items': [
                    {
                      'id': 'answer',
                      'type': 'agentMessage',
                      'text': 'Public completed answer',
                    },
                  ],
                },
              ],
            };
          final desktop = await reasoningDesktop(transport);
          try {
            await showConversation(
              tester,
              desktop,
              brightness: brightness,
              scale: scale,
              keyboard: 280,
            );
            final body = find.byType(MarkdownBody);
            final copy = find.byTooltip('Copy response');
            expect(body, findsOneWidget);
            expect(copy, findsOneWidget);
            expect(
              tester.getTopLeft(copy).dy - tester.getBottomLeft(body).dy,
              closeTo(4, .001),
            );
            expect(tester.getSize(copy).width, greaterThanOrEqualTo(44));
            expect(tester.getSize(copy).height, greaterThanOrEqualTo(44));
            expect(find.byTooltip('Read aloud'), findsNothing);
            expect(find.byTooltip('Stop reading'), findsNothing);
            expect(find.byTooltip('Start dictation'), findsOneWidget);
            expect(tester.takeException(), isNull);
          } finally {
            await finishDraft(tester, desktop);
            await tester.binding.setSurfaceSize(null);
          }
        },
      );
    }
  }
}
