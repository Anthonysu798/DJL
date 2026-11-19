import 'dart:convert';
import 'dart:io';
import 'package:djl_mobile/app/cloud_navigation.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/core/presentation/djl_glass.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'package:djl_mobile/features/conversations/presentation/cloud_navigation_menu.dart';
import 'package:djl_mobile/features/conversations/presentation/cloud_chat_actions.dart';
import 'package:djl_mobile/features/conversations/presentation/conversation_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

void main() {
  final reference =
      jsonDecode(
            File(
              'test/fixtures/cloud_menu_native_geometry.json',
            ).readAsStringSync(),
          )
          as Map;
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    for (final pinned in [true, false]) {
      testWidgets(
        'Cloud context preview and native placement: $platform/$pinned',
        (tester) async {
          final f = await mountCloudMenu(tester, platform);
          final title = pinned ? 'Cloud pinned QA' : 'Cloud recent QA';
          final row = find
              .ancestor(of: find.text(title), matching: find.byType(InkWell))
              .first;
          final original = tester.getRect(row);
          await tester.longPress(find.text(title));
          await tester.pumpAndSettle();
          final menu = tester.getRect(
            find.byKey(const Key('cloud-chat-actions')),
          );
          final action = tester.getRect(
            find.widgetWithText(TextButton, pinned ? 'Unpin' : 'Pin'),
          );
          final expected =
              reference[pinned
                      ? 'pinned_first_action'
                      : 'selected_first_action']
                  as List;
          expect(action.left, closeTo((expected[0] as num).toDouble(), 1));
          expect(action.top, closeTo((expected[1] as num).toDouble(), 1));
          expect(menu.width, reference['action_width']);
          expect(action.height, reference['action_height']);
          final preview = tester.getRect(
            find.byKey(const Key('navigation.context-preview')),
          );
          expect(preview.width, closeTo(original.width * 1.1, .01));
          expect(preview.height, closeTo(original.height * 1.1, .01));
          expect(
            tester
                .widget<Opacity>(
                  find.byKey(
                    ValueKey(
                      'cloud.navigation.paint.${pinned ? 'cloud-pinned' : 'cloud-recent'}',
                    ),
                  ),
                )
                .opacity,
            0,
          );
          if (pinned) {
            expect(menu.top, greaterThan(preview.bottom));
          } else {
            expect(menu.bottom, lessThan(preview.top));
          }
          await tester.binding.handlePopRoute();
          await tester.pumpAndSettle();
          expect(
            find.byKey(const Key('navigation.context-preview')),
            findsNothing,
          );
          expect(f.actions, isEmpty);
          expect(tester.takeException(), isNull);
        },
        variant: TargetPlatformVariant({platform}),
      );
    }

    testWidgets(
      'Cloud owner change dismisses the owned preview on $platform',
      (tester) async {
        final f = await mountCloudMenu(tester, platform);
        await tester.longPress(find.text('Cloud recent QA'));
        await tester.pumpAndSettle();
        f.navigation.bindOwner('replacement');
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('cloud-chat-actions')), findsNothing);
        expect(
          find.byKey(const Key('navigation.context-preview')),
          findsNothing,
        );
        expect(
          tester
              .widget<Opacity>(
                find.byKey(
                  const ValueKey('cloud.navigation.paint.cloud-recent'),
                ),
              )
              .opacity,
          1,
        );
        expect(
          djlNativeGlassOverlays(
            tester.state<NavigatorState>(find.byType(Navigator).first),
          ).value,
          0,
        );
        expect(f.actions, isEmpty);
        expect(tester.takeException(), isNull);
      },
      variant: TargetPlatformVariant({platform}),
    );

    testWidgets(
      'Cloud context actions scroll above a narrow keyboard on $platform',
      (tester) async {
        tester.view.physicalSize = const Size(320, 640);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        String? result;
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(Brightness.dark),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: TextScaler.linear(3),
                viewInsets: const EdgeInsets.only(bottom: 280),
              ),
              child: child!,
            ),
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () async {
                    result = await showCloudChatActions(
                      context,
                      const Conversation(id: 'owned'),
                      const Rect.fromLTWH(10, 80, 260, 50),
                      preview: const SizedBox(width: 260, height: 50),
                    );
                  },
                  child: const Text('Actions'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Actions'));
        await tester.pumpAndSettle();
        final menu = tester.getRect(
          find.byKey(const Key('cloud-chat-actions')),
        );
        expect(menu.top, greaterThanOrEqualTo(10));
        expect(menu.bottom, lessThanOrEqualTo(350));
        await tester.ensureVisible(find.text('Delete'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Delete'));
        await tester.pumpAndSettle();
        expect(result, 'delete');
        expect(tester.takeException(), isNull);
      },
      variant: TargetPlatformVariant({platform}),
    );
  }
}

class CloudMenuFixture {
  final navigation = CloudNavigationController()
    ..bindOwner('owner')
    ..open('cloud-recent');
  final actions = <String>[];
}

Future<CloudMenuFixture> mountCloudMenu(
  WidgetTester tester,
  TargetPlatform platform,
) async {
  tester.view.physicalSize = const Size(402, 874);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final f = CloudMenuFixture();
  final client = CloudClient(
    baseUrl: Uri.parse('https://qa.test/'),
    credentials: TestCredentials(),
  );
  final repository = CloudRepository(client);
  final history = ConversationController(repository)
    ..items = const [
      Conversation(id: 'cloud-pinned', title: 'Cloud pinned QA', pinned: true),
      Conversation(id: 'cloud-recent', title: 'Cloud recent QA'),
    ];
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    history.dispose();
    f.navigation.dispose();
    repository.modelSelection.dispose();
    client.close();
  });
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(Brightness.light).copyWith(platform: platform),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          padding: const EdgeInsets.only(top: 62, bottom: 34),
          viewPadding: const EdgeInsets.only(top: 62, bottom: 34),
        ),
        child: child!,
      ),
      home: Scaffold(
        body: Align(
          alignment: Alignment.topLeft,
          child: SizedBox(
            width: 281.4,
            child: CloudNavigationMenu(
              history: history,
              navigation: f.navigation,
              onDestination: (_) {},
              onConversation: (_) {},
              onNewChat: () {},
              onRemote: () {},
              onAction: (_, action, _) async {
                f.actions.add(action);
              },
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return f;
}
