import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show ValueListenable;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'voice_controller_test.dart' show TestVoice;

class ImageSheetFixture {
  ImageSheetFixture({this.enabled = true}) {
    client = CloudClient(
      baseUrl: Uri.parse('https://qa.invalid'),
      credentials: TestCredentials()..values['cloud.session'] = 'qa-session',
      client: MockClient((request) async {
        switch (request.url.path) {
          case '/v1/auth/token':
            return http.Response('{"token":"jwt"}', 200);
          case '/v1/models':
            return http.Response(
              '{"models":[{"id":"m","provider":"anthropic","status":"active","capabilities":["text.chat","vision"]}]}',
              200,
            );
          case '/v1/client-config':
            return http.Response(
              jsonEncode({
                'tools': {'imageGeneration': enabled},
              }),
              200,
            );
          case '/v1/conversations':
            creates++;
            return http.Response('{"id":"created"}', 201);
          case '/v1/conversations/created/images':
            final input = jsonDecode(request.body) as Map<String, dynamic>;
            images.add(input);
            if (pending != null) return pending!.future;
            return accepted(input);
          case '/v1/runs/r/events':
            return http.Response(
              'data: {"runId":"r","seq":1,"type":"status","payload":{"status":"succeeded","error":null}}\n\n',
              200,
            );
          default:
            throw StateError('Unexpected image QA route ${request.url.path}');
        }
      }),
    );
    chat = ChatController(CloudRepository(client), accountScope: 'u:o');
  }
  final bool enabled;
  late final CloudClient client;
  late final ChatController chat;
  final images = <Map<String, dynamic>>[];
  int creates = 0;
  Completer<http.Response>? pending;
  http.Response accepted(Map<String, dynamic> input) => http.Response(
    jsonEncode({
      'message': {
        'id': 'u',
        'role': 'user',
        'parts': [
          {'type': 'text', 'text': input['prompt']},
        ],
      },
      'reply': {
        'id': 'a',
        'parentId': 'u',
        'role': 'assistant',
        'runId': 'r',
        'parts': [],
      },
      'run': {'id': 'r', 'mode': 'task', 'status': 'queued'},
    }),
    201,
    headers: {'content-type': 'application/json; charset=utf-8'},
  );
}

Future<void> openImageSheet(
  WidgetTester tester,
  ImageSheetFixture f, {
  bool automatic = false,
  double scale = 1,
  double keyboard = 0,
  String? draft,
  ValueListenable<bool>? parentVisible,
}) async {
  addTearDown(() async {
    if (f.pending != null && !f.pending!.isCompleted) {
      f.pending!.complete(
        http.Response('{"error":{"message":"QA cleanup"}}', 503),
      );
    }
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(milliseconds: 600));
    f.client.close();
  });
  final page = ChatPage(
    controller: f.chat,
    voiceDriver: TestVoice(),
    createImageOnOpen: automatic,
  );
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(Brightness.light),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(scale),
          viewInsets: EdgeInsets.only(bottom: keyboard),
        ),
        child: child!,
      ),
      home: parentVisible == null
          ? page
          : ValueListenableBuilder<bool>(
              valueListenable: parentVisible,
              builder: (_, visible, _) =>
                  visible ? page : const Scaffold(body: Text('New scope')),
            ),
    ),
  );
  await tester.pumpAndSettle();
  if (!automatic) {
    if (draft != null) {
      await tester.enterText(find.byKey(const Key('composer')), draft);
      await tester.pump();
    }
    await tester.tap(find.byTooltip('Attach file or image'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Create image'));
    await tester.pumpAndSettle();
  }
}

Finder get imagePrompt =>
    find.widgetWithText(TextField, 'A quiet studio in morning light…');
Finder get createImage => find.widgetWithText(FilledButton, 'Create image');

void main() {
  testWidgets(
    'source image sheet shows prompt, shape controls and safe local Close',
    (tester) async {
      final f = ImageSheetFixture();
      await openImageSheet(tester, f, draft: 'Keep underlying draft');
      expect(find.text('Make something yours.'), findsOneWidget);
      expect(
        find.text('Describe the subject, style, and details you have in mind.'),
        findsOneWidget,
      );
      for (final label in ['Square', 'Landscape', 'Portrait']) {
        expect(find.text(label), findsOneWidget);
      }
      expect(
        find.text(
          'One image per request. You can leave the chat while DJL works.',
        ),
        findsOneWidget,
      );
      expect(tester.widget<FilledButton>(createImage).onPressed, isNull);
      await tester.tap(find.widgetWithText(TextButton, 'Close'));
      await tester.pumpAndSettle();
      expect(find.text('Make something yours.'), findsNothing);
      expect(f.creates, 0);
      expect(f.images, isEmpty);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('composer')))
            .controller!
            .text,
        'Keep underlying draft',
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'empty, whitespace and over4000 UTF16 prompt never create a request',
    (tester) async {
      final f = ImageSheetFixture();
      await openImageSheet(tester, f);
      for (final text in ['', '  \n ', '${'😀' * 2000}x']) {
        await tester.enterText(imagePrompt, text);
        await tester.pump();
        expect(tester.widget<FilledButton>(createImage).onPressed, isNull);
        await tester.tap(createImage);
        await tester.pump();
        expect(f.creates, 0);
        expect(f.images, isEmpty);
        expect(find.text('Make something yours.'), findsOneWidget);
      }
    },
  );
  for (final choice in [
    ('Square', '1:1'),
    ('Landscape', '4:3'),
    ('Portrait', '3:4'),
  ]) {
    testWidgets('source ${choice.$1} submits exact image request once', (
      tester,
    ) async {
      final f = ImageSheetFixture();
      await openImageSheet(tester, f);
      final prompt = choice.$1 == 'Square' ? '😀' * 2000 : 'A calm desk';
      await tester.enterText(imagePrompt, prompt);
      await tester.pump();
      await tester.ensureVisible(find.text(choice.$1));
      await tester.tap(find.text(choice.$1));
      await tester.pump();
      await tester.tap(createImage);
      await tester.pumpAndSettle();
      expect(f.creates, 1);
      expect(f.images, hasLength(1));
      expect(f.images.single['prompt'], prompt);
      expect(f.images.single['aspectRatio'], choice.$2);
      expect(find.text('Make something yours.'), findsNothing);
    });
  }

  testWidgets(
    'pending image blocks Close back and drag, then retains error and retries same ID',
    (tester) async {
      final f = ImageSheetFixture()..pending = Completer<http.Response>();
      await openImageSheet(tester, f);
      await tester.enterText(imagePrompt, 'A calm desk');
      await tester.tap(find.text('Landscape'));
      await tester.pump();
      await tester.tap(createImage);
      for (var i = 0; i < 20 && f.images.isEmpty; i++) {
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(f.images, hasLength(1));
      expect(find.text('Starting…'), findsOneWidget);
      final close = find.widgetWithText(TextButton, 'Close');
      expect(tester.widget<TextButton>(close).onPressed, isNull);
      await tester.binding.handlePopRoute();
      await tester.pump();
      final header = find.widgetWithText(AppBar, 'Create image');
      await tester.dragFrom(tester.getCenter(header), const Offset(0, 500));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Make something yours.'), findsOneWidget);
      expect(f.images, hasLength(1));
      f.pending!.complete(
        http.Response(
          '{"error":{"code":"overloaded","message":"Image QA unavailable"}}',
          503,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Image QA unavailable'), findsWidgets);
      expect(
        tester.widget<TextField>(imagePrompt).controller!.text,
        'A calm desk',
      );
      final id = f.images.single['clientMessageId'];
      f.pending = null;
      await tester.tap(createImage);
      await tester.pumpAndSettle();
      expect(f.images, hasLength(2));
      expect(f.images.last['clientMessageId'], id);
      expect(f.images.last['aspectRatio'], '4:3');
      expect(f.creates, 1);
      expect(find.text('Make something yours.'), findsNothing);
    },
    variant: TargetPlatformVariant({
      TargetPlatform.iOS,
      TargetPlatform.android,
    }),
  );

  testWidgets(
    'idle source sheet drags down without sending',
    (tester) async {
      final f = ImageSheetFixture();
      await openImageSheet(tester, f);
      final header = find.widgetWithText(AppBar, 'Create image');
      await tester.dragFrom(tester.getCenter(header), const Offset(0, 500));
      await tester.pumpAndSettle();
      expect(find.text('Make something yours.'), findsNothing);
      expect(f.creates, 0);
      expect(f.images, isEmpty);
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );

  testWidgets(
    'late image acceptance removes only its sheet beneath a newer overlay',
    (tester) async {
      final f = ImageSheetFixture()..pending = Completer<http.Response>();
      await openImageSheet(tester, f);
      await tester.enterText(imagePrompt, 'A calm desk');
      await tester.pump();
      await tester.tap(createImage);
      for (var i = 0; i < 20 && f.images.isEmpty; i++) {
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(f.images, hasLength(1));
      unawaited(
        showDialog<void>(
          context: tester.element(imagePrompt),
          builder: (context) => AlertDialog(
            title: const Text('Temporary overlay'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Close temporary overlay'),
              ),
            ],
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 300));
      f.pending!.complete(f.accepted(f.images.single));
      await tester.pumpAndSettle();
      expect(find.text('Temporary overlay'), findsOneWidget);
      expect(find.text('Make something yours.'), findsNothing);
      await tester.tap(find.text('Close temporary overlay'));
      await tester.pumpAndSettle();
      expect(f.images, hasLength(1));
    },
  );

  testWidgets('covered or closed image sheet rejects a stale Create callback', (
    tester,
  ) async {
    final f = ImageSheetFixture();
    await openImageSheet(tester, f);
    await tester.enterText(imagePrompt, 'A calm desk');
    await tester.pump();
    final create = tester.widget<FilledButton>(createImage).onPressed!;
    unawaited(
      showDialog<void>(
        context: tester.element(imagePrompt),
        builder: (context) => AlertDialog(
          title: const Text('Newer overlay'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Close newer overlay'),
            ),
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();
    create();
    await tester.pumpAndSettle();
    expect(f.images, isEmpty);
    expect(f.creates, 0);
    expect(find.text('Newer overlay'), findsOneWidget);
    await tester.tap(find.text('Close newer overlay'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Close'));
    await tester.pumpAndSettle();
    create();
    await tester.pumpAndSettle();
    expect(f.images, isEmpty);
    expect(f.creates, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('sheet exit survives disposal of its owning chat', (
    tester,
  ) async {
    final f = ImageSheetFixture();
    final visible = ValueNotifier(true);
    addTearDown(visible.dispose);
    await openImageSheet(tester, f, parentVisible: visible);
    Navigator.of(tester.element(imagePrompt)).pop();
    visible.value = false;
    await tester.pump(const Duration(milliseconds: 100));
    expect(tester.takeException(), isNull);
    await tester.pumpAndSettle();
    expect(find.text('New scope'), findsOneWidget);
    expect(f.images, isEmpty);
    expect(f.creates, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('configuration-off sheet explains availability and stays local', (
    tester,
  ) async {
    final f = ImageSheetFixture(enabled: false);
    await openImageSheet(tester, f, automatic: true);
    expect(
      find.text(
        "Image generation isn't configured on this server yet. Your saved images are still available.",
      ),
      findsOneWidget,
    );
    await tester.enterText(imagePrompt, 'A calm desk');
    await tester.pump();
    expect(tester.widget<FilledButton>(createImage).onPressed, isNull);
    expect(f.creates, 0);
    expect(f.images, isEmpty);
  });

  testWidgets(
    'source image sheet stays usable with short keyboard and large text',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(360, 640));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final f = ImageSheetFixture();
      await openImageSheet(tester, f, scale: 2.2, keyboard: 300);
      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(
        imagePrompt,
        100,
        scrollable: find
            .descendant(
              of: find.byType(ListView),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      await tester.pumpAndSettle();
      await tester.enterText(imagePrompt, 'A calm desk');
      await tester.pumpAndSettle();
      expect(tester.getRect(createImage).bottom, lessThanOrEqualTo(340));
      await tester.scrollUntilVisible(
        find.text('Portrait'),
        100,
        scrollable: find
            .descendant(
              of: find.byType(ListView),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .getRect(find.text('Portrait'))
            .overlaps(tester.getRect(createImage)),
        isFalse,
      );
      await tester.tap(find.text('Portrait'));
      await tester.pump();
      expect(f.images, isEmpty);
      await tester.tap(createImage);
      await tester.pumpAndSettle();
      expect(f.images.single['aspectRatio'], '3:4');
      expect(tester.takeException(), isNull);
    },
  );
}
