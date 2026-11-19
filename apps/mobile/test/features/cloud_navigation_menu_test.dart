import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/cloud_navigation.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/conversations/presentation/cloud_navigation_menu.dart';
import 'package:djl_mobile/features/conversations/presentation/conversation_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'cloud_deep_links_test.dart' show client;

void main() {
  testWidgets(
    'Source drawer actions stay usable at narrow phone width and 3x text',
    (tester) async {
      final cloud = client(
        TestCredentials()..values['cloud.session'] = 'session',
        [],
      );
      final history = ConversationController(CloudRepository(cloud));
      final nav = CloudNavigationController()..bindOwner('owner');
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: MediaQuery(
                data: const MediaQueryData(textScaler: TextScaler.linear(3)),
                child: SizedBox(
                  width: 224,
                  child: CloudNavigationMenu(
                    history: history,
                    navigation: nav,
                    onDestination: (_) {},
                    onConversation: (_) {},
                    onNewChat: () {},
                    onRemote: () {},
                    onAction: (_, _, _) async {},
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.widget<Text>(find.text('DJL')).style!.fontSize, 18);
        expect(
          tester.widget<Text>(find.text('Chat').first).style!.fontSize,
          15,
        );
        expect(find.byTooltip('Settings'), findsOneWidget);
        expect(find.byTooltip('New chat'), findsOneWidget);
        expect(find.byTooltip('Search chats'), findsOneWidget);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        nav.dispose();
        history.dispose();
        cloud.close();
      }
    },
  );
}
