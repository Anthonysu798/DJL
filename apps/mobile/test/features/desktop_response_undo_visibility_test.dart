import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/workspace/domain/response_change_set.dart';
import 'desktop_conversation_fidelity_test.dart' show showConversation;
import 'desktop_new_chat_draft_test.dart' show finishDraft;
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop;
import 'response_change_set_test.dart' show patch;

void main() {
  for (final kind in [
    'empty',
    'path',
    'aggregate',
    'batch',
    'incomplete',
    'reverted',
  ]) {
    testWidgets('response Undo visibility follows $kind change evidence', (
      tester,
    ) async {
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
                  'text': 'Public reply',
                },
              ],
            },
          ],
        };
      final desktop = await reasoningDesktop(transport);
      final entry =
          desktop.threadList.data.responseChanges.entry(
              'thread',
              'turn',
              '/repo',
            )
            ..assistant = 'answer'
            ..terminal = true;
      switch (kind) {
        case 'path':
          entry.evidence.add('a.txt');
        case 'aggregate':
          entry.aggregate = ResponsePatch('turn', patch);
        case 'batch':
          entry.batches.add(ResponsePatch('operation', patch));
        case 'incomplete':
          entry.incompleteOperations.add('unknown-file-change');
        case 'reverted':
          entry.evidence.add('a.txt');
          entry.reverted = true;
      }
      try {
        await showConversation(tester, desktop);
        expect(find.text('Public reply'), findsOneWidget);
        expect(find.byTooltip('Copy response'), findsOneWidget);
        expect(find.byTooltip('Read aloud'), findsNothing);
        if (kind == 'empty') {
          expect(find.text('Undo this response'), findsNothing);
        } else {
          final label = kind == 'reverted'
              ? 'Response undone'
              : 'Undo this response';
          expect(find.text(label), findsOneWidget);
          final action = tester.widget<TextButton>(
            find.ancestor(
              of: find.text(label),
              matching: find.byWidgetPredicate(
                (widget) => widget is TextButton,
              ),
            ),
          );
          expect(action.onPressed == null, kind != 'batch');
        }
        expect(
          transport.calls.where(
            (call) =>
                (call['method'] as String).startsWith('workspace/revertPatch'),
          ),
          isEmpty,
        );
      } finally {
        await finishDraft(tester, desktop);
      }
    });
  }
}
