import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:djl_mobile/main.dart' as application;
import 'threads_test.dart' show securePairingEntry;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'native launch, email keyboard, back navigation and pairing validation',
    (tester) async {
      application.main();
      if (Platform.isAndroid) {
        await binding.convertFlutterSurfaceToImage();
      }
      await tester.pumpAndSettle();
      expect(find.text('Welcome to DJL'), findsOneWidget);
      await precacheImage(
        const AssetImage('assets/djl-logo.png'),
        tester.element(find.text('Welcome to DJL')),
      );
      await tester.pumpAndSettle();
      await binding.takeScreenshot('welcome');
      await tester.tap(find.text('Continue with email'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('email')));
      await tester.enterText(
        find.byKey(const Key('email')),
        'mobile-qa@example.invalid',
      );
      await tester.pumpAndSettle();
      expect(find.text('Continue with email'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await binding.takeScreenshot('email-keyboard');
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Pair with a Mac'));
      await tester.pumpAndSettle();
      await securePairingEntry(tester);
      await tester.enterText(
        find.byKey(const Key('pairing_payload')),
        'invalid-pairing',
      );
      await tester.ensureVisible(find.text('Pair securely'));
      await tester.tap(find.text('Pair securely'));
      await tester.pumpAndSettle();
      expect(find.textContaining('not a DJL pairing'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
