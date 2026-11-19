import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:re_editor/re_editor.dart';
import 'package:djl_mobile/features/workspace/data/workspace_repository.dart';
import 'package:djl_mobile/features/workspace/presentation/workspace_linked_file_page.dart';
import 'workspace_linked_file_controller_test.dart';

import 'package:djl_mobile/core/design/djl_icons.dart';

Future<void> open(
  WidgetTester tester,
  PreviewTransport t,
  String path, {
  Brightness brightness = Brightness.light,
  double scale = 1,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(brightness: brightness),
      home: MediaQuery(
        data: MediaQueryData(
          size: const Size(390, 844),
          textScaler: TextScaler.linear(scale),
        ),
        child: WorkspaceLinkedFilePage(
          repository: WorkspaceRepository(t, cwd: '/repo', threadId: 't'),
          path: path,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  for (final failed in [false, true]) {
    testWidgets('preview chrome stays at the top when failed=$failed', (
      tester,
    ) async {
      final transport = PreviewTransport();
      if (failed) {
        transport.failures.addAll([
          'workspace/readImage',
          'workspace/readFile',
        ]);
      }
      await open(tester, transport, 'drawing.svg');
      final close = find.byTooltip(
        failed ? 'Close file preview' : 'Close SVG preview',
      );
      expect(tester.getCenter(close).dy, lessThan(90));
      if (failed) {
        expect(tester.getCenter(find.text('Retry')).dy, greaterThan(150));
      } else {
        expect(
          tester.getCenter(find.byTooltip('Reload SVG preview')).dy,
          lessThan(90),
        );
      }
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets(
    'linked text shows metadata and read-only unwrapped code, not a path form',
    (tester) async {
      final t = PreviewTransport();
      await open(tester, t, 'hello.txt');
      expect(find.text('Done'), findsOneWidget);
      expect(find.text('8 bytes'), findsOneWidget);
      expect(find.text('2 lines'), findsOneWidget);
      expect(find.text('UTF-8'), findsOneWidget);
      expect(find.text('/repo/hello.txt'), findsOneWidget);
      expect(find.text('File path on your Mac'), findsNothing);
      final editor = tester.widget<CodeEditor>(find.byType(CodeEditor));
      expect(editor.readOnly, isTrue);
      expect(editor.wordWrap, isFalse);
      expect(editor.autofocus, isFalse);
      expect(editor.maxLengthSingleLineRendering, isNull);
      expect(editor.controller!.text, 'hello\nhi');
      expect(find.byType(DefaultCodeLineNumber), findsOneWidget);
      expect(tester.testTextInput.hasAnyClients, isFalse);
      await tester.tap(find.byTooltip('Reload file'));
      await tester.pumpAndSettle();
      expect(t.calls, hasLength(2));
      expect((t.calls.last['params'] as Map)['ifByteLength'], 8);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('copy preserves exact text and transient feedback clears', (
    tester,
  ) async {
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied = call.arguments['text'] as String;
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
    await open(tester, PreviewTransport(), 'hello.txt');
    await tester.tap(find.byTooltip('Copy file contents'));
    await tester.pump();
    expect(copied, 'hello\nhi');
    expect(find.byIcon(DjlIcons.check), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 1700));
    expect(find.byIcon(DjlIcons.check), findsNothing);
    await tester.pumpWidget(const SizedBox());
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'focused mobile hardware keys cannot alter read-only file contents',
    (tester) async {
      await open(tester, PreviewTransport(), 'hello.txt');
      final editor = tester.widget<CodeEditor>(find.byType(CodeEditor));
      editor.focusNode!.requestFocus();
      editor.controller!.selectAll();
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.backspace);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.sendKeyEvent(LogicalKeyboardKey.numpadEnter);
      await tester.sendKeyEvent(LogicalKeyboardKey.delete);
      await tester.sendKeyEvent(LogicalKeyboardKey.keyA);
      await tester.pump();
      expect(editor.controller!.text, 'hello\nhi');
      expect(tester.testTextInput.hasAnyClients, isFalse);
      await tester.pumpWidget(const SizedBox());
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('find searches real code and next/previous match work', (
    tester,
  ) async {
    await open(tester, PreviewTransport(), 'hello.txt');
    await tester.tap(find.byTooltip('Find in file'));
    await tester.pumpAndSettle();
    final findController = tester
        .widget<CodeEditor>(find.byType(CodeEditor))
        .findController!;
    await tester.runAsync(() async {
      await tester.enterText(
        find.byKey(const Key('workspace_find_input')),
        'h',
      );
      final deadline = DateTime.now().add(const Duration(seconds: 5));
      while (findController.value?.result?.matches.length != 2 &&
          DateTime.now().isBefore(deadline)) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
    });
    await tester.pumpAndSettle();
    expect(
      findController.value?.result?.matches.length,
      2,
      reason: findController.value.toString(),
    );
    expect(findController.value?.result?.index, 0);
    expect(find.text('1 of 2'), findsOneWidget);
    await tester.tap(find.byTooltip('Next match'));
    await tester.pumpAndSettle();
    expect(find.text('2 of 2'), findsOneWidget);
    await tester.tap(find.byTooltip('Previous match'));
    await tester.pumpAndSettle();
    expect(find.text('1 of 2'), findsOneWidget);
    await tester.tap(find.byTooltip('Close find'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('workspace_find_input')), findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets('SVG uses image RPC and a full-screen zoom canvas', (
    tester,
  ) async {
    final t = PreviewTransport();
    await open(tester, t, 'drawing.svg');
    expect(t.calls.single['method'], 'workspace/readImage');
    expect(find.byTooltip('Close SVG preview'), findsOneWidget);
    expect(find.byTooltip('Reload SVG preview'), findsOneWidget);
    expect(find.byType(SvgPicture), findsOneWidget);
    expect(
      tester.widget<InteractiveViewer>(find.byType(InteractiveViewer)).maxScale,
      8,
    );
    expect(find.byTooltip('Save to Photos'), findsNothing);
    expect(find.text('File path on your Mac'), findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets('load errors expose Retry and recover', (tester) async {
    final t = PreviewTransport()
      ..failures.addAll(['workspace/readFile', 'workspace/readImage']);
    await open(tester, t, 'hello.txt');
    expect(find.textContaining('Cannot workspace/readFile'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    t.failures.clear();
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.byType(CodeEditor), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  for (final brightness in Brightness.values) {
    testWidgets('narrow large text metadata wraps in $brightness', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(320, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await open(
        tester,
        PreviewTransport(),
        'hello.txt',
        brightness: brightness,
        scale: 2,
      );
      expect(find.text('UTF-8'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets(
    'large code keeps all Unicode and long lines without highlighting or truncation',
    (tester) async {
      final long = '界😀e\u0301' * 18000;
      final content =
          '${List.generate(35000, (i) => 'let value$i = $i;').join('\n')}\n$long\nEND';
      final t = PreviewTransport()
        ..textResponse = {
          ...textReply('large.swift'),
          'byteLength': utf8.encode(content).length,
          'content': content,
          'lineCount': 35002,
        };
      await open(tester, t, 'large.swift');
      final editor = tester.widget<CodeEditor>(find.byType(CodeEditor));
      expect(editor.controller!.text, content);
      expect(editor.style!.codeTheme, isNull);
      expect(editor.maxLengthSingleLineRendering, isNull);
      editor.controller!.selectAll();
      expect(editor.controller!.selectedText, content);
      expect(tester.takeException(), isNull);
    },
  );
}
