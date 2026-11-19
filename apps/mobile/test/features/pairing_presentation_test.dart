import 'dart:async';
import 'dart:convert';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_activity_test.dart' show ActivityCacheStore;
import 'desktop_recovery_test.dart' show RecoveringTransport;
import 'desktop_offline_test.dart' show savedPair;

class ObservedPairingTransport extends RecoveringTransport {
  ObservedPairingTransport(super.pairings);
  final rpc = <String>[];
  final connectGate = Completer<void>();
  bool gateConnect = false;
  int disconnects = 0;
  @override
  Future<void> connect(Pairing pair, {required bool bootstrap}) async {
    if (gateConnect) await connectGate.future;
    await super.connect(pair, bootstrap: bootstrap);
  }

  @override
  Future<void> disconnect() async {
    disconnects++;
    await super.disconnect();
  }

  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    rpc.add(method);
    return super.request(method, params, timeout: timeout);
  }
}

class VerifiedPairings extends PairingRepository {
  VerifiedPairings(super.credentials);
  @override
  Future<Pairing> resolveTrusted(Pairing pair) async => pair;
}

class PairingWrites extends TestCredentials {
  int writes = 0;
  bool failWrites = false;
  @override
  Future<void> write(String key, String? value) async {
    writes++;
    if (failWrites) throw StateError('Secure store unavailable');
    await super.write(key, value);
  }
}

Future<void> more(WidgetTester tester, String label) async {
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.byTooltip('More actions'));
  await tester.pumpAndSettle();
  await tester.tap(find.byTooltip('More actions'));
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.text(label));
  await tester.pumpAndSettle();
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

Future<void> close(WidgetTester tester, String label) async {
  await tester.ensureVisible(find.text(label));
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

Future<void> finish(WidgetTester tester, DesktopController desktop) async {
  await tester.pumpWidget(const SizedBox.shrink());
  desktop.dispose();
  await tester.pump();
}

Future<List<Color>> paintedColors(
  WidgetTester tester,
  List<Offset> points,
) async {
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(const Key('pairing_paint')),
  );
  return (await tester.runAsync(() async {
    final image = await boundary.toImage();
    final bytes = (await image.toByteData(format: ui.ImageByteFormat.rawRgba))!;
    final colors = points.map((point) {
      final local = boundary.globalToLocal(point);
      final index = (local.dy.floor() * image.width + local.dx.floor()) * 4;
      return Color.fromARGB(
        bytes.getUint8(index + 3),
        bytes.getUint8(index),
        bytes.getUint8(index + 1),
        bytes.getUint8(index + 2),
      );
    }).toList();
    image.dispose();
    return colors;
  }))!;
}

Future<void> expectDistinctPaint(
  WidgetTester tester,
  Rect rect,
  Color surface,
  Color parent, {
  bool capsule = false,
}) async {
  final colors = await paintedColors(tester, [
    capsule
        ? Offset(rect.center.dx, rect.top + 4)
        : Offset(rect.left + 8, rect.center.dy),
    Offset(rect.left - 8, rect.center.dy),
    if (capsule) rect.topLeft + const Offset(1, 1),
  ]);
  expect(colors, [surface, parent, if (capsule) parent]);
  expect(colors.first, isNot(colors[1]));
}

void expectHeaderContained(WidgetTester tester, String title) {
  final button = find.widgetWithText(TextButton, 'Close');
  final capsule = tester.getRect(
    find.descendant(of: button, matching: find.byType(Material)),
  );
  final titleRect = tester.getRect(find.text(title));
  final sheet = tester.getRect(find.byType(BottomSheet));
  final label = tester.getRect(find.text('Close'));
  debugPrint(
    'pairing measured $title capsule=$capsule label=$label title=$titleRect sheet=$sheet',
  );
  for (final rect in [capsule, titleRect]) {
    expect(sheet.intersect(rect), rect);
  }
  expect(capsule.intersect(label), label);
  expect(capsule.overlaps(titleRect), isFalse);
  for (final text in ['Close', title]) {
    expect(
      tester.renderObject<RenderParagraph>(find.text(text)).didExceedMaxLines,
      isFalse,
    );
  }
}

void expectFieldLabelVisible(WidgetTester tester, String label) {
  final finder = find.text(label);
  expect(
    tester.renderObject<RenderParagraph>(finder).didExceedMaxLines,
    isFalse,
  );
  final viewport = Rect.fromLTWH(
    0,
    0,
    tester.view.physicalSize.width / tester.view.devicePixelRatio,
    (tester.view.physicalSize.height - tester.view.viewInsets.bottom) /
        tester.view.devicePixelRatio,
  );
  final rect = tester.getRect(finder);
  expect(viewport.intersect(rect), rect);
  final scroll = tester.getRect(
    find.ancestor(of: finder, matching: find.byType(ListView)).first,
  );
  expect(scroll.intersect(rect), rect);
}

void main() {
  WidgetController.hitTestWarningShouldBeFatal = true;
  for (final title in ['Connections', 'Secure pairing details']) {
    for (final initial in [Brightness.dark, Brightness.light]) {
      testWidgets('open $title follows system theme from ${initial.name}', (
        tester,
      ) async {
        tester.platformDispatcher.platformBrightnessTestValue = initial;
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        var network = 0;
        final credentials = PairingWrites();
        final pairs = PairingRepository(
          credentials,
          client: MockClient((_) async {
            network++;
            return http.Response('{}', 500);
          }),
        );
        final transport = ObservedPairingTransport(pairs);
        final desktop = DesktopController(
          pairs,
          connection: transport,
          localStore: ActivityCacheStore(),
        );
        await tester.pumpWidget(
          RepaintBoundary(
            key: const Key('pairing_paint'),
            child: MaterialApp(
              theme: djlTheme(Brightness.light),
              darkTheme: djlTheme(Brightness.dark),
              themeMode: ThemeMode.system,
              home: PairingPage(controller: desktop),
            ),
          ),
        );
        await more(tester, title);
        const invalid = 'This is not a DJL pairing QR or pasteable code.';
        TextEditingController? payload, relay;
        if (title == 'Secure pairing details') {
          final field = find.byKey(const Key('pairing_payload'));
          final relayField = find.byKey(const Key('pairing_relay'));
          await tester.enterText(field, '000');
          await tester.enterText(relayField, 'wss://custom.test/relay');
          payload = tester.widget<TextField>(field).controller;
          relay = tester.widget<TextField>(relayField).controller;
          await tester.tap(find.text('Pair securely'));
          await tester.pumpAndSettle();
          expect(find.text(invalid), findsOneWidget);
        }
        final sheet = find.byType(BottomSheet);
        final sheetElement = tester.element(sheet);
        final route = ModalRoute.of(tester.element(find.text(title)))!;
        final rootState = tester.state(find.byType(PairingPage));
        final state = desktop.state;
        final error = desktop.error;
        for (final brightness in [
          initial,
          initial == Brightness.dark ? Brightness.light : Brightness.dark,
        ]) {
          tester.platformDispatcher.platformBrightnessTestValue = brightness;
          await tester.pumpAndSettle();
          final dark = brightness == Brightness.dark;
          final surface = djlTheme(brightness).colorScheme.surfaceContainerLow;
          final foreground = dark ? Colors.white : Colors.black;
          expect(tester.element(sheet), same(sheetElement));
          expect(ModalRoute.of(tester.element(find.text(title))), same(route));
          expect(route.isCurrent, isTrue);
          expect(Theme.of(tester.element(sheet)).brightness, brightness);
          final textColor = tester
              .renderObject<RenderParagraph>(find.text(title))
              .text
              .style!
              .color!;
          expect(textColor, foreground);
          final material = tester.widget<Material>(
            find.descendant(of: sheet, matching: find.byType(Material)).first,
          );
          final paint = (await paintedColors(tester, [
            tester.getBottomLeft(sheet) +
                Offset(tester.getSize(sheet).width / 2, -12),
          ])).single;
          debugPrint(
            '$title system=${brightness.name} material=${material.color} paint=$paint text=$textColor',
          );
          expect(paint, surface);
          expect(material.color, surface);
          final textLuminance = textColor.computeLuminance();
          final backgroundLuminance = paint.computeLuminance();
          final contrast = dark
              ? (textLuminance + .05) / (backgroundLuminance + .05)
              : (backgroundLuminance + .05) / (textLuminance + .05);
          expect(contrast, greaterThanOrEqualTo(4.5));
          if (payload != null) {
            final field = tester.widget<TextField>(
              find.byKey(const Key('pairing_payload')),
            );
            final relayField = tester.widget<TextField>(
              find.byKey(const Key('pairing_relay')),
            );
            expect(field.controller, same(payload));
            expect(relayField.controller, same(relay));
            expect(payload.text, '000');
            expect(relay!.text, 'wss://custom.test/relay');
            expect(find.text(invalid), findsOneWidget);
          }
          expect(tester.state(find.byType(PairingPage)), same(rootState));
          expect(desktop.state, state);
          expect(desktop.error, error);
          expect(desktop.active, isNull);
          expect(desktop.busy, isFalse);
          expect(credentials.writes, 0);
          expect(network, 0);
          expect(transport.attempts, 0);
          expect(transport.rpc, isEmpty);
          expect(transport.disconnects, 0);
        }
        await close(tester, 'Close');
        await finish(tester, desktop);
      });
    }
  }
  for (final dark in [false, true]) {
    for (final section in ['Close', 'roles', 'secure fields']) {
      testWidgets('native polish $section dark=$dark', (tester) async {
        final theme = djlTheme(dark ? Brightness.dark : Brightness.light);
        final pairs = PairingRepository(PairingWrites());
        final desktop = DesktopController(
          pairs,
          connection: ObservedPairingTransport(pairs),
          localStore: ActivityCacheStore(),
        );
        await tester.pumpWidget(
          RepaintBoundary(
            key: const Key('pairing_paint'),
            child: MaterialApp(
              theme: theme,
              home: PairingPage(controller: desktop),
            ),
          ),
        );
        if (section != 'secure fields') {
          await more(tester, 'Connections');
          if (section == 'Close') {
            final closeButton = find.widgetWithText(TextButton, 'Close');
            final capsule = tester.getRect(
              find.descendant(of: closeButton, matching: find.byType(Material)),
            );
            await expectDistinctPaint(
              tester,
              capsule,
              dark
                  ? theme.colorScheme.surfaceContainerHigh
                  : theme.colorScheme.surface,
              theme.colorScheme.surfaceContainerLow,
              capsule: true,
            );
            expect(
              tester
                  .renderObject<RenderParagraph>(find.text('Close'))
                  .text
                  .style!
                  .color,
              theme.colorScheme.onSurfaceVariant,
            );
          } else {
            final caption = tester.renderObject<RenderParagraph>(
              find.text('Devices'),
            );
            final action = tester.renderObject<RenderParagraph>(
              find.text('Scan QR Code').hitTestable(),
            );
            expect(
              caption.text.style!.fontSize,
              lessThan(action.text.style!.fontSize!),
            );
            expect(
              caption.text.style!.color,
              theme.colorScheme.onSurfaceVariant,
            );
            for (final label in ['Scan QR Code', 'Pair with Code']) {
              final row = find.widgetWithText(ListTile, label).hitTestable();
              final icon = find.descendant(
                of: row,
                matching: find.byType(Icon),
              );
              expect(
                IconTheme.of(tester.element(icon)).color,
                theme.colorScheme.onSurface,
              );
              expect(tester.widget<ListTile>(row).enabled, isTrue);
              expect(tester.widget<ListTile>(row).onTap, isNotNull);
            }
          }
          await close(tester, 'Close');
        } else {
          final semantics = tester.ensureSemantics();
          await tester.tap(find.text('Pair with Code'));
          await tester.pumpAndSettle();
          await tester.enterText(find.byKey(const Key('pairing_code')), '000');
          await close(tester, 'Relay settings');
          for (final key in ['pairing_payload', 'pairing_relay']) {
            final field = find.byKey(Key(key));
            final label = key == 'pairing_payload'
                ? 'Paste pairing code'
                : 'Desktop relay URL';
            await tester.ensureVisible(field);
            await tester.pumpAndSettle();
            await expectDistinctPaint(
              tester,
              tester.getRect(field),
              theme.colorScheme.surface,
              theme.colorScheme.surfaceContainerLow,
            );
            expectFieldLabelVisible(tester, label);
            expect(tester.getSemantics(field).label, contains(label));
            await tester.tap(field);
            await tester.enterText(
              field,
              key == 'pairing_payload'
                  ? 'unfinished payload'
                  : 'wss://custom.test/relay',
            );
            tester.view.viewInsets = const FakeViewPadding(bottom: 260);
            addTearDown(tester.view.resetViewInsets);
            await tester.pumpAndSettle();
            await tester.ensureVisible(field);
            await tester.pumpAndSettle();
            expect(field.hitTestable(), findsOneWidget);
            expect(
              tester.getBottomRight(field).dy,
              lessThanOrEqualTo(tester.view.physicalSize.height - 260),
            );
            await expectDistinctPaint(
              tester,
              tester.getRect(field),
              theme.colorScheme.surface,
              theme.colorScheme.surfaceContainerLow,
            );
            expectFieldLabelVisible(tester, label);
            expect(tester.getSemantics(field).label, contains(label));
            await tester.testTextInput.receiveAction(TextInputAction.done);
            tester.view.resetViewInsets();
            await tester.pumpAndSettle();
            if (key == 'pairing_relay') {
              expect(
                tester
                    .widget<EditableText>(
                      find.descendant(
                        of: field,
                        matching: find.byType(EditableText),
                      ),
                    )
                    .focusNode
                    .hasFocus,
                isFalse,
              );
            }
            await expectDistinctPaint(
              tester,
              tester.getRect(field),
              theme.colorScheme.surface,
              theme.colorScheme.surfaceContainerLow,
            );
          }
          await close(tester, 'Close');
          expect(find.text('Enter one-time code'), findsOneWidget);
          expect(
            tester
                .widget<TextField>(find.byKey(const Key('pairing_code')))
                .controller!
                .text,
            '000',
          );
          await close(tester, 'Cancel');
          await more(tester, 'Secure pairing details');
          expect(
            tester
                .widget<TextField>(find.byKey(const Key('pairing_payload')))
                .controller!
                .text,
            'unfinished payload',
          );
          expect(
            tester
                .widget<TextField>(find.byKey(const Key('pairing_relay')))
                .controller!
                .text,
            'wss://custom.test/relay',
          );
          await close(tester, 'Close');
          semantics.dispose();
        }
        await finish(tester, desktop);
      });
    }
  }

  testWidgets(
    'secure invalid payload removes only the Dart wrapper without changing controller errors or pairing work',
    (tester) async {
      var network = 0;
      final credentials = PairingWrites();
      final pairs = PairingRepository(
        credentials,
        client: MockClient((_) async {
          network++;
          return http.Response('{}', 500);
        }),
      );
      final transport = ObservedPairingTransport(pairs);
      final desktop = DesktopController(
        pairs,
        connection: transport,
        localStore: ActivityCacheStore(),
      );
      const message = 'This is not a DJL pairing QR or pasteable code.';
      await expectLater(
        desktop.pair('000'),
        throwsA(
          isA<FormatException>().having(
            (e) => e.toString(),
            'raw error',
            'FormatException: $message',
          ),
        ),
      );
      desktop.error = 'Existing controller error';
      final state = desktop.state;
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      await more(tester, 'Secure pairing details');
      await tester.enterText(find.byKey(const Key('pairing_payload')), '000');
      await tester.tap(find.text('Pair securely'));
      await tester.pumpAndSettle();
      expect(find.text(message), findsOneWidget);
      expect(find.text('FormatException: $message'), findsNothing);
      expect(desktop.error, 'Existing controller error');
      expect(desktop.state, state);
      expect(desktop.busy, isFalse);
      expect(desktop.active, isNull);
      expect(credentials.writes, 0);
      expect(network, 0);
      expect(transport.attempts, 0);
      expect(transport.rpc, isEmpty);
      await close(tester, 'Close');
      desktop.error =
          'StateError: FormatException: keep this unsupported error';
      await more(tester, 'Secure pairing details');
      expect(find.text(desktop.error!), findsOneWidget);
      await close(tester, 'Close');
      await finish(tester, desktop);
    },
  );
  testWidgets(
    'passive entries preserve controller, context and all drafts with zero writes or network',
    (tester) async {
      var network = 0;
      final credentials = PairingWrites();
      final pairs = PairingRepository(
        credentials,
        client: MockClient((_) async {
          network++;
          return http.Response('{}', 500);
        }),
      );
      final transport = ObservedPairingTransport(pairs);
      final desktop = DesktopController(
        pairs,
        connection: transport,
        localStore: ActivityCacheStore(),
      );
      var settings = 0, cloud = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: PairingPage(
            controller: desktop,
            onSettings: () => settings++,
            onCloud: () => cloud++,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Connect to DJL Desktop'), findsOneWidget);
      expect(find.byKey(const Key('pairing_payload')), findsNothing);
      await more(tester, 'Connections');
      expect(find.text('No paired devices yet.'), findsOneWidget);
      await close(tester, 'Close');
      await more(tester, 'Secure pairing details');
      await tester.enterText(
        find.byKey(const Key('pairing_payload')),
        'unfinished payload',
      );
      await tester.enterText(
        find.byKey(const Key('pairing_relay')),
        'wss://custom.test/relay',
      );
      await close(tester, 'Close');
      await tester.tap(find.text('Pair with Code'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('pairing_code')),
        'abcd-ef2345',
      );
      await close(tester, 'Cancel');
      await tester.tap(find.text('Pair with Code'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('pairing_code')))
            .controller!
            .text,
        'abcd-ef2345',
      );
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      await more(tester, 'Secure pairing details');
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('pairing_payload')))
            .controller!
            .text,
        'unfinished payload',
      );
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('pairing_relay')))
            .controller!
            .text,
        'wss://custom.test/relay',
      );
      await close(tester, 'Close');
      expect(
        tester.widget<PairingPage>(find.byType(PairingPage)).controller,
        same(desktop),
      );
      expect(desktop.active, isNull);
      expect(desktop.thread, isNull);
      expect(credentials.writes, 0);
      expect(network, 0);
      expect(transport.attempts, 0);
      expect(transport.rpc, isEmpty);
      expect(transport.disconnects, 0);
      await tester.tap(find.byTooltip('Settings'));
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cloud chat').hitTestable());
      await tester.pumpAndSettle();
      expect(find.byTooltip('SSH terminals'), findsNothing);
      expect([settings, cloud], [1, 1]);
      await finish(tester, desktop);
    },
  );

  testWidgets(
    'code validates alphabet and real relay, normalizes via repository, and Cancel during busy only dismisses',
    (tester) async {
      final semantics = tester.ensureSemantics();
      final response = Completer<http.Response>();
      final requests = <http.Request>[];
      final pairs = PairingRepository(
        PairingWrites(),
        client: MockClient((r) {
          requests.add(r);
          return response.future;
        }),
      );
      final transport = ObservedPairingTransport(pairs);
      final desktop = DesktopController(
        pairs,
        connection: transport,
        localStore: ActivityCacheStore(),
      );
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      await tester.tap(find.text('Pair with Code'));
      await tester.pumpAndSettle();
      final pair = find.widgetWithText(FilledButton, 'Pair');
      final codeField = find.byKey(const Key('pairing_code'));
      final editable = find.descendant(
        of: codeField,
        matching: find.byType(EditableText),
      );
      expect(tester.widget<EditableText>(editable).focusNode.hasFocus, isFalse);
      expect(tester.getSemantics(codeField).label, contains('Pairing code'));
      await tester.tap(codeField);
      await tester.pumpAndSettle();
      expect(tester.widget<EditableText>(editable).focusNode.hasFocus, isTrue);
      expect(tester.widget<FilledButton>(pair).onPressed, isNull);
      await tester.enterText(
        find.byKey(const Key('pairing_code')),
        'abcd-ef2345',
      );
      expect(tester.widget<FilledButton>(pair).onPressed, isNull);
      await close(tester, 'Relay settings');
      expect(find.byKey(const Key('pairing_code')), findsNothing);
      await tester.enterText(
        find.byKey(const Key('pairing_relay')),
        'https://custom.test/base',
      );
      await close(tester, 'Close');
      await tester.enterText(
        find.byKey(const Key('pairing_code')),
        'abcd-ef2340',
      );
      await tester.pump();
      expect(tester.widget<FilledButton>(pair).onPressed, isNull);
      await tester.enterText(
        find.byKey(const Key('pairing_code')),
        ' abcd-ef2345 ',
      );
      await tester.pump();
      expect(tester.widget<FilledButton>(pair).onPressed, isNotNull);
      await tester.tap(pair);
      await tester.pump();
      expect(desktop.busy, isTrue);
      expect(desktop.state, 'resolving');
      expect(requests, hasLength(1));
      expect(
        requests.single.url.toString(),
        'https://custom.test/base/v1/pairing/code/resolve',
      );
      expect(jsonDecode(requests.single.body), {'code': 'ABCDEF2345'});
      await tester.tap(find.text('Cancel'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Enter one-time code'), findsNothing);
      expect(desktop.busy, isTrue);
      expect(transport.attempts, 0);
      expect(
        tester
            .widget<OutlinedButton>(
              find.widgetWithText(OutlinedButton, 'Pair with Code'),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.byTooltip('More actions'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(
        tester
            .widget<PopupMenuItem<String>>(
              find.widgetWithText(
                PopupMenuItem<String>,
                'Secure pairing details',
              ),
            )
            .enabled,
        isFalse,
      );
      await tester.tap(find.text('Connections'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      for (final label in ['Scan QR Code', 'Pair with Code']) {
        final row = tester.widget<ListTile>(
          find.widgetWithText(ListTile, label).hitTestable(),
        );
        expect(row.onTap, isNull);
        expect(row.enabled, isFalse);
        final tile = find.widgetWithText(ListTile, label).hitTestable();
        final icon = find.descendant(of: tile, matching: find.byType(Icon));
        expect(
          IconTheme.of(tester.element(icon)).color,
          Theme.of(tester.element(icon)).disabledColor,
        );
        expect(
          tester.getSemantics(tile).flagsCollection.isEnabled,
          ui.Tristate.isFalse,
        );
      }
      expect(transport.rpc, isEmpty);
      expect(transport.disconnects, 0);
      await tester.tap(find.text('Close'));
      await tester.pump(const Duration(milliseconds: 300));
      response.complete(
        http.Response('{"ok":false,"error":"Fixture code rejected"}', 403),
      );
      await tester.pumpAndSettle();
      expect(desktop.busy, isFalse);
      expect(find.textContaining('Fixture code rejected'), findsOneWidget);
      await tester.ensureVisible(find.text('Pair with Code'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Pair with Code'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Fixture code rejected'), findsNothing);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('pairing_code')))
            .controller!
            .text,
        ' abcd-ef2345 ',
      );
      await close(tester, 'Cancel');
      semantics.dispose();
      await finish(tester, desktop);
    },
  );

  testWidgets(
    'successful code pairing returns to its real root and completion during Cancel cannot pop the parent route',
    (tester) async {
      for (final cancel in [false, true]) {
        final response = Completer<http.Response>();
        final pairs = PairingRepository(
          PairingWrites(),
          client: MockClient((_) => response.future),
        );
        final transport = ObservedPairingTransport(pairs)..attempts = 2;
        final desktop = DesktopController(
          pairs,
          connection: transport,
          localStore: ActivityCacheStore(),
        );
        await tester.pumpWidget(
          MaterialApp(
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute<void>(
                      builder: (_) => PairingPage(controller: desktop),
                    ),
                  ),
                  child: const Text('Open My Macs'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Open My Macs'));
        await tester.pumpAndSettle();
        await more(tester, 'Secure pairing details');
        await tester.enterText(
          find.byKey(const Key('pairing_relay')),
          'wss://relay.test/relay',
        );
        await close(tester, 'Close');
        await tester.tap(find.text('Pair with Code'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('pairing_code')),
          'abcd-ef2345',
        );
        await tester.pump();
        await tester.tap(find.widgetWithText(FilledButton, 'Pair'));
        await tester.pump();
        if (cancel) await tester.tap(find.text('Cancel'));
        response.complete(
          http.Response(jsonEncode({'ok': true, ...savedPair().data}), 200),
        );
        await tester.pumpAndSettle();
        expect(desktop.runtimeReady, isTrue);
        expect(find.byType(PairingPage), findsOneWidget);
        expect(find.text('Enter one-time code'), findsNothing);
        expect(find.bySemanticsLabel('New chat').hitTestable(), findsOneWidget);
        await finish(tester, desktop);
      }
    },
  );

  testWidgets(
    'secure payload completion during Close retains the parent route and code/payload/relay drafts',
    (tester) async {
      final pairs = PairingRepository(PairingWrites());
      final transport = ObservedPairingTransport(pairs)
        ..attempts = 2
        ..gateConnect = true;
      final desktop = DesktopController(
        pairs,
        connection: transport,
        localStore: ActivityCacheStore(),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute<void>(
                    builder: (_) => PairingPage(controller: desktop),
                  ),
                ),
                child: const Text('Open My Macs'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open My Macs'));
      await tester.pumpAndSettle();
      await more(tester, 'Secure pairing details');
      await tester.enterText(
        find.byKey(const Key('pairing_payload')),
        jsonEncode(savedPair().data),
      );
      await tester.tap(find.text('Pair securely'));
      await tester.pump();
      expect(desktop.busy, isTrue);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('pairing_payload')))
            .enabled,
        isFalse,
      );
      await tester.tap(find.text('Close'));
      transport.connectGate.complete();
      await tester.pumpAndSettle();
      expect(desktop.runtimeReady, isTrue);
      expect(find.byType(PairingPage), findsOneWidget);
      expect(find.bySemanticsLabel('New chat').hitTestable(), findsOneWidget);
      await finish(tester, desktop);
    },
  );

  testWidgets(
    'Connections confirms forget, Cancel writes nothing, and failed secure store retains saved row',
    (tester) async {
      final credentials = PairingWrites();
      final pairs = PairingRepository(credentials);
      final saved = Pairing({
        ...savedPair().data,
        'displayName': 'My Studio Mac',
      });
      await pairs.trust(saved);
      final transport = ObservedPairingTransport(pairs);
      final desktop = DesktopController(
        pairs,
        connection: transport,
        localStore: ActivityCacheStore(),
      );
      await desktop.restore();
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      final writes = credentials.writes;
      await more(tester, 'Connections');
      await tester.drag(
        find.byKey(ValueKey('device_row_${saved.macDeviceId}')),
        const Offset(-220, 0),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Forget desktop'));
      await tester.pumpAndSettle();
      expect(find.text('Forget this device?'), findsOneWidget);
      await close(tester, 'Cancel');
      expect(credentials.writes, writes);
      expect(desktop.trusted.single, same(desktop.active));
      credentials.failWrites = true;
      await tester.drag(
        find.byKey(ValueKey('device_row_${saved.macDeviceId}')),
        const Offset(-220, 0),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Forget desktop'));
      await tester.pumpAndSettle();
      await close(tester, 'Forget');
      expect(find.textContaining('Secure store unavailable'), findsOneWidget);
      expect(desktop.trusted.single.macDeviceId, saved.macDeviceId);
      expect(find.text('My Studio Mac').hitTestable(), findsOneWidget);
      await close(tester, 'Close');
      await finish(tester, desktop);
    },
  );

  for (final connected in [false, true]) {
    testWidgets(
      'exact Mac plus pin current identity and menu-only saved rows when connected=$connected',
      (tester) async {
        final semantics = tester.ensureSemantics();
        final pairs = PairingRepository(PairingWrites());
        final transport = ObservedPairingTransport(pairs)..online = connected;
        final desktop = DesktopController(
          pairs,
          connection: transport,
          localStore: ActivityCacheStore(),
        );
        final current = Pairing({
          ...savedPair().data,
          'displayName': 'Shared name',
        });
        final wrongPin = Pairing({
          ...current.data,
          'macIdentityPublicKey': base64Encode(List.filled(32, 2)),
        });
        desktop.active = current;
        desktop.trusted = [current, wrongPin];
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: desktop)),
        );
        await more(tester, 'Connections');
        expect(find.text('Active'), findsOneWidget);
        expect(
          find.byKey(const Key('connected_device_dot')),
          connected ? findsOneWidget : findsNothing,
        );
        final rows = tester.widgetList<ListTile>(
          find.widgetWithText(ListTile, 'Shared name'),
        );
        expect(rows, hasLength(2));
        expect(rows.where((row) => row.selected), hasLength(1));
        expect(rows.every((r) => r.onTap == null), isTrue);
        for (final title in ['Scan QR Code', 'Pair with Code']) {
          final action = find.descendant(
            of: find.byType(BottomSheet),
            matching: find.text(title),
          );
          await tester.scrollUntilVisible(
            action,
            220,
            scrollable: find
                .descendant(
                  of: find.byType(BottomSheet),
                  matching: find.byType(Scrollable),
                )
                .first,
          );
          await tester.ensureVisible(action);
          await tester.pumpAndSettle();
          final row = tester.widget<ListTile>(
            find.widgetWithText(ListTile, title),
          );
          expect(row.onTap, isNotNull);
          expect(row.enabled, isTrue);
          final tile = find.widgetWithText(ListTile, title).hitTestable();
          final icon = find.descendant(of: tile, matching: find.byType(Icon));
          final theme = Theme.of(tester.element(icon));
          expect(
            IconTheme.of(tester.element(icon)).color,
            theme.colorScheme.onSurface,
          );
          expect(
            tester.getSemantics(tile).flagsCollection.isEnabled,
            ui.Tristate.isTrue,
          );
        }
        expect(transport.attempts, 0);
        await close(tester, 'Close');
        semantics.dispose();
        await finish(tester, desktop);
      },
    );
  }

  for (final link in ['matching', 'unavailable', 'unqualified']) {
    testWidgets('same-name saved Macs identify the $link link choice', (
      tester,
    ) async {
      final pairs = VerifiedPairings(PairingWrites());
      final desktop = DesktopController(
        pairs,
        connection: ObservedPairingTransport(pairs),
        localStore: ActivityCacheStore(),
      );
      final right = Pairing({...savedPair().data, 'displayName': 'Device'});
      desktop.trusted = [
        right,
        Pairing({...right.data, 'macDeviceId': 'other'}),
        Pairing({
          ...right.data,
          'macIdentityPublicKey': base64Encode(List.filled(32, 9)),
        }),
      ];
      desktop.active = desktop.trusted[1];
      desktop.queueNavigation(
        DesktopLinkTarget(
          'linked',
          macId: link == 'unqualified'
              ? null
              : link == 'matching'
              ? right.macDeviceId
              : 'unavailable',
          macKeySha256: link == 'unqualified'
              ? null
              : DesktopLinkTarget.keyFingerprint(right.publicKey),
        ),
        forceHostChoice: true,
      );
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      expect(find.widgetWithText(ListTile, 'Device'), findsNWidgets(3));
      expect(
        find.text('Matches this link’s verified identity'),
        link == 'matching' ? findsOneWidget : findsNothing,
      );
      expect(
        find.text('Different desktop identity'),
        findsNWidgets(
          link == 'unqualified'
              ? 0
              : link == 'matching'
              ? 2
              : 3,
        ),
      );
      expect(
        find.text('Saved, verified desktop identity'),
        findsNWidgets(link == 'unqualified' ? 3 : 0),
      );
      await finish(tester, desktop);
    });
  }

  testWidgets(
    'qualified link keeps real inline host choice and rejects wrong Mac or pin before selecting verified host',
    (tester) async {
      final pairs = VerifiedPairings(PairingWrites());
      final transport = ObservedPairingTransport(pairs)..attempts = 2;
      final desktop = DesktopController(
        pairs,
        connection: transport,
        localStore: ActivityCacheStore(),
      );
      final right = Pairing({...savedPair().data, 'displayName': 'Right Mac'});
      final wrongMac = Pairing({
        ...right.data,
        'macDeviceId': 'other',
        'displayName': 'Other Mac',
      });
      final wrongPin = Pairing({
        ...right.data,
        'macIdentityPublicKey': base64Encode(List.filled(32, 9)),
        'displayName': 'Changed pin',
      });
      desktop.active = wrongMac;
      desktop.trusted = [right, wrongMac, wrongPin];
      final target = DesktopLinkTarget(
        'linked',
        macId: right.macDeviceId,
        macKeySha256: DesktopLinkTarget.keyFingerprint(right.publicKey),
      );
      desktop.queueNavigation(target);
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      for (final label in ['Other Mac', 'Changed pin']) {
        await tester.tap(find.widgetWithText(ListTile, label));
        await tester.pumpAndSettle();
        expect(desktop.navigationNeedsHost, isTrue);
        expect(desktop.active, same(wrongMac));
        expect(transport.attempts, 2);
        expect(
          find.textContaining('Its verified identity must match'),
          findsOneWidget,
        );
      }
      await tester.tap(find.widgetWithText(ListTile, 'Right Mac'));
      await tester.pumpAndSettle();
      expect(desktop.navigationNeedsHost, isFalse);
      expect(desktop.active?.publicKey, right.publicKey);
      expect(transport.attempts, 3);
      expect(desktop.navigationTarget, target);
      await close(tester, 'Cancel desktop link');
      expect(desktop.navigationTarget, isNull);
      await finish(tester, desktop);
    },
  );

  testWidgets(
    'saved Macs without active selection are offered Connections and passive sheets preserve cached history and composer draft',
    (tester) async {
      final pairs = PairingRepository(PairingWrites());
      final transport = ObservedPairingTransport(pairs);
      final desktop = DesktopController(
        pairs,
        connection: transport,
        localStore: ActivityCacheStore(),
      );
      final saved = savedPair();
      desktop.trusted = [saved];
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      expect(find.text('Choose a saved Mac'), findsOneWidget);
      expect(find.text('Connect to DJL Desktop'), findsNothing);
      await tester.tap(find.text('Connections'));
      await tester.pumpAndSettle();
      await close(tester, 'Close');
      desktop.active = saved;
      await desktop.threadList.attach(saved.macDeviceId);
      desktop.threadList.data.upsert({
        'id': 'cached',
        'name': 'Cached conversation',
        'cwd': '/repo',
      });
      desktop.thread = {'id': 'cached', 'cwd': '/repo'};
      desktop.timeline = [
        {'id': 'saved-message', 'text': 'Private cached reply'},
      ];
      desktop.threadList.data.setComposerDraft(
        'cached',
        DesktopComposerDraft(text: 'Keep this draft'),
      );
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Projects'));
      await tester.pumpAndSettle();
      expect(find.text('Cached conversation'), findsOneWidget);
      final history = desktop.threadList.data;
      final selectedThread = desktop.thread, timeline = desktop.timeline;
      await more(tester, 'Connections');
      await close(tester, 'Close');
      expect(desktop.threadList.data, same(history));
      expect(history.composerDraft('cached').text, 'Keep this draft');
      expect(desktop.thread, same(selectedThread));
      expect(desktop.timeline, same(timeline));
      expect(transport.rpc, isEmpty);
      expect(find.text('Cached conversation'), findsOneWidget);
      expect(transport.attempts, 0);
      await finish(tester, desktop);
    },
  );

  for (final unavailable in [false, true]) {
    testWidgets(
      'QR scanner is explicit, camera unavailable=$unavailable fallback is readable, and Back never pairs',
      (tester) async {
        var cameraCalls = 0;
        const methods = MethodChannel(
          'dev.steenbakker.mobile_scanner/scanner/method',
        );
        final messenger =
            TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
        messenger.setMockMethodCallHandler(methods, (call) async {
          cameraCalls++;
          if (call.method == 'state') return unavailable ? 1 : 0;
          if (call.method == 'request') return unavailable;
          if (call.method == 'start' && unavailable) {
            throw PlatformException(code: 'MOBILE_SCANNER_NO_CAMERA_ERROR');
          }
          return null;
        });
        for (final channel in ['event', 'deviceOrientation']) {
          messenger.setMockMethodCallHandler(
            MethodChannel('dev.steenbakker.mobile_scanner/scanner/$channel'),
            (_) async => null,
          );
        }
        addTearDown(() {
          messenger.setMockMethodCallHandler(methods, null);
          for (final channel in ['event', 'deviceOrientation']) {
            messenger.setMockMethodCallHandler(
              MethodChannel('dev.steenbakker.mobile_scanner/scanner/$channel'),
              null,
            );
          }
        });
        final pairs = PairingRepository(PairingWrites());
        final transport = ObservedPairingTransport(pairs);
        final desktop = DesktopController(
          pairs,
          connection: transport,
          localStore: ActivityCacheStore(),
        );
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: desktop)),
        );
        await more(tester, 'Connections');
        expect(cameraCalls, 0);
        await tester.tap(find.text('Scan QR Code').hitTestable());
        await tester.pumpAndSettle();
        expect(
          find.text(
            '${unavailable ? 'QR scanning is not available on this device.' : 'Camera access is denied.'} You can paste the pairing code instead.',
          ),
          findsOneWidget,
        );
        await tester.pageBack();
        await tester.pumpAndSettle();
        expect(transport.attempts, 0);
        await tester.tap(find.text('Scan QR Code'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Paste pairing code'));
        await tester.pumpAndSettle();
        expect(
          find.byKey(const Key('pairing_payload')).hitTestable(),
          findsOneWidget,
        );
        expect(transport.attempts, 0);
        expect(tester.takeException(), isNull);
        await close(tester, 'Close');
        await finish(tester, desktop);
      },
    );
  }

  for (final scale in [1.0, 2.2]) {
    for (final font in [
      AppFontStyle.geist,
      AppFontStyle.geistMono,
      AppFontStyle.jetBrainsMono,
    ]) {
      for (final dark in [false, true]) {
        testWidgets(
          'short viewport text $scale font=$font dark=$dark has full nonoverlapping labels, keyboard-safe prompt and scrolling secure details',
          (tester) async {
            tester.view.reset();
            tester.view.physicalSize = const Size(360, 640);
            tester.view.devicePixelRatio = 1;
            addTearDown(tester.view.resetPhysicalSize);
            addTearDown(tester.view.resetDevicePixelRatio);
            for (final family in ['Geist', 'GeistMono', 'JetBrainsMono']) {
              final loader = FontLoader(family)
                ..addFont(rootBundle.load('assets/fonts/$family-Regular.ttf'));
              await loader.load();
            }
            final pairs = PairingRepository(PairingWrites());
            final transport = ObservedPairingTransport(pairs);
            final desktop = DesktopController(
              pairs,
              connection: transport,
              localStore: ActivityCacheStore(),
            );
            await tester.pumpWidget(
              MaterialApp(
                theme: djlTheme(
                  dark ? Brightness.dark : Brightness.light,
                  font: font,
                ),
                builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(context).copyWith(
                    textScaler: TextScaler.linear(scale),
                    disableAnimations: true,
                  ),
                  child: child!,
                ),
                home: PairingPage(
                  controller: desktop,
                  onSettings: () {},
                  onCloud: () {},
                ),
              ),
            );
            await tester.pumpAndSettle();
            final setupDetail = tester.renderObject<RenderParagraph>(
              find.text(
                'Open DJL on your Mac or Windows PC, then go to Settings → Remote.',
              ),
            );
            expect(setupDetail.didExceedMaxLines, isFalse);
            for (final label in ['Scan QR Code', 'Pair with Code']) {
              await tester.ensureVisible(find.text(label));
              await tester.pumpAndSettle();
              final text = tester.renderObject<RenderParagraph>(
                find.text(label),
              );
              expect(text.didExceedMaxLines, isFalse);
              final button = find
                  .ancestor(
                    of: find.text(label),
                    matching: find.byWidgetPredicate(
                      (w) => w is ButtonStyleButton,
                    ),
                  )
                  .first;
              final rect = tester.getRect(button);
              expect(
                rect.contains(tester.getTopLeft(find.text(label))),
                isTrue,
              );
              expect(
                rect.contains(tester.getBottomRight(find.text(label))),
                isTrue,
              );
            }
            final settings = tester.getRect(find.byTooltip('Settings'));
            final moreRect = tester.getRect(find.byTooltip('More actions'));
            expect(settings.overlaps(moreRect), isFalse);
            await more(tester, 'Connections');
            expectHeaderContained(tester, 'Connections');
            await close(tester, 'Close');
            await tester.ensureVisible(find.text('Pair with Code'));
            await tester.tap(find.text('Pair with Code'));
            await tester.pumpAndSettle();
            tester.view.viewInsets = const FakeViewPadding(bottom: 260);
            addTearDown(tester.view.resetViewInsets);
            await tester.pumpAndSettle();
            await tester.ensureVisible(find.text('Cancel'));
            await tester.pumpAndSettle();
            expect(
              tester.getBottomLeft(find.text('Cancel')).dy,
              lessThanOrEqualTo(380),
            );
            await close(tester, 'Cancel');
            tester.view.resetViewInsets();
            await more(tester, 'Secure pairing details');
            expectHeaderContained(tester, 'Secure pairing details');
            tester.view.viewInsets = const FakeViewPadding(bottom: 260);
            await tester.pumpAndSettle();
            for (final key in ['pairing_payload', 'pairing_relay']) {
              await tester.scrollUntilVisible(
                find.byKey(Key(key)),
                180,
                scrollable: find
                    .descendant(
                      of: find.byType(ListView).last,
                      matching: find.byType(Scrollable),
                    )
                    .first,
              );
              await tester.pumpAndSettle();
              expectFieldLabelVisible(
                tester,
                key == 'pairing_payload'
                    ? 'Paste pairing code'
                    : 'Desktop relay URL',
              );
            }
            expect(
              find.byKey(const Key('pairing_relay')).hitTestable(),
              findsOneWidget,
            );
            final relay = find.byKey(const Key('pairing_relay'));
            await tester.tap(relay);
            await tester.enterText(relay, 'wss://last-field.test/relay');
            await tester.testTextInput.receiveAction(TextInputAction.done);
            await tester.pumpAndSettle();
            expect(
              tester
                  .widget<EditableText>(
                    find.descendant(
                      of: relay,
                      matching: find.byType(EditableText),
                    ),
                  )
                  .focusNode
                  .hasFocus,
              isFalse,
            );
            expect(
              tester
                  .renderObject<RenderParagraph>(find.text('Desktop relay URL'))
                  .didExceedMaxLines,
              isFalse,
            );
            expect(tester.takeException(), isNull);
            tester.view.resetViewInsets();
            await tester.pumpAndSettle();
            await close(tester, 'Close');
            await finish(tester, desktop);
          },
        );
      }
    }
  }
}
