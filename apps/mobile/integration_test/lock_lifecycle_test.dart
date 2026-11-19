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
import 'package:djl_mobile/features/settings/presentation/privacy_shield.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'support/native_acceptance.dart';
import 'support/native_auth_acceptance.dart';
import 'cloud_test.dart' show waitFor;
import 'threads_test.dart' show macs;

class _Life with WidgetsBindingObserver {
  final states = <AppLifecycleState>[];
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    states.add(state);
    debugPrint('DJL_PRIVACY_LIFECYCLE_${state.name}');
  }
}

Future<Map> _host() async =>
    jsonDecode(
          (await http.get(
            nativeAcceptanceDriverHost(isAndroid: Platform.isAndroid),
          )).body,
        )
        as Map;
Future<int> _turns(Uri endpoint) async =>
    (jsonDecode((await http.get(endpoint.replace(path: '/qa/state'))).body)
            as Map)['turnStartCount']
        as int;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  Future<void> capture(String name) async {
    // Keep Android's production SurfaceView; the host captures native frames.
    if (!Platform.isAndroid) await binding.takeScreenshot(name);
  }

  testWidgets(
    'native private snapshots and short and five-minute resume without app auth',
    (tester) async {
      final life = _Life();
      WidgetsBinding.instance.addObserver(life);
      addTearDown(() => WidgetsBinding.instance.removeObserver(life));
      final observed = ObservedDeviceOwnerAuth(NativeDeviceOwnerAuth());
      final lock = AppLockController(observed);
      runApp(
        DjlApp(
          client: CloudClient(
            baseUrl: nativeAcceptanceApi(
              const String.fromEnvironment('DJL_CLOUD_API_URL'),
            ),
            credentials: PlatformCredentialStore(),
          ),
          appLock: lock,
        ),
      );
      await tester.pump();
      var driver = false;
      final deadline = DateTime.now().add(const Duration(seconds: 45));
      while (!driver && DateTime.now().isBefore(deadline)) {
        driver = (await _host())['driverConnected'] == true;
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(driver, isTrue);
      await waitFor(
        tester,
        () => find.byType(PrivacyShield).evaluate().isNotEmpty && lock.ready,
      );
      expect(lock.requiresUnlock, isFalse);
      expect(observed.attempts, 0);
      expect(observed.supportChecks, 0);
      await waitFor(
        tester,
        () => !lock.shielded && !lock.authenticating,
        timeout: const Duration(seconds: 90),
      );
      expect(observed.attempts, 0);
      final desktop = await macs(tester);
      final pair = desktop.active;
      expect(
        pair,
        isNotNull,
        reason: 'Prepare a saved local QA fixture first.',
      );
      expect(pair!.macDeviceId.startsWith('desktop-qa-'), isTrue);
      final endpoint = nativeAcceptanceApi(
        pair.relay.replace(scheme: 'http', path: '').toString(),
      );
      await waitFor(tester, () => desktop.runtimeReady);
      final thread = desktop.threadList.data.find('native-thread-1');
      expect(thread, isNotNull, reason: 'Use the disposable native QA thread.');
      await desktop.openThread(thread!);
      Navigator.of(tester.element(find.byType(PairingPage))).push<void>(
        MaterialPageRoute(builder: (_) => DesktopChatPage(controller: desktop)),
      );
      await waitFor(
        tester,
        () => find.byType(DesktopChatPage).evaluate().isNotEmpty,
      );
      String draft() => tester
          .widget<TextField>(find.byKey(const Key('desktop_composer')))
          .controller!
          .text;
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'DJL_QA_PRIVATE_RESUME_DRAFT',
      );
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      expect(draft(), 'DJL_QA_PRIVATE_RESUME_DRAFT');
      final turns = await _turns(endpoint);
      final initialCalls = observed.attempts;
      expect(initialCalls, 0);
      expect(observed.supportChecks, 0);
      await capture('privacy-before-background');
      life.states.clear();
      final shortStart = DateTime.now();
      debugPrint('DJL_PRIVACY_SHORT_BACKGROUND_READY');
      await waitFor(
        tester,
        () =>
            life.states.contains(AppLifecycleState.paused) &&
            WidgetsBinding.instance.lifecycleState ==
                AppLifecycleState.paused &&
            lock.shielded &&
            !lock.requiresUnlock,
        timeout: const Duration(seconds: 90),
      );
      await waitFor(
        tester,
        () =>
            WidgetsBinding.instance.lifecycleState ==
                AppLifecycleState.resumed &&
            !lock.shielded,
        timeout: const Duration(seconds: 90),
      );
      expect(
        DateTime.now().difference(shortStart),
        lessThan(const Duration(seconds: 300)),
      );
      expect(lock.requiresUnlock, isFalse);
      expect(observed.attempts, initialCalls);
      expect(draft(), 'DJL_QA_PRIVATE_RESUME_DRAFT');
      await capture('privacy-short-resumed');
      life.states.clear();
      final longStart = DateTime.now();
      debugPrint('DJL_PRIVACY_LONG_BACKGROUND_READY');
      await waitFor(
        tester,
        () =>
            life.states.contains(AppLifecycleState.paused) &&
            WidgetsBinding.instance.lifecycleState ==
                AppLifecycleState.paused &&
            lock.shielded &&
            !lock.requiresUnlock,
        timeout: const Duration(minutes: 7),
      );
      await waitFor(
        tester,
        () =>
            life.states.contains(AppLifecycleState.resumed) &&
            observed.attempts == 0 &&
            !lock.requiresUnlock &&
            !lock.shielded &&
            !lock.authenticating,
        timeout: const Duration(minutes: 7),
      );
      expect(
        DateTime.now().difference(longStart),
        greaterThanOrEqualTo(const Duration(seconds: 300)),
      );
      expect(lock.shielded, isFalse);
      expect(lock.requiresUnlock, isFalse);
      expect(observed.attempts, 0);
      expect(observed.supportChecks, 0);
      expect(find.text('Unlock DJL'), findsNothing);
      expect(draft(), 'DJL_QA_PRIVATE_RESUME_DRAFT');
      expect(await _turns(endpoint), turns);
      await capture('privacy-long-resumed');
      debugPrint('DJL_PRIVACY_FRAME_READY');
      var captured = false;
      final captureDeadline = DateTime.now().add(const Duration(seconds: 45));
      while (!captured && DateTime.now().isBefore(captureDeadline)) {
        captured = (await _host())['captured'] == true;
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(captured, isTrue);
      expect(tester.takeException(), isNull);
      // Keep existing secure pairing and saved test state for cold restoration.
      debugPrint('DJL_PRIVACY_FINISHED');
    },
    timeout: const Timeout(Duration(minutes: 12)),
  );
}
