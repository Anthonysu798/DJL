import 'dart:async';
import 'dart:convert';
import 'package:cryptography/cryptography.dart' show Sha256;
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/design/djl_tokens.dart';
import 'package:djl_mobile/features/chat/presentation/assistant_code_block.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_new_chat_draft_test.dart'
    show DraftTransport, draftDesktop, finishDraft;
import 'package:djl_mobile/features/desktop/presentation/desktop_conversation_view.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  Future<void> show(
    WidgetTester tester,
    String text, {
    bool user = false,
    AssistantCodeScope? scope,
    Brightness brightness = Brightness.light,
    AppFontStyle font = AppFontStyle.system,
    double scale = 1,
    void Function(String?)? link,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: djlTheme(brightness, font: font),
        home: MediaQuery(
          data: MediaQueryData(
            size: const Size(390, 640),
            textScaler: TextScaler.linear(scale),
          ),
          child: Scaffold(
            body: SingleChildScrollView(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: RepaintBoundary(
                  key: const ValueKey('code-paint'),
                  child: DesktopConversationMessage(
                    item: const {'id': 'same'},
                    text: text,
                    user: user,
                    codeScope: scope,
                    onTapLink: (_, href, _) => link?.call(href),
                    accessories: const [Text('Preserved accessory')],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Finder card(int index) => find.byType(AssistantCodeBlock).at(index);
  Finder action(int index, String label) =>
      find.descendant(of: card(index), matching: find.bySemanticsLabel(label));
  final writes = <String>[];
  final haptics = <Object?>[];
  setUpAll(() async {
    for (final family in ['Geist', 'GeistMono', 'JetBrainsMono']) {
      final loader = FontLoader(family);
      for (final weight in ['Regular', 'Medium', 'Bold']) {
        loader.addFont(rootBundle.load('assets/fonts/$family-$weight.ttf'));
      }
      await loader.load();
    }
  });
  setUp(() {
    writes.clear();
    haptics.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
          if (call.method == 'Clipboard.setData') {
            writes.add((call.arguments as Map)['text'] as String);
          }
          if (call.method == 'HapticFeedback.vibrate') {
            haptics.add(call.arguments);
          }
          return null;
        });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });
  test(
    'actual bundled Cupertino font has required family asset and exact glyph bytes',
    () async {
      const asset = 'packages/cupertino_icons/assets/CupertinoIcons.ttf';
      final data = await rootBundle.load(asset);
      final bytes = data.buffer.asUint8List(
        data.offsetInBytes,
        data.lengthInBytes,
      );
      expect(bytes.length, 257628);
      final digest = await Sha256().hash(bytes);
      expect(
        digest.bytes
            .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
            .join(),
        '67c44fe9183b002e79dde7f6977e2988661c9a3e4a3c5fce968787efdbed823c',
      );
      final manifest =
          jsonDecode(await rootBundle.loadString('FontManifest.json')) as List;
      final family = manifest.cast<Map<String, dynamic>>().singleWhere(
        (entry) => entry['family'] == 'packages/cupertino_icons/CupertinoIcons',
      );
      expect(
        (family['fonts'] as List).cast<Map<String, dynamic>>(),
        contains(containsPair('asset', asset)),
      );
    },
  );

  testWidgets('actual assistant parses separate code cards and exact copy body', (
    tester,
  ) async {
    const source =
        '# Heading\n\nProse [link](https://example.com) and `inline`.\n\n'
        '```js title=ignored\n\t  <tag>& **literal** e\u0301 😀  \n/repo/A.swift https://example.com?a=1&b=2\n\nend\t \n\n```\n\n'
        '~~~mYsTeRy-lang\nsecond\n~~~';
    await tester.pumpWidget(
      MaterialApp(
        theme: djlTheme(Brightness.light),
        home: Scaffold(
          body: SingleChildScrollView(
            child: DesktopConversationMessage(
              item: const {'id': 'a'},
              text: source,
              user: false,
              onTapLink: (_, _, _) {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('JavaScript'), findsOneWidget);
    expect(find.text('Mystery-Lang'), findsOneWidget);
    expect(find.bySemanticsLabel('Copy code'), findsNWidgets(2));
    expect(writes, isEmpty);
    expect(haptics, isEmpty);
    await tester.tap(find.bySemanticsLabel('Copy code').first);
    await tester.pump();
    expect(writes, [
      '\t  <tag>& **literal** e\u0301 😀  \n/repo/A.swift https://example.com?a=1&b=2\n\nend\t \n',
    ]);
    expect(haptics, ['HapticFeedbackType.lightImpact']);
    expect(find.text('Copied'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 1499));
    expect(find.text('Copied'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 1));
    expect(find.text('Copied'), findsNothing);
    expect(source.startsWith('# Heading'), isTrue);
  });

  testWidgets('actual AST aliases, empty indented nested and unclosed bodies', (
    tester,
  ) async {
    const aliases = {
      'bash': 'Shell',
      'c': 'C',
      'c++': 'C++',
      'cpp': 'C++',
      'cs': 'C#',
      'csharp': 'C#',
      'css': 'CSS',
      'diff': 'Diff',
      'dockerfile': 'Dockerfile',
      'fish': 'Shell',
      'go': 'Go',
      'haskell': 'Haskell',
      'hs': 'Haskell',
      'html': 'HTML',
      'java': 'Java',
      'javascript': 'JavaScript',
      'js': 'JavaScript',
      'json': 'JSON',
      'jsx': 'JSX',
      'kotlin': 'Kotlin',
      'kt': 'Kotlin',
      'lua': 'Lua',
      'makefile': 'Makefile',
      'markdown': 'Markdown',
      'md': 'Markdown',
      'objc': 'Objective-C',
      'objective-c': 'Objective-C',
      'objectivec': 'Objective-C',
      'php': 'PHP',
      'py': 'Python',
      'python': 'Python',
      'rb': 'Ruby',
      'ruby': 'Ruby',
      'rs': 'Rust',
      'rust': 'Rust',
      'scss': 'SCSS',
      'sh': 'Shell',
      'shell': 'Shell',
      'sql': 'SQL',
      'swift': 'Swift',
      'toml': 'TOML',
      'ts': 'TypeScript',
      'tsx': 'TSX',
      'typescript': 'TypeScript',
      'xml': 'XML',
      'yaml': 'YAML',
      'yml': 'YAML',
      'zsh': 'Shell',
    };
    for (final entry in aliases.entries) {
      await show(
        tester,
        '```${entry.key} metadata\nbody\n```'.replaceAll(r'\n', '\n'),
      );
      expect(find.text(entry.value), findsOneWidget, reason: entry.key);
    }
    const fixtures = <(String, String, String)>[
      ('```\n```', '', 'Code'),
      ('~~~py\n  lead\t \n~~~', '  lead\t ', 'Python'),
      ('```json\n{"x":1}', '{"x":1}', 'JSON'),
      ('    indented  \n    second\n', 'indented  \nsecond', 'Code'),
      ('> ```sh\n> echo nested\n> ```', 'echo nested', 'Shell'),
      ('- item\n\n  ```swift\n  let x = 1\n  ```', 'let x = 1', 'Swift'),
    ];
    for (final (markdown, expected, label) in fixtures) {
      await show(
        tester,
        markdown.replaceAll(r'\n', '\n').replaceAll(r'\t', '\t'),
      );
      expect(find.text(label), findsOneWidget);
      await tester.tap(action(0, 'Copy code'));
      await tester.pump();
      expect(
        writes.last,
        expected.replaceAll(r'\n', '\n').replaceAll(r'\t', '\t'),
      );
    }
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'shared fenced controls preserve prose links inline user and accessory',
    (tester) async {
      String? destination;
      await show(
        tester,
        '# Heading\n\n[Visit](https://example.com/a%20b) and `inline`\n\n```js\ncode\n```'
            .replaceAll(r'\n', '\n'),
        link: (href) => destination = href,
      );
      expect(
        tester.widget<MarkdownBody>(find.byType(MarkdownBody)).selectable,
        isTrue,
      );
      await tester.tapAt(
        tester.getTopLeft(find.textContaining('Visit', findRichText: true)) +
            const Offset(16, 8),
      );
      await tester.pump();
      expect(destination, 'https://example.com/a%20b');
      expect(find.text('Preserved accessory'), findsOneWidget);
      expect(find.byType(AssistantCodeBlock), findsOneWidget);
      await show(
        tester,
        'User `inline`\n\n```js\ncode\n```'.replaceAll(r'\n', '\n'),
        user: true,
      );
      expect(find.byType(AssistantCodeBlock), findsOneWidget);
      expect(find.byKey(const ValueKey('desktop-user-bubble')), findsOneWidget);
      expect(writes, isEmpty);
      expect(haptics, isEmpty);
    },
  );

  testWidgets('desktop setext hierarchy survives compact ATX normalization', (
    tester,
  ) async {
    Finder text(String value) => find.byWidgetPredicate(
      (widget) =>
          widget is SelectableText &&
          (widget.data ?? widget.textSpan?.toPlainText()) == value,
    );
    for (final user in [false, true]) {
      await show(
        tester,
        'Native heading\n==============\n\nParagraph.\n\n'
        'Second heading\n--------------\n\n# Compact heading',
        user: user,
      );
      final paragraph = tester.getSize(text('Paragraph.')).height;
      expect(
        tester.getSize(text('Native heading')).height,
        greaterThan(paragraph * 2),
      );
      expect(
        tester.getSize(text('Second heading')).height,
        greaterThan(paragraph * 1.5),
      );
      expect(
        tester.getSize(text('Compact heading')).height,
        lessThanOrEqualTo(paragraph * 1.25),
      );
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('user fenced actions copy exact bytes and reset with Mac scope', (
    tester,
  ) async {
    const source = 'User `inline`\n\n```text\n  exact code. \n```';
    const first = AssistantCodeScope(
      mac: 'mac-a',
      pin: 'pin-a',
      thread: 'thread-a',
      item: 'same',
    );
    const next = AssistantCodeScope(
      mac: 'mac-b',
      pin: 'pin-b',
      thread: 'thread-a',
      item: 'same',
    );
    await show(tester, source, user: true, scope: first);
    expect(find.byType(AssistantCodeBlock), findsOneWidget);
    expect(writes, isEmpty);
    await tester.tap(find.bySemanticsLabel('Copy code'));
    await tester.pump();
    expect(writes, ['  exact code. ']);
    expect(find.text('Copied'), findsOneWidget);
    await tester.tap(find.bySemanticsLabel('Disable word wrap'));
    await tester.pump();
    expect(find.bySemanticsLabel('Enable word wrap'), findsOneWidget);
    await show(tester, source, user: true, scope: next);
    expect(find.text('Copied'), findsNothing);
    expect(find.bySemanticsLabel('Disable word wrap'), findsOneWidget);
    expect(writes, ['  exact code. ']);
    expect(find.text('Preserved accessory'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'wrap changes real horizontal geometry and scroll only for one block; append retains it',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 640));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final token = List.filled(160, 'x').join();
      final source = '```js\n$token\n```\n\n```py\nsecond\n```'.replaceAll(
        r'\n',
        '\n',
      );
      await show(tester, source);
      final initial = tester.getSize(card(0));
      expect(
        find.descendant(
          of: card(0),
          matching: find.byType(SingleChildScrollView),
        ),
        findsNothing,
      );
      await tester.tap(action(0, 'Disable word wrap'));
      await tester.pumpAndSettle();
      final horizontal = find.descendant(
        of: card(0),
        matching: find.byType(SingleChildScrollView),
      );
      expect(horizontal, findsOneWidget);
      expect(tester.getSize(card(0)).height, lessThan(initial.height));
      expect(
        tester
            .widget<SingleChildScrollView>(horizontal)
            .controller!
            .position
            .maxScrollExtent,
        greaterThan(0),
      );
      await tester.dragFrom(
        tester.getTopLeft(horizontal) + const Offset(2, 2),
        const Offset(-180, 0),
      );
      await tester.pumpAndSettle();
      expect(
        tester.widget<SingleChildScrollView>(horizontal).controller!.offset,
        greaterThan(0),
      );
      expect(action(1, 'Disable word wrap'), findsOneWidget);
      await show(tester, '$source\n\nAppended prose'.replaceAll(r'\n', '\n'));
      expect(action(0, 'Enable word wrap'), findsOneWidget);
      expect(
        tester.widget<SingleChildScrollView>(horizontal).controller!.offset,
        greaterThan(0),
      );
      await tester.tap(action(0, 'Enable word wrap'));
      await tester.pumpAndSettle();
      expect(tester.getSize(card(0)).height, initial.height);
      expect(writes, isEmpty);
      expect(haptics, isEmpty);
    },
  );

  testWidgets(
    'copy overlapping completions failure text changes repeat timer and disposal',
    (tester) async {
      final pending = <Completer<void>>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
            if (call.method == 'Clipboard.setData') {
              writes.add((call.arguments as Map)['text'] as String);
              final completion = Completer<void>();
              pending.add(completion);
              await completion.future;
            }
            if (call.method == 'HapticFeedback.vibrate') {
              haptics.add(call.arguments);
            }
            return null;
          });
      const source = '```js\none\n```\n\n```py\ntwo\n```';
      await show(tester, source.replaceAll(r'\n', '\n'));
      await tester.tap(action(0, 'Copy code'));
      await tester.pump();
      expect(find.text('Copied'), findsNothing);
      await tester.tap(action(0, 'Copy code'));
      await tester.pump();
      pending[1].complete();
      await tester.pump();
      await tester.pump();
      expect(find.text('Copied'), findsOneWidget);
      expect(action(1, 'Copy code'), findsOneWidget);
      pending[0].complete();
      await tester.pump();
      await tester.pump();
      expect(haptics.length, 1);
      await tester.pump(const Duration(milliseconds: 1000));
      await tester.tap(action(0, 'Copied'));
      await tester.pump();
      pending[2].complete();
      await tester.pump();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1000));
      expect(find.text('Copied'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.text('Copied'), findsNothing);
      await tester.tap(action(0, 'Copy code'));
      await tester.pump();
      pending[3].completeError(PlatformException(code: 'clipboard-denied'));
      await tester.pump();
      expect(find.text('Copied'), findsNothing);
      expect(haptics.length, 2);
      await tester.tap(action(0, 'Copy code'));
      await tester.pump();
      await show(
        tester,
        source.replaceFirst('one', 'changed').replaceAll(r'\n', '\n'),
      );
      pending[4].complete();
      await tester.pump();
      await tester.pump();
      expect(find.text('Copied'), findsNothing);
      await tester.tap(action(0, 'Copy code'));
      await tester.pump();
      await tester.pumpWidget(const SizedBox());
      pending[5].complete();
      await tester.pump(const Duration(seconds: 2));
      expect(tester.takeException(), isNull);
      expect(haptics.length, 2);
    },
  );

  testWidgets(
    'production Page resets code state for colliding host pin thread and item IDs without exposing pin',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      const code = '```js\nlong code\n```';
      Future<void> render({
        String mac = 'mac-a',
        String pin = 'private-pin-a',
        String thread = 'thread-a',
        String item = 'same',
      }) async {
        desktop.active = Pairing({
          'macDeviceId': mac,
          'macIdentityPublicKey': pin,
        });
        desktop.thread = {'id': thread, 'title': 'Code test', 'cwd': '/repo'};
        desktop.timeline = [
          {
            'id': item,
            'type': 'agentMessage',
            'text': code.replaceAll(r'\n', '\n'),
          },
        ];
        await tester.pumpWidget(
          MaterialApp(
            theme: djlTheme(Brightness.light),
            home: DesktopChatPage(controller: desktop),
          ),
        );
        desktop.notifyListeners();
        await tester.pumpAndSettle();
      }

      await render();
      final calls = List.of(remote.calls);
      for (final scope in [
        ('mac-b', 'private-pin-a', 'thread-a', 'same'),
        ('mac-b', 'private-pin-b', 'thread-a', 'same'),
        ('mac-b', 'private-pin-b', 'thread-b', 'same'),
        ('mac-b', 'private-pin-b', 'thread-b', 'other'),
      ]) {
        await tester.tap(action(0, 'Disable word wrap'));
        await tester.pump();
        await tester.tap(action(0, 'Copy code'));
        await tester.pump();
        expect(find.text('Copied'), findsOneWidget);
        await render(
          mac: scope.$1,
          pin: scope.$2,
          thread: scope.$3,
          item: scope.$4,
        );
        expect(action(0, 'Disable word wrap'), findsOneWidget);
        expect(find.text('Copied'), findsNothing);
        expect(find.textContaining('private-pin'), findsNothing);
        expect(
          tester.element(card(0)).toStringDeep(),
          isNot(contains('private-pin')),
        );
      }
      expect(desktop.timeline.single['text'], code.replaceAll(r'\n', '\n'));
      expect(remote.calls, calls);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'old async completion and horizontal offset cannot cross a private scope',
    (tester) async {
      final pending = Completer<void>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
            if (call.method == 'Clipboard.setData') await pending.future;
            if (call.method == 'HapticFeedback.vibrate') {
              haptics.add(call.arguments);
            }
            return null;
          });
      const first = AssistantCodeScope(
        mac: 'mac',
        pin: 'secret-one',
        thread: 'thread',
        item: 'same',
      );
      const next = AssistantCodeScope(
        mac: 'mac',
        pin: 'secret-two',
        thread: 'thread',
        item: 'same',
      );
      final source = '```js\n${'long' * 100}\n```'.replaceAll(r'\n', '\n');
      await show(tester, source, scope: first);
      await tester.tap(action(0, 'Disable word wrap'));
      await tester.pumpAndSettle();
      final horizontal = find.descendant(
        of: card(0),
        matching: find.byType(SingleChildScrollView),
      );
      await tester.dragFrom(
        tester.getTopLeft(horizontal) + const Offset(2, 2),
        const Offset(-180, 0),
      );
      await tester.pumpAndSettle();
      expect(
        tester.widget<SingleChildScrollView>(horizontal).controller!.offset,
        greaterThan(0),
      );
      await tester.tap(action(0, 'Copy code'));
      await tester.pump();
      await show(tester, source, scope: next);
      pending.complete();
      await tester.pump();
      await tester.pump();
      expect(find.text('Copied'), findsNothing);
      expect(haptics, isEmpty);
      expect(action(0, 'Disable word wrap'), findsOneWidget);
      await tester.tap(action(0, 'Disable word wrap'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<SingleChildScrollView>(horizontal).controller!.offset,
        0,
      );
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('actual painted neutral light and dark card fills', (
    tester,
  ) async {
    for (final brightness in Brightness.values) {
      await show(
        tester,
        '```js\nbody\n```'.replaceAll(r'\n', '\n'),
        brightness: brightness,
      );
      final boundary = tester.renderObject<RenderRepaintBoundary>(
        find.byKey(const ValueKey('code-paint')),
      );
      final origin = tester.getTopLeft(
        find.byKey(const ValueKey('code-paint')),
      );
      final sample = tester.getTopLeft(card(0)) - origin + const Offset(3, 36);
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 1);
        final pixels = (await image.toByteData(
          format: ui.ImageByteFormat.rawRgba,
        ))!;
        final offset =
            (sample.dy.floor() * image.width + sample.dx.floor()) * 4;
        final actual = Color.fromARGB(
          pixels.getUint8(offset + 3),
          pixels.getUint8(offset),
          pixels.getUint8(offset + 1),
          pixels.getUint8(offset + 2),
        );
        expect(
          actual.toARGB32(),
          (brightness == Brightness.dark ? DjlColors.dark : DjlColors.light)
              .surfaceRaised
              .toARGB32(),
        );
        image.dispose();
      });
    }
  });

  for (final width in [360.0, 393.0]) {
    for (final brightness in Brightness.values) {
      for (final font in AppFontStyle.values) {
        for (final scale in [1.0, 2.2]) {
          testWidgets(
            'paint geometry controls $width/${brightness.name}/${font.name}/$scale',
            (tester) async {
              await tester.binding.setSurfaceSize(Size(width, 640));
              addTearDown(() => tester.binding.setSurfaceSize(null));
              await show(
                tester,
                '```very-long-language-that-must-ellipsize\n${'word ' * 25}\n```'
                    .replaceAll(r'\n', '\n'),
                brightness: brightness,
                font: font,
                scale: scale,
              );
              final language = tester.widget<Text>(
                find.text('Very-Long-Language-That-Must-Ellipsize'),
              );
              expect(language.style!.fontSize, 15);
              final semantics = tester.ensureSemantics();
              try {
                expect(
                  tester
                      .getSemantics(action(0, 'Copy code'))
                      .getSemanticsData()
                      .hasAction(ui.SemanticsAction.tap),
                  isTrue,
                );
                expect(
                  tester
                      .getSemantics(action(0, 'Disable word wrap'))
                      .getSemanticsData()
                      .hasAction(ui.SemanticsAction.tap),
                  isTrue,
                );
                final bounds = tester.getRect(card(0));
                expect(bounds.left, 16);
                expect(bounds.right, width - 16);
                final wrap = tester.getRect(action(0, 'Disable word wrap'));
                final copy = tester.getRect(action(0, 'Copy code'));
                expect(wrap.width, greaterThanOrEqualTo(44));
                expect(copy.height, greaterThanOrEqualTo(44));
                expect(wrap.right, lessThanOrEqualTo(copy.left));
                expect(bounds.contains(copy.bottomRight), isTrue);
                final decoration =
                    tester
                            .widget<DecoratedBox>(
                              find
                                  .descendant(
                                    of: card(0),
                                    matching: find.byType(DecoratedBox),
                                  )
                                  .first,
                            )
                            .decoration
                        as BoxDecoration;
                expect(decoration.borderRadius, BorderRadius.circular(20));
                expect((decoration.border! as Border).top.width, .5);
                expect(
                  (decoration.border! as Border).top.color,
                  (brightness == Brightness.dark
                          ? DjlColors.dark
                          : DjlColors.light)
                      .hairline,
                );
                final body = tester.widget<SelectableText>(
                  find.descendant(
                    of: card(0),
                    matching: find.byType(SelectableText),
                  ),
                );
                expect(body.style!.fontFamily, font.codeFamily);
                expect(body.style!.fontSize, 15 * .882);
                expect(body.style!.height, 1.39);
                tester.binding.performSemanticsAction(
                  ui.SemanticsActionEvent(
                    type: ui.SemanticsAction.tap,
                    viewId: tester.view.viewId,
                    nodeId: tester.getSemantics(action(0, 'Copy code')).id,
                  ),
                );
                await tester.pump();
                await tester.pump();
                expect(writes, hasLength(1));
                expect(haptics, ['HapticFeedbackType.lightImpact']);
                expect(action(0, 'Copied').hitTestable(), findsOneWidget);
                expect(
                  tester.getRect(action(0, 'Copied')).right,
                  lessThanOrEqualTo(bounds.right),
                );
                expect(tester.takeException(), isNull);
                await tester.pumpWidget(const SizedBox());
              } finally {
                semantics.dispose();
              }
            },
          );
        }
      }
    }
  }
}
