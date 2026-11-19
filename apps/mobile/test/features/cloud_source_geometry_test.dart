import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/presentation/djl_glass.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'cloud_composer_draft_page_test.dart' show DraftPageFixture;
import 'cloud_composer_draft_store_test.dart' show DraftCredentials;
import 'voice_controller_test.dart' show TestVoice;

void main() {
  testWidgets(
    'Cloud root uses original compact toolbar and 84-point idle composer',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(402, 874);
      addTearDown(tester.view.reset);
      final fixture = DraftPageFixture(DraftCredentials());
      final chat = ChatController(fixture.repository, accountScope: 'u:o');
      try {
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(Brightness.light),
            home: ChatPage(
              controller: chat,
              voiceDriver: TestVoice(),
              onOpenNavigation: () {},
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.getSize(find.byType(AppBar)).height, 44);
        final navigation = tester.getRect(find.byTooltip('Open navigation'));
        expect(navigation.left, 16);
        expect(navigation.width, 44);
        expect(navigation.height, 44);
        expect(find.byTooltip('Share link'), findsNothing);
        expect(
          tester.widget<Text>(find.text('How can I help?')).style!.fontSize,
          18,
        );
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('composer')))
              .style!
              .fontSize,
          15,
        );
        final picker = find.descendant(
          of: find.byKey(const Key('cloud.model-picker')),
          matching: find.byType(Text),
        );
        expect(tester.widget<Text>(picker).style!.fontSize, 15);
        final semantics = tester.ensureSemantics();
        try {
          expect(
            tester
                .getSemantics(find.byKey(const Key('cloud.model-picker')))
                .getSemanticsData()
                .label,
            'Model',
          );
          expect(
            tester
                .getSemantics(find.byKey(const Key('cloud.model-picker')))
                .getSemanticsData()
                .tooltip,
            isEmpty,
          );
        } finally {
          semantics.dispose();
        }
        expect(find.byIcon(CupertinoIcons.chevron_down), findsOneWidget);
        final composer = find.byType(DjlGlassSurface);
        expect(composer, findsOneWidget);
        expect(tester.widget<DjlGlassSurface>(composer).radius, 26);
        expect(tester.getSize(composer).height, closeTo(84, 1));
        expect(fixture.sends, 0);
        expect(fixture.creates, 0);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        fixture.client.close();
      }
    },
  );
}
