import '../support/native_text_search.dart'
    show useAsciiNativeSearch, clearNativeSearchFixture;
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/core/design/djl_icons.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_new_chat_draft_test.dart'
    show DraftTransport, draftDesktop, finishDraft;
import 'desktop_recovery_test.dart' show RecoveryMemoryStore;

const paintKey = Key('navigation_controls_paint');

Future<Color> controlPaint(WidgetTester tester, Finder control) async {
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(paintKey),
  );
  final rect = tester.getRect(control);
  final point = boundary.globalToLocal(Offset(rect.center.dx, rect.top + 8));
  return (await tester.runAsync(() async {
    final image = await boundary.toImage();
    final bytes = (await image.toByteData(format: ui.ImageByteFormat.rawRgba))!;
    final index = (point.dy.floor() * image.width + point.dx.floor()) * 4;
    final color = Color.fromARGB(
      bytes.getUint8(index + 3),
      bytes.getUint8(index),
      bytes.getUint8(index + 1),
      bytes.getUint8(index + 2),
    );
    image.dispose();
    return color;
  }))!;
}

Finder circle(IconData icon) =>
    find.widgetWithIcon(IconButton, icon).hitTestable();
Finder materialInside(Finder control) =>
    find.descendant(of: control, matching: find.byType(Material)).first;

void main() {
  setUp(useAsciiNativeSearch);
  tearDown(clearNativeSearchFixture);
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final brightness in Brightness.values) {
    testWidgets(
      'drawer search, close search and Settings stay legible in $brightness',
      (tester) async {
        final remote = DraftTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        final theme = djlTheme(brightness);
        var settings = 0;
        await tester.pumpWidget(
          MaterialApp(
            theme: theme,
            home: RepaintBoundary(
              key: paintKey,
              child: PairingPage(
                controller: desktop,
                onSettings: () => settings++,
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Open navigation'));
        await tester.pumpAndSettle();
        final calls = remote.calls.length;
        Future<void> expectNeutral(IconData icon, double size) async {
          final button = circle(icon), surface = materialInside(button);
          final paint = await controlPaint(tester, surface);
          expect((paint.r - paint.g).abs(), lessThan(.03));
          expect((paint.g - paint.b).abs(), lessThan(.03));
          final ink = theme.colorScheme.onSurface.computeLuminance();
          final background = paint.computeLuminance();
          final contrast = ink > background
              ? (ink + .05) / (background + .05)
              : (background + .05) / (ink + .05);
          expect(contrast, greaterThanOrEqualTo(4.5));
          final iconContext = tester.element(
            find.descendant(of: button, matching: find.byIcon(icon)),
          );
          expect(IconTheme.of(iconContext).color, theme.colorScheme.onSurface);
          expect(tester.getSize(surface), Size(size, size));
          expect(tester.getSize(button), Size(size, size));
        }

        await expectNeutral(DjlIcons.search, 44);
        await expectNeutral(DjlIcons.settings, 50);
        await tester.tap(circle(DjlIcons.search));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('navigation.search')),
          'local filter',
        );
        await tester.pumpAndSettle();
        await expectNeutral(DjlIcons.close, 44);
        await tester.tap(circle(DjlIcons.close));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('navigation.search')), findsNothing);
        await expectNeutral(DjlIcons.search, 44);
        await tester.tap(circle(DjlIcons.settings));
        await tester.pumpAndSettle();
        expect(settings, 1);
        expect(remote.calls.length, calls);
        await finishDraft(tester, desktop);
      },
    );

    for (final connected in [false, true]) {
      testWidgets(
        'footer Chat retains primary surface and ${connected ? 'enabled' : 'disabled'} state in $brightness',
        (tester) async {
          final remote = DraftTransport(PairingRepository(TestCredentials()))
            ..online = connected;
          final desktop = connected
              ? await draftDesktop(remote)
              : DesktopController(
                  remote.pairings,
                  connection: remote,
                  localStore: RecoveryMemoryStore(),
                );
          final theme = djlTheme(brightness);
          await tester.pumpWidget(
            MaterialApp(
              theme: theme,
              home: RepaintBoundary(
                key: paintKey,
                child: PairingPage(controller: desktop),
              ),
            ),
          );
          await tester.pumpAndSettle();
          await tester.tap(find.byTooltip('Open navigation'));
          await tester.pumpAndSettle();
          final button = find
              .ancestor(
                of: find.text('Chat').hitTestable(),
                matching: find.byWidgetPredicate((w) => w is FilledButton),
              )
              .first;
          final surface = materialInside(button);
          expect(
            await controlPaint(tester, surface),
            theme.colorScheme.onSurface,
          );
          expect(
            tester.widget<Material>(surface).color,
            theme.colorScheme.onSurface,
          );
          expect(
            DefaultTextStyle.of(
              tester.element(find.text('Chat').hitTestable()),
            ).style.color,
            connected
                ? theme.colorScheme.surface
                : theme.colorScheme.onSurfaceVariant,
          );
          expect(
            tester.widget<FilledButton>(button).onPressed,
            connected ? isNotNull : isNull,
          );
          final semantics = tester.ensureSemantics();
          expect(
            tester.getSemantics(button).flagsCollection.isEnabled,
            connected ? ui.Tristate.isTrue : ui.Tristate.isFalse,
          );
          expect(tester.getSize(surface).height, greaterThanOrEqualTo(50));
          if (!connected) {
            await tester.tap(button);
            await tester.pumpAndSettle();
            expect(desktop.newChatDraft, isNull);
            expect(remote.calls, isEmpty);
          }
          semantics.dispose();
          await finishDraft(tester, desktop);
        },
      );
    }
  }
}
