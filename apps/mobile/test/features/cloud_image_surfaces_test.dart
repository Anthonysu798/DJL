import 'dart:async';
import 'dart:convert';
import 'dart:ui' show SemanticsAction, SemanticsActionEvent;
import 'dart:ui' as ui show instantiateImageCodec;
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart' show CupertinoButton;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/presentation/message_view.dart';
import 'package:djl_mobile/features/images/data/image_repository.dart';
import 'package:djl_mobile/features/images/presentation/image_controller.dart';
import 'package:djl_mobile/features/images/presentation/image_gallery_page.dart';
import 'package:djl_mobile/features/images/presentation/image_preview_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

class GalleryFixture {
  GalleryFixture({
    this.empty = false,
    this.enabled = true,
    this.imageCount = 2,
  }) {
    client = CloudClient(
      baseUrl: Uri.parse('https://qa.invalid'),
      credentials: TestCredentials()..values['cloud.session'] = 'qa-session',
      client: MockClient((request) async {
        final path = request.url.path;
        if (path == '/v1/auth/token') {
          return http.Response('{"token":"jwt"}', 200);
        }
        if (path == '/v1/client-config') {
          return http.Response(
            jsonEncode({
              'tools': {'imageGeneration': enabled, 'imageEditing': true},
            }),
            200,
          );
        }
        if (path == '/v1/images') {
          pages++;
          if (failPage) {
            return http.Response(
              '{"error":{"message":"Gallery unavailable"}}',
              503,
            );
          }
          final more = request.url.queryParameters['cursor'] == 'next';
          return http.Response(
            jsonEncode({
              'images': empty
                  ? <Object>[]
                  : [
                      for (final n
                          in more
                              ? [3]
                              : List.generate(imageCount, (index) => index + 1))
                        {
                          'fileId': 'file$n',
                          'conversationId': 'chat$n',
                          'prompt':
                              'Public image $n with a long description for wrapping over multiple lines',
                          'mimeType': 'image/png',
                          'width': n == 2 ? 768 : 1024,
                          'height': 1024,
                        },
                    ],
              'nextCursor': empty || more ? null : 'next',
            }),
            200,
          );
        }
        if (path.startsWith('/v1/files/')) {
          files.add(path);
          return exportRequest?.future ??
              http.Response(
                '{"error":{"message":"Public image unavailable"}}',
                503,
              );
        }
        throw StateError('Unexpected gallery request $path');
      }),
    );
    repository = CloudRepository(client);
  }
  final bool empty, enabled;
  final int imageCount;
  late final CloudClient client;
  late final CloudRepository repository;
  int pages = 0;
  bool failPage = false;
  final files = <String>[];
  final opens = <String>[];
  Completer<http.Response>? exportRequest;
}

Future<void> gallery(
  WidgetTester tester,
  GalleryFixture f, {
  double width = 390,
  double scale = 1,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, 844);
  addTearDown(() async {
    if (f.exportRequest != null && !f.exportRequest!.isCompleted) {
      f.exportRequest!.complete(http.Response('{}', 503));
    }
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    f.client.close();
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(Brightness.light),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: ImageGalleryPage(
        controller: ImageController(ImageRepository(f.client)),
        repository: f.repository,
        onOpen: (image, edit) =>
            f.opens.add('${image.conversationId}:$edit:${image.fileId}'),
        onCreate: () {},
        onOpenNavigation: () {},
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> openGalleryPreview(WidgetTester tester, int index) async {
  await tester.ensureVisible(find.byType(CloudImage).at(index));
  await tester.pumpAndSettle();
  final semantics = tester.ensureSemantics();
  try {
    await tester.pump();
    final node = tester.getSemantics(
      find.bySemanticsLabel('Open image').at(index),
    );
    tester.binding.performSemanticsAction(
      SemanticsActionEvent(
        viewId: tester.view.viewId,
        nodeId: node.id,
        type: SemanticsAction.tap,
      ),
    );
    await tester.pumpAndSettle();
  } finally {
    semantics.dispose();
  }
}

void main() {
  for (final width in [320.0, 390.0]) {
    testWidgets('preview scales a decoded tiny image to phone width $width', (
      tester,
    ) async {
      const url = 'https://qa.invalid/public-tiny.png';
      final codec = await tester.runAsync(
        () => ui.instantiateImageCodec(
          base64Decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          ),
        ),
      );
      final frame = await tester.runAsync(() => codec!.getNextFrame());
      codec!.dispose();
      const provider = NetworkImage(url);
      PaintingBinding.instance.imageCache.putIfAbsent(
        provider,
        () => OneFrameImageStreamCompleter(
          Future.value(ImageInfo(image: frame!.image)),
        ),
      );
      addTearDown(() => provider.evict());
      final f = GalleryFixture()
        ..exportRequest = (Completer<http.Response>()
          ..complete(http.Response(jsonEncode({'url': url}), 200)));
      await gallery(tester, f, width: width);
      await openGalleryPreview(tester, 0);
      final image = find.descendant(
        of: find.byType(ImagePreviewPage),
        matching: find.byType(RawImage),
      );
      expect(tester.widget<RawImage>(image).image!.width, 1);
      expect(tester.getSize(image), Size(width, 844));
      expect(tester.widget<RawImage>(image).fit, BoxFit.contain);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('phone gallery fits two source image tiles in one row', (
    tester,
  ) async {
    final f = GalleryFixture();
    await gallery(tester, f);
    final tiles = find.byType(CloudImage);
    expect(tiles, findsNWidgets(2));
    final first = tester.getRect(tiles.at(0)),
        second = tester.getRect(tiles.at(1));
    expect(first.top, closeTo(second.top, .1));
    expect(first.left, 16);
    expect(second.left - first.right, closeTo(12, .1));
    expect(first.height, lessThanOrEqualTo(220));
    expect(second.height, lessThanOrEqualTo(220));
    await tester.tap(find.text('Open chat').first);
    await tester.pump();
    expect(f.opens, ['chat1:false:file1']);
    expect(tester.takeException(), isNull);
  });

  for (final layout in [(320.0, 1.0), (390.0, 2.2)]) {
    testWidgets('gallery reflows without clipped actions at $layout', (
      tester,
    ) async {
      final f = GalleryFixture();
      await gallery(tester, f, width: layout.$1, scale: layout.$2);
      final tiles = find.byType(CloudImage);
      final first = tester.getRect(tiles.at(0)),
          second = tester.getRect(tiles.at(1));
      expect(first.left, 16);
      expect(first.width, layout.$1 - 32);
      expect(second.top, greaterThan(first.bottom));
      await tester.ensureVisible(find.text('Open chat').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open chat').last);
      await tester.pump();
      expect(f.opens, ['chat2:false:file2']);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('gallery defers offscreen image downloads until scrolling', (
    tester,
  ) async {
    final f = GalleryFixture(imageCount: 30);
    await gallery(tester, f);
    final initial = f.files.length;
    expect(initial, greaterThan(0));
    expect(initial, lessThan(30));
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -650));
    await tester.pumpAndSettle();
    expect(f.files.length, greaterThan(initial));
    expect(tester.takeException(), isNull);
  });

  testWidgets('gallery item actions edit only their matching image', (
    tester,
  ) async {
    final f = GalleryFixture();
    await gallery(tester, f);
    await tester.tap(find.byTooltip('Image actions').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Edit in chat'));
    await tester.pumpAndSettle();
    expect(f.opens, ['chat2:true:file2']);
    await tester.ensureVisible(find.text('Load more'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Load more'));
    await tester.pumpAndSettle();
    expect(f.pages, 2);
    expect(find.text('Load more'), findsNothing);
    expect(find.byType(CloudImage), findsNWidgets(3));
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'unconfigured empty gallery explains saved images and hides creation',
    (tester) async {
      final f = GalleryFixture(empty: true, enabled: false);
      await gallery(tester, f);
      expect(find.byTooltip('Create image'), findsNothing);
      expect(
        find.text(
          'Image creation is not configured yet. Saved images will appear here.',
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('empty gallery retry recovers its original service error', (
    tester,
  ) async {
    final f = GalleryFixture(empty: true)..failPage = true;
    await gallery(tester, f);
    expect(find.textContaining('Gallery unavailable'), findsOneWidget);
    f.failPage = false;
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(
      find.text('Create an image and find it here, ready to save or share.'),
      findsOneWidget,
    );
    expect(f.pages, 2);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'failed thumbnail retry remains usable without a framework exception',
    (tester) async {
      final f = GalleryFixture();
      await gallery(tester, f);
      final before = f.files.length;
      await tester.tap(find.text('Image unavailable · Retry').first);
      await tester.pumpAndSettle();
      expect(f.files.length, before + 1);
      expect(find.text('Image unavailable · Retry'), findsNWidgets(2));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'preview opens the tapped file with source Close and export controls',
    (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        final f = GalleryFixture();
        await gallery(tester, f);
        f.files.clear();
        final node = tester.getSemantics(
          find.bySemanticsLabel('Open image').last,
        );
        tester.binding.performSemanticsAction(
          SemanticsActionEvent(
            viewId: tester.view.viewId,
            nodeId: node.id,
            type: SemanticsAction.tap,
          ),
        );
        await tester.pumpAndSettle();
        expect(
          tester.widget<ImagePreviewPage>(find.byType(ImagePreviewPage)).fileId,
          'file2',
        );
        expect(f.files, ['/v1/files/file2/url']);
        expect(find.byTooltip('Close'), findsOneWidget);
        expect(find.byTooltip('Share'), findsOneWidget);
        expect(find.byTooltip('Save to Photos'), findsOneWidget);
        expect(find.byType(AppBar), findsNothing);
        await tester.tap(find.byTooltip('Close'));
        await tester.pumpAndSettle();
        expect(find.byType(ImageGalleryPage), findsOneWidget);
        expect(f.opens, isEmpty);
        expect(tester.takeException(), isNull);
      } finally {
        semantics.dispose();
      }
    },
  );
  testWidgets(
    'preview leaves enough space for its title beside floating controls',
    (tester) async {
      final f = GalleryFixture();
      await gallery(tester, f);
      await openGalleryPreview(tester, 0);
      expect(
        tester.getSize(find.text('Your image')).width,
        greaterThanOrEqualTo(150),
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'preview controls stay above safe areas with large text on a narrow phone',
    (tester) async {
      tester.view.padding = const FakeViewPadding(top: 44, bottom: 34);
      addTearDown(tester.view.resetPadding);
      final f = GalleryFixture();
      await gallery(tester, f, width: 320, scale: 2.2);
      await openGalleryPreview(tester, 0);
      for (final label in ['Close', 'Share', 'Save to Photos']) {
        final rect = tester.getRect(find.byTooltip(label));
        expect(rect.top, greaterThanOrEqualTo(44));
        expect(rect.left, greaterThanOrEqualTo(12));
        expect(rect.right, lessThanOrEqualTo(308));
        expect(rect.width, greaterThanOrEqualTo(44));
        expect(rect.height, greaterThanOrEqualTo(44));
      }
      await tester.tap(find.byTooltip('Close'));
      await tester.pumpAndSettle();
      expect(find.byType(ImageGalleryPage), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'preview export blocks duplicate actions and displays its actual service error',
    (tester) async {
      final f = GalleryFixture();
      await gallery(tester, f);
      await openGalleryPreview(tester, 0);
      final before = f.files.length;
      f.exportRequest = Completer<http.Response>();
      await tester.tap(find.byTooltip('Save to Photos'));
      await tester.pump();
      for (final label in ['Share', 'Save to Photos']) {
        final button = find.descendant(
          of: find.byTooltip(label),
          matching: find.byType(CupertinoButton),
        );
        expect(tester.widget<CupertinoButton>(button).onPressed, isNull);
      }
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      await tester.tap(find.byTooltip('Share'));
      await tester.pump();
      expect(f.files.length, before + 1);
      f.exportRequest!.complete(
        http.Response('{"error":{"message":"Public export unavailable"}}', 503),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Public export unavailable'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
