import 'package:djl_mobile/features/desktop/presentation/desktop_focus_timeline.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> focusViewport(WidgetTester tester) async {
  tester.view.physicalSize = const Size(402, 634);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Widget focusRows({
  required int count,
  required int target,
  required TargetPlatform platform,
  double height = 69,
}) => MaterialApp(
  theme: ThemeData(platform: platform),
  home: Scaffold(
    body: DesktopFocusTimeline(
      count: count,
      target: target,
      itemBuilder: (_, index) => SizedBox(
        key: ValueKey('focus.row.$index'),
        height: index == target ? height : 80,
        child: Align(
          alignment: Alignment.centerLeft,
          child: Text('Visible row $index'),
        ),
      ),
    ),
  ),
);

void main() {
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    testWidgets(
      '$platform: an explicit middle row centers within the available viewport',
      (tester) async {
        await focusViewport(tester);
        await tester.pumpWidget(
          focusRows(count: 30, target: 14, platform: platform),
        );
        await tester.pumpAndSettle();
        expect(
          tester.getRect(find.byKey(const ValueKey('focus.row.14'))).center.dy,
          closeTo(317, .5),
        );
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      '$platform: last-row focus clamps at the end and retains preceding context',
      (tester) async {
        await focusViewport(tester);
        await tester.pumpWidget(
          focusRows(count: 30, target: 29, platform: platform),
        );
        await tester.pumpAndSettle();
        expect(
          tester.getRect(find.byKey(const ValueKey('focus.row.29'))).bottom,
          closeTo(622, .5),
        );
        expect(
          tester
              .getRect(find.byKey(const ValueKey('focus.row.28')))
              .overlaps(const Rect.fromLTWH(0, 0, 402, 634)),
          isTrue,
        );
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      '$platform: first-row focus does not introduce a blank leading viewport',
      (tester) async {
        await focusViewport(tester);
        await tester.pumpWidget(
          focusRows(count: 30, target: 0, platform: platform),
        );
        await tester.pumpAndSettle();
        expect(
          tester.getRect(find.byKey(const ValueKey('focus.row.0'))).top,
          closeTo(12, .5),
        );
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      '$platform: short focused history starts at the real beginning',
      (tester) async {
        await focusViewport(tester);
        await tester.pumpWidget(
          focusRows(count: 2, target: 1, platform: platform),
        );
        await tester.pumpAndSettle();
        expect(
          tester.getRect(find.byKey(const ValueKey('focus.row.0'))).top,
          closeTo(12, .5),
        );
        expect(
          tester.getRect(find.byKey(const ValueKey('focus.row.1'))).center.dy,
          closeTo(140.5, .5),
        );
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      '$platform: an oversized explicit target centers its actual row bounds',
      (tester) async {
        await focusViewport(tester);
        await tester.pumpWidget(
          focusRows(count: 2, target: 0, platform: platform, height: 1000),
        );
        await tester.pumpAndSettle();
        expect(
          tester.getRect(find.byKey(const ValueKey('focus.row.0'))).center.dy,
          closeTo(317, .5),
        );
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      '$platform: focused history keeps manual reading across later growth',
      (tester) async {
        await focusViewport(tester);
        late StateSetter update;
        var count = 30;
        var height = 69.0;
        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(platform: platform),
            home: Scaffold(
              body: StatefulBuilder(
                builder: (_, setState) {
                  update = setState;
                  return DesktopFocusTimeline(
                    count: count,
                    target: 14,
                    itemBuilder: (_, index) => SizedBox(
                      key: ValueKey('manual.row.$index'),
                      height: index == 14 ? height : 80,
                      child: Text('Manual row $index'),
                    ),
                  );
                },
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final row = find.byKey(const ValueKey('manual.row.14'));
        expect(tester.getRect(row).center.dy, closeTo(317, .5));
        await tester.timedDrag(
          find.byType(DesktopFocusTimeline),
          const Offset(0, 60),
          const Duration(milliseconds: 600),
        );
        await tester.pumpAndSettle();
        final top = tester.getRect(row).top;
        update(() {
          count++;
          height = 150;
        });
        await tester.pumpAndSettle();
        expect(tester.getRect(row).top, closeTo(top, .5));
        expect(tester.takeException(), isNull);
      },
    );
    testWidgets('$platform: late child focus cannot override manual reading', (
      tester,
    ) async {
      await focusViewport(tester);
      late BuildContext childContext;
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(platform: platform),
          home: Scaffold(
            body: DesktopFocusTimeline(
              count: 30,
              target: 14,
              itemBuilder: (_, index) => Builder(
                builder: (context) {
                  if (index == 14) childContext = context;
                  return SizedBox(
                    key: ValueKey('late.row.$index'),
                    height: index == 14 ? 69 : 80,
                    child: Text('Late row $index'),
                  );
                },
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.timedDrag(
        find.byType(DesktopFocusTimeline),
        const Offset(0, 60),
        const Duration(milliseconds: 600),
      );
      await tester.pumpAndSettle();
      final row = find.byKey(const ValueKey('late.row.14'));
      final top = tester.getRect(row).top;
      DesktopFocusTimeline.revealTarget(childContext);
      await tester.pumpAndSettle();
      expect(tester.getRect(row).top, closeTo(top, .5));
      expect(tester.takeException(), isNull);
    });
  }
}
