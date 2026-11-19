import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/core/security/credential_store.dart';
import 'support/native_acceptance.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'cloud_test.dart' show waitFor, nativeCloudEntry, nativePasswordSignIn;

Future<void> hostPhase(
  WidgetTester tester,
  int expected, {
  bool requireDriver = false,
}) async {
  final deadline = DateTime.now().add(const Duration(seconds: 45));
  var phase = 0;
  var ready = false;
  while (!ready && DateTime.now().isBefore(deadline)) {
    final status =
        (jsonDecode(
              (await http.get(Uri.parse('http://127.0.0.1:8854/phase'))).body,
            )
            as Map);
    phase = status['phase'] as int;
    ready =
        phase >= expected &&
        (!requireDriver || status['driverConnected'] == true);
    await tester.pump(const Duration(milliseconds: 200));
  }
  expect(
    ready,
    isTrue,
    reason: 'The host must deliver the real OS URL before this assertion.',
  );
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets(
    'actual OS cold/warm Cloud conversation links',
    (tester) async {
      const cold = String.fromEnvironment('DJL_QA_LINK_COLD');
      const warm = String.fromEnvironment('DJL_QA_LINK_WARM');
      expect(cold, isNotEmpty);
      expect(warm, isNotEmpty);
      // Test-only seam: production app, credentials and AppLinks, with real
      // local HTTP delegated through a method/path-only request recorder.
      final recorder = ConversationRequestRecorder(http.Client());
      final cloud = CloudClient(
        baseUrl: nativeAcceptanceApi(
          const String.fromEnvironment('DJL_CLOUD_API_URL'),
        ),
        credentials: PlatformCredentialStore(),
        client: recorder,
      );
      runApp(DjlApp(client: cloud));
      await tester.pump();
      debugPrint('DJL_LINK_APP_MOUNTED');
      if (Platform.isAndroid) await binding.convertFlutterSurfaceToImage();
      await hostPhase(tester, 0, requireDriver: true);
      debugPrint('DJL_LINK_DRIVER_READY');
      await nativeCloudEntry(tester);
      if (find.text('Continue with email').evaluate().isNotEmpty) {
        await nativePasswordSignIn(
          tester,
          email: const String.fromEnvironment('DJL_E2E_EMAIL'),
          password: const String.fromEnvironment('DJL_E2E_PASSWORD'),
        );
      }
      bool opened(String id, String title) => find
          .byType(ChatPage)
          .evaluate()
          .any(
            (element) => nativeLinkLoaded(
              (element.widget as ChatPage).controller,
              id,
              title,
            ),
          );
      await waitFor(tester, () => opened(cold, 'Native cold link QA'));
      final client = tester
          .widget<ChatPage>(find.byType(ChatPage))
          .controller
          .repository
          .client;
      expect(identical(client, cloud), isTrue);
      final revision = client.revision;
      expect(recorder.conversationMutationAttempts, 0);
      expect(
        tester.widget<ChatPage>(find.byType(ChatPage)).controller.messages,
        isEmpty,
      );
      await binding.takeScreenshot('links-cold-authenticated');
      debugPrint('DJL_LINK_COLD_VERIFIED');
      await hostPhase(tester, 1);
      await waitFor(tester, () => opened(warm, 'Native warm link QA'));
      expect(recorder.conversationMutationAttempts, 0);
      expect(
        tester.widget<ChatPage>(find.byType(ChatPage)).controller.messages,
        isEmpty,
      );
      await binding.takeScreenshot('links-warm-conversation');
      debugPrint('DJL_LINK_WARM_VERIFIED');
      await hostPhase(tester, 2);
      expect(opened(warm, 'Native warm link QA'), isTrue);
      expect(client.revision, revision);
      expect(await client.signedIn, isTrue);
      expect(tester.takeException(), isNull);
      await binding.takeScreenshot('links-session-preserved');
      expect(recorder.conversationMutationAttempts, 0);
      debugPrint('DJL_LINK_FINISHED');
    },
    timeout: const Timeout(Duration(minutes: 5)),
  );
}
