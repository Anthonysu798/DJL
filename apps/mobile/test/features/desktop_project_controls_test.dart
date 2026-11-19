import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/cupertino.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_project_controls.dart';

Future<void> controlsApp(
  WidgetTester tester,
  TextEditingController text, {
  required VoidCallback branch,
  required VoidCallback handoff,
  VoidCallback? expanded,
  bool enabled = true,
  Key projectKey = const ValueKey('original-owner'),
  double scale = 1,
  bool reduced = false,
}) => tester.pumpWidget(
  MaterialApp(
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(
        textScaler: TextScaler.linear(scale),
        disableAnimations: reduced,
      ),
      child: child!,
    ),
    home: Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            const Expanded(child: Center(child: Text('Timeline'))),
            Align(
              alignment: Alignment.centerLeft,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: DesktopProjectControls(
                  key: projectKey,
                  branchLabel: 'feature/very-long-project-branch',
                  worktree: false,
                  branchEnabled: enabled,
                  handoffEnabled: enabled,
                  handoffLabel: 'Hand off to Worktree',
                  onExpand: expanded ?? () {},
                  onBranch: (_) => branch(),
                  onHandoff: handoff,
                ),
              ),
            ),
            TextField(controller: text, key: const Key('input')),
          ],
        ),
      ),
    ),
  ),
);

final _nativeSprings =
    (jsonDecode(
              File(
                'test/fixtures/project_controls_ios_springs.json',
              ).readAsStringSync(),
            )
            as List)
        .cast<Map<String, dynamic>>();

List<Map<String, double>> _springSamples(String name) =>
    (_nativeSprings.singleWhere((row) => row['name'] == name)['samples']
            as List)
        .map((raw) {
          final row = raw as Map;
          final value = (row['position'] ?? row['displacement']) as num;
          return {
            'time': (row['time'] as num).toDouble(),
            'position': name == 'collapse'
                ? 1 - value.toDouble()
                : value.toDouble(),
          };
        })
        .toList();

Future<void> _expectNativeFrames(
  WidgetTester tester,
  List<Map<String, double>> samples,
) async {
  var elapsed = 0;
  for (final sample in samples) {
    final micros = (sample['time']! * 1000000).round();
    await tester.pump(Duration(microseconds: micros - elapsed));
    elapsed = micros;
    final progress = sample['position']!;
    final pill = find.byTooltip('Current Branch');
    if (pill.evaluate().isEmpty) {
      expect(
        progress.abs(),
        lessThan(.001),
        reason: 'Native spring has not settled',
      );
    } else {
      final box = tester.renderObject<RenderBox>(pill);
      final a = box.localToGlobal(Offset.zero);
      final b = box.localToGlobal(Offset(box.size.width, 0));
      final scale = (b - a).distance / box.size.width;
      expect(
        scale,
        closeTo(.01 + .99 * progress, .0001),
        reason: 'Painted pill at ${sample['time']}s',
      );
      RenderObject? parent = box;
      while (parent != null &&
          parent is! RenderOpacity &&
          parent is! RenderAnimatedOpacity) {
        parent = parent.parent;
      }
      final opacity = parent is RenderOpacity
          ? parent.opacity
          : (parent as RenderAnimatedOpacity).opacity.value;
      expect(opacity, closeTo(progress.clamp(0, 1), .0001));
    }
    final icon = tester.renderObject<RenderBox>(
      find.byIcon(CupertinoIcons.chevron_right),
    );
    final vector =
        icon.localToGlobal(const Offset(1, 0)) -
        icon.localToGlobal(Offset.zero);
    expect(
      math.atan2(vector.dy, vector.dx),
      closeTo(-math.pi / 2 * progress, .0001),
      reason: 'Chevron must follow the same spring',
    );
  }
}

void main() {
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    testWidgets(
      'painted project controls match native spring samples on $platform',
      (tester) async {
        final text = TextEditingController();
        await controlsApp(tester, text, branch: () {}, handoff: () {});
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Expand project controls'));
        await tester.pump();
        await _expectNativeFrames(tester, _springSamples('expand'));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Collapse project controls'));
        await tester.pump();
        await _expectNativeFrames(tester, _springSamples('collapse'));
        await tester.pumpAndSettle();
        expect(find.byTooltip('Current Branch'), findsNothing);
        await tester.pumpWidget(const SizedBox());
        text.dispose();
      },
      variant: TargetPlatformVariant({platform}),
    );

    testWidgets(
      'project spring reversal preserves native position and velocity on $platform',
      (tester) async {
        final text = TextEditingController();
        await controlsApp(tester, text, branch: () {}, handoff: () {});
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Expand project controls'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 85));
        await tester.tap(find.byTooltip('Collapse project controls'));
        await tester.pump();
        await _expectNativeFrames(
          tester,
          _springSamples('interrupted-collapse'),
        );
        await tester.pumpAndSettle();
        expect(find.byTooltip('Current Branch'), findsNothing);
        await tester.pumpWidget(const SizedBox());
        text.dispose();
      },
      variant: TargetPlatformVariant({platform}),
    );

    testWidgets(
      'reduced motion settles and removes project controls on $platform',
      (tester) async {
        final text = TextEditingController();
        await controlsApp(
          tester,
          text,
          reduced: true,
          branch: () {},
          handoff: () {},
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Expand project controls'));
        await tester.pump();
        final box = tester.renderObject<RenderBox>(
          find.byTooltip('Current Branch'),
        );
        expect(
          (box.localToGlobal(Offset(box.size.width, 0)) -
                      box.localToGlobal(Offset.zero))
                  .distance /
              box.size.width,
          1,
        );
        await tester.tap(find.byTooltip('Collapse project controls'));
        await tester.pump();
        expect(find.byTooltip('Current Branch'), findsNothing);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        text.dispose();
      },
      variant: TargetPlatformVariant({platform}),
    );
  }

  testWidgets(
    'floating pills receive taps without moving or replacing the input',
    (tester) async {
      final text = TextEditingController();
      var branches = 0, handoffs = 0, expansions = 0;
      await controlsApp(
        tester,
        text,
        branch: () => branches++,
        handoff: () => handoffs++,
        expanded: () => expansions++,
      );
      await tester.enterText(
        find.byKey(const Key('input')),
        'Exact unsent draft',
      );
      await tester.pumpAndSettle();
      final editable = tester.state<EditableTextState>(
        find.byType(EditableText),
      );
      final input = tester.getRect(find.byKey(const Key('input')));
      expect(find.byTooltip('Current Branch'), findsNothing);
      await tester.tap(find.byTooltip('Expand project controls'));
      await tester.pumpAndSettle();
      expect(expansions, 1);
      expect(tester.getRect(find.byKey(const Key('input'))), input);
      expect(
        tester.state<EditableTextState>(find.byType(EditableText)),
        same(editable),
      );
      expect(editable.widget.focusNode.hasFocus, isTrue);
      expect(text.text, 'Exact unsent draft');
      expect(find.byTooltip('Current Branch').hitTestable(), findsOneWidget);
      expect(
        tester.getRect(find.byTooltip('Current Branch')).bottom,
        lessThan(
          tester.getRect(find.byTooltip('Collapse project controls')).top,
        ),
      );
      await tester.tap(find.byTooltip('Current Branch'));
      await tester.pumpAndSettle();
      expect(branches, 1);
      await tester.tap(find.byTooltip('Runtime'));
      await tester.pumpAndSettle();
      expect(find.text('Continue in'), findsOneWidget);
      await tester.tap(find.text('Hand off to Worktree'));
      await tester.pumpAndSettle();
      expect(handoffs, 1);
      await tester.tap(find.byTooltip('Collapse project controls'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Current Branch'), findsNothing);
      expect(tester.getRect(find.byKey(const Key('input'))), input);
      expect(editable.widget.focusNode.hasFocus, isTrue);
      await tester.pumpWidget(const SizedBox());
      text.dispose();
    },
  );

  testWidgets('owner replacement removes the old floating controls', (
    tester,
  ) async {
    final text = TextEditingController();
    var calls = 0;
    await controlsApp(
      tester,
      text,
      branch: () => calls++,
      handoff: () => calls++,
    );
    await tester.tap(find.byTooltip('Expand project controls'));
    await tester.pumpAndSettle();
    await controlsApp(
      tester,
      text,
      projectKey: const ValueKey('replacement-owner'),
      branch: () => calls++,
      handoff: () => calls++,
    );
    await tester.pumpAndSettle();
    expect(find.byTooltip('Current Branch'), findsNothing);
    expect(find.byTooltip('Expand project controls'), findsOneWidget);
    expect(calls, 0);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    text.dispose();
  });

  testWidgets(
    'a Runtime menu cannot use a removed owner after viewport change',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(402, 874);
      addTearDown(tester.view.reset);
      final text = TextEditingController();
      var calls = 0;
      await controlsApp(
        tester,
        text,
        branch: () => calls++,
        handoff: () => calls++,
      );
      await tester.tap(find.byTooltip('Expand project controls'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Runtime'));
      await tester.pumpAndSettle();
      expect(find.text('Continue in'), findsOneWidget);
      await controlsApp(
        tester,
        text,
        projectKey: const ValueKey('replacement-owner'),
        branch: () => calls++,
        handoff: () => calls++,
      );
      tester.view.physicalSize = const Size(874, 402);
      await tester.pumpAndSettle();
      expect(find.text('Continue in'), findsNothing);
      expect(calls, 0);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      text.dispose();
    },
  );

  for (final size in [const Size(402, 874), const Size(360, 430)]) {
    testWidgets(
      'project pills remain safe and scrollable with keyboard at $size',
      (tester) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = size;
        tester.view.viewPadding = const FakeViewPadding(top: 44, bottom: 34);
        tester.view.padding = const FakeViewPadding(top: 44);
        tester.view.viewInsets = FakeViewPadding(
          bottom: size.height > 500 ? 300 : 200,
        );
        addTearDown(tester.view.reset);
        final text = TextEditingController();
        var handoffs = 0;
        await controlsApp(
          tester,
          text,
          scale: 2.2,
          branch: () {},
          handoff: () => handoffs++,
        );
        await tester.tap(find.byTooltip('Expand project controls'));
        await tester.pumpAndSettle();
        final branch = find.byTooltip('Current Branch');
        await tester.ensureVisible(branch);
        await tester.pumpAndSettle();
        expect(branch.hitTestable(), findsOneWidget);
        expect(tester.getRect(branch).top, greaterThanOrEqualTo(44));
        final runtime = find.byTooltip('Runtime');
        await tester.ensureVisible(runtime);
        await tester.pumpAndSettle();
        expect(runtime.hitTestable(), findsOneWidget);
        expect(
          tester.getRect(runtime).bottom,
          lessThan(
            tester.getRect(find.byTooltip('Collapse project controls')).top,
          ),
        );
        await tester.tap(runtime);
        await tester.pumpAndSettle();
        final handoff = find.text('Hand off to Worktree');
        await tester.ensureVisible(handoff);
        await tester.pumpAndSettle();
        expect(
          handoff.hitTestable(),
          findsOneWidget,
          reason:
              'action=${tester.getRect(handoff)} menu=${tester.getRect(find.ancestor(of: handoff, matching: find.byType(SingleChildScrollView)).first)} trigger=${tester.getRect(runtime)}',
        );
        expect(
          tester
              .getRect(
                find
                    .ancestor(
                      of: handoff,
                      matching: find.byType(SingleChildScrollView),
                    )
                    .first,
              )
              .bottom,
          lessThanOrEqualTo(size.height - (size.height > 500 ? 300 : 200)),
        );
        await tester.tap(handoff);
        await tester.pumpAndSettle();
        expect(handoffs, 1);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        text.dispose();
      },
    );
  }
}
