import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import '../../integration_test/drawer_corner_render_app.dart';

void main() {
  final reference =
      jsonDecode(
            File(
              'test/fixtures/drawer_shadow_swift_profile.json',
            ).readAsStringSync(),
          )
          as Map;
  for (final brightness in Brightness.values) {
    testWidgets(
      'drawer shadow retains native falloff over white marker $brightness',
      (tester) async {
        tester.view.physicalSize = const Size(1206, 2622);
        tester.view.devicePixelRatio = 3;
        addTearDown(tester.view.reset);
        final previousShadows = debugDisableShadows;
        debugDisableShadows = false;
        try {
          final key = GlobalKey();
          await tester.pumpWidget(
            RepaintBoundary(
              key: key,
              child: DrawerCornerRender(brightness: brightness),
            ),
          );
          await tester.pumpAndSettle();
          final actual = (await tester.runAsync(() async {
            final image =
                await (key.currentContext!.findRenderObject()
                        as RenderRepaintBoundary)
                    .toImage(pixelRatio: 3);
            try {
              final data = (await image.toByteData(
                format: ui.ImageByteFormat.rawRgba,
              ))!.buffer.asUint8List();
              return [
                for (final raw in reference['samples'] as List)
                  (() {
                    final sample = raw as Map;
                    final x =
                        (image.width * .7 - (sample['distance'] as num) * 3)
                            .round();
                    var total = 0;
                    for (
                      var y = image.height ~/ 2 - 3;
                      y <= image.height ~/ 2 + 3;
                      y++
                    ) {
                      total += data[(y * image.width + x) * 4];
                    }
                    return total / 7;
                  })(),
              ];
            } finally {
              image.dispose();
            }
          }))!;
          var error = 0.0;
          for (var i = 0; i < actual.length; i++) {
            final expected =
                ((reference['samples'] as List)[i] as Map)['gray'] as num;
            final delta = (actual[i] - expected).abs();
            error += delta;
            expect(
              delta,
              lessThanOrEqualTo(1.1),
              reason: 'Native shadow sample $i; actual=$actual',
            );
          }
          expect(
            error / actual.length,
            lessThan(.5),
            reason: 'Native falloff mean error; actual=$actual',
          );
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          debugDisableShadows = previousShadows;
        }
      },
    );
  }
}
