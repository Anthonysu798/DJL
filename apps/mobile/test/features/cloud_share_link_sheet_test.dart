import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'cloud_composer_draft_store_test.dart' show DraftCredentials;
import 'voice_controller_test.dart' show TestVoice;

const shareUrl = 'https://qa.invalid/s/owned-snapshot';
final shareHeader = find.byWidgetPredicate(
  (widget) =>
      widget is IconButton && (widget.tooltip?.startsWith('Share') ?? false),
);

class ShareFixture {
  ShareFixture({bool held = false}) {
    if (held) reply = Completer<http.Response>();
    credentials.values['cloud.session'] = 'qa-session';
    client = CloudClient(
      baseUrl: Uri.parse('https://qa.invalid'),
      credentials: credentials,
      client: MockClient((request) async {
        switch (request.url.path) {
          case '/v1/auth/token':
            return http.Response('{"token":"jwt"}', 200);
          case '/v1/models':
            return http.Response(
              '{"models":[{"id":"m","displayName":"Model","provider":"anthropic","status":"active","capabilities":["text.chat"]}]}',
              200,
            );
          case '/v1/client-config':
            return http.Response('{"tools":{}}', 200);
          case '/v1/conversations/c':
            return http.Response(
              '{"conversation":{"id":"c"},"messages":[{"id":"u","role":"user","parentId":null,"parts":[{"type":"text","text":"Owned question"}]},{"id":"a","role":"assistant","parentId":"u","parts":[{"type":"text","text":"Owned answer"}]}]}',
              200,
            );
          case '/v1/conversations/c/shares':
            expect(request.method, 'POST');
            expect(jsonDecode(request.body), {'messageId': 'a'});
            shares++;
            return reply?.future ??
                http.Response(jsonEncode({'url': shareUrl}), 201);
          default:
            throw StateError('Unexpected QA request ${request.url.path}');
        }
      }),
    );
    chat = ChatController(
      CloudRepository(client),
      accountScope: 'u:o',
      conversation: const Conversation(id: 'c'),
    );
  }

  final credentials = DraftCredentials();
  late final CloudClient client;
  late final ChatController chat;
  Completer<http.Response>? reply;
  int shares = 0;
  final copied = <String>[];
  final nativeShares = <MethodCall>[];
  bool nativeFailure = false;

  Future<void> open(WidgetTester tester) async {
    final messenger = tester.binding.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') {
        copied.add((call.arguments as Map)['text'] as String);
      }
      return null;
    });
    const channel = MethodChannel('dev.fluttercommunity.plus/share');
    messenger.setMockMethodCallHandler(channel, (call) async {
      nativeShares.add(call);
      if (nativeFailure) throw PlatformException(code: 'QA_SHARE_FAILED');
      return '';
    });
    addTearDown(() async {
      if (reply != null && !reply!.isCompleted) {
        reply!.complete(
          http.Response('{"error":{"message":"QA stopped"}}', 400),
        );
        await tester.pumpAndSettle();
      }
      await tester.pumpWidget(const SizedBox.shrink());
      client.close();
      messenger.setMockMethodCallHandler(SystemChannels.platform, null);
      messenger.setMockMethodCallHandler(channel, null);
    });
    await tester.pumpWidget(
      MaterialApp(
        theme: djlTheme(Brightness.light),
        home: ChatPage(controller: chat, voiceDriver: TestVoice()),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> review(WidgetTester tester) async {
    await open(tester);
    await tester.tap(shareHeader);
    await tester.pumpAndSettle();
  }
}

void main() {
  testWidgets(
    'Creating a share opens its review without copying or invoking native sharing',
    (tester) async {
      final fixture = ShareFixture();
      await fixture.review(tester);
      expect(fixture.shares, 1);
      expect(fixture.copied, isEmpty);
      expect(fixture.nativeShares, isEmpty);
      expect(find.text('Share link created'), findsOneWidget);
      expect(
        find.text(
          "Anyone with the link can read this chat as it is now. Messages you send later aren't shared.",
        ),
        findsOneWidget,
      );
      expect(find.text(shareUrl), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('Copy link writes only the reviewed URL and reports Copied', (
    tester,
  ) async {
    final fixture = ShareFixture();
    await fixture.review(tester);
    await tester.tap(find.text('Copy link'));
    await tester.pumpAndSettle();
    expect(fixture.copied, [shareUrl]);
    expect(find.text('Copied'), findsOneWidget);
    expect(fixture.nativeShares, isEmpty);
    expect(fixture.shares, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'Share explicitly opens the native URI sheet with a real anchor and tolerates dismissal',
    (tester) async {
      final fixture = ShareFixture();
      await fixture.review(tester);
      await tester.tap(find.text('Share'));
      await tester.pumpAndSettle();
      expect(fixture.nativeShares, hasLength(1));
      expect(fixture.nativeShares.single.method, 'share');
      final arguments = fixture.nativeShares.single.arguments as Map;
      expect(arguments['uri'], shareUrl);
      expect(arguments['originWidth'], greaterThan(0));
      expect(arguments['originHeight'], greaterThan(0));
      expect(fixture.copied, isEmpty);
      expect(fixture.shares, 1);
      expect(find.text('Share link created'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'A failed native sheet remains recoverable without creating another public link',
    (tester) async {
      final fixture = ShareFixture()..nativeFailure = true;
      await fixture.review(tester);
      await tester.tap(find.text('Share'));
      await tester.pumpAndSettle();
      expect(fixture.nativeShares, hasLength(1));
      expect(find.text('Could not open sharing. Try again.'), findsOneWidget);
      fixture.nativeFailure = false;
      await tester.tap(find.text('Share'));
      await tester.pumpAndSettle();
      expect(fixture.nativeShares, hasLength(2));
      expect(fixture.shares, 1);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'The share header disables duplicate requests while one link is being created',
    (tester) async {
      final fixture = ShareFixture(held: true);
      await fixture.open(tester);
      await tester.tap(shareHeader);
      await tester.pump();
      expect(fixture.shares, 1);
      expect(tester.widget<IconButton>(shareHeader).onPressed, isNull);
      expect(await fixture.chat.share(), isNull);
      expect(fixture.shares, 1);
      fixture.reply!.complete(
        http.Response(jsonEncode({'url': shareUrl}), 201),
      );
      await tester.pumpAndSettle();
      expect(fixture.shares, 1);
      expect(find.text('Share link created'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'A share response after leaving the page cannot copy or present its link',
    (tester) async {
      final fixture = ShareFixture(held: true);
      await fixture.open(tester);
      await tester.tap(shareHeader);
      await tester.pump();
      expect(fixture.shares, 1);
      await tester.pumpWidget(const SizedBox.shrink());
      fixture.reply!.complete(
        http.Response(jsonEncode({'url': shareUrl}), 201),
      );
      await tester.pumpAndSettle();
      expect(fixture.copied, isEmpty);
      expect(fixture.nativeShares, isEmpty);
      expect(find.text('Share link created'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'A response cannot open a share review after its retained chat is hidden',
    (tester) async {
      final fixture = ShareFixture(held: true);
      await fixture.open(tester);
      await tester.tap(shareHeader);
      await tester.pump();
      expect(fixture.shares, 1);
      await tester.pumpWidget(
        MaterialApp(
          theme: djlTheme(Brightness.light),
          home: ChatPage(
            controller: fixture.chat,
            voiceDriver: TestVoice(),
            exposed: false,
          ),
        ),
      );
      fixture.reply!.complete(
        http.Response(jsonEncode({'url': shareUrl}), 201),
      );
      await tester.pumpAndSettle();
      expect(fixture.copied, isEmpty);
      expect(fixture.nativeShares, isEmpty);
      expect(find.text('Share link created'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  test('A disposed conversation drops a held share URL', () async {
    final fixture = ShareFixture(held: true);
    addTearDown(fixture.client.close);
    await fixture.chat.initialize();
    final result = fixture.chat.share();
    for (var i = 0; i < 10 && fixture.shares == 0; i++) {
      await Future<void>.delayed(Duration.zero);
    }
    expect(fixture.shares, 1);
    fixture.chat.dispose();
    fixture.reply!.complete(http.Response(jsonEncode({'url': shareUrl}), 201));
    expect(await result, isNull);
    expect(await fixture.chat.share(), isNull);
    expect(fixture.shares, 1);
  });

  testWidgets(
    'Narrow large-text review keeps its explicit actions reachable by scrolling',
    (tester) async {
      tester.view.physicalSize = const Size(320, 700);
      tester.view.devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 3;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final fixture = ShareFixture();
      await fixture.open(tester);
      expect(tester.takeException(), isNull);
      await tester.tap(shareHeader);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final reviewScroll = find.descendant(
        of: find.ancestor(
          of: find.text('Share link created'),
          matching: find.byType(SingleChildScrollView),
        ),
        matching: find.byType(Scrollable),
      );
      await tester.scrollUntilVisible(
        find.text('Copy link'),
        200,
        scrollable: reviewScroll,
      );
      await tester.tap(find.text('Copy link'));
      await tester.pumpAndSettle();
      expect(fixture.copied, [shareUrl]);
      expect(fixture.shares, 1);
      expect(tester.takeException(), isNull);
    },
  );
}
