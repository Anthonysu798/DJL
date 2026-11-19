import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/settings/presentation/device_name_sheet.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_conversation_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart' show CupertinoColors;
import 'package:flutter/rendering.dart' show RenderParagraph;
import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/features/settings/data/settings_store.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/settings/presentation/local_settings_page.dart';
import '../core/trusted_device_preferences_test.dart'
    show PreferenceCredentials, preferencePair;
import 'desktop_recovery_test.dart' show RecoveryMemoryStore;
import 'pairing_presentation_test.dart'
    show ObservedPairingTransport, VerifiedPairings, more, paintedColors;

Future<
  ({
    DesktopController desktop,
    PreferenceCredentials store,
    SettingsController settings,
  })
>
fixture({bool single = false}) async {
  final store = PreferenceCredentials();
  final a = preferencePair(), b = preferencePair(mac: 'other');
  store.values['desktop.trusted'] = jsonEncode(
    single ? [a.data] : [a.data, b.data],
  );
  store.values['desktop.active'] = a.macDeviceId;
  final repository = VerifiedPairings(store);
  final desktop = DesktopController(
    repository,
    connection: ObservedPairingTransport(repository),
    localStore: RecoveryMemoryStore(),
  );
  await desktop.restore();
  final settings = SettingsController(SharedSettingsStore());
  await settings.load();
  return (desktop: desktop, store: store, settings: settings);
}

Widget settingsPage(DesktopController desktop, SettingsController settings) =>
    LocalSettingsPage(
      controller: settings,
      desktop: desktop,
      signedIn: false,
      onCloud: () {},
      taskStatus: const Text('Task status'),
      onMyMacs: () {},
    );
Future<void> openEditor(WidgetTester tester) async {
  expect(find.byTooltip('Edit device name'), findsOneWidget);
  await tester.scrollUntilVisible(find.byTooltip('Edit device name'), 300);
  await tester.ensureVisible(find.byTooltip('Edit device name'));
  await tester.pumpAndSettle();
  await tester.tap(find.byTooltip('Edit device name'));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    WidgetController.hitTestWarningShouldBeFatal = true;
  });
  testWidgets('dark Connections groups advance above their elevated sheet', (
    tester,
  ) async {
    final f = await fixture(single: true);
    try {
      await tester.pumpWidget(
        RepaintBoundary(
          key: const Key('pairing_paint'),
          child: MaterialApp(
            theme: djlTheme(Brightness.dark),
            home: PairingPage(controller: f.desktop),
          ),
        ),
      );
      await more(tester, 'Connections');
      final rect = tester.getRect(find.widgetWithText(ListTile, 'Studio'));
      final colors = await paintedColors(tester, [
        Offset(rect.left + 8, rect.center.dy),
        Offset(rect.left - 8, rect.center.dy),
      ]);
      expect(
        colors[0].computeLuminance(),
        greaterThan(colors[1].computeLuminance()),
      );
      expect(tester.takeException(), isNull);
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      f.desktop.dispose();
      f.settings.dispose();
    }
  });
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    testWidgets(
      'one eligible Mac has no redundant Connections chooser on $platform',
      (tester) async {
        debugDefaultTargetPlatformOverride = platform;
        final f = await fixture(single: true);
        try {
          final writes = f.store.writes;
          await tester.pumpWidget(
            MaterialApp(
              theme: djlTheme(Brightness.light),
              home: PairingPage(controller: f.desktop),
            ),
          );
          await more(tester, 'Connections');
          expect(find.byKey(const Key('device_menu')), findsNothing);
          expect(find.text('Devices'), findsOneWidget);
          expect(find.widgetWithText(ListTile, 'Studio'), findsOneWidget);
          expect(f.store.writes, writes);
          expect((f.desktop.transport as ObservedPairingTransport).attempts, 0);
          expect(tester.takeException(), isNull);
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          f.desktop.dispose();
          f.settings.dispose();
          debugDefaultTargetPlatformOverride = null;
        }
      },
    );
    for (final scale in [1.0, 2.2]) {
      testWidgets(
        'Connections Active badge follows the source row at $scale on $platform',
        (tester) async {
          debugDefaultTargetPlatformOverride = platform;
          tester.view.devicePixelRatio = 1;
          tester.view.physicalSize = const Size(390, 844);
          final f = await fixture(single: true);
          try {
            await tester.pumpWidget(
              MaterialApp(
                theme: djlTheme(Brightness.light),
                builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(textScaler: TextScaler.linear(scale)),
                  child: child!,
                ),
                home: PairingPage(controller: f.desktop),
              ),
            );
            await more(tester, 'Connections');
            final row = find.widgetWithText(ListTile, 'Studio');
            await tester.ensureVisible(row);
            await tester.pumpAndSettle();
            final name = tester.getRect(
              find.descendant(of: row, matching: find.text('Studio')),
            );
            final badge = tester.getRect(
              find.descendant(of: row, matching: find.text('Active')),
            );
            if (scale == 1) {
              expect(name.center.dy, closeTo(badge.center.dy, 2));
              expect(badge.left, greaterThan(name.right));
            }
            expect(name.overlaps(badge), isFalse);
            final status = tester.getRect(
              find.descendant(of: row, matching: find.text('Selected')),
            );
            expect(status.top, greaterThanOrEqualTo(badge.bottom));
            expect(tester.takeException(), isNull);
          } finally {
            await tester.pumpWidget(const SizedBox.shrink());
            f.desktop.dispose();
            f.settings.dispose();
            tester.view.resetPhysicalSize();
            tester.view.resetDevicePixelRatio();
            debugDefaultTargetPlatformOverride = null;
          }
        },
      );
    }
  }
  testWidgets('settings editor starts empty and saves a trimmed local name', (
    tester,
  ) async {
    final f = await fixture();
    await tester.pumpWidget(
      MaterialApp(home: settingsPage(f.desktop, f.settings)),
    );
    await openEditor(tester);
    final field = find.byKey(const Key('device_nickname'));
    expect(tester.widget<TextField>(field).controller!.text, '');
    expect(
      tester.widget<TextField>(field).decoration!.hintText,
      'Studio.local',
    );
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Save'))
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<TextButton>(find.widgetWithText(TextButton, 'Use Default'))
          .onPressed,
      isNull,
    );
    await tester.enterText(field, '  Work desk  ');
    await tester.pump();
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(field, findsNothing);
    expect(find.text('Work desk'), findsOneWidget);
    expect(f.desktop.selectedDeviceName, 'Work desk');
    expect(
      (await f.desktop.pairings.trusted()).first.data['displayName'],
      'Studio.local',
    );
    await tester.pumpWidget(const SizedBox());
    f.desktop.dispose();
    f.settings.dispose();
  });
  testWidgets(
    'hidden device leaves routine chooser but remains manageable and recoverable',
    (tester) async {
      final f = await fixture();
      final hidden = f.desktop.trusted.last;
      await f.desktop.setDeviceNickname(
        f.desktop.devicePreferences(hidden)!,
        'Hidden Mac.LOCAL',
      );
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: f.desktop)),
      );
      await more(tester, 'Connections');
      final toggle = find.byKey(const ValueKey('device_visibility_other'));
      expect(toggle, findsOneWidget);
      await tester.ensureVisible(toggle);
      await tester.tap(toggle);
      await tester.pumpAndSettle();
      expect(f.desktop.devicePreferences(hidden)!.visibleInMenu, isFalse);
      expect(find.text('Hidden Mac'), findsOneWidget);
      expect(find.byKey(const Key('device_menu')), findsNothing);
      expect(f.desktop.menuDevices.map((pair) => pair.macDeviceId), ['mac']);
      await tester.ensureVisible(toggle);
      await tester.tap(toggle);
      await tester.pumpAndSettle();
      expect(f.desktop.devicePreferences(hidden)!.visibleInMenu, isTrue);
      await tester.ensureVisible(find.byKey(const Key('device_menu')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('device_menu')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('device_choice_mac')), findsOneWidget);
      expect(find.byKey(const ValueKey('device_choice_other')), findsOneWidget);
      await tester.tapAt(const Offset(8, 8));
      await tester.pumpAndSettle();
      expect(find.text('Hidden Mac'), findsOneWidget);
      expect(find.byKey(const ValueKey('device_visibility_mac')), findsNothing);
      expect((f.desktop.transport as ObservedPairingTransport).attempts, 0);
      await tester.pumpWidget(const SizedBox());
      f.desktop.dispose();
      f.settings.dispose();
    },
  );
  testWidgets(
    'unchanged raw draft disables Save; whitespace resets; Close and Back never write',
    (tester) async {
      final f = await fixture();
      final pair = f.desktop.active!;
      await f.desktop.setDeviceNickname(
        f.desktop.devicePreferences(pair)!,
        'Desk',
      );
      await tester.pumpWidget(
        MaterialApp(home: settingsPage(f.desktop, f.settings)),
      );
      await openEditor(tester);
      final field = find.byKey(const Key('device_nickname'));
      expect(tester.widget<TextField>(field).controller!.text, 'Desk');
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Save'))
            .onPressed,
        isNull,
      );
      final before = f.store.writes;
      await tester.enterText(field, 'Abandoned');
      await tester.pump();
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
      expect(f.store.writes, before);
      await openEditor(tester);
      await tester.enterText(field, 'Back');
      await tester.pump();
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(f.store.writes, before);
      expect(f.desktop.selectedDeviceName, 'Desk');
      await openEditor(tester);
      await tester.enterText(field, '  \n ');
      await tester.pump();
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Save'))
            .onPressed,
        isNotNull,
      );
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(f.desktop.selectedDeviceName, 'Studio.local');
      await f.desktop.setDeviceNickname(
        f.desktop.devicePreferences(pair)!,
        'Again',
      );
      await tester.pumpAndSettle();
      await openEditor(tester);
      await tester.tap(find.text('Use Default'));
      await tester.pumpAndSettle();
      expect(f.desktop.devicePreferences(pair)!.nickname, '');
      expect(field, findsNothing);
      await tester.pumpWidget(const SizedBox());
      f.desktop.dispose();
      f.settings.dispose();
    },
  );
  testWidgets(
    'failed save keeps editor and draft; failed reread disables writes until explicit retry',
    (tester) async {
      final f = await fixture();
      await tester.pumpWidget(
        MaterialApp(home: settingsPage(f.desktop, f.settings)),
      );
      await openEditor(tester);
      final field = find.byKey(const Key('device_nickname'));
      f.store.failWrite = true;
      await tester.enterText(field, 'Keep my draft');
      await tester.pump();
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(field, findsOneWidget);
      expect(tester.widget<TextField>(field).controller!.text, 'Keep my draft');
      expect(f.desktop.devicePreferencesError, isNotNull);
      f.store.failRead = true;
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(f.desktop.devicePreferencesReady, isFalse);
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Save'))
            .onPressed,
        isNull,
      );
      final writes = f.store.writes;
      f.store.failRead = false;
      f.store.failWrite = false;
      await tester.tap(find.text('Retry local preferences').last);
      await tester.pumpAndSettle();
      expect(f.store.writes, writes);
      expect(tester.widget<TextField>(field).controller!.text, 'Keep my draft');
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(field, findsNothing);
      expect(f.desktop.selectedDeviceName, 'Keep my draft');
      await tester.pumpWidget(const SizedBox());
      f.desktop.dispose();
      f.settings.dispose();
    },
  );
  testWidgets(
    'write persisted then threw retains editor and authoritative name without Saved claim',
    (tester) async {
      final f = await fixture();
      await tester.pumpWidget(
        MaterialApp(home: settingsPage(f.desktop, f.settings)),
      );
      await openEditor(tester);
      final field = find.byKey(const Key('device_nickname'));
      f.store.persistThenThrow = true;
      await tester.enterText(field, 'Persisted');
      await tester.pump();
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(field, findsOneWidget);
      expect(f.desktop.selectedDeviceName, 'Persisted');
      expect(f.desktop.devicePreferencesError, isNotNull);
      expect(find.text('Saved'), findsNothing);
      expect(tester.widget<TextField>(field).controller!.text, 'Persisted');
      await tester.pumpWidget(const SizedBox());
      f.desktop.dispose();
      f.settings.dispose();
    },
  );
  testWidgets(
    'all hidden remains manageable and qualified link keeps hidden verified host',
    (tester) async {
      final f = await fixture();
      f.desktop.active = null;
      for (final pair in f.desktop.trusted) {
        await f.desktop.setDeviceMenuVisibility(
          f.desktop.devicePreferences(pair)!,
          false,
        );
      }
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: f.desktop)),
      );
      await tester.tap(find.text('Connections'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('device_menu')), findsNothing);
      expect(f.desktop.menuDevices, isEmpty);
      expect(f.desktop.trusted, hasLength(2));
      expect(
        find.byKey(const ValueKey('device_visibility_mac')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('device_visibility_other')),
        findsOneWidget,
      );
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
      final target = f.desktop.trusted.last;
      await f.desktop.setDeviceNickname(
        f.desktop.devicePreferences(target)!,
        'Hidden exact Mac',
      );
      f.desktop.queueNavigation(
        DesktopLinkTarget(
          'linked',
          macId: target.macDeviceId,
          macKeySha256: DesktopLinkTarget.keyFingerprint(target.publicKey),
        ),
        useActive: false,
        forceHostChoice: true,
      );
      await tester.pumpAndSettle();
      expect(find.widgetWithText(ListTile, 'Hidden exact Mac'), findsOneWidget);
      expect(f.desktop.trusted, hasLength(2));
      await tester.tap(find.widgetWithText(ListTile, 'Studio.local'));
      await tester.pumpAndSettle();
      expect((f.desktop.transport as ObservedPairingTransport).attempts, 0);
      await tester.tap(find.widgetWithText(ListTile, 'Hidden exact Mac'));
      await tester.pumpAndSettle();
      expect((f.desktop.transport as ObservedPairingTransport).attempts, 1);
      expect(f.desktop.active!.macDeviceId, target.macDeviceId);
      await tester.pumpWidget(const SizedBox());
      f.desktop.dispose();
      f.settings.dispose();
    },
  );
  for (final brightness in [Brightness.light, Brightness.dark]) {
    testWidgets(
      'editor scrolls with keyboard, long names and large text in ${brightness.name}',
      (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        tester.view.viewInsets = const FakeViewPadding(bottom: 310);
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.view.resetViewInsets);
        final f = await fixture();
        final target = f.desktop.devicePreferences(f.desktop.active!)!;
        final longName = List.filled(12, 'Long device name').join(' ');
        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(brightness: brightness),
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => showModalBottomSheet<void>(
                    context: context,
                    isScrollControlled: true,
                    useSafeArea: true,
                    builder: (_) => MediaQuery(
                      data: MediaQuery.of(
                        context,
                      ).copyWith(textScaler: const TextScaler.linear(2)),
                      child: DeviceNameSheet(
                        desktop: f.desktop,
                        target: target,
                        currentName: longName,
                      ),
                    ),
                  ),
                  child: const Text('Open'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Open'));
        await tester.pumpAndSettle();
        final field = find.byKey(const Key('device_nickname'));
        await tester.ensureVisible(field);
        await tester.pumpAndSettle();
        await tester.enterText(field, longName);
        await tester.pump();
        await tester.ensureVisible(find.text('Save'));
        await tester.pumpAndSettle();
        expect(
          tester.getRect(find.text('Save')).bottom,
          lessThanOrEqualTo(534),
        );
        expect(tester.takeException(), isNull);
        await tester.tap(find.text('Save'));
        await tester.pumpAndSettle();
        expect(f.desktop.selectedDeviceName, longName);
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      },
    );
  }
  testWidgets(
    'routine chooser invokes real saved selection and connected chooser remains available',
    (tester) async {
      final f = await fixture();
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: f.desktop)),
      );
      await more(tester, 'Connections');
      expect(find.text('Active device'), findsOneWidget);
      await tester.tap(find.byKey(const Key('device_menu')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('device_choice_other')));
      await tester.pumpAndSettle();
      final transport = f.desktop.transport as ObservedPairingTransport;
      expect(transport.attempts, 1);
      expect(f.desktop.active!.macDeviceId, 'other');
      await f.desktop.disconnect();
      transport.online = true;
      f.desktop.state = 'connected';
      await f.desktop.loadDevicePreferences();
      await tester.pumpAndSettle();
      expect(
        tester.widget<ListTile>(find.byKey(const Key('device_menu'))).onTap,
        isNotNull,
      );
      for (final label in ['Scan QR Code', 'Pair with Code']) {
        await tester.scrollUntilVisible(
          find.text(label),
          220,
          scrollable: find
              .descendant(
                of: find.byType(BottomSheet),
                matching: find.byType(Scrollable),
              )
              .first,
        );
        await tester.ensureVisible(find.text(label));
        await tester.pumpAndSettle();
        expect(
          tester.widget<ListTile>(find.widgetWithText(ListTile, label)).onTap,
          isNotNull,
        );
      }
      expect(transport.attempts, 1);
      await tester.pumpWidget(const SizedBox());
      f.desktop.dispose();
      f.settings.dispose();
    },
  );
  testWidgets(
    'confirmed local name propagates to offline root, history and general draft subtitle only',
    (tester) async {
      final f = await fixture();
      final pair = f.desktop.active!;
      await f.desktop.setDeviceNickname(
        f.desktop.devicePreferences(pair)!,
        'My local name',
      );
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: f.desktop)),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('My local name'), findsWidgets);
      final remote = f.desktop.transport as ObservedPairingTransport;
      remote.online = true;
      f.desktop.state = 'connected';
      final draft = f.desktop.beginNewChatDraft()!;
      await tester.pumpWidget(
        MaterialApp(
          home: DesktopChatPage(controller: f.desktop, draft: draft),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<DesktopConversationTitle>(
              find.byType(DesktopConversationTitle),
            )
            .subtitle,
        'My local name',
      );
      final beforeNicknameRpc = List<String>.of(remote.rpc);
      expect(beforeNicknameRpc, everyElement('project/projectlessRoots'));
      await f.desktop.setDeviceNickname(
        f.desktop.devicePreferences(pair)!,
        'Updated name',
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<DesktopConversationTitle>(
              find.byType(DesktopConversationTitle),
            )
            .subtitle,
        'Updated name',
      );
      expect(remote.rpc, beforeNicknameRpc);
      await tester.pumpWidget(const SizedBox());
      f.desktop.dispose();
      f.settings.dispose();
    },
  );
  testWidgets(
    'pending editor save stays captured across selection; forgotten and repaired target cannot save',
    (tester) async {
      final f = await fixture();
      final original = f.desktop.active!;
      await tester.pumpWidget(
        MaterialApp(home: settingsPage(f.desktop, f.settings)),
      );
      await openEditor(tester);
      final field = find.byKey(const Key('device_nickname'));
      await tester.enterText(field, 'Captured name');
      await tester.pump();
      f.store.writeGate = Completer<void>();
      await tester.tap(find.text('Save'));
      await tester.pump();
      expect(find.byType(LinearProgressIndicator), findsWidgets);
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Save'))
            .onPressed,
        isNull,
      );
      f.desktop.active = f.desktop.trusted.last;
      f.store.writeGate!.complete();
      await tester.pumpAndSettle();
      expect(field, findsNothing);
      expect(f.desktop.deviceName(original), 'Captured name');
      expect(f.desktop.selectedDeviceName, 'Studio.local');
      f.desktop.active = original;
      await f.desktop.loadDevicePreferences();
      await tester.pumpAndSettle();
      await openEditor(tester);
      await tester.enterText(field, 'Stale draft');
      await tester.pump();
      await f.desktop.pairings.forget(original);
      await f.desktop.pairings.trust(original);
      await f.desktop.loadDevicePreferences();
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(field).controller!.text, 'Stale draft');
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Save'))
            .onPressed,
        isNull,
      );
      expect(
        find.text('This saved device changed. Close and reopen the editor.'),
        findsOneWidget,
      );
      expect(f.desktop.devicePreferences(original)!.nickname, '');
      await tester.pumpWidget(const SizedBox());
      f.desktop.dispose();
      f.settings.dispose();
    },
  );
  for (final brightness in [Brightness.light, Brightness.dark]) {
    testWidgets(
      'real themed nickname sheet paints source inline header and neutral controls in ${brightness.name}',
      (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await (FontLoader('Geist')
              ..addFont(rootBundle.load('assets/fonts/Geist-Regular.ttf'))
              ..addFont(rootBundle.load('assets/fonts/Geist-SemiBold.ttf')))
            .load();
        final f = await fixture();
        await f.desktop.setDeviceNickname(
          f.desktop.devicePreferences(f.desktop.active!)!,
          'Current nickname',
        );
        await tester.pumpWidget(
          RepaintBoundary(
            key: const Key('pairing_paint'),
            child: MaterialApp(
              theme: djlTheme(brightness, font: AppFontStyle.geist),
              home: settingsPage(f.desktop, f.settings),
            ),
          ),
        );
        await openEditor(tester);
        final field = find.byKey(const Key('device_nickname'));
        await tester.enterText(field, 'Changed nickname');
        await tester.pumpAndSettle();
        final title = tester.getRect(find.text('Edit Device Name'));
        final close = tester.getRect(find.widgetWithText(TextButton, 'Close'));
        final sheet = tester.getRect(find.byType(BottomSheet));
        expect(
          title.center.dy,
          close.center.dy,
          reason: 'Source has an inline navigation title beside Close.',
        );
        expect(title.center.dx, closeTo(sheet.center.dx, 1));
        expect(title.overlaps(close), isFalse);
        expect(
          tester
              .renderObject<RenderParagraph>(find.text('Edit Device Name'))
              .text
              .style!
              .fontSize,
          17,
        );
        final caption = find.text(
          'This nickname stays on this phone and appears anywhere this device is shown.',
        );
        expect(
          tester.renderObject<RenderParagraph>(caption).text.style!.fontSize,
          11,
        );
        expect(
          tester
              .renderObject<RenderParagraph>(find.text('Device name'))
              .text
              .style!
              .fontSize,
          14,
        );
        final context = tester.element(field),
            scheme = Theme.of(tester.element(field)).colorScheme;
        expect(
          tester.renderObject<RenderParagraph>(caption).text.style!.color,
          scheme.onSurfaceVariant,
        );
        expect(
          tester
              .renderObject<RenderParagraph>(
                find.descendant(
                  of: find.byType(DeviceNameSheet),
                  matching: find.text('Current nickname'),
                ),
              )
              .text
              .style!
              .fontSize,
          11,
        );
        final input = tester.widget<InputDecorator>(
          find.descendant(of: field, matching: find.byType(InputDecorator)),
        );
        final border = input.decoration.border! as OutlineInputBorder;
        expect(border.borderRadius, BorderRadius.circular(12));
        expect(border.borderSide, BorderSide.none);
        final inputRect = tester.getRect(field);
        final reset = find.widgetWithText(TextButton, 'Use Default'),
            save = find.widgetWithText(FilledButton, 'Save');
        final resetMaterial = find.descendant(
          of: reset,
          matching: find.byType(Material),
        );
        final saveMaterial = find.descendant(
          of: save,
          matching: find.byType(Material),
        );
        final resetRect = tester.getRect(resetMaterial),
            saveRect = tester.getRect(saveMaterial);
        for (final material in [resetMaterial, saveMaterial]) {
          final shape =
              tester.widget<Material>(material).shape!
                  as RoundedRectangleBorder;
          expect(shape.borderRadius, BorderRadius.circular(10));
        }
        for (final rect in [resetRect, saveRect]) {
          expect(rect.left, inputRect.left);
          expect(rect.right, inputRect.right);
          expect(
            rect.height,
            lessThan(52),
            reason:
                'Source controls must not inherit the app primary 52px pill.',
          );
        }
        expect(saveRect.top - resetRect.bottom, closeTo(10, .1));
        final colors = await paintedColors(tester, [
          Offset(saveRect.left - 8, saveRect.center.dy),
          saveRect.topLeft + const Offset(6, 4),
          Offset(saveRect.left + 16, saveRect.center.dy),
          saveRect.topLeft + const Offset(1, 1),
          Offset(resetRect.left + 16, resetRect.center.dy),
          Offset(inputRect.left + 2, inputRect.center.dy),
          inputRect.topLeft + const Offset(1, 1),
        ]);
        final parent = colors.first;
        final neutral = Color.alphaBlend(
          scheme.onSurface.withValues(alpha: .08),
          parent,
        );
        final inputFill = Color.alphaBlend(
          CupertinoColors.secondarySystemFill.resolveFrom(context),
          parent,
        );
        // Raster captures are 8-bit; compare the composited colors in that same space.
        expect(
          colors.map((color) => color.toARGB32()),
          [
            parent,
            neutral,
            neutral,
            parent,
            neutral,
            inputFill,
            parent,
          ].map((color) => color.toARGB32()),
        );
        expect(
          tester
              .renderObject<RenderParagraph>(find.text('Save'))
              .text
              .style!
              .color,
          scheme.onSurface,
        );
        expect(
          tester
              .renderObject<RenderParagraph>(find.text('Use Default'))
              .text
              .style!
              .color,
          scheme.onSurfaceVariant,
        );
        expect(tester.takeException(), isNull);
        debugPrint(
          'nickname source style ${brightness.name}: title=$title close=$close input=$inputRect reset=$resetRect save=$saveRect sampled=$colors',
        );
        await tester.tap(find.text('Close'));
        await tester.pumpAndSettle();
        expect(f.desktop.selectedDeviceName, 'Current nickname');
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      },
    );
    testWidgets(
      'real themed nickname error retry and Close remain reachable at 2.2 text with short keyboard viewport in ${brightness.name}',
      (tester) async {
        tester.view.physicalSize = const Size(360, 640);
        tester.view.devicePixelRatio = 1;
        tester.view.viewInsets = const FakeViewPadding(bottom: 240);
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.view.resetViewInsets);
        await (FontLoader('Geist')
              ..addFont(rootBundle.load('assets/fonts/Geist-Regular.ttf'))
              ..addFont(rootBundle.load('assets/fonts/Geist-SemiBold.ttf')))
            .load();
        final f = await fixture();
        final target = f.desktop.devicePreferences(f.desktop.active!)!;
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(brightness, font: AppFontStyle.geist),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(2.2)),
              child: child!,
            ),
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => showModalBottomSheet<void>(
                    context: context,
                    isScrollControlled: true,
                    useSafeArea: true,
                    builder: (_) => DeviceNameSheet(
                      desktop: f.desktop,
                      target: target,
                      currentName:
                          'A long current device name that must remain readable',
                    ),
                  ),
                  child: const Text('Open editor'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Open editor'));
        await tester.pumpAndSettle();
        final field = find.byKey(const Key('device_nickname'));
        await tester.ensureVisible(field);
        await tester.pumpAndSettle();
        await tester.enterText(field, 'Retained draft');
        await tester.pump();
        f.store.failWrite = true;
        Future<void> revealAndTap(String text) async {
          final action = find.descendant(
            of: find.byType(DeviceNameSheet),
            matching: find.text(text),
          );
          await tester.ensureVisible(action);
          await tester.pumpAndSettle();
          final rect = tester.getRect(action);
          expect(rect.bottom, lessThanOrEqualTo(400));
          expect(rect.top, greaterThanOrEqualTo(0));
          expect(
            tester.renderObject<RenderParagraph>(action).didExceedMaxLines,
            isFalse,
          );
          await tester.tap(action);
          await tester.pumpAndSettle();
        }

        await revealAndTap('Save');
        expect(
          tester.widget<TextField>(field).controller!.text,
          'Retained draft',
        );
        expect(f.desktop.devicePreferencesError, isNotNull);
        final error = find.descendant(
          of: find.byType(DeviceNameSheet),
          matching: find.text(f.desktop.devicePreferencesError!),
        );
        await tester.ensureVisible(error);
        await tester.pumpAndSettle();
        expect(
          tester.renderObject<RenderParagraph>(error).didExceedMaxLines,
          isFalse,
        );
        await revealAndTap('Retry local preferences');
        expect(
          tester.widget<TextField>(field).controller!.text,
          'Retained draft',
        );
        await revealAndTap('Close');
        expect(field, findsNothing);
        expect(f.desktop.selectedDeviceName, 'Studio.local');
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      },
    );
  }
}
