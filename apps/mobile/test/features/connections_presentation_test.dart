import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter/rendering.dart' show RenderParagraph;
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import '../core/trusted_device_preferences_test.dart' show preferencePair;
import 'trusted_device_preferences_widget_test.dart' show fixture;
import 'pairing_presentation_test.dart' show more, ObservedPairingTransport;
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets(
    'Connections keeps current and previous first and shows truthful recorded recency',
    (tester) async {
      final f = await fixture();
      try {
        final now = DateTime.now();
        Map<String, dynamic> row(String id, Duration age) => {
          'djlTrustedEntry': 1,
          'trustId': 'observed-$id',
          'pairing': preferencePair(mac: id).data,
          'preferences': {'nickname': '', 'visibleInMenu': true},
          'activity': {'lastUsedAt': now.subtract(age).millisecondsSinceEpoch},
        };
        f.store.values['desktop.trusted'] = jsonEncode([
          preferencePair(mac: 'unknown').data,
          row('older', const Duration(days: 2)),
          row('recent', const Duration(hours: 2)),
          row('previous', const Duration(days: 3)),
          row('mac', const Duration(days: 1)),
        ]);
        await f.desktop.restore();
        f.desktop.previousDevice = preferencePair(mac: 'previous');
        final writes = f.store.writes;
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: f.desktop)),
        );
        await more(tester, 'Connections');
        expect(
          find.descendant(
            of: find.byKey(const ValueKey('device_row_mac')),
            matching: find.text('Selected · 1d ago'),
          ),
          findsOneWidget,
        );
        expect(find.text('Previous · 3d ago'), findsOneWidget);
        expect(find.text('Saved · 2h ago'), findsOneWidget);
        final unknown = find.byKey(const ValueKey('device_row_unknown'));
        expect(
          find.descendant(of: unknown, matching: find.text('Saved')),
          findsOneWidget,
        );
        final ids = ['mac', 'previous', 'recent', 'older', 'unknown'];
        for (var i = 1; i < ids.length; i++) {
          expect(
            tester
                .getTopLeft(find.byKey(ValueKey('device_row_${ids[i - 1]}')))
                .dy,
            lessThan(
              tester
                  .getTopLeft(find.byKey(ValueKey('device_row_${ids[i]}')))
                  .dy,
            ),
          );
        }
        await tester.tap(find.byKey(const Key('device_menu')));
        await tester.pumpAndSettle();
        final menu = find.byKey(const ValueKey('device_choice_recent'));
        expect(
          find.descendant(of: menu, matching: find.text('Saved · 2h ago')),
          findsOneWidget,
        );
        final current = find.byKey(const ValueKey('device_choice_mac'));
        expect(tester.widget<PopupMenuItem<Pairing>>(current).enabled, isFalse);
        expect(f.store.writes, writes);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    },
  );
  for (final connected in [false, true]) {
    testWidgets('active switcher retains recency when connected=$connected', (
      tester,
    ) async {
      final f = await fixture();
      try {
        f.store.values['desktop.trusted'] = jsonEncode([
          for (final pair in f.desktop.trusted)
            {
              'djlTrustedEntry': 1,
              'trustId': 'active-status-${pair.macDeviceId}',
              'pairing': pair.data,
              'preferences': {'nickname': '', 'visibleInMenu': true},
              'activity': {
                'lastUsedAt': DateTime.now()
                    .subtract(const Duration(hours: 2))
                    .millisecondsSinceEpoch,
              },
            },
        ]);
        await f.desktop.restore();
        (f.desktop.transport as ObservedPairingTransport).online = connected;
        final writes = f.store.writes;
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: f.desktop)),
        );
        await more(tester, 'Connections');
        final row = find.byKey(const Key('device_menu'));
        expect(
          find.descendant(
            of: row,
            matching: find.text(
              '${connected ? 'Connected' : 'Selected'} · 2h ago',
            ),
          ),
          findsOneWidget,
        );
        final dot = find.descendant(
          of: row,
          matching: find.byKey(const Key('active_device_status_dot')),
        );
        expect(dot, connected ? findsOneWidget : findsNothing);
        expect(f.store.writes, writes);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    });
  }
  testWidgets(
    'Connections uses the source large-sheet compact header and row rhythm',
    (tester) async {
      tester.view.physicalSize = const Size(402, 874);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final f = await fixture();
      try {
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(Brightness.light),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(padding: const EdgeInsets.only(top: 62, bottom: 34)),
              child: child!,
            ),
            home: PairingPage(controller: f.desktop),
          ),
        );
        await more(tester, 'Connections');
        final sheet = tester.getRect(find.byType(BottomSheet));
        expect(sheet.top, closeTo(62, 1));
        expect(
          tester.getRect(find.widgetWithText(TextButton, 'Close')).height,
          closeTo(36, .5),
        );
        expect(
          tester.getRect(find.byKey(const Key('device_menu'))).top,
          closeTo(165.333, 1),
        );
        final title = tester.getRect(find.text('Connections'));
        expect(title.center.dx, closeTo(201, 1));
        expect(title.center.dy, closeTo(100, 1));
        expect(
          tester.getRect(find.byKey(const Key('device_menu'))).height,
          closeTo(70, 1),
        );
        expect(
          tester.getRect(find.byKey(const ValueKey('device_row_mac'))).height,
          closeTo(70, 1),
        );
        final scan = find.ancestor(
          of: find.text('Scan QR Code'),
          matching: find.byType(ListTile),
        );
        expect(tester.getRect(scan).height, closeTo(52, 1));
        expect(
          tester
              .getTopLeft(
                find.descendant(of: scan, matching: find.text('Scan QR Code')),
              )
              .dx,
          closeTo(68, 1),
        );
        expect(
          tester
              .widget<Icon>(
                find.descendant(of: scan, matching: find.byType(Icon)),
              )
              .size,
          16,
        );
        expect(find.text('Close').hitTestable(), findsOneWidget);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    },
  );
  testWidgets(
    'device switch menu matches source centered width leading artwork and wrapped caption',
    (tester) async {
      tester.view.physicalSize = const Size(402, 874);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final f = await fixture();
      const channel = MethodChannel('djl.mobile/app-info');
      final now = DateTime.now();
      final labels = <int, String>{};
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
            channel,
            (call) async => call.method == 'relativeDate'
                ? labels[(call.arguments as Map)['date']]
                : null,
          );
      addTearDown(
        () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null),
      );
      try {
        final data = [
          ('mac', 'Workspace Mac', const Duration(minutes: 2), '2 mins ago'),
          ('other', 'Studio Mac', const Duration(hours: 2), '2 hrs ago'),
          ('build', 'Build Mac', const Duration(days: 1), '1 day ago'),
        ];
        f.store.values['desktop.trusted'] = jsonEncode([
          for (final (id, name, age, _) in data)
            {
              'djlTrustedEntry': 1,
              'trustId': 'menu-$id',
              'pairing': preferencePair(mac: id).data,
              'preferences': {'nickname': name, 'visibleInMenu': true},
              'activity': {
                'lastUsedAt': now.subtract(age).millisecondsSinceEpoch,
              },
            },
        ]);
        for (final (_, _, age, label) in data) {
          labels[now.subtract(age).millisecondsSinceEpoch] = label;
        }
        await f.desktop.restore();
        f.desktop.previousDevice = preferencePair(mac: 'other');
        (f.desktop.transport as ObservedPairingTransport).online = true;
        final writes = f.store.writes;
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(Brightness.light),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(padding: const EdgeInsets.only(top: 62, bottom: 34)),
              child: child!,
            ),
            home: PairingPage(controller: f.desktop),
          ),
        );
        await more(tester, 'Connections');
        final anchor = tester.getRect(find.byKey(const Key('device_menu')));
        await tester.tap(find.byKey(const Key('device_menu')));
        await tester.pumpAndSettle();
        final current = find.byKey(const ValueKey('device_choice_mac'));
        final row = tester.getRect(current);
        expect(row.width, closeTo(250, 1));
        expect(row.center.dx, closeTo(anchor.center.dx, 1));
        expect(row.top, closeTo(anchor.top + 53.333, 1));
        expect(row.height, closeTo(78, 1));
        final caption = find.descendant(
          of: current,
          matching: find.text('Connected · 2 mins ago'),
        );
        expect(tester.getSize(caption).height, closeTo(36, 1));
        final icon = find.descendant(
          of: current,
          matching: find.byType(SvgPicture),
        );
        final title = find.descendant(
          of: current,
          matching: find.text('Workspace Mac'),
        );
        expect(
          tester.getRect(icon).right,
          lessThan(tester.getRect(title).left),
        );
        expect(tester.widget<PopupMenuItem<Pairing>>(current).enabled, isFalse);
        await tester.tapAt(const Offset(390, 850));
        await tester.pumpAndSettle();
        expect(find.text('Switch to'), findsNothing);
        expect(find.text('Connections'), findsOneWidget);
        expect(f.store.writes, writes);
        expect((f.desktop.transport as ObservedPairingTransport).attempts, 0);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    },
  );
  testWidgets(
    'switch menu Escape cancels and keyboard skips the disabled current device',
    (tester) async {
      final f = await fixture();
      try {
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: f.desktop)),
        );
        await more(tester, 'Connections');
        final writes = f.store.writes;
        await tester.tap(find.byKey(const Key('device_menu')));
        await tester.pumpAndSettle();
        await tester.sendKeyEvent(LogicalKeyboardKey.escape);
        await tester.pumpAndSettle();
        expect(find.text('Switch to'), findsNothing);
        expect(find.text('Connections'), findsOneWidget);
        expect(f.store.writes, writes);
        expect((f.desktop.transport as ObservedPairingTransport).attempts, 0);
        await tester.tap(find.byKey(const Key('device_menu')));
        await tester.pumpAndSettle();
        await tester.sendKeyEvent(LogicalKeyboardKey.tab);
        await tester.sendKeyEvent(LogicalKeyboardKey.enter);
        await tester.pumpAndSettle();
        expect(find.text('Switch to'), findsNothing);
        expect(f.desktop.active!.macDeviceId, 'other');
        expect((f.desktop.transport as ObservedPairingTransport).attempts, 1);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    },
  );
  testWidgets(
    'forget review has source typography capsules and explicit no-write cancellation',
    (tester) async {
      tester.view.physicalSize = const Size(402, 874);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final f = await fixture();
      try {
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(Brightness.light),
            home: PairingPage(controller: f.desktop),
          ),
        );
        await more(tester, 'Connections');
        final before = Map<String, String>.from(f.store.values);
        await tester.drag(
          find.byKey(const ValueKey('device_row_other')),
          const Offset(-220, 0),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Forget desktop'));
        await tester.pumpAndSettle();
        final title = find.text('Forget this device?');
        expect(
          tester.renderObject<RenderParagraph>(title).text.style!.fontSize,
          17,
        );
        expect(
          tester
              .getRect(
                find
                    .descendant(
                      of: find.byType(Dialog),
                      matching: find.byType(Material),
                    )
                    .first,
              )
              .width,
          closeTo(320, 1),
        );
        for (final text in ['Cancel', 'Forget']) {
          final button = find.widgetWithText(TextButton, text);
          expect(tester.getRect(button).height, closeTo(48, 1));
          expect(tester.getRect(button).width, closeTo(140, 1));
          expect(
            tester
                .renderObject<RenderParagraph>(find.text(text))
                .text
                .style!
                .fontSize,
            17,
          );
        }
        expect(
          find.textContaining('Studio.local will be removed'),
          findsOneWidget,
        );
        await tester.tapAt(const Offset(8, 8));
        await tester.pumpAndSettle();
        expect(title, findsOneWidget);
        expect(f.store.values, before);
        await tester.sendKeyEvent(LogicalKeyboardKey.escape);
        await tester.pumpAndSettle();
        expect(title, findsNothing);
        expect(f.store.values, before);
        expect(find.text('Connections'), findsOneWidget);
        await tester.drag(
          find.byKey(const ValueKey('device_row_other')),
          const Offset(-220, 0),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Forget desktop'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(title, findsNothing);
        expect(f.store.values, before);
        expect(f.desktop.trusted, hasLength(2));
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    },
  );

  testWidgets(
    'large-text forget review keeps complete actions above keyboard and Back preserves trust',
    (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final f = await fixture();
      try {
        await f.desktop.setDeviceNickname(
          f.desktop.devicePreferences(f.desktop.trusted.last)!,
          'A very long named Mac for an explicit local review',
        );
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(Brightness.dark),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: TextScaler.linear(2.2),
                viewInsets: const EdgeInsets.only(bottom: 220),
              ),
              child: child!,
            ),
            home: PairingPage(controller: f.desktop),
          ),
        );
        await more(tester, 'Connections');
        await tester.ensureVisible(
          find.byKey(const ValueKey('device_row_other')),
        );
        await tester.drag(
          find.byKey(const ValueKey('device_row_other')),
          const Offset(-220, 0),
        );
        await tester.pumpAndSettle();
        final before = Map<String, String>.from(f.store.values);
        await tester.tap(find.byTooltip('Forget desktop'));
        await tester.pumpAndSettle();
        for (final text in ['Cancel', 'Forget']) {
          final action = find.widgetWithText(TextButton, text);
          expect(action.hitTestable(), findsOneWidget);
          expect(tester.getRect(action).bottom, lessThanOrEqualTo(420));
          final paragraph = tester.renderObject<RenderParagraph>(
            find.text(text),
          );
          final bounds = tester.getRect(action);
          for (final box in paragraph.getBoxesForSelection(
            TextSelection(baseOffset: 0, extentOffset: text.length),
          )) {
            final glyphs = box.toRect().shift(
              paragraph.localToGlobal(Offset.zero),
            );
            expect(bounds.intersect(glyphs), glyphs);
          }
        }
        expect(tester.takeException(), isNull);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.text('Forget this device?'), findsNothing);
        expect(f.store.values, before);
        expect(f.desktop.trusted, hasLength(2));
      } finally {
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    },
  );

  testWidgets(
    'only explicit forget removes the chosen volatile fixture identity',
    (tester) async {
      final f = await fixture();
      try {
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: f.desktop)),
        );
        await more(tester, 'Connections');
        await tester.drag(
          find.byKey(const ValueKey('device_row_other')),
          const Offset(-220, 0),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Forget desktop'));
        await tester.pumpAndSettle();
        expect(f.desktop.trusted, hasLength(2));
        await tester.tap(find.text('Forget'));
        await tester.pumpAndSettle();
        expect(f.desktop.trusted.map((p) => p.macDeviceId), ['mac']);
        expect(f.desktop.active!.macDeviceId, 'mac');
        expect((f.desktop.transport as ObservedPairingTransport).attempts, 0);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    },
  );
  testWidgets(
    'only one device action row stays revealed and opening the switcher closes it',
    (tester) async {
      final f = await fixture();
      try {
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: f.desktop)),
        );
        await more(tester, 'Connections');
        final writes = f.store.writes;
        await tester.drag(
          find.byKey(const ValueKey('device_row_mac')),
          const Offset(-220, 0),
        );
        await tester.pumpAndSettle();
        expect(find.byTooltip('Forget desktop'), findsOneWidget);
        await tester.drag(
          find.byKey(const ValueKey('device_row_other')),
          const Offset(-220, 0),
        );
        await tester.pumpAndSettle();
        expect(find.byTooltip('Forget desktop'), findsOneWidget);
        await tester.tap(find.byKey(const Key('device_menu')));
        await tester.pumpAndSettle();
        expect(find.byTooltip('Forget desktop'), findsNothing);
        expect(f.store.writes, writes);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    },
  );
  testWidgets(
    'current and previous devices lead both rows and switch choices',
    (tester) async {
      final f = await fixture();
      try {
        final previous = preferencePair(mac: 'previous');
        await f.desktop.pairings.trust(previous);
        await f.desktop.restore();
        f.desktop.previousDevice = previous;
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: f.desktop)),
        );
        await more(tester, 'Connections');
        final earlier = find.byKey(const ValueKey('device_row_previous'));
        final saved = find.byKey(const ValueKey('device_row_other'));
        expect(
          tester.getTopLeft(earlier).dy,
          lessThan(tester.getTopLeft(saved).dy),
        );
        await tester.tap(find.byKey(const Key('device_menu')));
        await tester.pumpAndSettle();
        final choices = tester.widgetList<PopupMenuItem<Pairing>>(
          find.byWidgetPredicate(
            (w) => w is PopupMenuItem<Pairing> && w.value != null,
          ),
        );
        expect(choices.map((w) => w.value!.macDeviceId), [
          'mac',
          'previous',
          'other',
        ]);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    },
  );
  testWidgets(
    'menu distinguishes legacy records sharing a Mac id with different pins',
    (tester) async {
      final f = await fixture();
      try {
        final a = preferencePair(), b = preferencePair(pin: 9);
        f.store.values['desktop.trusted'] = jsonEncode([a.data, b.data]);
        await f.desktop.restore();
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: f.desktop)),
        );
        await more(tester, 'Connections');
        await tester.tap(find.byKey(const Key('device_menu')));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final choices = tester
            .widgetList<PopupMenuItem<Pairing>>(
              find.byWidgetPredicate(
                (w) => w is PopupMenuItem<Pairing> && w.value != null,
              ),
            )
            .toList();
        expect(choices.map((w) => w.value!.publicKey).toSet(), {
          a.publicKey,
          b.publicKey,
        });
        expect(
          choices.where((w) => !w.enabled).single.value!.publicKey,
          a.publicKey,
        );
      } finally {
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    },
  );
  testWidgets(
    'active device row opens an anchored switch menu, not another sheet',
    (tester) async {
      final f = await fixture();
      try {
        await f.desktop.setDeviceNickname(
          f.desktop.devicePreferences(f.desktop.trusted.last)!,
          'Other Mac',
        );
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: f.desktop)),
        );
        await more(tester, 'Connections');
        final row = find.byKey(const Key('device_menu'));
        expect(
          find.descendant(of: row, matching: find.text('Studio')),
          findsOneWidget,
        );
        expect(
          find.descendant(of: row, matching: find.text('Selected')),
          findsOneWidget,
        );
        final anchor = tester.getRect(row);
        final writes = f.store.writes;
        await tester.tap(row);
        await tester.pumpAndSettle();
        expect(find.byType(BottomSheet), findsOneWidget);
        expect(find.text('Switch to'), findsOneWidget);
        expect(
          tester.getTopLeft(find.text('Switch to')).dy,
          closeTo(anchor.top + 27, 2),
        );
        expect(
          tester
              .widget<PopupMenuItem<Pairing>>(
                find.byKey(const ValueKey('device_choice_mac')),
              )
              .enabled,
          isFalse,
        );
        await tester.tapAt(const Offset(8, 8));
        await tester.pumpAndSettle();
        expect(find.text('Connections'), findsOneWidget);
        expect(f.store.writes, writes);
        expect((f.desktop.transport as ObservedPairingTransport).attempts, 0);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    },
  );
  testWidgets(
    'visibility is inline and swipe never forgets without confirmation',
    (tester) async {
      final f = await fixture();
      try {
        await f.desktop.setDeviceNickname(
          f.desktop.devicePreferences(f.desktop.trusted.last)!,
          'Other Mac',
        );
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: f.desktop)),
        );
        await more(tester, 'Connections');
        final row = find.byKey(const ValueKey('device_row_other'));
        final toggle = find.byKey(const ValueKey('device_visibility_other'));
        expect(row, findsOneWidget);
        expect(
          tester.getCenter(toggle).dy,
          closeTo(tester.getCenter(row).dy, 3),
        );
        expect(find.text('Show in device menu'), findsNothing);
        expect(find.byTooltip('Forget desktop'), findsNothing);
        final before = Map<String, String>.from(f.store.values);
        await tester.drag(row, const Offset(-500, 0));
        await tester.pumpAndSettle();
        expect(find.byType(AlertDialog), findsNothing);
        expect(find.byTooltip('Forget desktop'), findsOneWidget);
        expect(f.store.values, before);
        await tester.tap(find.byTooltip('Forget desktop'));
        await tester.pumpAndSettle();
        expect(find.text('Forget this device?'), findsOneWidget);
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(f.store.values, before);
        expect(f.desktop.trusted, hasLength(2));
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    },
  );
  testWidgets('an open menu cannot select a replaced pinned identity', (
    tester,
  ) async {
    final f = await fixture();
    try {
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: f.desktop)),
      );
      await more(tester, 'Connections');
      await tester.tap(find.byKey(const Key('device_menu')));
      await tester.pumpAndSettle();
      final changed = preferencePair(mac: 'other', pin: 9);
      f.desktop.trusted = [f.desktop.active!, changed];
      await tester.tap(find.byKey(const ValueKey('device_choice_other')));
      await tester.pumpAndSettle();
      expect((f.desktop.transport as ObservedPairingTransport).attempts, 0);
      expect(f.desktop.active!.macDeviceId, 'mac');
      expect(tester.takeException(), isNull);
    } finally {
      await tester.pumpWidget(const SizedBox());
      f.desktop.dispose();
      f.settings.dispose();
    }
  });
  for (final brightness in Brightness.values) {
    testWidgets('narrow large-text Connections remains usable in $brightness', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(320, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final f = await fixture();
      try {
        await f.desktop.setDeviceNickname(
          f.desktop.devicePreferences(f.desktop.active!)!,
          'A very long Mac name 👩‍💻 café',
        );
        final rows = (jsonDecode(f.store.values['desktop.trusted']!) as List)
            .cast<Map<String, dynamic>>();
        for (final row in rows) {
          row['activity'] = {
            'lastUsedAt': DateTime.now()
                .subtract(const Duration(hours: 2))
                .millisecondsSinceEpoch,
          };
        }
        f.store.values['desktop.trusted'] = jsonEncode(rows);
        await f.desktop.loadDevicePreferences();
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(brightness),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(2.2)),
              child: child!,
            ),
            home: PairingPage(controller: f.desktop),
          ),
        );
        await more(tester, 'Connections');
        final closeText = tester.renderObject<RenderParagraph>(
          find.text('Close'),
        );
        final closeRect = tester.getRect(
          find.widgetWithText(TextButton, 'Close'),
        );
        for (final box in closeText.getBoxesForSelection(
          const TextSelection(baseOffset: 0, extentOffset: 5),
        )) {
          final glyphs = box.toRect().shift(
            closeText.localToGlobal(Offset.zero),
          );
          expect(
            closeRect.intersect(glyphs),
            glyphs,
            reason:
                'The complete scaled Close glyphs must fit inside the button.',
          );
        }

        await tester.ensureVisible(find.byKey(const Key('device_menu')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('device_menu')));
        await tester.pumpAndSettle();
        expect(find.text('Switch to'), findsOneWidget);
        expect(
          find.descendant(
            of: find.byKey(const ValueKey('device_choice_other')),
            matching: find.text('Saved · 2h ago'),
          ),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('device_choice_other')).hitTestable(),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    });
  }
}
