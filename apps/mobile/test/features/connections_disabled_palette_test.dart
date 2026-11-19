import 'dart:async';
import 'dart:ui' show Tristate;
import 'package:flutter/cupertino.dart' show CupertinoColors;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show RenderParagraph;
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'desktop_connected_switch_test.dart';
import 'desktop_connected_switch_widget_test.dart' show openConnectionSwitcher;
import 'pairing_presentation_test.dart' show paintedColors;

void closeColor(Color actual, Color expected) {
  for (final channel in [
    (actual.r, expected.r),
    (actual.g, expected.g),
    (actual.b, expected.b),
    (actual.a, expected.a),
  ]) {
    expect(
      channel.$1,
      closeTo(channel.$2, 2 / 255),
      reason: 'Rendered $actual must match source composite $expected',
    );
  }
}

void main() {
  setUpAll(() async {
    await (FontLoader('Geist')
          ..addFont(rootBundle.load('assets/fonts/Geist-Regular.ttf'))
          ..addFont(rootBundle.load('assets/fonts/Geist-SemiBold.ttf')))
        .load();
  });
  for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
    for (final brightness in Brightness.values) {
      testWidgets(
        'Connections disabled ON and OFF paint preserve source state on $platform/$brightness',
        (tester) async {
          tester.view.physicalSize = const Size(402, 874);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final semantics = tester.ensureSemantics();
          final f = await switchFixture();
          try {
            await f.pairs.trust(switchPair('C'));
            await f.pairs.trust(switchPair('A'));
            await f.desktop.restore();
            await f.desktop.setDeviceMenuVisibility(
              f.desktop.devicePreferences(switchPair('C'))!,
              false,
            );
            final theme = djlTheme(
              brightness,
              font: AppFontStyle.geist,
            ).copyWith(platform: platform);
            await tester.pumpWidget(
              RepaintBoundary(
                key: const Key('pairing_paint'),
                child: MaterialApp(
                  theme: theme,
                  home: PairingPage(controller: f.desktop),
                ),
              ),
            );
            await tester.tap(find.byTooltip('More actions'));
            await tester.pumpAndSettle();
            await tester.tap(find.text('Connections'));
            await tester.pumpAndSettle();
            final on = find.byKey(const ValueKey('device_visibility_B'));
            final off = find.byKey(const ValueKey('device_visibility_C'));
            final context = tester.element(on);
            final group = brightness == Brightness.dark
                ? theme.colorScheme.surfaceContainerHigh
                : theme.colorScheme.surface;
            final green = CupertinoColors.systemGreen.resolveFrom(context);
            final neutral = Color(
              brightness == Brightness.dark ? 0xff656569 : 0xffc5c5c7,
            );
            final before = Map<String, String>.of(f.credentials.values);
            Future<List<Color>> samples() async {
              final a = tester.getRect(on), b = tester.getRect(off);
              return paintedColors(tester, [
                a.center + const Offset(-14, 0),
                a.center + const Offset(10, 0),
                b.center + const Offset(14, 0),
                b.center + const Offset(-10, 0),
              ]);
            }

            final enabled = await samples();
            closeColor(enabled[0], green);
            closeColor(enabled[1], Colors.white);
            closeColor(enabled[2], neutral);
            closeColor(enabled[3], Colors.white);
            f.pairs.resolveGate = Completer();
            await openConnectionSwitcher(tester);
            await tester.tap(find.byKey(const ValueKey('device_choice_B')));
            await tester.pump();
            await tester.pump(const Duration(milliseconds: 400));
            expect(find.text('Switching device…'), findsOneWidget);
            for (final row in [(on, true), (off, false)]) {
              final flags = tester.getSemantics(row.$1).flagsCollection;
              expect(
                flags.isToggled,
                row.$2 ? Tristate.isTrue : Tristate.isFalse,
              );
              expect(flags.isEnabled, Tristate.isFalse);
            }
            final name = find.descendant(
              of: find.byKey(const ValueKey('device_row_B')),
              matching: find.text('Mac B'),
            );
            expect(
              tester
                  .renderObject<RenderParagraph>(name)
                  .text
                  .style!
                  .color!
                  .toARGB32(),
              theme.colorScheme.onSurface.toARGB32(),
            );
            final card = tester.getRect(
              find.byKey(const Key('device_switch_progress')),
            );
            for (final point in [
              tester.getCenter(on) + const Offset(-14, 0),
              tester.getCenter(off) + const Offset(14, 0),
            ]) {
              expect(
                card.contains(point),
                isFalse,
                reason: 'Sample the visible switch, not the overlay card',
              );
            }
            final disabled = await samples();
            Color composite(Color base) => Color.alphaBlend(
              Colors.black.withValues(alpha: .12),
              Color.alphaBlend(base.withValues(alpha: base.a * .5), group),
            );
            closeColor(disabled[0], composite(green));
            closeColor(disabled[1], composite(Colors.white));
            closeColor(disabled[2], composite(neutral));
            closeColor(disabled[3], composite(Colors.white));
            expect(f.credentials.values, before);
            expect(
              f.desktop.devicePreferences(switchPair('B'))!.visibleInMenu,
              isTrue,
            );
            expect(
              f.desktop.devicePreferences(switchPair('C'))!.visibleInMenu,
              isFalse,
            );
            expect(tester.takeException(), isNull);
          } finally {
            if (f.desktop.switchingDevice != null) {
              await f.desktop.cancelSavedSwitch();
            }
            if (f.pairs.resolveGate case final gate?) {
              if (!gate.isCompleted) {
                gate.complete(switchPair('B'));
              }
            }
            await tester.pumpWidget(const SizedBox.shrink());
            f.desktop.dispose();
            await tester.pump();
            semantics.dispose();
          }
        },
      );
    }
  }
}
