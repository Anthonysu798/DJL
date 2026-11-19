import 'dart:io';
import 'dart:ui' as ui;
import 'package:crypto/crypto.dart';
import 'package:djl_mobile/features/activity/domain/desktop_activity.dart';
import 'package:djl_mobile/features/activity/presentation/activity_card.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:djl_mobile/core/design/djl_icons.dart';

DesktopActivity command(String raw, [String status = 'running']) =>
    DesktopActivity(
      mac: 'mac-a',
      thread: 'thread',
      turn: 'turn',
      item: 'command',
      kind: 'command',
      status: status,
      command: raw,
    );

Future<void> showCommand(
  WidgetTester tester,
  DesktopActivity activity, {
  double scale = 1,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(
        extensions: const [DjlAppearance(font: AppFontStyle.geist)],
      ),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: Scaffold(
        body: SingleChildScrollView(
          child: RepaintBoundary(
            key: const ValueKey('paint'),
            child: ActivityCard(activity: activity, changes: ValueNotifier(0)),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  final examples = <(String, String, String)>[
    ('cat /repo/lib/a.dart', 'Reading lib/a.dart', 'Read lib/a.dart'),
    ('  CAT   /repo/lib/a.dart  ', 'Reading lib/a.dart', 'Read lib/a.dart'),
    ('cat "a/b/name spaced.dart"', 'Reading spaced.dart', 'Read spaced.dart'),
    ('bash -c "', 'Running ', 'Ran '),
    ('bash -c "echo ignored&&\ncat a"', 'Running \ncat a', 'Ran \ncat a'),
    (
      '/usr/bin/NL -ba /a/b/c.dart | sed -n 1p',
      'Reading b/c.dart',
      'Read b/c.dart',
    ),
    ('head -n 2', 'Reading 2', 'Read 2'),
    ('tail -f', 'Reading file', 'Read file'),
    ('sed -n "1,2p" src/a.dart', 'Reading src/a.dart', 'Read src/a.dart'),
    ('less a', 'Reading a', 'Read a'),
    ('more b', 'Reading b', 'Read b'),
    (
      'rg -n "hello world" /repo/src/',
      'Searching for hello world in /repo/src/',
      'Searched for hello world in /repo/src/',
    ),
    (
      r'''grep -g '*.dart' --max-count 1 'a\'b' src/''',
      "Searching for a'b in src/",
      "Searched for a'b in src/",
    ),
    (
      'ag --type dart --glob *.dart pattern a/b/c',
      'Searching for pattern in b/c',
      'Searched for pattern in b/c',
    ),
    (
      'ack -t dart -g *.dart needle',
      'Searching for needle',
      'Searched for needle',
    ),
    ('rg -n', 'Searching for ...', 'Searched for ...'),
    ('ls -al', 'Listing directory', 'Listed directory'),
    ('find /a/b/c', 'Finding b/c', 'Found b/c'),
    ('fd', 'Finding files', 'Found files'),
    ('mkdir -p a/b/c', 'Creating b/c', 'Created b/c'),
    ('rm -rf /a/b/c', 'Removing b/c', 'Removed b/c'),
    ('cp a b/c/d', 'Copying c/d', 'Copied c/d'),
    ('mv a b/c/d', 'Moving c/d', 'Moved c/d'),
    (
      'bash -lc "cd /repo && cat lib/a.dart"',
      'Reading lib/a.dart',
      'Read lib/a.dart',
    ),
    ("/bin/sh -c 'echo setup && ls a/b/c'", 'Listing b/c', 'Listed b/c'),
    (
      'env -u GH_TOKEN gh pr status',
      'Running env -u GH_TOKEN gh pr status',
      'Ran env -u GH_TOKEN gh pr status',
    ),
    ('git STATUS', 'Running git STATUS', 'Ran git STATUS'),
    ('git', 'Running git ', 'Ran git '),
    (
      'echo   hello\tworld',
      'Running echo   hello\tworld',
      'Ran echo   hello\tworld',
    ),
    ('', 'Command', 'Command'),
  ];
  for (final (sub, running, past) in [
    ('status', 'Checking git status', 'Checked git status'),
    ('diff', 'Comparing changes', 'Compared changes'),
    ('log', 'Viewing git log', 'Viewed git log'),
    ('add', 'Staging changes', 'Staged changes'),
    ('commit', 'Committing changes', 'Committed changes'),
    ('push', 'Pushing to remote', 'Pushed to remote'),
    ('pull', 'Pulling from remote', 'Pulled from remote'),
    ('checkout -b feature', 'Switching to feature', 'Switched to feature'),
    ('switch', 'Switching to branch', 'Switched to branch'),
    ('fetch origin', 'Running git fetch origin', 'Ran git fetch origin'),
  ]) {
    examples.add(('git $sub', running, past));
  }
  final unicode = List.filled(31, '👩‍💻').join();
  final shortened = '${List.filled(27, '👩‍💻').join()}...';
  examples.add((
    'rg "$unicode" src',
    'Searching for $shortened in src',
    'Searched for $shortened in src',
  ));
  testWidgets('source command families retain original labels and tense', (
    tester,
  ) async {
    for (final (raw, running, past) in examples) {
      for (final (status, expected) in [
        ('running', running),
        ('completed', past),
      ]) {
        await showCommand(tester, command(raw, status));
        expect(find.text(expected), findsOneWidget, reason: '$status: $raw');
      }
    }
  });
  testWidgets('compact geometry uses selected prose and adjacent disclosure', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(412, 915);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await showCommand(tester, command('cat /repo/lib/a.dart'));
    final text = find.text('Reading lib/a.dart');
    final label = tester.widget<Text>(text);
    expect(label.maxLines, 1);
    expect(label.overflow, TextOverflow.ellipsis);
    expect(label.style!.fontSize, 15);
    expect(label.style!.fontWeight, FontWeight.w400);
    expect(label.style!.fontFamily, 'Geist');
    expect(
      label.style!.color,
      Theme.of(tester.element(text)).colorScheme.onSurfaceVariant,
    );
    expect(
      tester.widget<Icon>(find.byIcon(DjlIcons.chevronRight)).fontWeight,
      FontWeight.w600,
    );
    final glyph = find.byType(SvgPicture).first;
    expect(tester.getSize(glyph), const Size(17, 17));
    expect(tester.getTopLeft(text).dx - tester.getTopRight(glyph).dx, 6);
    final chevron = find.byIcon(DjlIcons.chevronRight);
    expect(tester.getSize(chevron), const Size(8, 8));
    expect(tester.getTopLeft(chevron).dx - tester.getTopRight(text).dx, 8);
    expect(tester.getTopRight(chevron).dx, lessThan(382));
    expect(find.byType(ListTile), findsNothing);
    expect(find.text('Running'), findsNothing);
    expect(tester.getSize(find.byType(ActivityCard)).height, lessThan(30));
    await showCommand(
      tester,
      command('echo ${List.filled(120, 'long').join(' ')}'),
    );
    expect(tester.getTopRight(chevron).dx, lessThanOrEqualTo(412));
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'single accessible button preserves full raw command and true status',
    (tester) async {
      final handle = tester.ensureSemantics();

      const raw = 'bash -lc "cd /repo && cat /repo/lib/a.dart | head -n 1"';
      for (final status in ['failed', 'stopped', 'queued-future', '']) {
        await showCommand(tester, command(raw, status));
        expect(find.text('Read lib/a.dart'), findsOneWidget);
        final spoken = status == 'failed'
            ? 'Failed'
            : status == 'stopped'
            ? 'Stopped'
            : status;
        final button = find.bySemanticsLabel(
          '$raw. Status: $spoken. Open command details',
        );
        expect(button, findsOneWidget);
        final data = tester.getSemantics(button).getSemanticsData();
        expect(data.hasAction(ui.SemanticsAction.tap), isTrue);
        expect(data.flagsCollection.isButton, isTrue);
        var children = 0;
        tester.getSemantics(button).visitChildren((node) {
          children++;
          return true;
        });
        expect(children, 0);
        expect(
          find.byType(SvgPicture),
          status == 'failed' || status == 'stopped'
              ? findsNWidgets(2)
              : findsOneWidget,
        );
        tester.binding.performSemanticsAction(
          ui.SemanticsActionEvent(
            type: ui.SemanticsAction.tap,
            viewId: tester.view.viewId,
            nodeId: tester.getSemantics(button).id,
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Command details'), findsOneWidget);
        expect(find.text('Status: $spoken'), findsOneWidget);
        expect(
          find.byWidgetPredicate((w) => w is SelectableText && w.data == raw),
          findsOneWidget,
        );
        expect(find.text('Status: Completed'), findsNothing);
        await tester.pumpWidget(const SizedBox());
      }
      handle.dispose();
    },
  );
  testWidgets('source artwork is bundled unchanged and really paints', (
    tester,
  ) async {
    for (final (raw, status, name, original) in [
      (
        'cat a',
        'running',
        'central-magnifying-glass',
        'DJLCentralIcons/central-magnifying-glass.imageset',
      ),
      (
        'echo a',
        'running',
        'central-console',
        'DJLCentralIcons/central-console.imageset',
      ),
      (
        '/usr/bin/env -u GH_TOKEN -C /repo X=1 -- gh pr status',
        'running',
        'GitHub_Invertocat_Black',
        'GitHub_Invertocat_Black.imageset',
      ),
      (
        'hub pr list',
        'failed',
        'central-exclamation-circle-bold',
        'DJLCentralIcons/central-exclamation-circle-bold.imageset',
      ),
    ]) {
      final asset = 'assets/icons/command/$name.svg';
      final loaded = await rootBundle.load(asset);
      final source = File(
        '../ios/DJL/Assets.xcassets/$original/$name.svg',
      ).readAsBytesSync();
      expect(
        sha256.convert(loaded.buffer.asUint8List()),
        sha256.convert(source),
      );
      await showCommand(tester, command(raw, status));
      final svg = find.byWidgetPredicate(
        (w) =>
            w is SvgPicture &&
            w.bytesLoader is SvgAssetLoader &&
            (w.bytesLoader as SvgAssetLoader).assetName == asset,
      );
      expect(svg, findsOneWidget);
      final bounds = tester.getRect(svg);
      final boundary = tester.renderObject<RenderRepaintBoundary>(
        find.byKey(const ValueKey('paint')),
      );
      final image = (await tester.runAsync(() => boundary.toImage()))!;
      final pixels = (await tester.runAsync(
        () => image.toByteData(format: ui.ImageByteFormat.rawRgba),
      ))!.buffer.asUint8List();
      final colors = <int>{};
      for (var y = bounds.top.ceil(); y < bounds.bottom.floor(); y++) {
        for (var x = bounds.left.ceil(); x < bounds.right.floor(); x++) {
          final offset = (y * image.width + x) * 4;
          colors.add(
            pixels[offset] << 16 | pixels[offset + 1] << 8 | pixels[offset + 2],
          );
        }
      }
      image.dispose();
      expect(
        colors.length,
        greaterThan(2),
        reason: '$name must decode and paint actual paths',
      );
      if (status == 'failed') {
        expect(tester.getSize(svg), const Size(15, 15));
        expect(
          tester.widget<SvgPicture>(svg).colorFilter,
          const ColorFilter.mode(Colors.red, BlendMode.srcIn),
        );
      }
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets(
    'existing selectable command copies the full raw value on explicit selection',
    (tester) async {
      const raw = 'cat /repo/lib/a.dart';
      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            copied = (call.arguments as Map)['text'] as String;
          }
          if (call.method == 'Clipboard.hasStrings') return {'value': false};
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );
      await showCommand(tester, command(raw));
      await tester.tap(find.text('Reading lib/a.dart'));
      await tester.pumpAndSettle();
      expect(copied, isNull);
      final selectable = find.byWidgetPredicate(
        (w) => w is SelectableText && w.data == raw,
      );
      await tester.longPress(selectable);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Select all'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Copy'));
      await tester.pumpAndSettle();
      expect(copied, raw);
    },
  );
  testWidgets(
    'large text short viewport keeps disclosure and raw details accessible',
    (tester) async {
      tester.view.physicalSize = const Size(360, 300);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final raw = 'cat /repo/${List.filled(25, 'directory').join('/')}/a.dart';
      await showCommand(tester, command(raw, 'stopped'), scale: 2.2);
      expect(
        tester.getSize(find.byType(SvgPicture).first).width,
        closeTo(37.4, .01),
      );
      expect(
        tester.getTopRight(find.byIcon(DjlIcons.chevronRight)).dx,
        lessThanOrEqualTo(360),
      );
      await tester.tap(find.byType(ActivityCard));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text(raw),
        80,
        scrollable: find
            .descendant(
              of: find.byType(ListView),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      expect(
        find.byWidgetPredicate((w) => w is SelectableText && w.data == raw),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );
}
