import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/design/djl_tokens.dart';
import 'package:djl_mobile/core/presentation/djl_glass.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import 'cloud_composer_draft_page_test.dart' show DraftPageFixture;
import 'cloud_composer_draft_store_test.dart' show DraftCredentials;
import 'voice_controller_test.dart' show TestVoice;

Future<({DraftPageFixture fixture, ChatController chat, GlobalKey boundary})>
showEmpty(
  WidgetTester tester, {
  Brightness brightness = Brightness.light,
  AppFontStyle font = AppFontStyle.system,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(402, 874);
  final fixture = DraftPageFixture(DraftCredentials());
  final chat = ChatController(fixture.repository, accountScope: 'u:o');
  final boundary = GlobalKey();
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    fixture.client.close();
    tester.view.reset();
  });
  await tester.pumpWidget(
    RepaintBoundary(
      key: boundary,
      child: MaterialApp(
        theme: djlTheme(brightness, font: font),
        home: ChatPage(
          controller: chat,
          voiceDriver: TestVoice(),
          onOpenNavigation: () {},
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (fixture: fixture, chat: chat, boundary: boundary);
}

Future<Color> pixelAt(
  WidgetTester tester,
  GlobalKey key,
  Offset position,
) async {
  final boundary =
      key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
  final point = boundary.globalToLocal(position);
  return (await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 1);
    try {
      final bytes = (await image.toByteData(
        format: ui.ImageByteFormat.rawRgba,
      ))!;
      final index = (point.dy.floor() * image.width + point.dx.floor()) * 4;
      return Color.fromARGB(
        bytes.getUint8(index + 3),
        bytes.getUint8(index),
        bytes.getUint8(index + 1),
        bytes.getUint8(index + 2),
      );
    } finally {
      image.dispose();
    }
  }))!;
}

void main() {
  testWidgets(
    'Navigation button is a flat raised disc with no shadow below the compact toolbar',
    (tester) async {
      final previous = debugDisableShadows;
      debugDisableShadows = false;
      try {
        final page = await showEmpty(tester);
        final toolbar = tester.getRect(find.byType(AppBar));
        final navigation = tester.getRect(find.byTooltip('Open navigation'));
        final below = await pixelAt(
          tester,
          page.boundary,
          Offset(navigation.center.dx, toolbar.bottom + 6),
        );
        expect(below.toARGB32(), DjlColors.light.surface.toARGB32());
        final disc = await pixelAt(
          tester,
          page.boundary,
          Offset(navigation.left + 4, navigation.center.dy),
        );
        expect(disc.toARGB32(), DjlColors.light.surfaceRaised.toARGB32());
        expect(page.fixture.posts, 0);
        expect(tester.takeException(), isNull);
      } finally {
        debugDisableShadows = previous;
      }
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );

  for (final font in [AppFontStyle.system, AppFontStyle.geist]) {
    testWidgets(
      'Model uses body text and empty heading uses title text while respecting $font',
      (tester) async {
        final page = await showEmpty(tester, font: font);
        final theme = Theme.of(tester.element(find.byType(ChatPage)));
        final model = find.descendant(
          of: find.byKey(const Key('cloud.model-picker')),
          matching: find.byType(Text),
        );
        final modelParagraph = tester.renderObject<RenderParagraph>(model);
        final heading = tester.renderObject<RenderParagraph>(
          find.text('How can I help?'),
        );
        expect(
          modelParagraph.text.style!.fontFamily,
          theme.textTheme.bodyLarge!.fontFamily,
        );
        expect(
          heading.text.style!.fontFamily,
          theme.textTheme.titleLarge!.fontFamily,
        );
        expect(tester.widget<Text>(model).style!.fontSize, 15);
        expect(
          tester.widget<Text>(find.text('How can I help?')).style!.fontSize,
          18,
        );
        expect(page.fixture.posts, 0);
        expect(tester.takeException(), isNull);
      },
      variant: TargetPlatformVariant.only(TargetPlatform.iOS),
    );
  }

  testWidgets(
    'System text follows UIKit optical size, weight, and native tracking',
    (tester) async {
      final page = await showEmpty(tester);
      final model = find.descendant(
        of: find.byKey(const Key('cloud.model-picker')),
        matching: find.byType(Text),
      );
      final modelStyle = tester
          .renderObject<RenderParagraph>(model)
          .text
          .style!;
      expect(
        modelStyle.fontVariations,
        contains(const FontVariation.opticalSize(17)),
      );
      expect(
        modelStyle.fontVariations,
        contains(const FontVariation.weight(590)),
      );
      expect(modelStyle.letterSpacing, -.23);
      final titleStyle = tester
          .renderObject<RenderParagraph>(find.text('How can I help?'))
          .text
          .style!;
      expect(
        titleStyle.fontVariations,
        contains(const FontVariation.opticalSize(18)),
      );
      expect(
        titleStyle.fontVariations,
        contains(const FontVariation.weight(590)),
      );
      expect(titleStyle.letterSpacing, -.44);
      expect(page.fixture.posts, 0);
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );

  testWidgets(
    'Empty overlay retains the timeline top inset while staying viewport centered',
    (tester) async {
      final page = await showEmpty(tester);
      final title = find.text('How can I help?');
      final content = find.ancestor(
        of: title,
        matching: find.byWidgetPredicate(
          (widget) =>
              widget is Column && widget.mainAxisSize == MainAxisSize.min,
        ),
      );
      final viewport = find.ancestor(
        of: title,
        matching: find.byType(Expanded),
      );
      expect(content, findsOneWidget);
      expect(viewport, findsOneWidget);
      expect(
        tester.getRect(content).center.dy - tester.getRect(viewport).center.dy,
        closeTo(12 / 2, .1),
      );
      expect(page.fixture.posts, 0);
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );

  testWidgets(
    'Task subtitle and reserved composer spacing match the source inset',
    (tester) async {
      final page = await showEmpty(tester);
      await tester.tap(find.byTooltip('Task mode'));
      await tester.pumpAndSettle();
      expect(page.chat.mode, 'task');
      final subtitle = find.text(
        "Start a task and return to the result when it's ready.",
      );
      expect(tester.widget<Text>(subtitle).style!.fontSize, 14);
      final viewport = find.ancestor(
        of: subtitle,
        matching: find.byType(Expanded),
      );
      expect(viewport, findsOneWidget);
      expect(
        tester.getRect(find.byType(DjlGlassSurface)).top -
            tester.getRect(viewport).bottom,
        0,
      );
      expect(page.fixture.posts, 0);
      expect(tester.takeException(), isNull);
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );

  for (final brightness in Brightness.values) {
    testWidgets(
      'Active Task is ink-filled with onInk content in $brightness',
      (tester) async {
        final page = await showEmpty(tester, brightness: brightness);
        await tester.tap(find.byTooltip('Task mode'));
        await tester.pumpAndSettle();
        final button = tester.getRect(find.byTooltip('Task mode'));
        final color = await pixelAt(
          tester,
          page.boundary,
          Offset(button.left + 6, button.center.dy),
        );
        final colors = brightness == Brightness.dark
            ? DjlColors.dark
            : DjlColors.light;
        expect(color.toARGB32(), colors.ink.toARGB32());
        expect(
          tester.widget<Text>(find.text('Task')).style!.color,
          colors.onInk,
        );
        expect(page.fixture.posts, 0);
        expect(tester.takeException(), isNull);
      },
      variant: TargetPlatformVariant.only(TargetPlatform.iOS),
    );
  }
}
