import '../support/open_cloud.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'settings/settings_controller_test.dart' show MemorySettingsStore;
import 'social_auth_controller_test.dart' show ControlledSocialIdentity;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets(
    'reduced-motion welcome still reaches the real code-first form and back route',
    (tester) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(
        tester.platformDispatcher.clearAccessibilityFeaturesTestValue,
      );
      final cloud = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: TestCredentials(),
        client: MockClient((_) async => http.Response('{"auth":{}}', 200)),
      );
      await tester.pumpWidget(
        DjlApp(
          client: cloud,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      await openCloudFromDesktop(tester);
      expect(
        MediaQuery.disableAnimationsOf(
          tester.element(find.text('Welcome to DJL')),
        ),
        isTrue,
      );
      await tester.tap(find.text('Continue with email'));
      await tester.pumpAndSettle();
      expect(find.text('Email me a code'), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Welcome to DJL'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'source welcome has no invented footer or gear and My Macs retains real Settings access',
    (tester) async {
      final requests = <String>[];
      final cloud = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: TestCredentials(),
        client: MockClient((r) async {
          requests.add(r.url.path);
          return http.Response('{"auth":{"apple":false,"google":false}}', 200);
        }),
      );
      await tester.pumpWidget(
        DjlApp(
          client: cloud,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      await openCloudFromDesktop(tester);
      expect(find.text('Welcome to DJL'), findsOneWidget);
      expect(
        find.text('Private conversations. Connected workflows.'),
        findsNothing,
      );
      expect(find.byTooltip('Settings'), findsNothing);
      expect(find.text('Terms'), findsNothing);
      expect(find.text('Privacy'), findsNothing);
      await tester.tap(find.text('Pair with a Mac'));
      await tester.pumpAndSettle();
      expect(find.byType(PairingPage), findsOneWidget);
      expect(find.byTooltip('Settings'), findsOneWidget);
      expect(find.text('Pair with Code'), findsOneWidget);
      await tester.tap(find.byTooltip('Settings'));
      await tester.pumpAndSettle();
      expect(find.text('Appearance'), findsOneWidget);
      expect(requests, ['/v1/client-config']);
      await tester.pumpWidget(const SizedBox());
    },
  );
  for (final size in [
    const Size(360, 800),
    const Size(402, 874),
    const Size(411, 923),
  ]) {
    for (final dark in [false, true]) {
      for (final mono in [false, true]) {
        testWidgets(
          'welcome actions remain reachable ${size.width} dark=$dark mono=$mono keyboard/large=$mono',
          (tester) async {
            tester.view.devicePixelRatio = 2;
            tester.view.physicalSize = size * 2;
            tester.view.padding = const FakeViewPadding(top: 88, bottom: 48);
            tester.view.viewPadding = const FakeViewPadding(
              top: 88,
              bottom: 48,
            );
            tester.view.viewInsets = FakeViewPadding(bottom: mono ? 600 : 0);
            tester.platformDispatcher.textScaleFactorTestValue = mono ? 1.7 : 1;
            addTearDown(tester.view.reset);
            addTearDown(
              tester.platformDispatcher.clearTextScaleFactorTestValue,
            );
            final settings = SettingsController(
              MemorySettingsStore()
                ..values.addAll({
                  SettingsController.themeKey: dark ? 'dark' : 'light',
                  SettingsController.fontKey: mono ? 'geistMono' : 'system',
                }),
            );
            final cloud = CloudClient(
              baseUrl: Uri.parse('https://example.test'),
              credentials: TestCredentials(),
              client: MockClient(
                (_) async => http.Response(
                  '{"auth":{"apple":true,"google":true},"policyUrls":{"terms":"https://example.test/terms","privacy":"https://example.test/privacy"}}',
                  200,
                ),
              ),
            );
            await tester.pumpWidget(
              DjlApp(
                client: cloud,
                settings: settings,
                socialIdentity: ControlledSocialIdentity(),
                linkStream: const Stream.empty(),
                initialLink: Future.value(null),
              ),
            );
            await tester.pumpAndSettle();
            await openCloudFromDesktop(tester);
            for (final label in [
              'Continue with Google',
              'Continue with email',
              'Pair with a Mac',
              'Terms',
              'Privacy',
            ]) {
              await tester.ensureVisible(find.text(label));
              await tester.pumpAndSettle();
              expect(find.text(label).hitTestable(), findsOneWidget);
              expect(
                tester.getRect(find.text(label)).bottom,
                lessThanOrEqualTo(size.height - (mono ? 300 : 24) + .1),
              );
            }
            final context = tester.element(find.text('Welcome to DJL'));
            expect(
              Theme.of(context).brightness,
              dark ? Brightness.dark : Brightness.light,
            );
            expect(
              Theme.of(context).textTheme.bodyMedium?.fontFamily,
              mono ? 'GeistMono' : ThemeData().textTheme.bodyMedium?.fontFamily,
            );
            expect(
              settings.font,
              mono ? AppFontStyle.geistMono : AppFontStyle.system,
            );
            expect(tester.takeException(), isNull);
            await tester.pumpWidget(const SizedBox());
            settings.dispose();
          },
        );
      }
    }
  }
}
