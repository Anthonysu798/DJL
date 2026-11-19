import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import 'desktop_conversation_fidelity_test.dart' show showConversation;
import 'desktop_new_chat_draft_test.dart' show finishDraft;
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop;

const _method = 'item/commandExecution/requestApproval';

void _request(ReasoningTransport transport, Map<String, dynamic> params) {
  transport.events.add({
    'id': 'approval-display',
    'method': _method,
    'params': {'threadId': 'thread', 'turnId': 'turn', ...params},
  });
}

void main() {
  for (final (name, params, expected)
      in <(String, Map<String, dynamic>, String)>[
        (
          'command over reason',
          {'command': 'printf "QA"', 'reason': 'Public reason'},
          'printf "QA"',
        ),
        (
          'empty command',
          {'command': '', 'reason': 'Public reason'},
          'Public reason',
        ),
        ('empty fields', {'command': '', 'reason': ''}, _method),
        (
          'non-string command',
          {
            'command': {'script': 'not a command'},
            'reason': 'Public reason',
          },
          'Public reason',
        ),
        (
          'non-string fields',
          {
            'command': ['not', 'a string'],
            'reason': 42,
          },
          _method,
        ),
        (
          'raw command',
          {'command': '  printf "QA"\n', 'reason': 'Public reason'},
          '  printf "QA"\n',
        ),
      ]) {
    testWidgets('approval display uses $name', (tester) async {
      final transport = ReasoningTransport();
      final desktop = await reasoningDesktop(transport);
      _request(transport, params);
      try {
        await showConversation(tester, desktop);
        expect(find.text(expected), findsOneWidget);
        if (params['reason'] == 'Public reason' &&
            expected != 'Public reason') {
          expect(find.text('Public reason'), findsNothing);
        }
        expect(find.text('Approve once'), findsOneWidget);
        expect(find.text('Decline'), findsOneWidget);
        expect(
          transport.sent.where(
            (message) => message['id'] == 'approval-display',
          ),
          isEmpty,
        );
      } finally {
        await finishDraft(tester, desktop);
      }
    });
  }

  for (final (brightness, font, family) in [
    (Brightness.light, AppFontStyle.system, 'JetBrainsMono'),
    (Brightness.dark, AppFontStyle.geistMono, 'GeistMono'),
  ]) {
    testWidgets('approval command respects $font with large text and IME', (
      tester,
    ) async {
      await tester.binding.setSurfaceSize(const Size(320, 640));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      const command =
          'printf "%s\\n" "Public fixture"\n'
          'printf "%s\\n" "Second public line"';
      final transport = ReasoningTransport();
      final desktop = await reasoningDesktop(transport);
      _request(transport, {'command': command});
      try {
        await showConversation(
          tester,
          desktop,
          brightness: brightness,
          font: font,
          scale: 2.2,
          keyboard: 220,
        );
        final text = tester.widget<SelectableText>(
          find.byWidgetPredicate(
            (widget) => widget is SelectableText && widget.data == command,
          ),
        );
        expect(text.style?.fontFamily, family);
        await tester.ensureVisible(find.text('Approve once'));
        await tester.pumpAndSettle();
        expect(find.text('Approve once').hitTestable(), findsOneWidget);
        await tester.ensureVisible(find.text('Decline'));
        await tester.pumpAndSettle();
        expect(find.text('Decline').hitTestable(), findsOneWidget);
        expect(tester.takeException(), isNull);
        expect(
          transport.sent.where(
            (message) => message['id'] == 'approval-display',
          ),
          isEmpty,
        );
      } finally {
        await finishDraft(tester, desktop);
      }
    });
  }
}
