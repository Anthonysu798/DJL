import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'desktop_reasoning_controller_test.dart';
import 'package:djl_mobile/features/reasoning/domain/thinking_disclosure.dart';
import 'package:djl_mobile/features/reasoning/presentation/thinking_timeline_row.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';

import 'package:djl_mobile/core/design/djl_icons.dart';

Future<void> showThinking(
  WidgetTester tester,
  String text, {
  String id = 'host/thread/turn/item',
  double scale = 1,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(Brightness.light, font: AppFontStyle.geist),
      home: MediaQuery(
        data: MediaQueryData(textScaler: TextScaler.linear(scale)),
        child: Scaffold(
          body: SingleChildScrollView(
            child: ThinkingTimelineRow(messageId: id, text: text),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  test(
    'Swift parser heading detail fallback comment boundary and preamble cases',
    () {
      final parsed = ThinkingDisclosureParser.parse(
        '**Investigating scrolling issues**\n\nAuto-scroll follows count.\n\n**Examining triggers**\n\nThe existing row mutates.',
      );
      expect(parsed.sections.map((s) => s.title), [
        'Investigating scrolling issues',
        'Examining triggers',
      ]);
      expect(parsed.sections.map((s) => s.detail), [
        'Auto-scroll follows count.',
        'The existing row mutates.',
      ]);
      final fallback = ThinkingDisclosureParser.parse(
        'Thinking...\nI am checking. **Inline emphasis** stays.',
      );
      expect(fallback.sections, isEmpty);
      expect(
        fallback.fallbackText,
        'I am checking. **Inline emphasis** stays.',
      );
      final comments = ThinkingDisclosureParser.parse(
        '**First**\n\n<!-- -->**Second**\n<!-- -->',
      );
      expect(comments.sections.map((s) => s.title), ['First', 'Second']);
      expect(comments.sections.map((s) => s.detail), ['', '']);
      final repeated = ThinkingDisclosureParser.parse(
        'Preamble\n\n**Title**\nFirst snapshot.\n\n**Title**\nFirst snapshot.\n\nMore detail.',
      );
      expect(repeated.sections, hasLength(1));
      expect(
        repeated.sections.single.detail,
        'Preamble\n\nFirst snapshot.\n\nMore detail.',
      );
      expect(ThinkingDisclosureParser.parse('tHiNkInG').fallbackText, '');
    },
  );
  testWidgets(
    'detail starts collapsed semantic toggle expands selectable inline Markdown',
    (tester) async {
      final semantics = tester.ensureSemantics();
      await showThinking(
        tester,
        '**Inspecting**\nBefore  **bold**\n# literal block',
      );
      expect(find.byType(SelectableText), findsNothing);
      expect(
        tester.getSemantics(find.bySemanticsLabel('Inspecting')),
        matchesSemantics(
          label: 'Inspecting',
          isButton: true,
          hasTapAction: true,
          hasExpandedState: true,
        ),
      );
      await tester.tap(find.text('Inspecting'));
      await tester.pump();
      final selected = tester.widget<SelectableText>(
        find.byType(SelectableText),
      );
      expect(selected.textSpan!.toPlainText(), 'Before  bold\n# literal block');
      expect(selected.style!.fontFamily, 'Geist');
      expect(selected.style!.fontSize, 11);
      expect(find.byType(ExpansionTile), findsNothing);
      expect(find.byType(Card), findsNothing);
      semantics.dispose();
    },
  );
  testWidgets(
    'section expansion survives streaming detail but changes with full message identity',
    (tester) async {
      await showThinking(tester, '**Title**\nFirst');
      await tester.tap(find.text('Title'));
      await tester.pump();
      await showThinking(tester, '**Title**\nFirst more');
      expect(
        tester
            .widget<SelectableText>(find.byType(SelectableText))
            .textSpan!
            .toPlainText(),
        'First more',
      );
      await showThinking(
        tester,
        '**Title**\nOther',
        id: 'other-host/thread/turn/item',
      );
      expect(find.byType(SelectableText), findsNothing);
    },
  );
  testWidgets(
    'summary only is body15 max2 without chevron and empty body is absent',
    (tester) async {
      await showThinking(tester, '**Summary only**');
      final text = tester.widget<Text>(find.text('Summary only'));
      expect(text.style!.fontSize, 15);
      expect(text.style!.fontWeight, FontWeight.w400);
      expect(text.maxLines, 2);
      expect(find.byType(Icon), findsNothing);
      expect(find.byType(SelectableText), findsNothing);
      await showThinking(tester, 'Thinking...');
      expect(find.byType(Text), findsNothing);
      await showThinking(tester, 'Completed **real** text');
      expect(
        tester
            .widget<SelectableText>(find.byType(SelectableText))
            .textSpan!
            .toPlainText(),
        'Completed real text',
      );
    },
  );
  testWidgets('2.2 scale short viewport keeps heading and details scrollable', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 230);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await showThinking(
      tester,
      '**A long heading which wraps naturally**\n${List.filled(35, 'Readable detail.').join(' ')}',
      scale: 2.2,
    );
    await tester.tap(find.text('A long heading which wraps naturally'));
    await tester.pump();
    await tester.drag(
      find.byType(SingleChildScrollView),
      const Offset(0, -180),
    );
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.byType(SelectableText), findsOneWidget);
  });

  testWidgets(
    'summary reasoning is readable plain text without generic tool chrome',
    (tester) async {
      final t = ReasoningTransport();
      final d = (await tester.runAsync(() => reasoningDesktop(t)))!;
      start(t);
      reasoningEvent(
        t,
        'item/completed',
        snapshot: {
          'summary': ['**Checking files**'],
        },
      );
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: d)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Checking files'), findsOneWidget);
      expect(find.byType(ExpansionTile), findsNothing);
      expect(find.byIcon(DjlIcons.tool), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      d.dispose();
    },
  );
}
