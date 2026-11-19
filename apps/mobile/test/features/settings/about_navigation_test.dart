import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/presentation/djl_glass.dart';
import 'package:djl_mobile/features/settings/presentation/about_djl_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    for (final brightness in Brightness.values) {
      for (final scale in [1.0, 2.2]) {
        testWidgets(
          'About source header and Back in $platform/$brightness/$scale',
          (tester) async {
            tester.view.physicalSize = const Size(320, 700);
            tester.view.devicePixelRatio = 1;
            addTearDown(tester.view.resetPhysicalSize);
            addTearDown(tester.view.resetDevicePixelRatio);
            final semantics = tester.ensureSemantics();
            try {
              await tester.pumpWidget(
                MaterialApp(
                  theme: djlTheme(brightness).copyWith(platform: platform),
                  builder: (context, child) => MediaQuery(
                    data: MediaQuery.of(
                      context,
                    ).copyWith(textScaler: TextScaler.linear(scale)),
                    child: child!,
                  ),
                  home: Builder(
                    builder: (context) => Scaffold(
                      body: TextButton(
                        onPressed: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => const AboutDjlPage(),
                          ),
                        ),
                        child: const Text('Open guide'),
                      ),
                    ),
                  ),
                ),
              );
              await tester.tap(find.text('Open guide'));
              await tester.pumpAndSettle();
              expect(tester.getSize(find.byType(AppBar)).height, 44);
              if (scale == 1.0) {
                expect(
                  tester.getSize(find.text('About DJL')).height,
                  closeTo(20.4, .5),
                );
              }
              expect(
                tester.getRect(find.text('DJL')).top -
                    tester.getRect(find.byType(AppBar)).bottom,
                18,
              );
              final back = find.byTooltip('Back');
              expect(back, findsOneWidget);
              expect(tester.getSize(back), const Size(44, 44));
              expect(tester.getRect(back).left, 16);
              expect(
                find.ancestor(of: back, matching: find.byType(DjlGlassSurface)),
                findsOneWidget,
              );
              expect(
                tester.getSemantics(back).flagsCollection.isButton,
                isTrue,
              );
              expect(find.text('About DJL'), findsOneWidget);
              expect(tester.takeException(), isNull);
              await tester.tap(back);
              await tester.pumpAndSettle();
              expect(find.text('Open guide'), findsOneWidget);
              expect(find.byType(AboutDjlPage), findsNothing);
              expect(tester.takeException(), isNull);
            } finally {
              semantics.dispose();
            }
          },
          variant: TargetPlatformVariant.only(platform),
        );
      }
    }
  }
}
