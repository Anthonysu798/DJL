import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:djl_mobile/features/settings/domain/device_owner_auth.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controls.dart';
import 'package:djl_mobile/features/settings/presentation/privacy_shield.dart';
import 'support/native_acceptance.dart';
import 'support/native_auth_acceptance.dart';
import 'cloud_test.dart' show waitFor, nativeSettings;
import 'threads_test.dart' show macs;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets(
    'native saved Mac restores without local app authentication',
    (tester) async {
      final credentials = PlatformCredentialStore();
      final saved = await credentials.read('desktop.trusted');
      expect(saved, isNotNull, reason: 'Prepare a saved local QA Mac first.');
      final identities = (jsonDecode(saved!) as List)
          .map((pair) => (pair['macDeviceId'], pair['macIdentityPublicKey']))
          .toSet();
      expect(identities, isNotEmpty);
      final observed = ObservedDeviceOwnerAuth(NativeDeviceOwnerAuth());
      final lock = AppLockController(observed);
      runApp(
        DjlApp(
          client: CloudClient(
            baseUrl: nativeAcceptanceApi(
              const String.fromEnvironment('DJL_CLOUD_API_URL'),
            ),
            credentials: credentials,
          ),
          appLock: lock,
        ),
      );
      await tester.pump();
      await waitFor(
        tester,
        () => find.byType(PrivacyShield).evaluate().isNotEmpty && lock.ready,
      );
      expect(lock.requiresUnlock, isFalse);
      expect(lock.authenticating, isFalse);
      expect(lock.shielded, isFalse);
      expect(observed.attempts, 0);
      expect(observed.supportChecks, 0);
      expect(find.text('Unlock DJL'), findsNothing);
      final desktop = await macs(tester);
      expect(desktop.trusted, isNotEmpty);
      await nativeSettings(tester);
      expect(find.byType(SettingsControls), findsOneWidget);
      expect(find.text('App lock'), findsNothing);
      Navigator.of(tester.element(find.byType(SettingsControls))).pop();
      await tester.pumpAndSettle();
      final restored = await credentials.read('desktop.trusted');
      expect(
        (jsonDecode(restored!) as List)
            .map((pair) => (pair['macDeviceId'], pair['macIdentityPublicKey']))
            .toSet(),
        identities,
      );
      expect(observed.attempts, 0);
      expect(observed.supportChecks, 0);
      var driverReady = false;
      final deadline = DateTime.now().add(const Duration(seconds: 45));
      while (!driverReady && DateTime.now().isBefore(deadline)) {
        final status =
            jsonDecode(
                  (await http.get(
                    nativeAcceptanceDriverHost(isAndroid: Platform.isAndroid),
                  )).body,
                )
                as Map;
        driverReady = status['driverConnected'] == true;
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(driverReady, isTrue);
      if (!Platform.isAndroid) {
        await binding.takeScreenshot('saved-mac-no-app-authentication');
      }
      // Preserve the legacy runner prefix; this journey never operates biometrics.
      debugPrint('DJL_LOCK_FRAME_READY');
      var captured = false;
      final captureDeadline = DateTime.now().add(const Duration(seconds: 45));
      while (!captured && DateTime.now().isBefore(captureDeadline)) {
        captured =
            (jsonDecode(
                  (await http.get(
                    nativeAcceptanceDriverHost(isAndroid: Platform.isAndroid),
                  )).body,
                )
                as Map)['captured'] ==
            true;
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(captured, isTrue);
      expect(tester.takeException(), isNull);
      debugPrint('DJL_LOCK_FINISHED');
    },
    timeout: const Timeout(Duration(minutes: 3)),
  );
}
