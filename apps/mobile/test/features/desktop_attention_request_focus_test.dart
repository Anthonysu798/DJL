import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'desktop_attention_projection_test.dart' show question;
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, ReasoningPairings, reasoningDesktop;
import 'desktop_root_routing_test.dart' show savedPair;
import 'desktop_new_chat_draft_test.dart' show finishDraft;

void main() {
  for (final target in [0, '0']) {
    testWidgets(
      'review focuses exact ${target is int ? 'integer' : 'string'} RPC request without answering',
      (tester) async {
        final transport = ReasoningTransport();
        (transport.pairings as ReasoningPairings).pair = savedPair('mac-a');
        final desktop = await reasoningDesktop(transport);
        try {
          final ids = <Object>[0, for (var i = 0; i < 8; i++) 'filler-$i', '0'];
          for (final id in ids) {
            final request = question(id, 'thread');
            final body = (request['params'] as Map)['questions'] as List;
            (body.single as Map)['header'] = 'Review request';
            (body.single as Map)['question'] =
                'Question for ${id is int ? 'integer' : 'string'} $id';
            transport.events.add(request);
          }
          final sentBefore = transport.sent.length;
          await tester.pumpWidget(
            MaterialApp(
              home: DesktopChatPage(
                controller: desktop,
                focusTarget: DesktopLinkTarget('thread', request: target),
              ),
            ),
          );
          await tester.pumpAndSettle();
          final prompt =
              'Question for ${target is int ? 'integer' : 'string'} $target';
          expect(find.text(prompt).hitTestable(), findsOneWidget);
          expect(
            find.text(
              'Linked position is not available in the loaded history.',
            ),
            findsNothing,
          );
          expect(transport.sent, hasLength(sentBefore));
          expect(
            transport.calls.where(
              (call) => {
                'turn/start',
                'turn/interrupt',
                'thread/resume',
                'thread/goal/set',
              }.contains(call['method']),
            ),
            isEmpty,
          );
          expect(tester.takeException(), isNull);
        } finally {
          await finishDraft(tester, desktop);
        }
      },
    );
  }
}
