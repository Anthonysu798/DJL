import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/settings/presentation/about_djl_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';

const runtimeNote =
    'The Codex runtime stays on your paired device. '
    'Your phone is a secure remote control connected through a relay.';

Future<void> showGuide(
  WidgetTester tester,
  Brightness brightness,
  double scale,
) async {
  tester.view.physicalSize = const Size(320, 700);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(brightness),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: const AboutDjlPage(),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  for (final brightness in Brightness.values) {
    for (final scale in [1.0, 2.2]) {
      testWidgets(
        'guide callout has source icon layout in $brightness/$scale',
        (tester) async {
          await showGuide(tester, brightness, scale);
          final note = find.text(runtimeNote);
          final card = find
              .ancestor(of: note, matching: find.byType(DecoratedBox))
              .first;
          final icon = find.descendant(
            of: card,
            matching: find.byType(SvgPicture),
          );
          expect(icon, findsOneWidget);
          expect(
            tester.getRect(icon).right,
            lessThan(tester.getRect(note).left),
          );
          expect(
            tester.getRect(note).left - tester.getRect(card).left,
            greaterThanOrEqualTo(54),
          );
          expect(tester.getRect(card).right, lessThanOrEqualTo(300));
          expect(tester.takeException(), isNull);
        },
      );

      testWidgets(
        'guide flow remains readable through footer in $brightness/$scale',
        (tester) async {
          final handle = tester.ensureSemantics();
          try {
            await showGuide(tester, brightness, scale);
            await tester.scrollUntilVisible(
              find.text('JSONL rollout'),
              220,
              maxScrolls: 40,
            );
            await tester.pumpAndSettle();
            final route = find.bySemanticsLabel(
              'DJL Mobile to Bridge on your paired device via WebSocket',
            );
            expect(route, findsOneWidget);
            expect(
              tester.getSemantics(route).flagsCollection.isButton,
              isFalse,
            );
            await tester.scrollUntilVisible(
              find.text('MIT License'),
              400,
              maxScrolls: 80,
            );
            await tester.pumpAndSettle();
            expect(find.text('MIT License').hitTestable(), findsOneWidget);
            expect(find.text('Open source'), findsOneWidget);
            expect(tester.takeException(), isNull);
          } finally {
            handle.dispose();
          }
        },
      );
    }
  }
}
