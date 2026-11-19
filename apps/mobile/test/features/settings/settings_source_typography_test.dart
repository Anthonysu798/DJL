import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import 'package:djl_mobile/features/settings/presentation/settings_group.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:djl_mobile/core/design/djl_icons.dart';

Future<void> showSourceRows(
  WidgetTester tester, {
  Brightness brightness = Brightness.light,
  TextScaler textScaler = TextScaler.noScaling,
  String value = 'Extra high',
  ValueChanged<String>? onChanged,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(brightness, font: AppFontStyle.geistMono),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: textScaler),
        child: child!,
      ),
      home: Scaffold(
        body: Padding(
          padding: const EdgeInsets.all(16),
          child: SingleChildScrollView(
            child: SettingsGroup(
              title: 'Composer Defaults',
              footer: 'Used for new chats.',
              children: [
                SettingsMenuRow<String>(
                  label: 'Reasoning',
                  valueLabel: value,
                  value: 'high',
                  options: const {'auto': 'Auto', 'high': 'Extra high'},
                  onChanged: onChanged,
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

RenderParagraph paragraph(WidgetTester tester, String text) =>
    tester.renderObject<RenderParagraph>(find.text(text));

void main() {
  for (final brightness in Brightness.values) {
    testWidgets('shared Settings rows use Swift semantic sizes in $brightness', (
      tester,
    ) async {
      await showSourceRows(tester, brightness: brightness, onChanged: (_) {});
      // SettingsBaseComponents uses AppFont.body/subheadline/footnote/caption2;
      // the actual AppFont source defines these as 15/14/12/10 points.
      final expected = {
        'Composer Defaults': 14.0,
        'Reasoning': 15.0,
        'Extra high': 14.0,
        'Used for new chats.': 12.0,
      };
      for (final entry in expected.entries) {
        final style = (paragraph(tester, entry.key).text as TextSpan).style!;
        expect(style.fontSize, entry.value, reason: entry.key);
        expect(style.fontFamily, 'GeistMono');
      }
      expect(
        tester.widget<Icon>(find.byIcon(DjlIcons.expandVertical)).size,
        10,
      );
      final changed = <String>[];
      await showSourceRows(
        tester,
        brightness: brightness,
        onChanged: changed.add,
      );
      await tester.tap(find.text('Reasoning'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Auto').last);
      await tester.pumpAndSettle();
      expect(changed, ['auto']);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('Settings links inherit source body and subtitle sizes', (
    tester,
  ) async {
    var taps = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: djlTheme(Brightness.light, font: AppFontStyle.geistMono),
        home: Scaffold(
          body: SettingsGroup(
            title: 'Device',
            children: [
              ListTile(
                title: const Text('Computer Name'),
                subtitle: const Text('Public QA Device'),
                onTap: () => taps++,
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    for (final entry in {
      'Computer Name': 15.0,
      'Public QA Device': 12.0,
    }.entries) {
      final style = (paragraph(tester, entry.key).text as TextSpan).style!;
      expect(style.fontSize, entry.value);
      expect(style.fontFamily, 'GeistMono');
    }
    await tester.tap(find.text('Computer Name'));
    await tester.pumpAndSettle();
    expect(taps, 1);
  });

  testWidgets('large narrow Settings values stay on one source-shaped line', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const value = 'A long public QA model display name';
    const scale = TextScaler.linear(2.2);
    await showSourceRows(tester, textScaler: scale, value: value);
    final rendered = paragraph(tester, value);
    final boxes = rendered.getBoxesForSelection(
      const TextSelection(baseOffset: 0, extentOffset: value.length),
    );
    expect(boxes.map((box) => box.top).toSet(), hasLength(1));
    expect(
      rendered.textScaler.scale(14),
      greaterThanOrEqualTo(scale.scale(14) * .85),
    );
    expect(
      rendered.getTransformTo(null).getMaxScaleOnAxis(),
      greaterThanOrEqualTo(.85),
    );
    final semantics = tester.ensureSemantics();
    expect(
      tester
          .getSemantics(find.byType(SettingsMenuRow<String>))
          .getSemanticsData()
          .value,
      value,
    );
    semantics.dispose();
    expect(tester.takeException(), isNull);
  });
}
