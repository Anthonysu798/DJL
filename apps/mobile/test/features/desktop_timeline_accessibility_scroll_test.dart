import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_focus_timeline.dart';

void main() {
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    for (final offsetAction in [false, true]) {
      testWidgets(
        'accessibility ${offsetAction ? 'offset' : 'page'} scroll pauses following on $platform',
        (tester) async {
          final semantics = tester.ensureSemantics();
          try {
            tester.view.physicalSize = const Size(360, 480);
            tester.view.devicePixelRatio = 1;
            addTearDown(tester.view.resetPhysicalSize);
            addTearDown(tester.view.resetDevicePixelRatio);
            var count = 30;
            late StateSetter update;
            await tester.pumpWidget(
              MaterialApp(
                home: Scaffold(
                  body: StatefulBuilder(
                    builder: (context, setState) {
                      update = setState;
                      return DesktopFocusTimeline(
                        count: count,
                        itemBuilder: (_, index) => SizedBox(
                          height: 100,
                          child: Text('Accessible history $index'),
                        ),
                      );
                    },
                  ),
                ),
              ),
            );
            await tester.pumpAndSettle();
            final position = tester
                .state<ScrollableState>(find.byType(Scrollable))
                .position;
            final latest = position.pixels;
            if (offsetAction) {
              tester.semantics.performAction(
                find.semantics.scrollable(),
                ui.SemanticsAction.scrollToOffset,
                args: Float64List.fromList([0, latest - 320]),
              );
            } else {
              tester.semantics.scrollDown();
            }
            await tester.pumpAndSettle();
            expect(
              position.pixels,
              lessThan(latest - 100),
              reason:
                  'An accessibility scroll toward earlier content must not snap back to latest.',
            );
            final reading = position.pixels;
            update(() => count++);
            await tester.pumpAndSettle();
            expect(position.pixels, closeTo(reading, .5));
            expect(find.byTooltip('Scroll to latest message'), findsOneWidget);
            await tester.tap(find.byTooltip('Scroll to latest message'));
            await tester.pumpAndSettle();
            final resumed = tester
                .state<ScrollableState>(find.byType(Scrollable))
                .position;
            expect(resumed.pixels, closeTo(resumed.maxScrollExtent, .5));
          } finally {
            await tester.pumpWidget(const SizedBox.shrink());
            semantics.dispose();
          }
        },
        variant: TargetPlatformVariant.only(platform),
      );
    }
  }
}
