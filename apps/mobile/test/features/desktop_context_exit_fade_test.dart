import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'desktop_drawer_pin_menu_test.dart' show mountPinMenu;
import 'desktop_new_chat_draft_test.dart' show finishDraft;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  final reference =
      jsonDecode(
            File(
              'test/fixtures/context_menu_native_exit.json',
            ).readAsStringSync(),
          )
          as Map;
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    for (var cycle = 0; cycle < (reference['cycles'] as List).length; cycle++) {
      testWidgets(
        'context backdrop exit matches native cycle$cycle on $platform',
        (tester) async {
          final f = await mountPinMenu(tester, platform: platform);
          final key = GlobalKey();
          final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
          await tester.pumpWidget(RepaintBoundary(key: key, child: app));
          await tester.pumpAndSettle();
          Future<int> red() async => (await tester.runAsync(() async {
            final image =
                await (key.currentContext!.findRenderObject()
                        as RenderRepaintBoundary)
                    .toImage(pixelRatio: 1);
            try {
              final data = (await image.toByteData(
                format: ui.ImageByteFormat.rawRgba,
              ))!;
              return data.getUint8((400 * image.width + 380) * 4);
            } finally {
              image.dispose();
            }
          }))!;
          try {
            final clear = await red();
            await tester.longPress(
              find.byKey(const Key('navigation.thread.pin-owned')),
            );
            await tester.pumpAndSettle();
            final dim = await red();
            expect(clear, greaterThan(dim));
            await tester.binding.handlePopRoute();
            await tester.pump();
            var elapsed = 0, count = 0;
            var total = 0.0;
            for (final raw
                in ((reference['cycles'] as List)[cycle] as Map)['samples']
                    as List) {
              final sample = raw as Map;
              final time = sample['microseconds'] as int;
              await tester.pump(Duration(microseconds: time - elapsed));
              elapsed = time;
              final expected =
                  dim + (sample['clear_fraction'] as num) * (clear - dim);
              final actual = await red();
              final error = (actual - expected).abs();
              total += error;
              count++;
              expect(
                error,
                lessThanOrEqualTo(3.2),
                reason:
                    'Native cycle$cycle t=$time actual=$actual expected=$expected',
              );
            }
            expect(total / count, lessThan(1.4));
            await tester.pumpAndSettle();
            expect(await red(), clear);
            expect(f.desktop.threadList.data.isPinned('pin-owned'), isFalse);
          } finally {
            await finishDraft(tester, f.desktop);
          }
        },
        variant: TargetPlatformVariant.only(platform),
      );
    }

    testWidgets(
      'interrupted context backdrop exit has no brightness jump on $platform',
      (tester) async {
        final f = await mountPinMenu(tester, platform: platform);
        final key = GlobalKey();
        final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
        await tester.pumpWidget(RepaintBoundary(key: key, child: app));
        await tester.pumpAndSettle();
        Future<int> red() async => (await tester.runAsync(() async {
          final image =
              await (key.currentContext!.findRenderObject()
                      as RenderRepaintBoundary)
                  .toImage(pixelRatio: 1);
          try {
            return (await image.toByteData(
              format: ui.ImageByteFormat.rawRgba,
            ))!.getUint8((400 * image.width + 380) * 4);
          } finally {
            image.dispose();
          }
        }))!;
        try {
          await tester.longPress(
            find.byKey(const Key('navigation.thread.pin-owned')),
          );
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 60));
          final before = await red();
          await tester.binding.handlePopRoute();
          await tester.pump();
          expect(await red(), before);
          await tester.pumpAndSettle();
          expect(f.desktop.threadList.data.isPinned('pin-owned'), isFalse);
        } finally {
          await finishDraft(tester, f.desktop);
        }
      },
      variant: TargetPlatformVariant.only(platform),
    );
  }
}
