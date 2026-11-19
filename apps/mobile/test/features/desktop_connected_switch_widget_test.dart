import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart'
    show CupertinoActivityIndicator, CupertinoButton;
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/core/design/djl_tokens.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_connected_switch_test.dart';
import '../core/trusted_device_preferences_test.dart'
    show ActiveWriteCredentials;

Future<void> openConnectionSwitcher(WidgetTester tester) async {
  final menu = find.byKey(const Key('device_menu'));
  await tester.scrollUntilVisible(
    menu,
    -160,
    scrollable: find
        .descendant(
          of: find.byType(BottomSheet),
          matching: find.byType(Scrollable),
        )
        .first,
  );
  await tester.ensureVisible(menu);
  await tester.pumpAndSettle();
  await tester.tap(menu);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'active-run switch review matches source width and cancels without touching the host',
    (tester) async {
      tester.view.physicalSize = const Size(402, 874);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final f = await switchFixture();
      try {
        f.transport.events.add({
          'method': 'turn/started',
          'params': {
            'threadId': 'live',
            'turn': {'id': 'live-turn'},
          },
        });
        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(platform: TargetPlatform.iOS),
            home: PairingPage(controller: f.desktop),
          ),
        );
        await tester.tap(find.byTooltip('More actions'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Connections'));
        await tester.pumpAndSettle();
        Future<void> open() async {
          await openConnectionSwitcher(tester);
          await tester.tap(find.byKey(const ValueKey('device_choice_B')));
          await tester.pumpAndSettle();
        }

        final before = Map<String, String>.of(f.credentials.values);
        await open();
        expect(
          tester.getSize(find.byKey(const Key('saved_switch_review'))).width,
          240,
        );
        final title = tester.widget<Text>(find.text('Switch device?'));
        expect(title.style!.fontSize, 17);
        expect(title.style!.fontWeight, FontWeight.w600);
        expect(find.text('Cancel'), findsNothing);
        final action = find.widgetWithText(TextButton, 'Switch');
        expect(tester.getSize(action).width, 208);
        expect(tester.getSize(action).height, 48);
        expect(
          tester
              .widget<TextButton>(action)
              .style!
              .foregroundColor!
              .resolve({})!
              .toARGB32(),
          DjlColors.light.danger.toARGB32(),
        );
        await tester.tapAt(const Offset(390, 800));
        await tester.pumpAndSettle();
        expect(find.text('Switch device?'), findsNothing);
        await open();
        await tester.sendKeyEvent(LogicalKeyboardKey.escape);
        await tester.pumpAndSettle();
        expect(find.text('Switch device?'), findsNothing);
        expect(f.credentials.values, before);
        expect(f.transport.disconnects, 0);
        expect(f.pairs.resolutions, isEmpty);
        expect(f.desktop.active!.macDeviceId, 'A');
        expect(f.desktop.switchNeedsConfirmation, isTrue);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        f.desktop.dispose();
        await tester.pump();
      }
    },
  );
  testWidgets(
    'manual code entry takes over an offline reconnect before awaiting its route',
    (tester) async {
      final f = await switchFixture();
      await f.desktop.disconnect();
      f.pairs.resolveGate = Completer<Pairing>();
      final reconnect = f.desktop.reconnect();
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: f.desktop)),
      );
      await tester.pump();
      await tester.tap(find.byTooltip('More actions'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.tap(find.text('Connections'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      final code = find.widgetWithText(ListTile, 'Pair with Code');
      await tester.ensureVisible(code);
      await tester.pump();
      expect(code, findsOneWidget);
      final enabled = tester.widget<ListTile>(code).onTap != null;
      if (enabled) {
        await tester.tap(code);
        await tester.pump();
      }
      f.pairs.resolveGate!.complete(switchPair('A'));
      await reconnect;
      await tester.pump();
      expect(
        enabled,
        isTrue,
        reason: 'Manual pairing must be reachable during offline recovery',
      );
      expect(find.text('Enter one-time code'), findsOneWidget);
      expect(f.desktop.connected, isFalse);
      await tester.pumpWidget(const SizedBox.shrink());
      f.desktop.dispose();
      await tester.pump();
    },
  );

  testWidgets('ordinary busy feedback remains visible without a saved switch', (
    tester,
  ) async {
    final f = await switchFixture();
    try {
      f.desktop.busy = true;
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: f.desktop)),
      );
      await tester.pump();
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      expect(find.byType(CupertinoActivityIndicator), findsNothing);
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      f.desktop.dispose();
      await tester.pump();
    }
  });

  testWidgets(
    'connected Connections really offers another saved Mac and cancellable switching',
    (tester) async {
      final credentials = ActiveWriteCredentials();
      final f = await switchFixture(storage: credentials);
      f.pairs.resolveGate = Completer<Pairing>();
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: f.desktop)),
      );
      await tester.tap(find.byTooltip('More actions'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.tap(find.text('Connections'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.text('Active'), findsOneWidget);
      await openConnectionSwitcher(tester);
      final target = find.byKey(const ValueKey('device_choice_B'));
      expect(target, findsOneWidget);
      expect(tester.widget<PopupMenuItem<Pairing>>(target).enabled, isTrue);
      await tester.tap(target);
      await tester.pump();
      expect(find.text('Switching device…'), findsOneWidget);
      expect(find.byType(CupertinoActivityIndicator), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(
        tester
            .widget<CupertinoActivityIndicator>(
              find.byType(CupertinoActivityIndicator),
            )
            .radius,
        10,
      );
      final heading = tester.widget<Text>(find.text('Switching device…'));
      expect(heading.style!.fontSize, 14);
      expect(heading.style!.fontWeight, FontWeight.w600);
      expect(
        tester
            .widget<CupertinoActivityIndicator>(
              find.byType(CupertinoActivityIndicator),
            )
            .animating,
        isTrue,
      );
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(
        tester.platformDispatcher.clearAccessibilityFeaturesTestValue,
      );
      await tester.pump();
      expect(
        tester
            .widget<CupertinoActivityIndicator>(
              find.byType(CupertinoActivityIndicator),
            )
            .animating,
        isFalse,
      );
      final cancel = find.widgetWithText(CupertinoButton, 'Cancel');
      expect(tester.getSize(cancel).height, greaterThanOrEqualTo(44));
      expect(
        find.widgetWithText(CupertinoButton, 'Cancel').hitTestable(),
        findsOneWidget,
      );
      credentials.activeGate = Completer<void>();
      addTearDown(() {
        if (!credentials.activeGate!.isCompleted) {
          credentials.activeGate!.complete();
        }
      });
      await tester.tap(find.widgetWithText(CupertinoButton, 'Cancel'));
      await tester.pump();
      expect(find.text('Cancelling switch…'), findsOneWidget);
      expect(tester.widget<CupertinoButton>(cancel).onPressed, isNull);
      expect(f.transport.disconnects, 1);
      await tester.tap(cancel);
      await tester.pump();
      expect(f.transport.disconnects, 1);
      f.pairs.resolveGate!.complete(switchPair('B'));
      credentials.activeGate!.complete();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(f.desktop.active, isNull);
      expect(f.transport.connected, isFalse);
      expect(
        find.text('Switch cancelled. Choose a device to reconnect.'),
        findsOneWidget,
      );
      final previous = find.descendant(
        of: find.byKey(const ValueKey('device_row_A')),
        matching: find.textContaining(RegExp(r'^Previous(?: · |$)')),
      );
      await tester.scrollUntilVisible(
        previous,
        100,
        scrollable: find
            .descendant(
              of: find.byType(BottomSheet),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      expect(previous.hitTestable(), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      f.desktop.dispose();
      await tester.pump();
    },
  );
  for (final brightness in Brightness.values) {
    for (final scale in [1.0, 2.2]) {
      testWidgets(
        'real consent cancel and switch overlay $brightness/$scale with short keyboard viewport',
        (tester) async {
          tester.view.physicalSize = const Size(390, 844);
          tester.view.devicePixelRatio = 1;
          tester.view.viewInsets = const FakeViewPadding(bottom: 200);
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          addTearDown(tester.view.resetViewInsets);
          final f = await switchFixture();
          final targetEntry = f.desktop.devicePreferences(switchPair('B'))!;
          await f.desktop.setDeviceNickname(targetEntry, 'Studio B');
          await f.desktop.setDeviceMenuVisibility(targetEntry, false);
          f.transport.events.add({
            'method': 'turn/started',
            'params': {
              'threadId': 'live',
              'turn': {'id': 'live-turn'},
            },
          });
          await tester.pumpWidget(
            MaterialApp(
              theme: ThemeData(brightness: brightness),
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(textScaler: TextScaler.linear(scale)),
                child: child!,
              ),
              home: PairingPage(controller: f.desktop),
            ),
          );
          await tester.tap(find.byTooltip('More actions'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Connections'));
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 350));
          expect(find.byKey(const Key('device_menu')), findsNothing);
          final visibility = find.byKey(const ValueKey('device_visibility_B'));
          await tester.ensureVisible(visibility);
          await tester.pump();
          await tester.tap(visibility);
          await tester.pumpAndSettle();
          expect(
            f.desktop.devicePreferences(switchPair('B'))!.visibleInMenu,
            isTrue,
          );
          expect(f.desktop.menuDevices, hasLength(2));
          await openConnectionSwitcher(tester);
          final choice = find.byKey(const ValueKey('device_choice_B'));
          expect(choice.hitTestable(), findsOneWidget);
          await tester.tap(choice);
          await tester.pumpAndSettle();
          expect(find.text('Switch device?'), findsOneWidget);
          final review = find.byKey(const Key('saved_switch_review'));
          final switchAction = find.widgetWithText(TextButton, 'Switch');
          expect(tester.getSize(review).width, 240);
          expect(
            tester.getBottomRight(switchAction).dy,
            lessThanOrEqualTo(644),
          );
          expect(switchAction.hitTestable(), findsOneWidget);
          expect(find.textContaining('will try to stop'), findsOneWidget);
          final before = Map<String, String>.of(f.credentials.values);
          await tester.binding.handlePopRoute();
          await tester.pumpAndSettle();
          expect(f.credentials.values, before);
          expect(f.transport.disconnects, 0);
          expect(f.pairs.resolutions, isEmpty);
          await openConnectionSwitcher(tester);
          await tester.tap(choice);
          await tester.pumpAndSettle();
          f.pairs.resolveGate = Completer<Pairing>();
          await tester.tap(
            find.widgetWithText(TextButton, 'Switch').hitTestable(),
          );
          await tester.pump();
          expect(find.text('Switching device…').hitTestable(), findsOneWidget);
          expect(
            find.widgetWithText(CupertinoButton, 'Cancel').hitTestable(),
            findsOneWidget,
          );
          expect(
            find.widgetWithText(TextButton, 'Close').hitTestable(),
            findsOneWidget,
          );
          await tester.tap(find.widgetWithText(CupertinoButton, 'Cancel'));
          await tester.pump();
          f.pairs.resolveGate!.complete(switchPair('B'));
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 350));
          expect(f.desktop.active, isNull);
          expect(f.desktop.previousDevice?.macDeviceId, 'A');
          expect(f.desktop.automaticConnectionAllowed, isFalse);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox.shrink());
          f.desktop.dispose();
          await tester.pump();
        },
      );
    }
  }

  testWidgets(
    'Connections Close dismisses navigation while the real switch continues',
    (tester) async {
      final f = await switchFixture();
      f.pairs.resolveGate = Completer<Pairing>();
      final pending = f.desktop.selectSaved(switchPair('B'));
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: f.desktop)),
      );
      await tester.tap(find.byTooltip('More actions'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.tap(find.text('Connections'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.text('Switching device…'), findsOneWidget);
      await tester.tap(find.widgetWithText(TextButton, 'Close'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.byType(BottomSheet), findsNothing);
      expect(f.desktop.switchingDevice, isNotNull);
      f.pairs.resolveGate!.complete(switchPair('B'));
      await pending;
      await tester.pump();
      expect(f.desktop.active?.macDeviceId, 'B');
      expect(f.desktop.connected, isTrue);
      await tester.pumpWidget(const SizedBox.shrink());
      f.desktop.dispose();
      await tester.pump();
    },
  );
}
