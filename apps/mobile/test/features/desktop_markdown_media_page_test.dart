import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_conversation_fidelity_test.dart' show showConversation;
import 'desktop_new_chat_draft_test.dart' show finishDraft;
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop;

const mediaPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

class MarkdownMediaTransport extends ReasoningTransport {
  MarkdownMediaTransport(String text) {
    history = {
      'id': 'thread',
      'cwd': '/repo',
      'turns': [
        {
          'id': 'turn',
          'status': 'completed',
          'items': [
            {
              'id': 'answer',
              'type': 'agentMessage',
              'phase': 'final_answer',
              'text': text,
            },
          ],
        },
      ],
    };
  }
  Completer<RemoteJson>? imageGate;
  bool imageFailure = false;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'workspace/readImage') {
      calls.add({'method': method, 'params': params, 'session': session});
      if (imageFailure) throw StateError('Local fixture image unavailable');
      return imageGate?.future ??
          {
            'path': params['path'],
            'fileName': 'result.png',
            'mimeType': 'image/png',
            'byteLength': 68,
            'dataBase64': mediaPng,
          };
    }
    return super.request(method, params, timeout: timeout);
  }
}

Future<void> openMediaPreview(WidgetTester tester) async {
  final image = find.byWidgetPredicate(
    (w) => w is Image && w.image is MemoryImage,
  );
  await tester.runAsync(
    () =>
        precacheImage(tester.widget<Image>(image).image, tester.element(image)),
  );
  await tester.pumpAndSettle();
  await tester.ensureVisible(image);
  await tester.tap(image);
  await tester.pumpAndSettle();
}

void main() {
  for (final size in [const Size(402, 874), const Size(320, 700)]) {
    testWidgets('preview controls stay above the image on $size', (
      tester,
    ) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final transport = MarkdownMediaTransport('![Result](/repo/result.png)');
      final desktop = await reasoningDesktop(transport);
      try {
        await showConversation(tester, desktop);
        await openMediaPreview(tester);
        final image = find.byWidgetPredicate(
          (w) => w is Image && w.image is MemoryImage,
        );
        final close = tester.getRect(find.byTooltip('Close'));
        expect(close.bottom, lessThan(tester.getTopLeft(image).dy));
        for (final label in ['Share', 'Save to Photos']) {
          expect(tester.getCenter(find.byTooltip(label)).dy, close.center.dy);
        }
        expect(tester.takeException(), isNull);
      } finally {
        await finishDraft(tester, desktop);
      }
    });
  }

  testWidgets('screen reader can activate a local image preview', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    final transport = MarkdownMediaTransport('![Result](/repo/result.png)');
    final desktop = await reasoningDesktop(transport);
    try {
      await showConversation(tester, desktop);
      final image = find.byWidgetPredicate(
        (w) => w is Image && w.image is MemoryImage,
      );
      await tester.runAsync(
        () => precacheImage(
          tester.widget<Image>(image).image,
          tester.element(image),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(image);
      final node = tester.getSemantics(
        find.bySemanticsLabel('Open image Result'),
      );
      expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
      tester.binding.performSemanticsAction(
        SemanticsActionEvent(
          viewId: tester.view.viewId,
          nodeId: node.id,
          type: SemanticsAction.tap,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(InteractiveViewer), findsOneWidget);
      expect(find.byTooltip('Close'), findsOneWidget);
    } finally {
      await finishDraft(tester, desktop);
      semantics.dispose();
    }
  });

  testWidgets(
    'expired image read waits for an explicit fresh preview request',
    (tester) async {
      final old = Completer<RemoteJson>();
      final transport = MarkdownMediaTransport('![Result](/repo/result.png)')
        ..imageGate = old;
      final desktop = await reasoningDesktop(transport);
      try {
        await showConversation(tester, desktop);
        transport.session = 'rotated-session';
        desktop.setPlan(false);
        await tester.pump();
        old.complete({
          'path': '/repo/result.png',
          'fileName': 'result.png',
          'mimeType': 'image/png',
          'byteLength': 68,
          'dataBase64': mediaPng,
        });
        await tester.pumpAndSettle();
        expect(
          tester
              .widgetList<Image>(find.byType(Image))
              .where((i) => i.image is MemoryImage),
          isEmpty,
        );
        expect(
          transport.calls.where((c) => c['method'] == 'workspace/readImage'),
          hasLength(1),
        );
        transport.imageGate = null;
        await tester.tap(find.bySemanticsLabel('Open image Result'));
        await tester.pumpAndSettle();
        expect(find.byType(InteractiveViewer), findsOneWidget);
        expect(
          transport.calls
              .where((c) => c['method'] == 'workspace/readImage')
              .map((c) => c['session']),
          ['secure-a', 'rotated-session'],
        );
      } finally {
        if (!old.isCompleted) old.complete({});
        await finishDraft(tester, desktop);
      }
    },
  );
  testWidgets('failed inline image opens a retryable workspace preview', (
    tester,
  ) async {
    final transport = MarkdownMediaTransport('![Result](/repo/result.png)')
      ..imageFailure = true;
    final desktop = await reasoningDesktop(transport);
    try {
      await showConversation(tester, desktop);
      await tester.tap(find.bySemanticsLabel('Open image Result'));
      await tester.pumpAndSettle();
      expect(find.text('Retry'), findsOneWidget);
      expect(find.text('Could not load this image.'), findsOneWidget);
      transport.imageFailure = false;
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();
      expect(find.byType(InteractiveViewer), findsOneWidget);
      expect(
        transport.calls.where((c) => c['method'] == 'workspace/readImage'),
        hasLength(3),
      );
      expect(tester.takeException(), isNull);
    } finally {
      await finishDraft(tester, desktop);
    }
  });

  for (final changed in ['pin', 'thread', 'mac']) {
    testWidgets(
      'preview clears old bytes and rejects held Save after $changed',
      (tester) async {
        final transport = MarkdownMediaTransport('![Result](/repo/result.png)');
        final desktop = await reasoningDesktop(transport);
        final nativeCalls = <MethodCall>[];
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(const MethodChannel('gal'), (call) async {
              nativeCalls.add(call);
              return call.method == 'requestAccess' ? true : null;
            });
        try {
          await showConversation(tester, desktop);
          await openMediaPreview(tester);
          final heldSave = tester
              .widget<IconButton>(
                find.byWidgetPredicate(
                  (w) => w is IconButton && w.tooltip == 'Save to Photos',
                ),
              )
              .onPressed!;
          if (changed == 'pin') {
            desktop.active = Pairing({
              ...desktop.active!.data,
              'macIdentityPublicKey': 'rotated-pin',
            });
          }
          if (changed == 'mac') {
            desktop.active = Pairing({
              ...desktop.active!.data,
              'macDeviceId': 'other-mac',
            });
          }
          if (changed == 'thread') {
            desktop.thread = {'id': 'other-thread', 'cwd': '/repo'};
          }
          desktop.setPlan(false);
          await tester.pumpAndSettle();
          heldSave();
          await tester.pumpAndSettle();
          expect(find.byType(InteractiveViewer), findsNothing);
          expect(nativeCalls, isEmpty);
          expect(
            find.text('Reopen this image from its paired chat.'),
            findsOneWidget,
          );
          if (changed == 'pin') {
            expect(
              transport.calls.where(
                (c) => c['method'] == 'workspace/readImage',
              ),
              hasLength(1),
            );
          }
          expect(tester.takeException(), isNull);
        } finally {
          await finishDraft(tester, desktop);
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
              .setMockMethodCallHandler(const MethodChannel('gal'), null);
        }
      },
    );
  }

  testWidgets(
    'pending native Save is not repeated or acknowledged after key revocation',
    (tester) async {
      final transport = MarkdownMediaTransport('![Result](/repo/result.png)');
      final desktop = await reasoningDesktop(transport);
      final saved = Completer<void>(), calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(const MethodChannel('gal'), (call) async {
            calls.add(call);
            if (call.method == 'requestAccess') return true;
            if (call.method == 'putImageBytes') await saved.future;
            return null;
          });
      try {
        await showConversation(tester, desktop);
        await openMediaPreview(tester);
        final save = tester
            .widget<IconButton>(
              find.byWidgetPredicate(
                (w) => w is IconButton && w.tooltip == 'Save to Photos',
              ),
            )
            .onPressed!;
        save();
        save();
        await tester.pump();
        expect(calls.where((c) => c.method == 'putImageBytes'), hasLength(1));
        desktop.active = Pairing({
          ...desktop.active!.data,
          'macIdentityPublicKey': 'rotated-pin',
        });
        desktop.setPlan(false);
        saved.complete();
        await tester.pumpAndSettle();
        expect(find.text('Saved to Photos.'), findsNothing);
        expect(find.byType(InteractiveViewer), findsNothing);
        expect(tester.takeException(), isNull);
      } finally {
        if (!saved.isCompleted) saved.complete();
        await finishDraft(tester, desktop);
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(const MethodChannel('gal'), null);
      }
    },
  );
  for (final change in ['offline', 'session']) {
    testWidgets(
      'downloaded image remains usable for its pinned owner after $change',
      (tester) async {
        final transport = MarkdownMediaTransport('![Result](/repo/result.png)');
        final desktop = await reasoningDesktop(transport);
        final saves = <MethodCall>[];
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(const MethodChannel('gal'), (call) async {
              saves.add(call);
              return call.method == 'requestAccess' ? true : null;
            });
        try {
          await showConversation(tester, desktop);
          await openMediaPreview(tester);
          if (change == 'offline') {
            await desktop.disconnect();
          } else {
            transport.session = 'rotated-session';
            desktop.setPlan(false);
          }
          await tester.pumpAndSettle();
          expect(find.byType(InteractiveViewer), findsOneWidget);
          await tester.tap(find.byTooltip('Save to Photos'));
          await tester.pumpAndSettle();
          expect(
            (saves.singleWhere((c) => c.method == 'putImageBytes').arguments
                as Map)['bytes'],
            base64Decode(mediaPng),
          );
          expect(
            transport.calls.where((c) => c['method'] == 'workspace/readImage'),
            hasLength(1),
          );
          expect(find.text('Saved to Photos.'), findsOneWidget);
        } finally {
          await finishDraft(tester, desktop);
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
              .setMockMethodCallHandler(const MethodChannel('gal'), null);
        }
      },
    );
  }
  testWidgets('image opens zoom preview and saves its exact loaded bytes', (
    tester,
  ) async {
    final transport = MarkdownMediaTransport('![Result](/repo/result.png)');
    final desktop = await reasoningDesktop(transport);
    final saves = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('gal'), (call) async {
          saves.add(call);
          if (call.method == 'requestAccess') return true;
          return null;
        });
    try {
      await showConversation(tester, desktop);
      final image = find.byWidgetPredicate(
        (w) => w is Image && w.image is MemoryImage,
      );
      await tester.runAsync(
        () => precacheImage(
          tester.widget<Image>(image).image,
          tester.element(image),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(image);
      await tester.tap(image);
      await tester.pumpAndSettle();
      expect(find.byType(InteractiveViewer), findsOneWidget);
      expect(find.byTooltip('Share'), findsOneWidget);
      await tester.tap(find.byTooltip('Save to Photos'));
      await tester.pumpAndSettle();
      expect(saves.where((c) => c.method == 'putImageBytes'), hasLength(1));
      expect(
        (saves.singleWhere((c) => c.method == 'putImageBytes').arguments
            as Map)['bytes'],
        base64Decode(mediaPng),
      );
      expect(find.text('Saved to Photos.'), findsOneWidget);
      await tester.tap(find.byTooltip('Close'));
      await tester.pumpAndSettle();
      expect(find.byType(InteractiveViewer), findsNothing);
      expect(
        transport.calls.where((c) => c['method'] == 'workspace/readImage'),
        hasLength(1),
      );
    } finally {
      await finishDraft(tester, desktop);
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(const MethodChannel('gal'), null);
    }
  });
  testWidgets('screenshots stay between prose while generated image follows it', (
    tester,
  ) async {
    final transport = MarkdownMediaTransport(
      'Before screenshot.\n\n![Screenshot](/tmp/shot.png)\n\nAfter screenshot.\n\n![Generated](/home/mac/.codex/generated_images/result.png)\n\nLast prose.',
    );
    final desktop = await reasoningDesktop(transport);
    try {
      await showConversation(tester, desktop);
      final shot = find.byWidgetPredicate(
        (w) => w is Image && w.semanticLabel == 'Screenshot',
      );
      final generated = find.byWidgetPredicate(
        (w) => w is Image && w.semanticLabel == 'Generated',
      );
      expect(shot, findsOneWidget);
      expect(generated, findsOneWidget);
      expect(
        tester.getTopLeft(shot).dy,
        greaterThan(
          tester
              .getBottomLeft(
                find.text('Before screenshot.', findRichText: true),
              )
              .dy,
        ),
      );
      expect(
        tester.getBottomLeft(shot).dy,
        lessThan(
          tester
              .getTopLeft(find.text('After screenshot.', findRichText: true))
              .dy,
        ),
      );
      expect(
        tester.getTopLeft(generated).dy,
        greaterThan(
          tester.getBottomLeft(find.text('Last prose.', findRichText: true)).dy,
        ),
      );
      expect(
        transport.calls
            .where((c) => c['method'] == 'workspace/readImage')
            .map((c) => (c['params'] as Map)['path']),
        ['/tmp/shot.png', '/home/mac/.codex/generated_images/result.png'],
      );
    } finally {
      await finishDraft(tester, desktop);
    }
  });

  testWidgets(
    'unrelated rebuild reuses image and Copy retains raw authored text',
    (tester) async {
      const raw =
          '  Prose\n\n![Result](/home/mac/.codex/generated_images/result.png)\n\nEnd  ';
      final transport = MarkdownMediaTransport(raw);
      final desktop = await reasoningDesktop(transport);
      final clipboard = <String>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
            if (call.method == 'Clipboard.setData') {
              clipboard.add((call.arguments as Map)['text'] as String);
            }
            return null;
          });
      try {
        await showConversation(tester, desktop);
        desktop.setPlan(false);
        await tester.pumpAndSettle();
        expect(
          transport.calls.where((c) => c['method'] == 'workspace/readImage'),
          hasLength(1),
        );
        await tester.tap(find.byTooltip('Copy response'));
        await tester.pump();
        expect(clipboard, [raw]);
      } finally {
        await finishDraft(tester, desktop);
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(SystemChannels.platform, null);
      }
    },
  );

  for (final end in ['disconnect', 'dispose']) {
    testWidgets('late image result is discarded after $end', (tester) async {
      final transport = MarkdownMediaTransport('![Result](/repo/result.png)')
        ..imageGate = Completer<RemoteJson>();
      final desktop = await reasoningDesktop(transport);
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((c) => c['method'] == 'workspace/readImage'),
        hasLength(1),
      );
      if (end == 'disconnect') {
        await desktop.disconnect();
        await tester.pump();
      } else {
        await tester.pumpWidget(const SizedBox.shrink());
      }
      transport.imageGate!.complete({
        'path': '/repo/result.png',
        'fileName': 'result.png',
        'mimeType': 'image/png',
        'byteLength': 68,
        'dataBase64': mediaPng,
      });
      await tester.pumpAndSettle();
      expect(
        tester
            .widgetList<Image>(find.byType(Image))
            .where((w) => w.image is MemoryImage),
        isEmpty,
      );
      expect(tester.takeException(), isNull);
      await finishDraft(tester, desktop);
    });
  }
  testWidgets('chat renders generated Mac image through scoped workspace RPC', (
    tester,
  ) async {
    final transport = MarkdownMediaTransport(
      'Before image.\n\n![Result](/home/mac/.codex/generated_images/result.png)\n\nAfter image.',
    );
    final desktop = await reasoningDesktop(transport);
    try {
      await showConversation(tester, desktop);
      final reads = transport.calls
          .where((call) => call['method'] == 'workspace/readImage')
          .toList();
      expect(reads, hasLength(1));
      expect(reads.single['params'], {
        'path': '/home/mac/.codex/generated_images/result.png',
        'includeData': true,
        'maxPixelDimension': 1600,
        'cwd': '/repo',
      });
      final image = tester
          .widgetList<Image>(find.byType(Image))
          .singleWhere((image) => image.image is MemoryImage);
      expect((image.image as MemoryImage).bytes, base64Decode(mediaPng));
      expect(
        tester.getTopLeft(find.byWidget(image)).dy,
        greaterThan(
          tester
              .getBottomLeft(find.text('After image.', findRichText: true))
              .dy,
        ),
      );
      expect(tester.takeException(), isNull);
    } finally {
      await finishDraft(tester, desktop);
    }
  });
  for (final missingOwner in ['workspace', 'transport', 'identity']) {
    testWidgets('image does not read without its current $missingOwner owner', (
      tester,
    ) async {
      final transport = MarkdownMediaTransport(
        '![Result](/home/mac/.codex/generated_images/result.png)',
      );
      if (missingOwner == 'workspace') {
        transport.history!.remove('cwd');
      }
      final desktop = await reasoningDesktop(transport);
      if (missingOwner == 'transport') {
        transport.mac = 'other-mac';
      }
      if (missingOwner == 'identity') {
        desktop.active = Pairing(
          Map<String, dynamic>.of(desktop.active!.data)
            ..remove('macIdentityPublicKey'),
        );
        transport.online = false;
        desktop.state = 'disconnected';
      }
      try {
        await showConversation(tester, desktop);
        expect(
          transport.calls.where((c) => c['method'] == 'workspace/readImage'),
          isEmpty,
        );
        expect(
          tester
              .widgetList<Image>(find.byType(Image))
              .where((i) => i.image is MemoryImage),
          isEmpty,
        );
        expect(tester.takeException(), isNull);
      } finally {
        await finishDraft(tester, desktop);
      }
    });
  }
}
