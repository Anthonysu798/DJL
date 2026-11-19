import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/advanced_test.dart' show sendComposer;

class NativeInputBinding extends AutomatedTestWidgetsFlutterBinding {
  @override
  bool get registerTestTextInput => false;
}

void main() {
  NativeInputBinding();
  testWidgets(
    'native send helper refocuses the same editable after an explicitly unfocused send',
    (tester) async {
      final text = TextEditingController();
      final sent = <String>[];
      final field = find.byKey(const Key('desktop_composer'));
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ListenableBuilder(
              listenable: text,
              builder: (context, _) => Column(
                children: [
                  TextField(
                    key: const Key('desktop_composer'),
                    controller: text,
                  ),
                  IconButton.filled(
                    tooltip: 'Send to desktop',
                    icon: const Icon(Icons.arrow_upward),
                    onPressed: text.text.isEmpty
                        ? null
                        : () {
                            sent.add(text.text);
                            text.clear();
                          },
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      try {
        final editable = tester.state<EditableTextState>(
          find.descendant(of: field, matching: find.byType(EditableText)),
        );
        await sendComposer(tester, 'Parent fixture');
        expect(sent, ['Parent fixture']);
        expect(text.text, isEmpty);
        expect(editable.widget.focusNode.hasFocus, isFalse);
        expect(tester.binding.focusedEditable, same(editable));
        await sendComposer(tester, '[echo] Native child follow-up');
        expect(sent, ['Parent fixture', '[echo] Native child follow-up']);
        expect(
          tester.state<EditableTextState>(
            find.descendant(of: field, matching: find.byType(EditableText)),
          ),
          same(editable),
        );
        expect(editable.widget.focusNode.hasFocus, isFalse);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        text.dispose();
      }
    },
  );
  testWidgets(
    'native send helper waits for the real filled button beneath its tooltip',
    (tester) async {
      final text = TextEditingController();
      Timer? enabling;
      var ready = false, sends = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StatefulBuilder(
              builder: (context, update) => Column(
                children: [
                  TextField(
                    key: const Key('desktop_composer'),
                    controller: text,
                    onChanged: (_) {
                      enabling = Timer(
                        const Duration(milliseconds: 500),
                        () => update(() => ready = true),
                      );
                    },
                  ),
                  IconButton.filled(
                    tooltip: 'Send to desktop',
                    icon: const Icon(Icons.arrow_upward),
                    onPressed: ready ? () => sends++ : null,
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      final button = find.byWidgetPredicate(
        (widget) => widget is IconButton && widget.tooltip == 'Send to desktop',
      );
      expect(tester.widget<IconButton>(button).onPressed, isNull);
      try {
        await sendComposer(tester, 'native readiness regression');
        expect(sends, 1);
        expect(text.text, 'native readiness regression');
        expect(tester.takeException(), isNull);
      } finally {
        enabling?.cancel();
        await tester.pumpWidget(const SizedBox());
        text.dispose();
      }
    },
  );
}
