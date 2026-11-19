import 'dart:async';
import 'dart:ui' show Tristate;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:djl_mobile/features/settings/presentation/local_settings_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import '../desktop_subagents_test.dart' show SubagentTransport;
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controls.dart';
import 'package:djl_mobile/features/settings/presentation/privacy_shield.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import 'settings_controller_test.dart' show MemorySettingsStore;
import 'app_lock_controller_test.dart' show FakeOwnerAuth;

class PendingSettingsStore extends MemorySettingsStore {
  final gate = Completer<void>();
  final writes = <(String, Object?)>[];
  @override
  Future<void> write(String key, Object? value) async {
    writes.add((key, value));
    await gate.future;
    return super.write(key, value);
  }
}

void main() {
  test('DJL light and dark use grayscale component colors', () {
    for (final brightness in Brightness.values) {
      final scheme = djlTheme(brightness).colorScheme;
      for (final color in [
        scheme.primary,
        scheme.secondaryContainer,
        scheme.tertiaryContainer,
        scheme.surfaceContainerLow,
        scheme.surfaceContainerHigh,
        scheme.onSurfaceVariant,
        scheme.inverseSurface,
      ]) {
        expect(color.r, color.g);
        expect(color.g, color.b);
      }
    }
  });

  for (final (platform, brightness) in [
    (TargetPlatform.android, Brightness.dark),
    (TargetPlatform.android, Brightness.light),
    (TargetPlatform.iOS, Brightness.dark),
  ]) {
    testWidgets(
      'app authentication controls are absent on ${platform.name} ${brightness.name}',
      (tester) async {
        final store = MemorySettingsStore()
          ..values[SettingsController.lockKey] = true;
        final settings = SettingsController(store);
        await settings.load();
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(brightness).copyWith(platform: platform),
            home: Scaffold(
              body: SingleChildScrollView(
                child: SettingsControls(controller: settings),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('App lock'), findsNothing);
        expect(find.text('Security'), findsNothing);
        expect(find.textContaining('Require Face ID'), findsNothing);
        expect(store.values[SettingsController.lockKey], isTrue);
        await tester.pumpWidget(const SizedBox());
        settings.dispose();
      },
    );
  }
  testWidgets(
    'loading and saving settings never expose an authentication toggle',
    (tester) async {
      final store = PendingSettingsStore();
      final settings = SettingsController(store);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: SettingsControls(controller: settings),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('App lock'), findsNothing);
      expect(store.writes, isEmpty);
      await settings.load();
      final saving = settings.setTheme(ThemeMode.dark);
      await tester.pump();
      expect(settings.saving, isTrue);
      expect(find.text('App lock'), findsNothing);
      store.gate.complete();
      await saving;
      await tester.pumpAndSettle();
      expect(store.writes, [('djl.appearance.mode', 'dark')]);
      await tester.pumpWidget(const SizedBox());
      settings.dispose();
    },
  );
  testWidgets(
    'persisted appearance controls rebuild themes and retain large ambient text scaling',
    (tester) async {
      final store = MemorySettingsStore()
        ..values.addAll({
          'djl.appearance.mode': 'dark',
          'codex.appFontStyle': 'geistMono',
          'codex.userBubbleColor': 'blue',
        });
      final settings = SettingsController(store);
      await settings.load();
      await tester.pumpWidget(
        ListenableBuilder(
          listenable: settings,
          builder: (_, _) => MaterialApp(
            theme: djlTheme(
              Brightness.light,
              font: settings.font,
              bubble: settings.bubble,
            ),
            darkTheme: djlTheme(
              Brightness.dark,
              font: settings.font,
              bubble: settings.bubble,
            ),
            themeMode: settings.theme,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: TextScaler.linear(2),
                disableAnimations: true,
              ),
              child: child!,
            ),
            home: Scaffold(
              body: SingleChildScrollView(
                child: SettingsControls(controller: settings),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final context = tester.element(find.text('Appearance'));
      expect(Theme.of(context).brightness, Brightness.dark);
      expect(Theme.of(context).textTheme.bodyMedium?.fontFamily, 'GeistMono');
      expect(MediaQuery.textScalerOf(context).scale(10), 20);
      expect(MediaQuery.disableAnimationsOf(context), true);
      final bubble = find.byKey(const Key('bubble-setting'));
      await tester.ensureVisible(bubble);
      await tester.tap(bubble);
      await tester.pumpAndSettle();
      final blue = find.byKey(const Key('bubble-blue'));
      await tester.ensureVisible(blue);
      final semantics = tester.ensureSemantics();
      await tester.pump();
      expect(
        tester.getSemantics(blue).getSemanticsData().flagsCollection.isSelected,
        Tristate.isTrue,
      );
      expect(
        tester.getSemantics(blue).getSemanticsData().label,
        'Blue bubble color',
      );
      final pink = find.byKey(const Key('bubble-pink'));
      await tester.ensureVisible(pink);
      await tester.tap(pink);
      await tester.pumpAndSettle();
      expect(store.values['codex.userBubbleColor'], 'pink');
      expect(DjlAppearance.of(context).bubble, UserBubbleColor.pink);
      final font = find.byKey(const Key('font-setting'));
      await tester.ensureVisible(font);
      await tester.tap(font);
      await tester.pumpAndSettle();
      await tester.tap(find.text('JetBrains Mono').last);
      await tester.pumpAndSettle();
      expect(
        Theme.of(context).textTheme.bodyMedium?.fontFamily,
        'JetBrainsMono',
      );
      final theme = find.byKey(const Key('theme-setting'));
      await tester.ensureVisible(theme);
      await tester.tap(theme);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Light').last);
      await tester.pumpAndSettle();
      expect(Theme.of(context).brightness, Brightness.light);
      expect(tester.takeException(), isNull);
      semantics.dispose();
    },
  );
  testWidgets(
    'anchored menus cancel without writes and failed appearance saves retain selection',
    (tester) async {
      final store = MemorySettingsStore();
      final settings = SettingsController(store);
      await settings.load();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: SettingsControls(controller: settings),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('font-setting')));
      await tester.pumpAndSettle();
      expect(find.text('JetBrains Mono'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(store.values, isEmpty);
      expect(find.byKey(const Key('bubble-blue')), findsNothing);
      store.failWrite = true;
      await tester.tap(find.byKey(const Key('font-setting')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Geist'));
      await tester.pumpAndSettle();
      expect(settings.font, AppFontStyle.system);
      expect(settings.error, isNotNull);
      store.failWrite = false;
      await tester.tap(find.byKey(const Key('font-setting')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Geist'));
      await tester.pumpAndSettle();
      expect(store.values['codex.appFontStyle'], 'geist');
      expect(settings.error, isNull);
      settings.dispose();
    },
  );
  testWidgets('keyboard opens and cancels a focused font menu without saving', (
    tester,
  ) async {
    final settings = SettingsController(MemorySettingsStore());
    await settings.load();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SettingsControls(controller: settings),
          ),
        ),
      ),
    );
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('JetBrains Mono'), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('JetBrains Mono'), findsNothing);
    expect((settings.store as MemorySettingsStore).values, isEmpty);
    settings.dispose();
  });
  testWidgets('pending saves disable appearance menus and announce progress', (
    tester,
  ) async {
    final store = PendingSettingsStore(), semantics = tester.ensureSemantics();
    final settings = SettingsController(store);
    await settings.load();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SettingsControls(controller: settings),
          ),
        ),
      ),
    );
    final saving = settings.setFont(AppFontStyle.geist);
    await tester.pump();
    final font = find.byKey(const Key('font-setting'));
    expect(
      tester.getSemantics(font).getSemanticsData().flagsCollection.isEnabled,
      Tristate.isFalse,
    );
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    await tester.tap(font);
    await tester.pump();
    expect(find.text('JetBrains Mono'), findsNothing);
    store.gate.complete();
    await saving;
    await tester.pumpAndSettle();
    expect(settings.font, AppFontStyle.geist);
    expect(find.byType(LinearProgressIndicator), findsNothing);
    semantics.dispose();
    settings.dispose();
  });
  for (final font in [AppFontStyle.system, AppFontStyle.geist]) {
    testWidgets(
      'local cover large text reaches last device action with unclipped separate header using ${font.name}',
      (tester) async {
        tester.view.physicalSize = const Size(360, 320);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final settings = SettingsController(MemorySettingsStore());
        await settings.load();
        final transport = SubagentTransport();
        final desktop = DesktopController(
          transport.pairings,
          connection: transport,
        );
        if (font == AppFontStyle.geist) {
          await (FontLoader('Geist')
                ..addFont(rootBundle.load('assets/fonts/Geist-Regular.ttf'))
                ..addFont(rootBundle.load('assets/fonts/Geist-Bold.ttf')))
              .load();
        }
        var macs = 0;
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(Brightness.light, font: font),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: TextScaler.linear(2.2),
                disableAnimations: true,
              ),
              child: child!,
            ),
            home: LocalSettingsPage(
              controller: settings,
              desktop: desktop,
              signedIn: false,
              onCloud: () {},
              taskStatus: const Text('Task status unavailable on this device'),
              onMyMacs: () => macs++,
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('My Macs'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('My Macs'));
        expect(macs, 1);
        expect(find.text('SSH terminals'), findsNothing);
        expect(tester.widget<Text>(find.text('Settings')).style?.fontSize, 17);
        expect(find.text('Done').hitTestable(), findsOneWidget);
        Rect glyphBounds(String label) {
          final paragraph = tester.renderObject<RenderParagraph>(
            find.text(label),
          );
          expect(paragraph.text.toPlainText(), label);
          expect(paragraph.didExceedMaxLines, isFalse);
          final bounds = paragraph
              .getBoxesForSelection(
                TextSelection(baseOffset: 0, extentOffset: label.length),
              )
              .map((box) => box.toRect())
              .reduce((a, b) => a.expandToInclude(b));
          return bounds.shift(paragraph.localToGlobal(Offset.zero));
        }

        final titleBounds = glyphBounds('Settings'),
            doneBounds = glyphBounds('Done');
        final header = tester.getRect(
          find.descendant(
            of: find.byType(SliverAppBar),
            matching: find.byType(AppBar),
          ),
        );
        expect(
          titleBounds.overlaps(doneBounds),
          isFalse,
          reason:
              'Fully scaled Settings and Done must occupy separate painted areas.',
        );
        for (final bounds in [titleBounds, doneBounds]) {
          expect(
            header.contains(bounds.topLeft),
            isTrue,
            reason: 'Header text must remain inside its painted header.',
          );
          expect(
            header.contains(bounds.bottomRight),
            isTrue,
            reason: 'Header text must remain inside its painted header.',
          );
        }
        expect(
          MediaQuery.textScalerOf(
            tester.element(find.text('Settings')),
          ).scale(10),
          22,
        );
        if (font == AppFontStyle.geist) {
          expect(
            tester.widget<Text>(find.text('Settings')).style?.fontFamily,
            'Geist',
          );
          expect(
            tester.widget<Text>(find.text('Done')).style?.fontFamily ??
                DefaultTextStyle.of(
                  tester.element(find.text('Done')),
                ).style.fontFamily,
            'Geist',
          );
        }
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        desktop.dispose();
        settings.dispose();
      },
    );
  }
  testWidgets('opening a long bubble menu reveals its saved final selection', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 320);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final store = MemorySettingsStore()
      ..values['codex.userBubbleColor'] = 'black';
    final settings = SettingsController(store);
    await settings.load();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: SettingsControls(controller: settings),
          ),
        ),
      ),
    );
    await tester.ensureVisible(find.byKey(const Key('bubble-setting')));
    await tester.tap(find.byKey(const Key('bubble-setting')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('bubble-black')).hitTestable(), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(store.values, {'codex.userBubbleColor': 'black'});
    settings.dispose();
  });
  testWidgets(
    'privacy shield covers pushed routes and modal hit tests and semantics',
    (tester) async {
      final lock = AppLockController(FakeOwnerAuth());
      lock.initialize(enabled: false, hasProtectedContent: false);
      final navigator = GlobalKey<NavigatorState>();
      var taps = 0;
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: navigator,
          builder: (_, child) => PrivacyShield(controller: lock, child: child!),
          home: const Scaffold(body: Text('Private home')),
        ),
      );
      navigator.currentState!.push(
        MaterialPageRoute<void>(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => showDialog<void>(
                context: context,
                builder: (_) => AlertDialog(
                  content: TextButton(
                    onPressed: () {
                      taps++;
                    },
                    child: const Text('Private modal action'),
                  ),
                ),
              ),
              child: const Text('Private route'),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Private route'));
      await tester.pumpAndSettle();
      final target = tester.getCenter(find.text('Private modal action'));
      final semantics = tester.ensureSemantics();
      expect(
        tester.getSemantics(find.byType(PrivacyShield)).toStringDeep(),
        contains('Private modal action'),
      );
      lock.lifecycle(AppLifecycleState.inactive);
      await tester.pumpAndSettle();
      expect(
        find.text('Your session is hidden while DJL is inactive.'),
        findsOneWidget,
      );
      expect(
        tester.getSemantics(find.byType(PrivacyShield)).toStringDeep(),
        isNot(contains('Private modal action')),
      );
      expect(
        tester.getSemantics(find.byType(PrivacyShield)).toStringDeep(),
        isNot(contains('Private route')),
      );
      await tester.tapAt(target);
      expect(taps, 0);
      lock.lifecycle(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Private modal action'));
      expect(taps, 1);
      expect(tester.takeException(), isNull);
      semantics.dispose();
    },
  );
}
