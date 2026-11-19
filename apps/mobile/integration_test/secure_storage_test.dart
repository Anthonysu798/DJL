import 'dart:io';
import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support/native_credential_phase.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const phase = String.fromEnvironment('DJL_QA_CREDENTIAL_PHASE');
  const cleanupApproved = bool.fromEnvironment(
    'DJL_QA_CREDENTIAL_CLEANUP_APPROVED',
  );
  testWidgets('native credential QA explicit phase', (tester) async {
    if (!kDebugMode || !(Platform.isAndroid || Platform.isIOS)) {
      throw StateError(
        'Native credential QA requires an owned native debug app.',
      );
    }
    // Deliberately do not boot main(), Cloud, pairings or normal app services.
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: Center(child: Text('Native credential QA'))),
      ),
    );
    await tester.runAsync(
      () => runNativeCredentialPhase(
        PlatformCredentialStore(),
        phase,
        android: Platform.isAndroid,
        cleanupApproved: cleanupApproved,
      ),
    );
    final platform = Platform.isAndroid ? 'ANDROID' : 'IOS';
    final marker = switch (phase) {
      'prepare' => 'PREPARED',
      'verify' => 'HEALTHY_VERIFIED',
      'fault-verify' => 'FAULT_READ_VERIFIED',
      'cleanup' => 'CLEANED',
      _ => throw StateError('Native credential QA phase refused.'),
    };
    expect(
      tester.takeException(),
      isNull,
      reason:
          'The native credential phase must complete without framework errors.',
    );
    debugPrint('DJL_NATIVE_CREDENTIAL_${platform}_$marker');
  });
}
