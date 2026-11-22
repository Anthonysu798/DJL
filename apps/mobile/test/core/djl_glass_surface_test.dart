import 'dart:async';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/presentation/djl_glass.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_thread_pin_menu.dart';

void main() {
  testWidgets(
    'context dismissal keeps native glass absent until the overlay completes',
    (tester) async {
      final messenger = tester.binding.defaultBinaryMessenger;
      const info = MethodChannel('djl.mobile/app-info');
      const views = MethodChannel('flutter/platform_views');
      messenger.setMockMethodCallHandler(info, (call) async => true);
      messenger.setMockMethodCallHandler(views, (call) async => null);
      final input = TextEditingController(text: 'Retained context draft');
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Column(
                children: [
                  SizedBox(
                    width: 260,
                    height: 60,
                    child: DjlGlassSurface(child: TextField(controller: input)),
                  ),
                  Builder(
                    builder: (context) => TextButton(
                      onPressed: () => unawaited(
                        showDesktopThreadPinMenu(
                          context,
                          const Rect.fromLTWH(10, 200, 260, 50),
                          pinned: false,
                          preview: const ColoredBox(color: Colors.white),
                        ),
                      ),
                      child: const Text('Open context'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final editor = tester.state(find.byType(EditableText));
        expect(find.byType(UiKitView), findsOneWidget);
        await tester.tap(find.text('Open context'));
        await tester.pumpAndSettle();
        expect(find.byType(UiKitView, skipOffstage: false), findsNothing);
        await tester.binding.handlePopRoute();
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 60));
        expect(
          find.byKey(const Key('navigation.context-preview')),
          findsOneWidget,
        );
        expect(
          find.byType(UiKitView, skipOffstage: false),
          findsNothing,
          reason:
              'A returning UIKit plane must not interrupt the Flutter backdrop transition.',
        );
        await tester.pumpAndSettle();
        expect(find.byType(UiKitView), findsOneWidget);
        expect(tester.state(find.byType(EditableText)), same(editor));
        expect(input.text, 'Retained context draft');
      } finally {
        await tester.pumpWidget(const SizedBox());
        input.dispose();
        messenger.setMockMethodCallHandler(info, null);
        messenger.setMockMethodCallHandler(views, null);
      }
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );
  testWidgets(
    'covered iOS route releases native glass without replacing its child',
    (tester) async {
      final messenger = tester.binding.defaultBinaryMessenger;
      const info = MethodChannel('djl.mobile/app-info');
      const views = MethodChannel('flutter/platform_views');
      messenger.setMockMethodCallHandler(info, (call) async => true);
      messenger.setMockMethodCallHandler(views, (call) async => null);
      final navigator = GlobalKey<NavigatorState>();
      final input = TextEditingController(text: 'Retained draft');
      try {
        await tester.pumpWidget(
          MaterialApp(
            navigatorKey: navigator,
            home: Scaffold(
              body: DjlGlassSurface(child: TextField(controller: input)),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final editable = tester.state(find.byType(EditableText));
        expect(find.byType(UiKitView), findsOneWidget);
        unawaited(
          showModalBottomSheet<void>(
            context: tester.element(find.byType(DjlGlassSurface)),
            builder: (_) => const SizedBox(
              height: 200,
              child: DjlGlassSurface(child: Text('Visible sheet')),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byType(UiKitView, skipOffstage: false), findsOneWidget);
        navigator.currentState!.pop();
        await tester.pumpAndSettle();
        expect(find.byType(UiKitView), findsOneWidget);
        expect(tester.state(find.byType(EditableText)), same(editable));
        expect(input.text, 'Retained draft');
      } finally {
        await tester.pumpWidget(const SizedBox());
        input.dispose();
        messenger.setMockMethodCallHandler(info, null);
        messenger.setMockMethodCallHandler(views, null);
      }
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );

  testWidgets(
    'Android glass keeps its live input across compositor preference changes',
    (tester) async {
      final input = TextEditingController(text: 'Retained local draft');
      var glass = true;
      late StateSetter update;
      try {
        await tester.pumpWidget(
          StatefulBuilder(
            builder: (context, setState) {
              update = setState;
              return MaterialApp(
                theme: djlTheme(Brightness.light, liquidGlass: glass),
                home: Scaffold(
                  body: Center(
                    child: SizedBox(
                      width: 260,
                      height: 72,
                      child: DjlGlassSurface(
                        child: TextField(controller: input),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        );
        await tester.pumpAndSettle();
        final blur = find.descendant(
          of: find.byType(DjlGlassSurface),
          matching: find.byType(BackdropFilter),
        );
        expect(
          blur,
          findsOneWidget,
          reason:
              'Android uses a plain compositor blur, never a runtime shader filter.',
        );
        final editor = tester.state(find.byType(EditableText));
        await tester.tap(find.byType(TextField));
        await tester.enterText(
          find.byType(TextField),
          'Still owned after glass change',
        );
        update(() => glass = false);
        await tester.pumpAndSettle();
        expect(blur, findsNothing);
        expect(tester.state(find.byType(EditableText)), same(editor));
        update(() => glass = true);
        await tester.pumpAndSettle();
        expect(blur, findsOneWidget);
        expect(tester.state(find.byType(EditableText)), same(editor));
        expect(input.text, 'Still owned after glass change');
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        input.dispose();
      }
    },
    variant: TargetPlatformVariant.only(TargetPlatform.android),
  );

  for (final brightness in Brightness.values) {
    testWidgets(
      'Disabled material stays visible against the $brightness page',
      (tester) async {
        final key = GlobalKey();
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(brightness, liquidGlass: false),
            home: Center(
              child: RepaintBoundary(
                key: key,
                child: ColoredBox(
                  color: brightness == Brightness.light
                      ? Colors.white
                      : Colors.black,
                  child: const SizedBox(
                    width: 200,
                    height: 100,
                    child: Center(
                      child: DjlGlassSurface(
                        child: SizedBox(width: 160, height: 60),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final boundary =
            key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
        final pixels = await tester.runAsync(() async {
          final image = await boundary.toImage(pixelRatio: 1);
          try {
            return await image.toByteData(format: ui.ImageByteFormat.rawRgba);
          } finally {
            image.dispose();
          }
        });
        final center = pixels!.getUint8((50 * 200 + 100) * 4);
        final page = pixels.getUint8((4 * 200 + 4) * 4);
        if (brightness == Brightness.light) {
          expect(page, 255);
          expect(center, lessThan(254));
        } else {
          expect(page, 0);
          expect(center, greaterThan(8));
        }
        expect(tester.takeException(), isNull);
      },
      variant: TargetPlatformVariant.only(TargetPlatform.android),
    );
  }
}
