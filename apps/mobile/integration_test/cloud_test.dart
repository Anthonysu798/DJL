import 'dart:io';
import 'package:flutter/material.dart';
import 'package:djl_mobile/features/settings/presentation/cloud_settings_page.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:djl_mobile/main.dart' as application;
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'package:djl_mobile/features/chat/presentation/message_view.dart';
import 'package:djl_mobile/features/images/presentation/image_preview_page.dart';
import 'package:djl_mobile/features/auth/presentation/auth_page.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controls.dart';
import 'threads_test.dart' show reveal;

Future<void> waitFor(
  WidgetTester tester,
  bool Function() ready, {
  Duration timeout = const Duration(seconds: 45),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (!ready() && DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 200));
  }
  expect(
    ready(),
    isTrue,
    reason: 'The native service journey did not reach its expected state.',
  );
  await tester.pumpAndSettle();
}

Future<void> nativeAuthInput(
  WidgetTester tester,
  Finder field,
  String value,
) async {
  await reveal(tester, field);
  expect(field.hitTestable(), findsOneWidget);
  final input = tester.widget<TextField>(field);
  expect(input.enabled != false && !input.readOnly, isTrue);
  await tester.tap(field);
  await tester.pumpAndSettle();
  await tester.enterText(field, value);
  await tester.pumpAndSettle();
  expect(
    tester.widget<TextField>(field).controller!.text == value,
    isTrue,
    reason: 'The native auth field must retain the requested input.',
  );
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
  expect(
    tester.widget<TextField>(field).controller!.text == value,
    isTrue,
    reason: 'The native auth field must retain input after unfocus.',
  );
}

Future<void> nativeCloudEntry(WidgetTester tester) async {
  final cloud = find.byTooltip('DJL Cloud');
  final navigation = find.byTooltip('Open navigation');
  bool ready() =>
      find.byType(ChatPage).evaluate().isNotEmpty ||
      find.text('Continue with email').hitTestable().evaluate().isNotEmpty ||
      (find.byType(PairingPage).evaluate().isEmpty &&
          find.byTooltip('New chat').hitTestable().evaluate().isNotEmpty);
  await waitFor(
    tester,
    () =>
        ready() ||
        cloud.hitTestable().evaluate().isNotEmpty ||
        navigation.hitTestable().evaluate().isNotEmpty,
  );
  if (ready()) return;
  if (cloud.hitTestable().evaluate().isNotEmpty) {
    await reveal(tester, cloud);
    expect(cloud.hitTestable(), findsOneWidget);
    await tester.tap(cloud);
  } else {
    await reveal(tester, navigation);
    expect(navigation.hitTestable(), findsOneWidget);
    await tester.tap(navigation);
    final entry = find.text('Cloud chat').hitTestable();
    await waitFor(tester, () => entry.evaluate().isNotEmpty);
    await tester.tap(entry);
  }
  await waitFor(tester, ready);
}

Future<void> nativeSettings(WidgetTester tester) async {
  expect(find.byType(AuthPage), findsNothing);
  final settings = find.byTooltip('Settings');
  final pair = find.text('Pair with a Mac');
  final navigation = find.byTooltip('Open navigation');
  await waitFor(
    tester,
    () =>
        settings.hitTestable().evaluate().isNotEmpty ||
        pair.hitTestable().evaluate().isNotEmpty ||
        navigation.hitTestable().evaluate().isNotEmpty,
  );
  if (settings.hitTestable().evaluate().isEmpty &&
      pair.hitTestable().evaluate().isEmpty &&
      navigation.hitTestable().evaluate().isNotEmpty) {
    await tester.tap(navigation.hitTestable());
    await tester.pumpAndSettle();
  }
  if (settings.evaluate().isEmpty) {
    await reveal(tester, pair);
    expect(pair.hitTestable(), findsOneWidget);
    await tester.tap(pair);
    await waitFor(tester, () => settings.hitTestable().evaluate().isNotEmpty);
  }
  await reveal(tester, settings);
  expect(settings.hitTestable(), findsOneWidget);
  await tester.tap(settings);
  await waitFor(
    tester,
    () =>
        find.byType(SettingsControls).evaluate().isNotEmpty ||
        find.byType(CloudSettingsPage).evaluate().isNotEmpty,
  );
}

Future<void> nativePasswordSignIn(
  WidgetTester tester, {
  required String email,
  required String password,
}) async {
  expect(
    email.isNotEmpty && password.isNotEmpty,
    isTrue,
    reason: 'Disposable local QA credentials are required.',
  );
  if (find.byType(AuthPage).evaluate().isEmpty) {
    final emailEntry = find.text('Continue with email');
    await reveal(tester, emailEntry);
    expect(emailEntry.hitTestable(), findsOneWidget);
    await tester.tap(emailEntry);
    await tester.pumpAndSettle();
  }
  expect(find.byType(AuthPage), findsOneWidget);
  expect(find.byKey(const Key('name')), findsNothing);
  expect(find.byKey(const Key('code')), findsNothing);
  final passwordField = find.byKey(const Key('password'));
  if (passwordField.evaluate().isEmpty) {
    final passwordMethod = find.descendant(
      of: find.byType(AuthPage),
      matching: find.text('Password'),
    );
    await reveal(tester, passwordMethod);
    expect(passwordMethod.hitTestable(), findsOneWidget);
    await tester.tap(passwordMethod);
    await tester.pumpAndSettle();
  }
  expect(passwordField, findsOneWidget);
  final submit = find.byKey(const Key('auth_primary'));
  await reveal(tester, submit);
  expect(
    find.descendant(of: submit, matching: find.text('Sign in')),
    findsOneWidget,
  );
  await nativeAuthInput(tester, find.byKey(const Key('email')), email);
  await nativeAuthInput(tester, passwordField, password);
  await reveal(tester, submit);
  expect(submit.hitTestable(), findsOneWidget);
  expect(tester.widget<TextButton>(submit).onPressed, isNotNull);
  await tester.tap(submit);
  await tester.pumpAndSettle();
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets('native Cloud sign-in, model load, streaming chat and history', (
    tester,
  ) async {
    const email = String.fromEnvironment('DJL_E2E_EMAIL');
    const password = String.fromEnvironment('DJL_E2E_PASSWORD');
    expect(
      email,
      isNotEmpty,
      reason: 'Use only disposable local QA credentials.',
    );
    application.main();
    if (Platform.isAndroid) await binding.convertFlutterSurfaceToImage();
    await nativeCloudEntry(tester);
    if (find.byType(ChatPage).evaluate().isNotEmpty ||
        find.byTooltip('Settings').evaluate().isNotEmpty) {
      await nativeSettings(tester);
      await tester.tap(find.byKey(const Key('cloud.settings.account')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Sign out'));
      await tester.tap(find.text('Sign out'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sign out').last);
      await tester.pumpAndSettle();
    }
    await nativePasswordSignIn(tester, email: email, password: password);
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Open navigation'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('New chat'));
    await tester.pumpAndSettle();
    await waitFor(
      tester,
      () =>
          find.byType(ChatPage).evaluate().isNotEmpty &&
          tester.widget<ChatPage>(find.byType(ChatPage)).controller.model !=
              null &&
          !tester.widget<ChatPage>(find.byType(ChatPage)).controller.loading,
    );
    final message =
        'Native mobile streaming acceptance on ${Platform.operatingSystem}';
    await tester.enterText(find.byKey(const Key('composer')), message);
    await tester.tap(find.byTooltip('Send message'));
    await waitFor(
      tester,
      () => find.byType(MessageView).evaluate().any((e) {
        final row = e.widget as MessageView;
        return row.message.role == 'assistant' && row.message.text.isNotEmpty;
      }),
    );
    await waitFor(
      tester,
      () =>
          tester
              .widget<ChatPage>(find.byType(ChatPage))
              .controller
              .reducer
              ?.status ==
          'succeeded',
    );
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await binding.takeScreenshot('cloud-stream-complete');
    expect(tester.takeException(), isNull);
    await tester.tap(find.byTooltip('Open navigation'));
    await tester.pumpAndSettle();
    expect(find.text('Pinned'), findsOneWidget);
    await binding.takeScreenshot('cloud-history');
    if (find.byTooltip('Settings').evaluate().isEmpty) {
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
    }
    await tester.tap(find.byTooltip('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('cloud.settings.account')));
    await waitFor(tester, () => find.text('Credits').evaluate().isNotEmpty);
    await binding.takeScreenshot('account-usage');
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Open navigation'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Notifications'));
    await tester.pumpAndSettle();
    expect(find.text('Notifications'), findsOneWidget);
    await binding.takeScreenshot('notifications');
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Open navigation'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Images'));
    await waitFor(
      tester,
      () =>
          find.byTooltip('Create image').evaluate().isNotEmpty &&
          tester
                  .widget<IconButton>(
                    find.byWidgetPredicate(
                      (w) => w is IconButton && w.tooltip == 'Create image',
                    ),
                  )
                  .onPressed !=
              null,
    );
    await tester.tap(find.byTooltip('Create image'));
    await waitFor(
      tester,
      () => find.text('Make something yours.').evaluate().isNotEmpty,
    );
    await tester.enterText(
      find.byWidgetPredicate(
        (w) => w is TextField && w.key == const Key('cloud.images.prompt'),
      ),
      'A blue desk from native mobile QA',
    );
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Create image'));
    await waitFor(
      tester,
      () =>
          find.byType(ChatPage).evaluate().isNotEmpty &&
          tester
                  .widget<ChatPage>(find.byType(ChatPage))
                  .controller
                  .reducer
                  ?.status ==
              'succeeded',
    );
    await waitFor(tester, () => find.byType(CloudImage).evaluate().isNotEmpty);
    final image = find.byType(CloudImage).first;
    await tester.ensureVisible(image);
    await tester.tap(image);
    await tester.pumpAndSettle();
    expect(find.byType(ImagePreviewPage), findsOneWidget);
    await tester.tap(find.byTooltip('Save to Photos'));
    await waitFor(
      tester,
      () => find.text('Saved to Photos.').evaluate().isNotEmpty,
    );
    await binding.takeScreenshot('generated-image-saved');
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    if (find.byTooltip('Settings').evaluate().isEmpty) {
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
    }
    await tester.tap(find.byTooltip('Settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('cloud.settings.account')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Sign out'));
    await tester.tap(find.text('Sign out'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign out').last);
    await tester.pumpAndSettle();
    expect(find.text('Continue with email'), findsOneWidget);
  });
}
