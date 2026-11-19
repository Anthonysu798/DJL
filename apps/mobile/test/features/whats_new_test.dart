import '../support/open_cloud.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/releases/presentation/whats_new_presenter.dart';
import 'package:djl_mobile/features/releases/presentation/whats_new_sheet.dart';
import 'settings/settings_controller_test.dart' show MemorySettingsStore;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'cloud_deep_links_test.dart' show client;
import 'pairing_presentation_test.dart' show ObservedPairingTransport;
import 'desktop_activity_test.dart' show ActivityCacheStore;
import 'settings/app_lock_controller_test.dart' show FakeOwnerAuth;

const seenKey = 'djl.mobile.whatsNew.lastPresentedVersion';
const appInfo = MethodChannel('djl.mobile/app-info');

Future<void> host(
  WidgetTester tester,
  MemorySettingsStore store, {
  ValueNotifier<bool>? allowed,
  GlobalKey<NavigatorState>? navigator,
  bool dark = false,
  double scale = 1,
}) async {
  final enabled = allowed ?? ValueNotifier(true);
  await tester.pumpWidget(
    MaterialApp(
      navigatorKey: navigator,
      theme: djlTheme(dark ? Brightness.dark : Brightness.light),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: ValueListenableBuilder<bool>(
        valueListenable: enabled,
        builder: (context, value, _) => WhatsNewPresenter(
          store: store,
          isAllowed: () => enabled.value,
          child: Builder(
            builder: (context) => Scaffold(
              body: Column(
                children: [
                  const Text('My Macs'),
                  TextField(
                    onSubmitted: (_) =>
                        FocusManager.instance.primaryFocus?.unfocus(),
                  ),
                  for (final modal in [false, true])
                    TextButton(
                      onPressed: () {
                        Widget close(BuildContext context) => TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('Return to My Macs'),
                        );
                        if (modal) {
                          showDialog<void>(
                            context: context,
                            builder: (context) => AlertDialog(
                              title: const Text('Pairing dialog'),
                              actions: [close(context)],
                            ),
                          );
                        } else {
                          Navigator.push<void>(
                            context,
                            MaterialPageRoute(
                              builder: (context) =>
                                  Scaffold(body: close(context)),
                            ),
                          );
                        }
                      },
                      child: Text(modal ? 'Open dialog' : 'Open page'),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

Future<void> showNotice(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 30));
  await tester.pumpAndSettle();
  expect(find.text("What's New"), findsOneWidget);
  expect(find.text('DJL 0.1.0'), findsOneWidget);
}

Future<void> dismiss(WidgetTester tester) async {
  await tester.tap(find.text('Got It'));
  await tester.pumpAndSettle();
}

class DelayedReleaseStore extends MemorySettingsStore {
  final ready = Completer<Map<String, Object>>();
  @override
  Future<Map<String, Object>> read() => ready.future;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          appInfo,
          (call) async => call.method == 'version' ? '0.1.0' : null,
        );
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(appInfo, null);
  });

  testWidgets(
    'waits30 seconds and persists only the installed version on dismissal',
    (tester) async {
      final store = MemorySettingsStore();
      store.values['codex.whatsNew.lastPresentedVersion'] = '1.5';
      store.values['unrelated'] = 'preserved';
      await host(tester, store);
      await tester.pump(const Duration(seconds: 29));
      expect(find.text("What's New"), findsNothing);
      expect(store.values[seenKey], isNull);
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle();
      expect(find.text("What's New"), findsOneWidget);
      expect(find.text('DJL 0.1.0'), findsOneWidget);
      expect(store.values[seenKey], isNull);
      await dismiss(tester);
      expect(store.values[seenKey], '0.1.0');
      expect(store.values['codex.whatsNew.lastPresentedVersion'], '1.5');
      expect(store.values['unrelated'], 'preserved');
      await tester.pumpWidget(const SizedBox.shrink());
      await host(tester, store);
      await tester.pump(const Duration(seconds: 60));
      expect(find.text("What's New"), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'busy state resets quiet time and preempts without recording seen',
    (tester) async {
      final store = MemorySettingsStore(), allowed = ValueNotifier(true);
      await host(tester, store, allowed: allowed);
      await tester.pump(const Duration(seconds: 20));
      allowed.value = false;
      await tester.pump();
      await tester.pump(const Duration(seconds: 60));
      expect(find.text("What's New"), findsNothing);
      allowed.value = true;
      await tester.pump();
      await showNotice(tester);
      allowed.value = false;
      await tester.pumpAndSettle();
      expect(find.text("What's New"), findsNothing);
      expect(store.values[seenKey], isNull);
      allowed.value = true;
      await tester.pump();
      await showNotice(tester);
      await dismiss(tester);
      expect(store.values[seenKey], '0.1.0');
      allowed.dispose();
    },
  );

  for (final modal in [false, true]) {
    testWidgets(
      'another ${modal ? 'dialog' : 'page'} owns the screen and delays announcement',
      (tester) async {
        final store = MemorySettingsStore();
        await host(tester, store);
        await tester.pump(const Duration(seconds: 20));
        await tester.tap(find.text(modal ? 'Open dialog' : 'Open page'));
        await tester.pumpAndSettle();
        await tester.pump(const Duration(seconds: 60));
        expect(find.text("What's New"), findsNothing);
        await tester.tap(find.text('Return to My Macs'));
        await tester.pumpAndSettle();
        await tester.pump(const Duration(seconds: 29));
        expect(find.text("What's New"), findsNothing);
        await tester.pump(const Duration(seconds: 1));
        await tester.pumpAndSettle();
        expect(find.text("What's New"), findsOneWidget);
        await dismiss(tester);
      },
    );
  }

  testWidgets('editable focus defers even without docked keyboard insets', (
    tester,
  ) async {
    final store = MemorySettingsStore();
    await host(tester, store);
    await tester.pump(const Duration(seconds: 20));
    await tester.tap(find.byType(TextField));
    await tester.pumpAndSettle();
    await tester.pump(const Duration(seconds: 60));
    expect(find.text("What's New"), findsNothing);
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();
    await tester.pump(const Duration(seconds: 29));
    expect(find.text("What's New"), findsNothing);
    await tester.pump(const Duration(seconds: 1));
    await tester.pumpAndSettle();
    expect(find.text("What's New"), findsOneWidget);
    await dismiss(tester);
  });

  testWidgets('inactive lifecycle resets the full quiet period', (
    tester,
  ) async {
    final store = MemorySettingsStore();
    await host(tester, store);
    await tester.pump(const Duration(seconds: 20));
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump(const Duration(seconds: 60));
    expect(find.text("What's New"), findsNothing);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump(const Duration(seconds: 29));
    expect(find.text("What's New"), findsNothing);
    await tester.pump(const Duration(seconds: 1));
    await tester.pumpAndSettle();
    expect(find.text("What's New"), findsOneWidget);
    await dismiss(tester);
  });

  testWidgets('pointer interaction pauses and restarts quiet time', (
    tester,
  ) async {
    final store = MemorySettingsStore();
    await host(tester, store);
    await tester.pump(const Duration(seconds: 20));
    final pointer = await tester.startGesture(
      tester.getCenter(find.text('My Macs')),
    );
    await tester.pump(const Duration(seconds: 60));
    expect(find.text("What's New"), findsNothing);
    await pointer.up();
    await tester.pump(const Duration(seconds: 29));
    expect(find.text("What's New"), findsNothing);
    await tester.pump(const Duration(seconds: 1));
    await tester.pumpAndSettle();
    expect(find.text("What's New"), findsOneWidget);
    await dismiss(tester);
  });

  testWidgets(
    'preemption removes only its own sheet while another route survives',
    (tester) async {
      final store = MemorySettingsStore(), allowed = ValueNotifier(true);
      final navigator = GlobalKey<NavigatorState>();
      await host(tester, store, allowed: allowed, navigator: navigator);
      await showNotice(tester);
      unawaited(
        navigator.currentState!.push<void>(
          MaterialPageRoute(
            builder: (_) => const Scaffold(body: Text('Recovery page')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      allowed.value = false;
      await tester.pumpAndSettle();
      expect(find.text('Recovery page'), findsOneWidget);
      expect(store.values[seenKey], isNull);
      navigator.currentState!.pop();
      await tester.pumpAndSettle();
      allowed.value = true;
      await tester.pump();
      await showNotice(tester);
      await dismiss(tester);
      allowed.dispose();
    },
  );

  for (final version in <String?>[null, '99.0.0']) {
    testWidgets(
      'missing or unknown version $version cannot show incorrect notes',
      (tester) async {
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(appInfo, (_) async => version);
        final store = MemorySettingsStore();
        await host(tester, store);
        await tester.pump(const Duration(seconds: 60));
        expect(find.text("What's New"), findsNothing);
        expect(store.values[seenKey], isNull);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'failed persistence never blocks dismissal or repeats this session',
    (tester) async {
      final store = MemorySettingsStore()..failWrite = true;
      await host(tester, store);
      await showNotice(tester);
      await dismiss(tester);
      expect(store.values[seenKey], isNull);
      await tester.pump(const Duration(seconds: 60));
      expect(find.text("What's New"), findsNothing);
      expect(tester.takeException(), isNull);
      store.failWrite = false;
      await tester.pumpWidget(const SizedBox.shrink());
      await host(tester, store);
      await showNotice(tester);
      await dismiss(tester);
      expect(store.values[seenKey], '0.1.0');
    },
  );

  testWidgets('late version result after disposal cannot open a sheet', (
    tester,
  ) async {
    final version = Completer<String?>();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(appInfo, (_) => version.future);
    await host(tester, MemorySettingsStore());
    await tester.pumpWidget(const SizedBox.shrink());
    version.complete('0.1.0');
    await tester.pump();
    await tester.pump(const Duration(seconds: 60));
    expect(find.text("What's New"), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'narrow dark large text keeps Got It pinned and content scrollable',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(320, 640);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);
      final store = MemorySettingsStore();
      await host(tester, store, dark: true, scale: 2.2);
      await showNotice(tester);
      expect(find.text('Got It').hitTestable(), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text("We'll only show this once for each app version."),
        200,
        scrollable: find.descendant(
          of: find.byType(WhatsNewSheet),
          matching: find.byType(Scrollable),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Got It').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
      await dismiss(tester);
      expect(store.values[seenKey], '0.1.0');
    },
  );
  testWidgets('system Back dismissal records the displayed version', (
    tester,
  ) async {
    final store = MemorySettingsStore();
    final navigator = GlobalKey<NavigatorState>();
    await host(tester, store, navigator: navigator);
    await showNotice(tester);
    navigator.currentState!.pop();
    await tester.pumpAndSettle();
    expect(store.values[seenKey], '0.1.0');
    await tester.pump(const Duration(seconds: 60));
    expect(find.text("What's New"), findsNothing);
  });

  for (final failure in ['metadata', 'preferences']) {
    testWidgets('unavailable $failure never blocks the root', (tester) async {
      final store = MemorySettingsStore()..failRead = failure == 'preferences';
      if (failure == 'metadata') {
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(
              appInfo,
              (_) async => throw PlatformException(code: 'unavailable'),
            );
      }
      await host(tester, store);
      await tester.pump(const Duration(seconds: 60));
      expect(find.text('My Macs'), findsOneWidget);
      expect(find.text("What's New"), findsNothing);
      expect(store.values[seenKey], isNull);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('late preference read after disposal cannot open a sheet', (
    tester,
  ) async {
    final store = DelayedReleaseStore();
    await host(tester, store);
    await tester.pumpWidget(const SizedBox.shrink());
    store.ready.complete({});
    await tester.pump();
    await tester.pump(const Duration(seconds: 60));
    expect(find.text("What's New"), findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'actual app announces only in My Macs with no auth or pairing activity',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final credentials = TestCredentials();
      final pairs = PairingRepository(credentials);
      final transport = ObservedPairingTransport(pairs);
      final store = MemorySettingsStore();
      final settings = SettingsController(store);
      final desktop = DesktopController(
        pairs,
        connection: transport,
        localStore: ActivityCacheStore(),
        settings: settings,
      );
      final owner = FakeOwnerAuth()..result = false;
      final lock = AppLockController(owner);
      final requests = <String>[];
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, requests),
          desktop: desktop,
          settings: settings,
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      await openCloudFromDesktop(tester);
      expect(find.text('Welcome to DJL'), findsOneWidget);
      await tester.pump(const Duration(seconds: 60));
      expect(find.text("What's New"), findsNothing);
      await tester.tap(find.text('Pair with a Mac'));
      await tester.pumpAndSettle();
      expect(find.text('Connect to DJL Desktop'), findsOneWidget);
      await showNotice(tester);
      await dismiss(tester);
      expect(store.values[seenKey], '0.1.0');
      expect(owner.calls, 0);
      expect(transport.attempts, 0);
      expect(transport.rpc, isEmpty);
      expect(credentials.values['cloud.session'], isNull);
      expect(credentials.values['desktop.active'], isNull);
      expect(requests.where((call) => call.contains('/v1/auth/')), isEmpty);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      settings.dispose();
      lock.dispose();
    },
  );
  testWidgets(
    'large release sheet fills the available safe area like the source',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(402, 874);
      tester.view.padding = const FakeViewPadding(top: 62, bottom: 34);
      tester.view.viewPadding = const FakeViewPadding(top: 62, bottom: 34);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetPadding);
      addTearDown(tester.view.resetViewPadding);
      await host(tester, MemorySettingsStore());
      await showNotice(tester);
      expect(tester.getRect(find.byType(BottomSheet)).top, closeTo(62, 1));
      expect(tester.getRect(find.text("What's New")).top, closeTo(86, 1));
      expect(tester.getRect(find.text('DJL 0.1.0')).top, closeTo(120, 1));
      expect(
        tester.getRect(find.text('DJL 0.1.0')).height,
        closeTo(18.667, .5),
      );
      expect(
        tester.getRect(find.widgetWithText(TextButton, 'Got It')).bottom,
        lessThanOrEqualTo(816),
      );
      await dismiss(tester);
    },
  );
  testWidgets(
    'native-style grabber dismisses and persists the current version',
    (tester) async {
      final store = MemorySettingsStore();
      await host(tester, store);
      await showNotice(tester);
      final semantics = tester.ensureSemantics();
      await tester.pump();
      expect(
        tester
            .getSemantics(find.bySemanticsLabel('Dismiss release notes'))
            .rect
            .height,
        lessThanOrEqualTo(25),
      );
      await tester.tap(find.bySemanticsLabel('Dismiss release notes'));
      await tester.pumpAndSettle();
      expect(find.text("What's New"), findsNothing);
      expect(store.values[seenKey], '0.1.0');
      semantics.dispose();
    },
  );
}
