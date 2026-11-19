import 'dart:async';
import 'package:http/http.dart' as http;
import 'dart:ui' show SemanticsAction, SemanticsActionEvent, Tristate;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/auth/presentation/auth_method_selector.dart';
import 'auth_fidelity_test.dart' show AuthFixture, fill, mountAuth, press;

class SelectorHost extends StatefulWidget {
  const SelectorHost({super.key, this.direction = TextDirection.ltr});
  final TextDirection direction;
  @override
  State<SelectorHost> createState() => SelectorHostState();
}

class SelectorHostState extends State<SelectorHost> {
  String value = 'Email code';
  bool enabled = true;
  final changes = <String>[];
  void update({String? value, bool? enabled}) => setState(() {
    this.value = value ?? this.value;
    this.enabled = enabled ?? this.enabled;
  });
  @override
  Widget build(BuildContext context) => MaterialApp(
    home: Scaffold(
      body: Directionality(
        textDirection: widget.direction,
        child: Center(
          child: SizedBox(
            width: 360,
            child: AuthMethodSelector<String>(
              value: value,
              onChanged: enabled
                  ? (next) => setState(() {
                      value = next;
                      changes.add(next);
                    })
                  : null,
              children: {
                for (final label in [
                  'Password',
                  'Email code',
                  'Create account',
                ])
                  label: Text(label),
              },
            ),
          ),
        ),
      ),
    ),
  );
}

void semanticsTap(WidgetTester tester, int nodeId) =>
    tester.binding.performSemanticsAction(
      SemanticsActionEvent(
        type: SemanticsAction.tap,
        viewId: tester.view.viewId,
        nodeId: nodeId,
      ),
    );

void main() {
  testWidgets('actual form tap changes method and retains its email', (
    tester,
  ) async {
    final fixture = AuthFixture();
    await mountAuth(tester, fixture);
    await fill(tester, 'email', 'ada@example.test');
    await press(tester, 'Password');
    expect(find.byKey(const Key('password')), findsOneWidget);
    expect(
      tester.widget<TextField>(find.byKey(const Key('email'))).controller!.text,
      'ada@example.test',
    );
    await press(tester, 'Email code');
    expect(find.byKey(const Key('password')), findsNothing);
    await tester.pumpWidget(const SizedBox());
    fixture.auth.dispose();
  });

  for (final direction in TextDirection.values) {
    testWidgets(
      'selected thumb drag previews then commits once in $direction',
      (tester) async {
        final key = GlobalKey<SelectorHostState>();
        await tester.pumpWidget(SelectorHost(key: key, direction: direction));
        await tester.pumpAndSettle();
        final gesture = await tester.startGesture(
          tester.getCenter(find.text('Email code')),
        );
        await gesture.moveBy(const Offset(20, 0));
        await gesture.moveTo(tester.getCenter(find.text('Password')));
        await tester.pumpAndSettle();
        expect(key.currentState!.value, 'Email code');
        expect(key.currentState!.changes, isEmpty);
        expect(
          tester.getCenter(find.byKey(const Key('auth_method_thumb'))).dx,
          closeTo(tester.getCenter(find.text('Password')).dx, 1),
        );
        await gesture.up();
        await tester.pumpAndSettle();
        expect(key.currentState!.value, 'Password');
        expect(key.currentState!.changes, ['Password']);
      },
    );
  }

  testWidgets(
    'actual verification drag cancel retains method and entered code',
    (tester) async {
      final fixture = AuthFixture();
      await mountAuth(tester, fixture);
      await fill(tester, 'email', 'ada@example.test');
      await press(tester, 'Email me a code');
      await fill(tester, 'code', '123456');
      final gesture = await tester.startGesture(
        tester.getCenter(find.text('Email code')),
      );
      await gesture.moveBy(const Offset(20, 0));
      await gesture.moveTo(tester.getCenter(find.text('Password')));
      await tester.pump();
      await gesture.cancel();
      await tester.pumpAndSettle();
      expect(
        tester.getCenter(find.byKey(const Key('auth_method_thumb'))).dx,
        closeTo(tester.getCenter(find.text('Email code')).dx, 1),
      );
      expect(find.byKey(const Key('password')), findsNothing);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('code')))
            .controller!
            .text,
        '123456',
      );
      expect(fixture.requests, hasLength(1));
      await tester.pumpWidget(const SizedBox());
      fixture.auth.dispose();
    },
  );

  testWidgets(
    'disabled selector rejects pointer semantic and keyboard activation, then recovers',
    (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        final key = GlobalKey<SelectorHostState>();
        await tester.pumpWidget(SelectorHost(key: key));
        await tester.pumpAndSettle();
        Focus.of(tester.element(find.text('Password'))).requestFocus();
        await tester.pump();
        key.currentState!.update(enabled: false);
        await tester.pumpAndSettle();
        for (final label in ['Password', 'Email code', 'Create account']) {
          final data = tester.getSemantics(find.text(label)).getSemanticsData();
          expect(data.flagsCollection.isEnabled, Tristate.isFalse);
          expect(data.hasAction(SemanticsAction.tap), isFalse);
          semanticsTap(tester, tester.getSemantics(find.text(label)).id);
          await tester.tap(find.text(label));
        }
        final drag = await tester.startGesture(
          tester.getCenter(find.text('Email code')),
        );
        await drag.moveBy(const Offset(20, 0));
        await drag.moveTo(tester.getCenter(find.text('Password')));
        await drag.up();
        await tester.sendKeyEvent(LogicalKeyboardKey.enter);
        await tester.sendKeyEvent(LogicalKeyboardKey.space);
        await tester.pumpAndSettle();
        expect(key.currentState!.changes, isEmpty);
        key.currentState!.update(enabled: true);
        await tester.pumpAndSettle();
        Focus.of(tester.element(find.text('Password'))).requestFocus();
        await tester.pump();
        await tester.sendKeyEvent(LogicalKeyboardKey.enter);
        await tester.pumpAndSettle();
        expect(key.currentState!.changes, ['Password']);
      } finally {
        semantics.dispose();
      }
    },
  );

  testWidgets(
    'actual pending request refuses method pointer semantic and keyboard activation',
    (tester) async {
      final semantics = tester.ensureSemantics();
      final fixture = AuthFixture(), response = Completer<http.Response>();
      fixture.responses.add(response);
      try {
        await mountAuth(tester, fixture);
        await fill(tester, 'email', 'ada@example.test');
        Focus.of(tester.element(find.text('Password'))).requestFocus();
        await tester.pump();
        await tester.tap(find.byKey(const Key('auth_primary')));
        await tester.pump();
        for (final label in ['Password', 'Email code', 'Create account']) {
          final node = tester.getSemantics(find.text(label));
          expect(
            node.getSemanticsData().flagsCollection.isEnabled,
            Tristate.isFalse,
          );
          expect(
            node.getSemanticsData().hasAction(SemanticsAction.tap),
            isFalse,
          );
          semanticsTap(tester, node.id);
          await tester.tap(find.text(label));
        }
        await tester.sendKeyEvent(LogicalKeyboardKey.enter);
        await tester.sendKeyEvent(LogicalKeyboardKey.space);
        final gesture = await tester.startGesture(
          tester.getCenter(find.text('Email code')),
        );
        await gesture.moveBy(const Offset(20, 0));
        await gesture.moveTo(tester.getCenter(find.text('Password')));
        await gesture.up();
        await tester.pump();
        expect(find.byKey(const Key('password')), findsNothing);
        expect(find.byKey(const Key('name')), findsNothing);
        expect(fixture.requests, hasLength(1));
        response.complete(http.Response('{}', 200));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('code')), findsOneWidget);
        await tester.pumpWidget(const SizedBox());
      } finally {
        fixture.auth.dispose();
        semantics.dispose();
      }
    },
  );

  for (final invalidation in ['external selection', 'disable']) {
    testWidgets(
      '$invalidation cancels an in-progress preview without stale release commit',
      (tester) async {
        final key = GlobalKey<SelectorHostState>();
        await tester.pumpWidget(SelectorHost(key: key));
        await tester.pumpAndSettle();
        final gesture = await tester.startGesture(
          tester.getCenter(find.text('Email code')),
        );
        await gesture.moveBy(const Offset(20, 0));
        await gesture.moveTo(tester.getCenter(find.text('Password')));
        await tester.pump();
        key.currentState!.update(
          value: invalidation == 'external selection' ? 'Create account' : null,
          enabled: invalidation == 'disable' ? false : null,
        );
        await tester.pump();
        if (invalidation == 'disable') {
          key.currentState!.update(enabled: true);
          await tester.pump();
        }
        await tester.pumpAndSettle();
        expect(
          tester.getCenter(find.byKey(const Key('auth_method_thumb'))).dx,
          closeTo(tester.getCenter(find.text(key.currentState!.value)).dx, 1),
        );
        await gesture.up();
        await tester.pumpAndSettle();
        expect(key.currentState!.changes, isEmpty);
        expect(
          key.currentState!.value,
          invalidation == 'external selection'
              ? 'Create account'
              : 'Email code',
        );
      },
    );
  }

  testWidgets(
    'enabled method semantics expose exactly one selected exclusive button',
    (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        final key = GlobalKey<SelectorHostState>();
        await tester.pumpWidget(SelectorHost(key: key));
        await tester.pumpAndSettle();
        for (final label in ['Password', 'Email code', 'Create account']) {
          final data = tester.getSemantics(find.text(label)).getSemanticsData();
          expect(data.flagsCollection.isButton, isTrue);
          expect(data.flagsCollection.isInMutuallyExclusiveGroup, isTrue);
          expect(
            data.flagsCollection.isSelected,
            label == 'Email code' ? Tristate.isTrue : Tristate.isFalse,
          );
          expect(data.flagsCollection.isEnabled, Tristate.isTrue);
          expect(data.hasAction(SemanticsAction.tap), isTrue);
        }
        final target = tester.getSemantics(find.text('Create account'));
        semanticsTap(tester, target.id);
        await tester.pumpAndSettle();
        expect(key.currentState!.changes, ['Create account']);
        expect(
          tester
              .getSemantics(find.text('Create account'))
              .getSemanticsData()
              .flagsCollection
              .isSelected,
          Tristate.isTrue,
        );
      } finally {
        semantics.dispose();
      }
    },
  );

  testWidgets('reduced motion selects without scheduling an animation', (
    tester,
  ) async {
    tester.platformDispatcher.accessibilityFeaturesTestValue =
        FakeAccessibilityFeatures(disableAnimations: true);
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
    final key = GlobalKey<SelectorHostState>();
    await tester.pumpWidget(SelectorHost(key: key));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Password'));
    await tester.pump();
    expect(key.currentState!.value, 'Password');
    expect(tester.binding.hasScheduledFrame, isFalse);
  });

  for (final label in ['Create account', 'Password', 'Email code']) {
    testWidgets(
      'actual selected $label remains full-size and single-line at 360 with text scale 2.2',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(360, 800));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        tester.platformDispatcher.textScaleFactorTestValue = 2.2;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        final semantics = tester.ensureSemantics();
        final fixture = AuthFixture();
        try {
          await mountAuth(tester, fixture);
          await press(tester, label);
          final selectedLabel = find.descendant(
            of: find.byWidgetPredicate(
              (widget) => widget is AuthMethodSelector,
            ),
            matching: find.text(label),
          );
          final paragraph = tester.renderObject<RenderParagraph>(selectedLabel);
          expect(paragraph.text.toPlainText(), label);
          expect(paragraph.textScaler.scale(10), closeTo(22, .001));
          expect(paragraph.didExceedMaxLines, isFalse);
          expect(
            paragraph.getBoxesForSelection(
              TextSelection(baseOffset: 0, extentOffset: label.length),
            ),
            hasLength(1),
            reason:
                'Horizontal expansion must retain the full selected label on one line.',
          );
          final data = tester.getSemantics(selectedLabel).getSemanticsData();
          expect(data.label, label);
          expect(data.flagsCollection.isSelected, Tristate.isTrue);
          expect(data.flagsCollection.isEnabled, Tristate.isTrue);
          expect(selectedLabel.hitTestable(), findsOneWidget);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
        } finally {
          fixture.auth.dispose();
          semantics.dispose();
        }
      },
    );
  }

  testWidgets(
    'actual large-font selector scrolls from an unselected cell and remains tappable',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(360, 800));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      tester.platformDispatcher.textScaleFactorTestValue = 2.2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final fixture = AuthFixture();
      await mountAuth(tester, fixture);
      final scroll = find.descendant(
        of: find.ancestor(
          of: find.byWidgetPredicate((widget) => widget is AuthMethodSelector),
          matching: find.byType(SingleChildScrollView),
        ),
        matching: find.byType(Scrollable),
      );
      expect(scroll, findsOneWidget);
      final position = tester.state<ScrollableState>(scroll).position;
      expect(position.maxScrollExtent, greaterThan(0));
      await tester.drag(find.text('Password'), const Offset(-240, 0));
      await tester.pumpAndSettle();
      expect(position.pixels, greaterThan(0));
      expect(find.byKey(const Key('password')), findsNothing);
      await press(tester, 'Create account');
      expect(find.byKey(const Key('name')), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      fixture.auth.dispose();
    },
  );
}
