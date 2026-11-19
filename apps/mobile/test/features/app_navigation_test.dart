import '../support/open_cloud.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:http/http.dart' as http;
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import '../../integration_test/threads_test.dart' show securePairingEntry;
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets(
    'welcome, sign-in keyboard layout, back, and manual pairing navigation',
    (tester) async {
      final client = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: TestCredentials(),
        client: MockClient((_) async => http.Response('{}', 200)),
      );
      await tester.pumpWidget(DjlApp(client: client));
      await tester.pumpAndSettle();
      await openCloudFromDesktop(tester);
      expect(find.text('Welcome to DJL'), findsOneWidget);
      await tester.tap(find.text('Continue with email'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('email')));
      await tester.pumpAndSettle();
      expect(find.text('Continue with email'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Pair with a Mac'));
      await tester.pumpAndSettle();
      expect(find.byType(PairingPage), findsOneWidget);
      expect(find.byTooltip('Settings'), findsOneWidget);
      expect(find.text('Pair with Code'), findsOneWidget);
      await securePairingEntry(tester);
      await tester.enterText(
        find.byKey(const Key('pairing_payload')),
        'invalid',
      );
      await tester.ensureVisible(find.text('Pair securely'));
      await tester.tap(find.text('Pair securely'));
      await tester.pumpAndSettle();
      expect(find.textContaining('not a DJL pairing'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
