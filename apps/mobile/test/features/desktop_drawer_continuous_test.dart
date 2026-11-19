import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_phone_drawer.dart';
import '../../integration_test/drawer_corner_render_app.dart';

void main() {
  for (final brightness in Brightness.values) {
    testWidgets(
      'drawer panel follows measured Swift continuous edge $brightness',
      (tester) async {
        tester.view.physicalSize = const Size(1206, 2622);
        tester.view.devicePixelRatio = 3;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final key = GlobalKey();
        await tester.pumpWidget(
          RepaintBoundary(
            key: key,
            child: DrawerCornerRender(brightness: brightness),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          tester
              .state<DesktopPhoneDrawerState>(find.byType(DesktopPhoneDrawer))
              .isOpen,
          isTrue,
        );
        const expected = {
          1: 50.933,
          2: 43.6,
          4: 35.933,
          8: 26.933,
          20: 12.933,
          40: 2.933,
          70: .267,
          100: -.067,
        };
        final actual = (await tester.runAsync(() async {
          final image =
              await (key.currentContext!.findRenderObject()
                      as RenderRepaintBoundary)
                  .toImage(pixelRatio: 3);
          try {
            final data = (await image.toByteData(
              format: ui.ImageByteFormat.rawRgba,
            ))!;
            final bytes = data.buffer.asUint8List();
            final edges = <int, double>{};
            for (final y in expected.keys) {
              for (
                var x = (image.width * .7).floor() - 5;
                x < image.width;
                x++
              ) {
                final offset = (y * 3 * image.width + x) * 4;
                if (bytes[offset] - bytes[offset + 1] > 100) {
                  edges[y] = (x - image.width * .7) / 3;
                  break;
                }
              }
            }
            return edges;
          } finally {
            image.dispose();
          }
        }))!;
        try {
          // Native Swift PNG uses the same402×874pt viewport and red panel marker.
          for (final point in expected.entries) {
            expect(
              actual[point.key],
              closeTo(point.value, 1),
              reason:
                  'Source corner edge at y=${point.key}pt; measured $actual',
            );
          }
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
        }
      },
    );
  }
}
