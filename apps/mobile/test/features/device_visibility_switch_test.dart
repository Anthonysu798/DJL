import 'dart:ui' show SemanticsAction, Tristate;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/design/djl_tokens.dart';
import 'package:djl_mobile/features/pairing/presentation/device_visibility_switch.dart';
import 'pairing_presentation_test.dart' show paintedColors;

Future<void> mount(
  WidgetTester tester,
  ValueNotifier<bool> value,
  ValueChanged<bool>? changed, {
  Key owner = const ValueKey('control'),
  FocusNode? focus,
  TextDirection direction = TextDirection.ltr,
  bool reduced = false,
  Brightness brightness = Brightness.light,
}) async {
  final theme = djlTheme(brightness);
  await tester.pumpWidget(
    RepaintBoundary(
      key: const Key('pairing_paint'),
      child: MaterialApp(
        theme: theme,
        home: MediaQuery(
          data: MediaQueryData(disableAnimations: reduced),
          child: Directionality(
            textDirection: direction,
            child: Scaffold(
              backgroundColor: brightness == Brightness.dark
                  ? theme.colorScheme.surfaceContainerHigh
                  : theme.colorScheme.surface,
              body: Center(
                child: ValueListenableBuilder<bool>(
                  valueListenable: value,
                  builder: (context, current, _) => DeviceVisibilitySwitch(
                    key: owner,
                    value: current,
                    onChanged: changed,
                    focusNode: focus,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  for (final on in [false, true]) {
    testWidgets('source track and pill thumb paint bounds for value=$on', (
      tester,
    ) async {
      final value = ValueNotifier(on);
      addTearDown(value.dispose);
      await mount(tester, value, (_) {});
      final rect = tester.getRect(find.byType(DeviceVisibilitySwitch));
      expect(rect.size, const Size(63, 48));
      final left = on ? 24.0 : 2.0, center = left + 18.5;
      final colors = await paintedColors(tester, [
        rect.topLeft + const Offset(-1, 24),
        rect.topLeft + const Offset(31, 9),
        rect.topLeft + Offset(left + 1, 24),
        rect.topLeft + Offset(left + 35, 24),
        rect.topLeft + Offset(left - 1, 24),
        rect.topLeft + Offset(left + 38, 24),
        rect.topLeft + Offset(center, 13),
        rect.topLeft + Offset(center, 35),
        rect.topLeft + Offset(center, 11),
        rect.topLeft + Offset(center, 37),
      ]);
      expect(colors.take(2).map((c) => c.toARGB32()), [0xffffffff, 0xffffffff]);
      for (final color in colors) {
        expect(color.r, color.g);
        expect(color.g, color.b);
      }
      for (final index in [2, 3, 6, 7]) {
        expect(
          colors[index].toARGB32(),
          0xffffffff,
          reason: 'The source thumb is37×24,not a small circle',
        );
      }
      for (final index in [4, 5, 8, 9]) {
        expect(
          colors[index].toARGB32(),
          isNot(0xffffffff),
          reason: 'Sample outside the source pill',
        );
      }
    });
  }
  testWidgets('dark selected switch uses an ink track and onInk thumb', (
    tester,
  ) async {
    final value = ValueNotifier(true);
    addTearDown(value.dispose);
    await mount(tester, value, (_) {}, brightness: Brightness.dark);
    final rect = tester.getRect(find.byType(DeviceVisibilitySwitch));
    expect(
      await paintedColors(tester, [
        rect.topLeft + const Offset(12, 24),
        rect.topLeft + const Offset(40, 24),
      ]),
      [DjlColors.dark.ink, DjlColors.dark.onInk],
    );
  });

  testWidgets(
    'tap uses the full48-point target and keeps the model authoritative',
    (tester) async {
      final value = ValueNotifier(false);
      addTearDown(value.dispose);
      final calls = <bool>[];
      await mount(tester, value, calls.add);
      final rect = tester.getRect(find.byType(DeviceVisibilitySwitch));
      await tester.tapAt(rect.topCenter + const Offset(0, 2));
      await tester.pumpAndSettle();
      expect(calls, [true]);
      expect(value.value, isFalse);
      final semantics = tester.ensureSemantics();
      try {
        expect(
          tester
              .getSemantics(find.byType(DeviceVisibilitySwitch))
              .flagsCollection
              .isToggled,
          Tristate.isFalse,
        );
      } finally {
        semantics.dispose();
      }
    },
  );
  for (final direction in TextDirection.values) {
    testWidgets('tap and drag propose one update each in $direction', (
      tester,
    ) async {
      final value = ValueNotifier(false);
      addTearDown(value.dispose);
      final calls = <bool>[];
      void change(bool next) {
        calls.add(next);
        value.value = next;
      }

      await mount(tester, value, change, direction: direction);
      final control = find.byType(DeviceVisibilitySwitch);
      await tester.tap(control);
      await tester.pumpAndSettle();
      expect(calls, [true]);
      final delta = direction == TextDirection.ltr ? -60.0 : 60.0;
      await tester.drag(control, Offset(delta, 0));
      await tester.pumpAndSettle();
      expect(calls, [true, false]);
      await tester.drag(control, Offset(-delta, 0));
      await tester.pumpAndSettle();
      expect(calls, [true, false, true]);
    });
  }
  testWidgets('cancelled drag makes no proposal', (tester) async {
    final value = ValueNotifier(false);
    addTearDown(value.dispose);
    final calls = <bool>[];
    await mount(tester, value, calls.add);
    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(DeviceVisibilitySwitch)),
    );
    await gesture.moveBy(const Offset(60, 0));
    await tester.pump();
    await gesture.cancel();
    await tester.pumpAndSettle();
    expect(calls, isEmpty);
    expect(value.value, isFalse);
  });
  testWidgets(
    'keyboard and accessibility activation preserve switch semantics',
    (tester) async {
      final value = ValueNotifier(false);
      addTearDown(value.dispose);
      final calls = <bool>[];
      final focus = FocusNode();
      addTearDown(focus.dispose);
      final handle = tester.ensureSemantics();
      try {
        void change(bool next) {
          calls.add(next);
          value.value = next;
        }

        await mount(tester, value, change, focus: focus);
        focus.requestFocus();
        await tester.pump();
        await tester.sendKeyEvent(LogicalKeyboardKey.space);
        await tester.pumpAndSettle();
        expect(calls, [true]);
        final node = tester.getSemantics(find.byType(DeviceVisibilitySwitch));
        expect(node.flagsCollection.isEnabled, Tristate.isTrue);
        expect(node.flagsCollection.isToggled, Tristate.isTrue);
        tester.binding.renderViews.single.owner!.semanticsOwner!.performAction(
          node.id,
          SemanticsAction.tap,
        );
        await tester.pumpAndSettle();
        expect(calls, [true, false]);
      } finally {
        handle.dispose();
      }
    },
  );
  testWidgets('disabled input never calls back and remains a disabled switch', (
    tester,
  ) async {
    final value = ValueNotifier(true);
    addTearDown(value.dispose);
    final handle = tester.ensureSemantics();
    try {
      await mount(tester, value, null);
      final node = tester.getSemantics(find.byType(DeviceVisibilitySwitch));
      expect(node.flagsCollection.isEnabled, Tristate.isFalse);
      expect(node.flagsCollection.isToggled, Tristate.isTrue);
      expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isFalse);
      await tester.tap(find.byType(DeviceVisibilitySwitch));
      await tester.drag(
        find.byType(DeviceVisibilitySwitch),
        const Offset(-60, 0),
      );
      await tester.pumpAndSettle();
      expect(value.value, isTrue);
    } finally {
      handle.dispose();
    }
  });
  testWidgets('external value and disabling cancel an in-flight drag', (
    tester,
  ) async {
    final value = ValueNotifier(false);
    addTearDown(value.dispose);
    final calls = <bool>[];
    await mount(tester, value, calls.add);
    var gesture = await tester.startGesture(
      tester.getCenter(find.byType(DeviceVisibilitySwitch)),
    );
    await gesture.moveBy(const Offset(40, 0));
    await tester.pump();
    value.value = true;
    await tester.pump();
    await gesture.up();
    await tester.pumpAndSettle();
    expect(calls, isEmpty);
    expect(value.value, isTrue);
    gesture = await tester.startGesture(
      tester.getCenter(find.byType(DeviceVisibilitySwitch)),
    );
    await gesture.moveBy(const Offset(-40, 0));
    await tester.pump();
    await mount(tester, value, null);
    await gesture.up();
    await tester.pumpAndSettle();
    expect(calls, isEmpty);
    expect(value.value, isTrue);
  });
  testWidgets('replacing an interaction owner drops the old gesture', (
    tester,
  ) async {
    final value = ValueNotifier(false);
    addTearDown(value.dispose);
    final old = <bool>[], next = <bool>[];
    await mount(tester, value, old.add, owner: const ValueKey('old'));
    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(DeviceVisibilitySwitch)),
    );
    await gesture.moveBy(const Offset(40, 0));
    await tester.pump();
    await mount(tester, value, next.add, owner: const ValueKey('new'));
    await gesture.up();
    await tester.pumpAndSettle();
    expect(old, isEmpty);
    expect(next, isEmpty);
  });
  testWidgets('reduced motion settles immediately without update haptics', (
    tester,
  ) async {
    final value = ValueNotifier(false);
    addTearDown(value.dispose);
    var haptics = 0;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'HapticFeedback.vibrate') haptics++;
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
    await mount(tester, value, (next) => value.value = next, reduced: true);
    value.value = true;
    await tester.pump();
    expect(haptics, 0);
    await tester.tap(find.byType(DeviceVisibilitySwitch));
    await tester.pump();
    expect(value.value, isFalse);
    expect(haptics, 1);
    expect(tester.binding.hasScheduledFrame, isFalse);
  });
}
