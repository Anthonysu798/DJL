// Device-rendering acceptance only. API metadata is mocked and credentials stay
// in memory; this target never opens the platform credential/settings stores.
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:integration_test/integration_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/chat/presentation/message_view.dart';
import 'package:djl_mobile/features/images/data/image_repository.dart';
import 'package:djl_mobile/features/images/presentation/cloud_image_creation_sheet.dart';
import 'package:djl_mobile/features/images/presentation/image_controller.dart';
import 'package:djl_mobile/features/images/presentation/image_gallery_page.dart';
import 'package:djl_mobile/features/images/presentation/image_preview_page.dart';

class _UiCredentials implements CredentialStore {
  final values = <String, String>{'cloud.session': 'public-ui-fixture'};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String? value) async {
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.shouldPropagateDevicePointerEvents = true;
  WidgetController.hitTestWarningShouldBeFatal = true;
  testWidgets('native public-image gallery, preview and creation cancel', (
    tester,
  ) async {
    const origin = String.fromEnvironment(
      'DJL_IMAGE_UI_FIXTURE',
      defaultValue: 'http://127.0.0.1:8869',
    );
    final base = Uri.parse(origin);
    if (base.scheme != 'http' ||
        base.host != '127.0.0.1' ||
        base.port != 8869) {
      throw StateError('Only the isolated public-image fixture is allowed.');
    }
    final posts = <String>[], opens = <String>[];
    final cloud = CloudClient(
      baseUrl: base,
      credentials: _UiCredentials(),
      client: MockClient((request) async {
        final path = request.url.path;
        if (request.method == 'POST' && path != '/v1/auth/token') {
          posts.add(path);
          throw StateError('Rendering QA must not create service data.');
        }
        final Object value;
        if (path == '/v1/auth/token') {
          value = {'token': 'public-ui-only'};
        } else if (path == '/v1/models') {
          value = {
            'models': [
              {
                'id': 'ui-model',
                'provider': 'qa',
                'status': 'active',
                'capabilities': ['text.chat'],
              },
            ],
          };
        } else if (path == '/v1/client-config') {
          value = {
            'tools': {'imageGeneration': true, 'imageEditing': true},
          };
        } else if (path == '/v1/images') {
          value = {
            'images': [
              for (var n = 1; n <= 4; n++)
                {
                  'fileId': 'public-logo-$n',
                  'conversationId': 'public-chat-$n',
                  'prompt': 'Public DJL visual fixture $n',
                  'mimeType': 'image/png',
                  'width': 1024,
                  'height': 1024,
                },
              {
                'fileId': 'public-tiny',
                'conversationId': 'public-chat-tiny',
                'prompt': 'Public 1 pixel blue image',
                'mimeType': 'image/png',
                'width': 1,
                'height': 1,
              },
            ],
            'nextCursor': null,
          };
        } else if (RegExp(
          r'^/v1/files/public-logo-[1-4]/url$',
        ).hasMatch(path)) {
          value = {'url': '$origin/public-logo.png'};
        } else if (path == '/v1/files/public-tiny/url') {
          value = {'url': '$origin/public-tiny.png'};
        } else {
          throw StateError('Unexpected rendering QA route $path');
        }
        return http.Response(
          jsonEncode(value),
          200,
          headers: {'content-type': 'application/json'},
        );
      }),
    );
    final repository = CloudRepository(cloud);
    final images = ImageController(ImageRepository(cloud));
    final scale = ValueNotifier(1.0);
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: djlTheme(Brightness.light),
        darkTheme: djlTheme(Brightness.dark),
        builder: (context, child) => ValueListenableBuilder<double>(
          valueListenable: scale,
          builder: (_, value, _) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(value)),
            child: child!,
          ),
        ),
        home: Builder(
          builder: (context) => ImageGalleryPage(
            controller: images,
            repository: repository,
            onOpenNavigation: () {},
            onOpen: (image, edit) => opens.add('${image.fileId}:$edit'),
            onCreate: () async {
              final chat = ChatController(
                repository,
                accountScope: 'public-ui-fixture',
              );
              try {
                await chat.initialize();
                if (context.mounted) {
                  await showCloudImageCreationSheet(context, controller: chat);
                }
              } finally {
                chat.dispose();
              }
            },
          ),
        ),
      ),
    );
    Future<void> loaded({int minimum = 2}) async {
      final deadline = DateTime.now().add(const Duration(seconds: 20));
      while (DateTime.now().isBefore(deadline)) {
        await tester.pump(const Duration(milliseconds: 100));
        if (find
                .byType(RawImage)
                .evaluate()
                .where((e) => (e.widget as RawImage).image != null)
                .length >=
            minimum) {
          return;
        }
      }
      fail('Public native image bytes did not render.');
    }

    await loaded();
    await tester.pumpAndSettle();
    if (Platform.isAndroid) {
      await binding.convertFlutterSurfaceToImage();
      await tester.pumpAndSettle();
    }
    final tiles = find.byType(CloudImage);
    expect(
      tester.getRect(tiles.at(0)).top,
      closeTo(tester.getRect(tiles.at(1)).top, 1),
    );
    await binding.takeScreenshot('cloud-image-surfaces-native-grid');
    await tester.tap(tiles.first);
    await tester.pumpAndSettle();
    await loaded(minimum: 1);
    expect(find.byType(ImagePreviewPage), findsOneWidget);
    for (final label in ['Close', 'Share', 'Save to Photos']) {
      expect(find.byTooltip(label), findsOneWidget);
    }
    await binding.takeScreenshot('cloud-image-surfaces-native-preview');
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(tiles.last);
    await tester.tap(tiles.last);
    await tester.pumpAndSettle();
    await loaded(minimum: 1);
    final tiny = find.descendant(
      of: find.byType(ImagePreviewPage),
      matching: find.byType(RawImage),
    );
    expect(tester.widget<RawImage>(tiny).image!.width, 1);
    expect(
      tester.getSize(tiny).width,
      tester.getSize(find.byType(ImagePreviewPage)).width,
    );
    await binding.takeScreenshot('cloud-image-surfaces-native-tiny-light');
    tester.binding.platformDispatcher.platformBrightnessTestValue =
        Brightness.dark;
    addTearDown(
      tester.binding.platformDispatcher.clearPlatformBrightnessTestValue,
    );
    await tester.pumpAndSettle();
    await binding.takeScreenshot('cloud-image-surfaces-native-tiny-dark');
    tester.binding.platformDispatcher.clearPlatformBrightnessTestValue();
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(tiles.first);
    await tester.tap(find.byTooltip('Create image'));
    await tester.pumpAndSettle();
    expect(find.text('Make something yours.'), findsOneWidget);
    final create = find.widgetWithText(FilledButton, 'Create image');
    expect(tester.widget<FilledButton>(create).onPressed, isNull);
    await tester.enterText(
      find.byKey(const Key('cloud.images.prompt')),
      'Public native layout QA',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Landscape'));
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(create).onPressed, isNotNull);
    await binding.takeScreenshot('cloud-image-surfaces-native-creation');
    await tester.tap(find.widgetWithText(TextButton, 'Close'));
    await tester.pumpAndSettle();
    expect(find.byType(ImageGalleryPage), findsOneWidget);
    expect(posts, isEmpty);
    scale.value = 2.2;
    await tester.pumpAndSettle();
    expect(
      tester.getRect(tiles.at(1)).top,
      greaterThan(tester.getRect(tiles.at(0)).bottom),
    );
    await binding.takeScreenshot('cloud-image-surfaces-native-large-text');
    scale.value = 1;
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Image actions').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Edit in chat'));
    await tester.pumpAndSettle();
    expect(opens, ['public-logo-1:true']);
    expect(posts, isEmpty);
    expect(tester.takeException(), isNull);
    debugPrint(
      'DJL_IMAGE_SURFACES_FINISHED public metadata and in-memory credentials only',
    );
  });
}
