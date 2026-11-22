import 'dart:async';
import 'dart:ui' as ui;
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/presentation/djl_glass.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'package:djl_mobile/features/conversations/presentation/cloud_chat_actions.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'only the current Cloud popup owns a native glass plane',
    (tester) async {
      final messenger = tester.binding.defaultBinaryMessenger;
      const info = MethodChannel('djl.mobile/app-info');
      const views = MethodChannel('flutter/platform_views');
      messenger.setMockMethodCallHandler(info, (_) async => true);
      messenger.setMockMethodCallHandler(views, (_) async => null);
      try {
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(Brightness.light),
            home: Scaffold(
              body: Column(
                children: [
                  const SizedBox(
                    width: 260,
                    height: 60,
                    child: DjlGlassSurface(child: Text('Retained background')),
                  ),
                  Builder(
                    builder: (context) => TextButton(
                      onPressed: () => unawaited(
                        showCloudChatActions(
                          context,
                          const Conversation(id: 'owned'),
                          const Rect.fromLTWH(10, 200, 260, 50),
                          preview: const SizedBox(width: 260, height: 50),
                        ),
                      ),
                      child: const Text('Open'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byType(UiKitView), findsOneWidget);
        await tester.tap(find.text('Open'));
        await tester.pumpAndSettle();
        final native = find.byType(UiKitView, skipOffstage: false);
        expect(
          native,
          findsOneWidget,
          reason:
              'Use native glass on the visible popup while its covered plane stays absent.',
        );
        final surface = find.byKey(const Key('cloud-chat-actions'));
        expect(
          find.descendant(of: surface, matching: find.byType(TextButton)),
          findsNWidgets(4),
        );
        expect(tester.widget<Material>(surface).color, Colors.transparent);
        await tester.binding.handlePopRoute();
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 60));
        final outgoing = tester.widget<UiKitView>(
          find.byType(UiKitView, skipOffstage: false),
        );
        expect((outgoing.creationParams as Map)['radius'], 34);
        await tester.pumpAndSettle();
        expect(find.byType(UiKitView), findsOneWidget);
        expect(find.text('Retained background'), findsOneWidget);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        messenger.setMockMethodCallHandler(info, null);
        messenger.setMockMethodCallHandler(views, null);
      }
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );

  for (final brightness in Brightness.values) {
    testWidgets(
      'Android Cloud glass transmits its backdrop in $brightness',
      (tester) async {
        tester.view.physicalSize = const Size(402, 874);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final boundary = GlobalKey();
        final dark = brightness == Brightness.dark;
        await tester.pumpWidget(
          RepaintBoundary(
            key: boundary,
            child: MaterialApp(
              theme: djlTheme(brightness),
              home: Builder(
                builder: (context) => Scaffold(
                  body: Stack(
                    fit: StackFit.expand,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(
                            child: ColoredBox(
                              color: dark
                                  ? const Color(0xff404040)
                                  : Colors.white,
                            ),
                          ),
                          Expanded(
                            child: ColoredBox(
                              color: dark
                                  ? Colors.black
                                  : const Color(0xff808080),
                            ),
                          ),
                        ],
                      ),
                      Align(
                        alignment: Alignment.topLeft,
                        child: TextButton(
                          onPressed: () => unawaited(
                            showCloudChatActions(
                              context,
                              const Conversation(id: 'owned'),
                              const Rect.fromLTWH(10, 200, 260, 50),
                              preview: const SizedBox(width: 260, height: 50),
                            ),
                          ),
                          child: const Text('Open'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Open'));
        await tester.pumpAndSettle();
        expect(find.byType(UiKitView), findsNothing);
        final rect = tester.getRect(
          find.byKey(const Key('cloud-chat-actions')),
        );
        final samples = await tester.runAsync(() async {
          final image =
              await (boundary.currentContext!.findRenderObject()
                      as RenderRepaintBoundary)
                  .toImage(pixelRatio: 1);
          try {
            final bytes = (await image.toByteData(
              format: ui.ImageByteFormat.rawRgba,
            ))!;
            int red(double x) => bytes.getUint8(
              ((rect.top + 22).floor() * image.width + x.floor()) * 4,
            );
            return [red(rect.left + 130), red(rect.left + 220)];
          } finally {
            image.dispose();
          }
        });
        final contrast = samples![0] - samples[1];
        expect(
          contrast,
          dark ? inInclusiveRange(3, 24) : greaterThan(10),
          reason:
              'Dark glass attenuates bright backdrop text; both materials retain visible transmission.',
        );
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      },
      variant: TargetPlatformVariant.only(TargetPlatform.android),
    );
  }
}
