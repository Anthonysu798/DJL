import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/settings/presentation/privacy_shield.dart';
import '../cloud_test.dart' show waitFor;

/// Waits for real startup/privacy state; the host operates any native auth sheet.
Future<void> waitForNativeAppReady(WidgetTester tester, String prefix) async {
  final shield = find.byType(PrivacyShield);
  await waitFor(
    tester,
    () =>
        shield.evaluate().isNotEmpty &&
        tester.widget<PrivacyShield>(shield).controller.ready,
  );
  final lock = tester.widget<PrivacyShield>(shield).controller;
  if (lock.requiresUnlock) debugPrint('${prefix}_UNLOCK_READY');
  await waitFor(
    tester,
    () => !lock.shielded && !lock.authenticating,
    timeout: const Duration(seconds: 90),
  );
}
