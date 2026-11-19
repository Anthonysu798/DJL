import 'package:djl_mobile/features/desktop/presentation/desktop_phone_drawer.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _content = Key('drawer.motion.content');

Future<GlobalKey<DesktopPhoneDrawerState>> _drawer(
  WidgetTester tester, {
  bool reduced = false,
}) async {
  tester.view.physicalSize = const Size(402, 874);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final drawer = GlobalKey<DesktopPhoneDrawerState>();
  await tester.pumpWidget(
    MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(disableAnimations: reduced),
        child: child!,
      ),
      home: DesktopPhoneDrawer(
        key: drawer,
        menu: const ColoredBox(color: Colors.grey),
        child: const ColoredBox(key: _content, color: Colors.white),
      ),
    ),
  );
  return drawer;
}

double _reveal(WidgetTester tester) =>
    tester.getTopLeft(find.byKey(_content)).dx / (402 * .7);

void main() {
  // Sampled from SwiftUI Spring.smooth(duration: 0.48, extraBounce: 0).
  const samples = {
    50: .14015277096621448,
    100: .37636108147466241,
    160: .61894160917895502,
    240: .82102555358593099,
    320: .9213139689875316,
    480: .98639906853442505,
    640: .99784347819772823,
  };

  for (final opening in [true, false]) {
    testWidgets(
      'drawer follows the Swift smooth spring while ${opening ? 'opening' : 'closing'}',
      (tester) async {
        final drawer = await _drawer(tester);
        if (!opening) {
          drawer.currentState!.toggle();
          await tester.pumpAndSettle();
        }
        drawer.currentState!.toggle();
        await tester.pump();
        var previous = 0;
        for (final sample in samples.entries) {
          await tester.pump(Duration(milliseconds: sample.key - previous));
          expect(
            _reveal(tester),
            closeTo(opening ? sample.value : 1 - sample.value, .00001),
            reason: 'Source trajectory at ${sample.key}ms',
          );
          previous = sample.key;
        }
        await tester.pumpAndSettle();
        expect(_reveal(tester), opening ? 1 : 0);
      },
    );
  }

  testWidgets(
    'reversing the drawer retains current spring position and velocity',
    (tester) async {
      final drawer = await _drawer(tester);
      drawer.currentState!.toggle();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 160));
      final before = _reveal(tester);
      drawer.currentState!.close();
      await tester.pump();
      expect(_reveal(tester), before);
      await tester.pump(const Duration(milliseconds: 50));
      expect(_reveal(tester), closeTo(.61992316916872181, .00001));
      await tester.pump(const Duration(milliseconds: 50));
      expect(_reveal(tester), closeTo(.47718096215871247, .00001));
      await tester.pumpAndSettle();
      expect(_reveal(tester), 0);
    },
  );

  testWidgets('drag release carries its velocity into the spring settle', (
    tester,
  ) async {
    await _drawer(tester);
    final gesture = await tester.startGesture(const Offset(8, 250));
    for (var step = 1; step <= 6; step++) {
      await tester.pump(const Duration(milliseconds: 20));
      await gesture.moveTo(
        Offset(8 + step * 20, 250),
        timeStamp: Duration(milliseconds: step * 20),
      );
    }
    await gesture.up(timeStamp: const Duration(milliseconds: 140));
    await tester.pump();
    expect(_reveal(tester), closeTo(120 / 281.4, .00001));
    await tester.pump(const Duration(milliseconds: 50));
    expect(_reveal(tester), closeTo(.5991676952103333, .00001));
    await tester.pump(const Duration(milliseconds: 50));
    expect(_reveal(tester), closeTo(.7382862912736763, .00001));
    await tester.pumpAndSettle();
    expect(_reveal(tester), 1);
  });

  testWidgets('reduced motion completes opening and closing in one frame', (
    tester,
  ) async {
    final drawer = await _drawer(tester, reduced: true);
    drawer.currentState!.toggle();
    await tester.pump();
    expect(_reveal(tester), 1);
    drawer.currentState!.close();
    await tester.pump();
    expect(_reveal(tester), 0);
    expect(tester.binding.hasScheduledFrame, isFalse);
  });
}
