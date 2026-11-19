import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'desktop_activity_test.dart' show ActivityCacheStore;
import 'pairing_presentation_test.dart'
    show PairingWrites, ObservedPairingTransport, finish;

Future<DesktopController> openPanel(WidgetTester tester, bool dark) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(402, 874);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
  final pairs = PairingRepository(PairingWrites());
  final desktop = DesktopController(
    pairs,
    connection: ObservedPairingTransport(pairs),
    localStore: ActivityCacheStore(),
  );
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(dark ? Brightness.dark : Brightness.light),
      home: PairingPage(controller: desktop),
    ),
  );
  await tester.pumpAndSettle();
  return desktop;
}

const _setup =
    'Open DJL on your Mac or Windows PC, then go to Settings → Remote.';

void main() {
  for (final dark in [false, true]) {
    testWidgets('first-run pairing has readable type and spacing dark=$dark', (
      tester,
    ) async {
      final desktop = await openPanel(tester, dark);
      final title = tester.renderObject<RenderParagraph>(
        find.text('Connect to DJL Desktop'),
      );
      final detail = tester.renderObject<RenderParagraph>(find.text(_setup));
      expect(title.text.style!.fontSize, 22);
      expect(detail.text.style!.fontSize, 13);
      expect(title.didExceedMaxLines, isFalse);
      expect(detail.didExceedMaxLines, isFalse);
      expect(
        tester.getRect(find.text(_setup)).top -
            tester.getRect(find.text('Connect to DJL Desktop')).bottom,
        closeTo(10, 1),
      );
      expect(tester.takeException(), isNull);
      await finish(tester, desktop);
    });
    testWidgets(
      'cold identity announces the setup instructions once dark=$dark',
      (tester) async {
        final desktop = await openPanel(tester, dark);
        final semantics = tester.ensureSemantics();
        await tester.pump();
        expect(
          find.bySemanticsLabel('Connect to DJL Desktop. $_setup'),
          findsOneWidget,
        );
        expect(
          tester
              .getSemantics(
                find.bySemanticsLabel('Connect to DJL Desktop. $_setup'),
              )
              .rect
              .height,
          lessThanOrEqualTo(200),
        );
        semantics.dispose();
        await finish(tester, desktop);
      },
    );
    testWidgets(
      'cold pairing buttons match source paint and keep touch area dark=$dark',
      (tester) async {
        final desktop = await openPanel(tester, dark);
        final primary = find.widgetWithText(FilledButton, 'Scan QR Code');
        final secondary = find.widgetWithText(OutlinedButton, 'Pair with Code');
        final primaryPaint = tester.getRect(
          find.descendant(of: primary, matching: find.byType(Material)),
        );
        final secondaryPaint = tester.getRect(
          find.descendant(of: secondary, matching: find.byType(Material)),
        );
        expect(primaryPaint.width, closeTo(300, .01));
        expect(primaryPaint.height, closeTo(46, 1));
        expect(secondaryPaint.height, closeTo(44.8, 1));
        expect(tester.getRect(primary).height, greaterThanOrEqualTo(48));
        expect(tester.getRect(secondary).height, greaterThanOrEqualTo(48));
        final primaryText = tester.renderObject<RenderParagraph>(
          find.text('Scan QR Code'),
        );
        final secondaryText = tester.renderObject<RenderParagraph>(
          find.text('Pair with Code'),
        );
        expect(primaryText.text.style!.fontSize, 15);
        expect(secondaryText.text.style!.fontSize, 14);
        expect(tester.takeException(), isNull);
        await finish(tester, desktop);
      },
    );
  }
}
