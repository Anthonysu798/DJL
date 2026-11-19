import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'package:djl_mobile/features/chat/presentation/message_view.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import '../../core/cloud_client_test.dart' show TestCredentials;
import '../cloud_deep_links_test.dart' show client;
import '../desktop_threads_controller_test.dart' show ThreadTransport;
import '../desktop_recovery_test.dart' show RecoveryMemoryStore;

void main() {
  testWidgets(
    'Cloud source user text keeps prose font and native neutral bubble',
    (tester) async {
      final cloud = client(TestCredentials(), []);
      try {
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(
              Brightness.light,
              font: AppFontStyle.jetBrainsMono,
              bubble: UserBubbleColor.blue,
            ),
            home: Scaffold(
              body: MessageView(
                message: ChatMessage(
                  id: 'm',
                  role: 'user',
                  parts: [
                    {'type': 'text', 'text': 'Hello \u0060code\u0060'},
                  ],
                ),
                repository: CloudRepository(cloud),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final plain = tester.widget<SelectableText>(
          find.byType(SelectableText),
        );
        expect(plain.data, 'Hello \u0060code\u0060');
        expect(plain.style?.fontFamily, 'JetBrainsMono');
        expect(plain.style?.color, Colors.black);
        expect(find.byType(MarkdownBody), findsNothing);
        final bubble = tester.widget<Container>(
          find.byWidgetPredicate(
            (w) =>
                w is Container &&
                w.decoration is BoxDecoration &&
                (w.decoration as BoxDecoration).borderRadius ==
                    BorderRadius.circular(20),
          ),
        );
        expect(
          (bubble.decoration as BoxDecoration).color,
          const Color(0xfff2f2f7),
        );
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        cloud.close();
      }
    },
  );
  testWidgets(
    'desktop source tint uses selected appearance without changing composer state',
    (tester) async {
      final desktop =
          DesktopController(
              PairingRepository(TestCredentials()),
              connection: ThreadTransport()..online = false,
              localStore: RecoveryMemoryStore(),
            )
            ..active = const Pairing({'macDeviceId': 'qa-mac'})
            ..thread = {'id': 'chat'}
            ..timeline = [
              {'type': 'userMessage', 'id': 'm', 'text': 'Hello `code`'},
            ];
      final selected = ValueNotifier(false);
      await tester.pumpWidget(
        ValueListenableBuilder(
          valueListenable: selected,
          builder: (_, value, _) => MaterialApp(
            theme: djlTheme(
              Brightness.light,
              font: value ? AppFontStyle.jetBrainsMono : AppFontStyle.system,
              bubble: value
                  ? UserBubbleColor.blue
                  : UserBubbleColor.defaultColor,
            ),
            home: DesktopChatPage(controller: desktop),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Unsent draft',
      );
      selected.value = true;
      await tester.pumpAndSettle();
      final bubble = tester.widget<Container>(
        find.byKey(const ValueKey('desktop-user-bubble')),
      );
      expect(
        (bubble.decoration as BoxDecoration).color,
        const Color(0xff007aff).withValues(alpha: .1),
      );
      final markdown = tester.widget<MarkdownBody>(
        find.byType(MarkdownBody).first,
      );
      expect(markdown.styleSheet?.code?.fontFamily, 'JetBrainsMono');
      expect(markdown.styleSheet?.p?.color, const Color(0xff007aff));
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller
            ?.text,
        'Unsent draft',
      );
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
      expect(tester.takeException(), isNull);
    },
  );
}
