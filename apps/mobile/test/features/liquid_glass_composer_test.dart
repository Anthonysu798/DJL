import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'cloud_composer_draft_page_test.dart' show DraftPageFixture;
import 'cloud_composer_draft_store_test.dart' show DraftCredentials;
import 'voice_controller_test.dart' show TestVoice;

void main() {
  testWidgets(
    'The source glass preference reaches the native composer without losing its draft or controls',
    (tester) async {
      final creations = <Map<dynamic, dynamic>>[];
      final messenger = tester.binding.defaultBinaryMessenger;
      const info = MethodChannel('djl.mobile/app-info');
      const views = MethodChannel('flutter/platform_views');
      messenger.setMockMethodCallHandler(
        info,
        (call) async => call.method == 'supportsLiquidGlass' ? true : null,
      );
      messenger.setMockMethodCallHandler(views, (call) async {
        if (call.method == 'create') {
          final args = call.arguments as Map;
          if (args['viewType'] == 'djl.mobile/glass') {
            creations.add(
              const StandardMessageCodec().decodeMessage(
                    ByteData.sublistView(args['params'] as Uint8List),
                  )
                  as Map,
            );
          }
        }
        return null;
      });
      final fixture = DraftPageFixture(DraftCredentials());
      final chat = ChatController(fixture.repository, accountScope: 'u:o');
      final page = ChatPage(controller: chat, voiceDriver: TestVoice());
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox.shrink());
        fixture.client.close();
        messenger.setMockMethodCallHandler(info, null);
        messenger.setMockMethodCallHandler(views, null);
      });
      Future<void> show(bool glass) async {
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(Brightness.light, liquidGlass: glass),
            home: page,
          ),
        );
        await tester.pumpAndSettle();
      }

      await show(true);
      expect(creations, hasLength(1));
      expect(creations.single['enabled'], true);
      expect(creations.single['dark'], false);
      expect(creations.single['radius'], 26);
      await tester.enterText(
        find.byKey(const Key('composer')),
        'Owned unsent draft',
      );
      await tester.pumpAndSettle();
      await show(false);
      expect(creations, hasLength(2));
      expect(creations.last['enabled'], false);
      expect(find.text('Owned unsent draft'), findsOneWidget);
      await tester.tap(find.byTooltip('Task mode'));
      await tester.pumpAndSettle();
      expect(chat.mode, 'task');
      expect(find.text('Owned unsent draft'), findsOneWidget);
      expect(fixture.posts, 0);
      expect(tester.takeException(), isNull);
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );
}
