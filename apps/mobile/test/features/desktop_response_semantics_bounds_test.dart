import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_conversation_view.dart';
import 'desktop_conversation_fidelity_test.dart' show showConversation;
import 'desktop_new_chat_draft_test.dart' show finishDraft;
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop;

void main() {
  for (final scale in [1.0, 2.2]) {
    for (final keyboard in [0.0, 308.0]) {
      testWidgets(
        'message semantics exclude Copy at scale $scale keyboard $keyboard',
        (tester) async {
          tester.view.physicalSize = const Size(402, 874);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final handle = tester.ensureSemantics();
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
                      'text': 'A complete reply.',
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
              scale: scale,
              keyboard: keyboard,
            );
            final message = find.byType(DesktopConversationMessage);
            final copy = find.bySemanticsLabel('Copy response');
            expect(message, findsOneWidget);
            expect(copy, findsOneWidget);
            final node = tester.getSemantics(message);
            final body = tester.getRect(message);
            final footer = tester.getRect(copy);
            expect(node.rect.height, lessThanOrEqualTo(body.height + .01));
            expect(body.bottom, lessThanOrEqualTo(footer.top));
          } finally {
            await finishDraft(tester, desktop);
            handle.dispose();
          }
        },
      );
    }
  }
}
