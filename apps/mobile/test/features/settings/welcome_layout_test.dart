import '../../support/open_cloud.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import '../../core/cloud_client_test.dart' show TestCredentials;
import '../cloud_deep_links_test.dart' show client;
import 'settings_controller_test.dart' show MemorySettingsStore;
import 'app_lock_controller_test.dart' show FakeOwnerAuth;
import 'app_settings_lock_test.dart' show savedPair;

Future<AppLockController> mountWelcome(
  WidgetTester tester, {
  bool shielded = false,
}) async {
  final credentials = TestCredentials();
  if (shielded) credentials.values['desktop.trusted'] = savedPair();
  final store = MemorySettingsStore()
    ..values.addAll({SettingsController.fontKey: 'geistMono'});
  final settings = SettingsController(store);
  final owner = FakeOwnerAuth();
  if (shielded) owner.pending = Completer<bool>();
  final lock = AppLockController(owner);
  addTearDown(() async {
    if (owner.pending != null && !owner.pending!.isCompleted) {
      owner.pending!.complete(false);
    }
    await tester.pumpWidget(const SizedBox());
    settings.dispose();
    lock.dispose();
  });
  await tester.pumpWidget(
    DjlApp(
      client: client(credentials, []),
      settings: settings,
      appLock: lock,
      linkStream: const Stream.empty(),
      initialLink: Future.value(null),
    ),
  );
  await tester.pumpAndSettle();
  await openCloudFromDesktop(tester);
  expect(settings.font, AppFontStyle.geistMono);
  return lock;
}

void size(WidgetTester tester, Size logical, {double inset = 0}) {
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = logical * 2;
  tester.view.viewInsets = FakeViewPadding(bottom: inset * 2);
  addTearDown(tester.view.reset);
}

Finder welcomeAction(String label) => find.ancestor(
  of: find.text(label),
  matching: find.byWidgetPredicate((widget) => widget is TextButton),
);

Future<void> reachable(
  WidgetTester tester,
  Finder button,
  double bottom,
) async {
  await tester.ensureVisible(button);
  await tester.pumpAndSettle();
  expect(button.hitTestable(), findsOneWidget);
  expect(tester.getRect(button).bottom, lessThanOrEqualTo(bottom + .1));
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final shielded in [false, true]) {
    testWidgets(
      'native-sized welcome with 300 logical keyboard inset, hasSavedMac=$shielded',
      (tester) async {
        size(tester, const Size(360, 800), inset: 300);
        final semantics = tester.ensureSemantics();
        try {
          final lock = await mountWelcome(tester, shielded: shielded);
          expect(find.text('Welcome to DJL'), findsOneWidget);
          expect(lock.shielded, isFalse);
          expect(lock.requiresUnlock, isFalse);
          expect(lock.authenticating, isFalse);
          await reachable(tester, welcomeAction('Continue with email'), 500);
          await reachable(tester, welcomeAction('Pair with a Mac'), 500);
          expect(tester.takeException(), isNull);
        } finally {
          semantics.dispose();
        }
      },
    );
  }
  testWidgets(
    'small welcome retains large text and makes both actions reachable',
    (tester) async {
      size(tester, const Size(320, 568));
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await mountWelcome(tester);
      final context = tester.element(find.text('Welcome to DJL'));
      expect(MediaQuery.textScalerOf(context).scale(10), 20);
      expect(Theme.of(context).textTheme.bodyMedium?.fontFamily, 'GeistMono');
      expect(tester.takeException(), isNull);
      await reachable(tester, welcomeAction('Continue with email'), 568);
      await reachable(tester, welcomeAction('Pair with a Mac'), 568);
      expect(find.byTooltip('Settings'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('tall welcome preserves balanced spacing and bottom padding', (
    tester,
  ) async {
    size(tester, const Size(360, 900));
    await mountWelcome(tester);
    final logo = tester.getRect(
      find.byWidgetPredicate(
        (widget) => widget is Image && widget.semanticLabel == 'DJL',
      ),
    );
    expect(find.byType(AppBar), findsNothing);
    final body = tester.getRect(
      find.text('Your ideas, conversations, and Mac.\nTogether in DJL.'),
    );
    final email = tester.getRect(welcomeAction('Continue with email'));
    final pair = tester.getRect(welcomeAction('Pair with a Mac'));
    final topGap = logo.top;
    final secondGap = email.top - body.bottom;
    expect(topGap, greaterThan(0));
    expect(secondGap, closeTo(topGap, .1));
    final noMac = tester.getRect(find.byKey(const Key('welcome.noMac')));
    expect(noMac.bottom, closeTo(876, .1));
    expect(pair.bottom, lessThanOrEqualTo(noMac.top));
    expect(welcomeAction('Continue with email').hitTestable(), findsOneWidget);
    expect(welcomeAction('Pair with a Mac').hitTestable(), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
