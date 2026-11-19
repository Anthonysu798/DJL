import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:djl_mobile/features/workspace/presentation/workspace_linked_file_page.dart';
import 'package:re_editor/re_editor.dart';
import 'package:djl_mobile/features/workspace/presentation/project_picker_page.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_conversation_view.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_focus_timeline.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_composer_widgets.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/design/djl_tokens.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/settings/domain/appearance.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_new_chat_draft_test.dart'
    show DraftTransport, draftDesktop, finishDraft;

class ConversationLinkTransport extends DraftTransport {
  ConversationLinkTransport(super.pairings);
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'workspace/readFile') {
      calls.add({'method': method, 'params': params});
      return {
        'path': params['path'],
        'fileName': 'My File.dart',
        'content': 'Actual workspace content',
        'byteLength': 24,
      };
    }
    return super.request(method, params, timeout: timeout);
  }
}

Future<void> showConversation(
  WidgetTester tester,
  DesktopController desktop, {
  DesktopNewChatDraft? draft,
  Brightness brightness = Brightness.light,
  AppFontStyle font = AppFontStyle.system,
  double scale = 1,
  double keyboard = 0,
  DesktopLinkTarget? focus,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(brightness, font: font),
      home: Builder(
        builder: (context) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(scale),
            viewInsets: EdgeInsets.only(bottom: keyboard),
            disableAnimations: true,
          ),
          child: DesktopChatPage(
            controller: desktop,
            draft: draft,
            focusTarget: focus,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    for (final family in ['Geist', 'GeistMono', 'JetBrainsMono']) {
      final loader = FontLoader(family);
      for (final weight in ['Regular', 'Medium', 'Bold']) {
        loader.addFont(rootBundle.load('assets/fonts/$family-$weight.ttf'));
      }
      await loader.load();
    }
  });
  testWidgets('general draft hero is local and keeps draft ownership', (
    tester,
  ) async {
    final remote = DraftTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    final draft = desktop.beginNewChatDraft()!;
    final calls = List.of(remote.calls);
    await showConversation(tester, desktop, draft: draft);
    expect(find.text('What should we work on?'), findsOneWidget);
    expect(find.text('Chats are End-to-end encrypted'), findsOneWidget);
    expect(find.text('Choose a project'), findsNothing);
    expect(find.byTooltip('Select folder'), findsNothing);
    expect(find.byType(ListView), findsNothing);
    expect(
      find.descendant(
        of: find.byType(DesktopConversationHero),
        matching: find.byType(Scrollable),
      ),
      findsNothing,
    );
    expect(remote.calls, calls);
    expect(identical(desktop.newChatDraft, draft), isTrue);
    expect(desktop.thread, isNull);
    await finishDraft(tester, desktop);
  });

  testWidgets('project-backed general draft has an inline recent-folder menu', (
    tester,
  ) async {
    final remote = DraftTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    for (final row in <RemoteJson>[
      {'id': 'a', 'cwd': '/repo/First folder', 'updatedAt': 20},
      {'id': 'b', 'cwd': '/repo/Second folder', 'updatedAt': 10},
      {'id': 'studio', 'cwd': '/h/.codex/threads/one', 'updatedAt': 50},
    ]) {
      desktop.threadList.data.upsert(row);
    }
    final draft = desktop.beginNewChatDraft(
      cwd: '/repo/First folder',
      source: DesktopDraftSource.generalChat,
    )!;
    await showConversation(tester, desktop, draft: draft);
    final before = List.of(remote.calls);
    final hero = find.byType(DesktopConversationHero);
    final picker = find.byTooltip('Select folder');
    expect(find.descendant(of: hero, matching: picker), findsOneWidget);
    expect(find.text('/repo/First folder'), findsNothing);
    await tester.tap(picker);
    await tester.pumpAndSettle();
    expect(find.byType(ProjectPickerPage), findsNothing);
    expect(find.text('Browse local folders…'), findsOneWidget);
    expect(find.text('Second folder'), findsOneWidget);
    expect(find.text('Quick Chat'), findsNothing);
    await tester.tap(find.text('Second folder'));
    await tester.pumpAndSettle();
    expect(draft.cwd, '/repo/Second folder');
    expect(
      find.descendant(of: hero, matching: find.text('Second folder')),
      findsOneWidget,
    );
    expect(remote.calls, before);
    expect(remote.starts, 0);
    await tester.tap(picker);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Browse local folders…'));
    await tester.pumpAndSettle();
    expect(find.byType(ProjectPickerPage), findsOneWidget);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    expect(draft.cwd, '/repo/Second folder');
    expect(remote.starts, 0);
    await finishDraft(tester, desktop);
  });

  testWidgets(
    'inline folder menu preserves active composer focus and selection',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.threadList.data.upsert({
        'id': 'other',
        'cwd': '/repo/Other folder',
      });
      final draft = desktop.beginNewChatDraft(
        cwd: '/repo/First folder',
        source: DesktopDraftSource.generalChat,
      )!;
      await showConversation(tester, desktop, draft: draft);
      final field = find.byKey(const Key('desktop_composer'));
      await tester.showKeyboard(field);
      await tester.enterText(field, 'Keep selected text');
      final input = tester.widget<EditableText>(find.byType(EditableText));
      input.controller.selection = const TextSelection(
        baseOffset: 5,
        extentOffset: 13,
      );
      expect(input.focusNode.hasFocus, isTrue);
      await tester.tap(find.byTooltip('Select folder'));
      await tester.pumpAndSettle();
      expect(input.focusNode.hasFocus, isTrue);
      expect(tester.testTextInput.isVisible, isTrue);
      await tester.tap(find.text('Other folder'));
      await tester.pumpAndSettle();
      expect(draft.cwd, '/repo/Other folder');
      expect(input.focusNode.hasFocus, isTrue);
      expect(input.controller.text, 'Keep selected text');
      expect(
        input.controller.selection,
        const TextSelection(baseOffset: 5, extentOffset: 13),
      );
      expect(remote.starts, 0);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'inline folder picker remains reachable with short keyboard and large text',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(360, 640));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      final draft = desktop.beginNewChatDraft(
        cwd: '/repo/Long accessible folder name',
        source: DesktopDraftSource.generalChat,
      )!;
      await showConversation(
        tester,
        desktop,
        draft: draft,
        scale: 2.2,
        keyboard: 300,
      );
      expect(tester.takeException(), isNull);
      final picker = find.byTooltip('Select folder');
      await tester.ensureVisible(picker);
      await tester.pumpAndSettle();
      await tester.tap(picker);
      await tester.pumpAndSettle();
      expect(find.text('Browse local folders…'), findsOneWidget);
      expect(tester.takeException(), isNull);
      expect(remote.starts, 0);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets('folder draft title opens picker without creating a thread', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(402, 874));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final remote = DraftTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    final draft = desktop.beginNewChatDraft(cwd: '/repo/workspace')!;
    await showConversation(
      tester,
      desktop,
      draft: draft,
      font: AppFontStyle.geist,
    );
    expect(find.text('/repo/workspace'), findsNothing);
    expect(tester.widget<AppBar>(find.byType(AppBar)).centerTitle, isTrue);
    expect(tester.getCenter(find.text('New thread')).dx, closeTo(201, .5));
    await tester.tap(find.text('New thread'));
    await tester.pumpAndSettle();
    expect(find.byType(ProjectPickerPage), findsOneWidget);
    expect(remote.starts, 0);
    expect(identical(desktop.newChatDraft, draft), isTrue);
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    expect(find.text('What should we do in workspace?'), findsOneWidget);
    expect(draft.cwd, '/repo/workspace');
    expect(remote.starts, 0);
    await finishDraft(tester, desktop);
  });

  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    testWidgets('paired hero uses native system typography on $platform', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: djlTheme(Brightness.light).copyWith(platform: platform),
          home: const Scaffold(
            body: DesktopConversationHero(draft: true, folder: 'workspace'),
          ),
        ),
      );
      final title = tester
          .widget<Text>(find.text('What should we do in workspace?'))
          .textSpan!
          .style!;
      final caption = tester
          .widget<Text>(find.text('Chats are End-to-end encrypted'))
          .style!;
      expect(title.fontSize, 20);
      expect(title.height, 1.2);
      expect(title.letterSpacing, platform == TargetPlatform.iOS ? -.45 : 0);
      expect(caption.letterSpacing, platform == TargetPlatform.iOS ? .06 : 0);
      expect(
        title.fontVariations,
        platform == TargetPlatform.iOS
            ? [const FontVariation.opticalSize(20)]
            : isNull,
      );
      expect(title.fontWeight, FontWeight.w400);
    });
  }

  testWidgets('source user gutter padding tint and plain assistant geometry', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(400, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final remote = DraftTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    desktop.thread = {
      'id': 'saved',
      'title': 'Actual conversation',
      'cwd': '/work/project',
    };
    desktop.timeline = [
      {'id': 'u', 'type': 'userMessage', 'text': 'Short user'},
      {'id': 'a', 'type': 'agentMessage', 'text': 'Assistant prose'},
    ];
    await showConversation(tester, desktop);
    expect(find.text('You'), findsNothing);
    expect(find.text('DJL'), findsNothing);
    final user = tester.getRect(find.byKey(const ValueKey<dynamic>('u')));
    final assistant = tester.getRect(find.byKey(const ValueKey<dynamic>('a')));
    final text = tester.getRect(find.text('Short user'));
    expect(user.left, 16);
    expect(text.left, greaterThanOrEqualTo(16 + 60 + 16));
    expect(user.bottom + 14, assistant.top);
    expect(tester.getRect(find.text('Assistant prose')).left, 16);
    final markdown = tester
        .widgetList<MarkdownBody>(find.byType(MarkdownBody))
        .first;
    expect(markdown.styleSheet!.p!.color, DjlColors.light.onInk);
    final fill = tester.widget<Container>(
      find.byKey(const ValueKey('desktop-user-bubble')),
    );
    expect((fill.decoration as BoxDecoration).color, DjlColors.light.ink);
    expect(
      text.top -
          tester.getRect(find.byKey(const ValueKey('desktop-user-bubble'))).top,
      12,
    );
    expect(
      (fill.decoration as BoxDecoration).borderRadius,
      BorderRadius.circular(22),
    );
    expect(
      remote.calls.where((c) => c['method'] != 'thread/goal/get'),
      isEmpty,
    );
    await finishDraft(tester, desktop);
  });
  for (final entry in <(Map<String, dynamic>, String)>[
    ({'cwd': '/work/Actual folder/'}, 'What should we do in Actual folder?'),
    ({'cwd': '/work/project', 'djlScope': 'studio'}, 'Hi! How can I help you?'),
    (
      {'cwd': '/Users/me/Documents/Codex/2026-10-29/example'},
      'Hi! How can I help you?',
    ),
    ({'cwd': '/Users/me/.codex/threads/example'}, 'Hi! How can I help you?'),
    (
      {'cwd': '/Users/me/.codex/threads/example', 'djlScope': 'project'},
      'What should we do in example?',
    ),
    ({'cwd': ''}, 'Hi! How can I help you?'),
    ({'cwd': 'server'}, 'Hi! How can I help you?'),
    ({'cwd': '/'}, 'What should we do in /?'),
  ]) {
    testWidgets('saved hero respects source scope ${entry.$1}', (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'saved', ...entry.$1};
      await showConversation(tester, desktop);
      expect(find.text(entry.$2), findsOneWidget);
      expect(find.byType(DesktopFocusTimeline), findsNothing);
      expect(remote.starts, 0);
      await finishDraft(tester, desktop);
    });
  }

  testWidgets(
    'draft source stays general after real project selection and folder draft uses folder',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      final general = desktop.beginNewChatDraft()!;
      await showConversation(tester, desktop, draft: general);
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Unsent identity',
      );
      final editable = tester.state(find.byType(EditableText));
      final calls = List.of(remote.calls);
      desktop.updateNewChatDraftCwd(general, '/repo/new-folder/');
      await tester.pumpAndSettle();
      expect(find.text('What should we work on?'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(DesktopConversationHero),
          matching: find.text('new-folder'),
        ),
        findsOneWidget,
      );
      expect(tester.state(find.byType(EditableText)), same(editable));
      expect(
        desktop.threadList.data.composerDraft(general.storageKey).text,
        'Unsent identity',
      );
      expect(remote.calls, calls);
      await tester.pumpWidget(const SizedBox());
      final folder = desktop.beginNewChatDraft(cwd: '/repo/Chosen folder/')!;
      await showConversation(tester, desktop, draft: folder);
      expect(find.text('What should we do in Chosen folder?'), findsOneWidget);
      expect(remote.starts, 0);
      await finishDraft(tester, desktop);
    },
  );

  for (final gate in [
    'busy',
    'turn',
    'request',
    'approval',
    'loading',
    'disconnected',
    'error',
    'navigation',
    'focus',
  ]) {
    testWidgets('idle hero does not replace $gate authority', (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      final draft = desktop.beginNewChatDraft()!;
      switch (gate) {
        case 'busy':
          desktop.busy = true;
        case 'turn':
          desktop.turnId = 'running';
        case 'request':
          desktop.userInputs.add({
            'id': 'q',
            'method': 'item/tool/requestUserInput',
            'params': {'questions': []},
          });
        case 'approval':
          desktop.approvals.add({
            'id': 'r',
            'method': 'item/commandExecution/requestApproval',
            'params': {'command': 'actual command'},
          });
        case 'loading':
          desktop.state = 'connecting';
        case 'disconnected':
          remote.online = false;
        case 'error':
          desktop.error = 'Actual error';
        case 'navigation':
          desktop.navigationError = 'Actual missing history';
      }
      await showConversation(
        tester,
        desktop,
        draft: draft,
        focus: gate == 'focus'
            ? const DesktopLinkTarget('saved', item: 'missing')
            : null,
      );
      expect(find.byType(DesktopConversationHero), findsNothing);
      expect(find.text('Loading chat...'), findsNothing);
      if (gate == 'error') expect(find.text('Actual error'), findsOneWidget);
      if (gate == 'disconnected') {
        expect(find.text('Reconnect'), findsOneWidget);
      }
      if (gate == 'approval') {
        expect(find.text('Approval required'), findsOneWidget);
      }
      expect(remote.starts, 0);
      await finishDraft(tester, desktop);
    });
  }

  for (final font in AppFontStyle.values) {
    for (final brightness in Brightness.values) {
      for (final keyboard in [0.0, 300.0]) {
        testWidgets(
          'hero full text and toolbar fit $font $brightness keyboard $keyboard large text',
          (tester) async {
            await tester.binding.setSurfaceSize(const Size(360, 640));
            addTearDown(() => tester.binding.setSurfaceSize(null));
            final remote = DraftTransport(PairingRepository(TestCredentials()));
            final desktop = await draftDesktop(remote);
            final draft = desktop.beginNewChatDraft(
              cwd: '/repo/Long accessible folder name',
            )!;
            await showConversation(
              tester,
              desktop,
              draft: draft,
              font: font,
              brightness: brightness,
              scale: 2.2,
              keyboard: keyboard,
            );
            expect(tester.takeException(), isNull);
            expect(
              find.text('What should we do in Long accessible folder name?'),
              findsOneWidget,
            );
            final semantics = tester.ensureSemantics();
            expect(
              find.bySemanticsLabel('New thread, Long accessible folder name'),
              findsOneWidget,
            );
            semantics.dispose();
            expect(
              find.descendant(
                of: find.byType(DesktopConversationTitle),
                matching: find.byType(InkWell),
              ),
              findsNothing,
            );
            final title = tester.widget<Text>(find.text('New thread'));
            expect(title.style?.fontSize, 14);
            expect(
              title.style?.fontFamily,
              Theme.of(
                tester.element(find.text('New thread')),
              ).textTheme.bodyMedium?.fontFamily,
            );
            expect(
              tester.getRect(find.text('New thread')).right,
              lessThanOrEqualTo(
                tester.getRect(find.byTooltip('Git actions')).left,
              ),
            );
            final hero = find.byType(DesktopConversationHero);
            final text = tester.widget<Text>(
              find.descendant(
                of: hero,
                matching: find.text(
                  'What should we do in Long accessible folder name?',
                ),
              ),
            );
            expect(text.maxLines, isNull);
            expect(text.textSpan?.style?.fontSize, 20);
            expect(remote.calls, isEmpty);
            await finishDraft(tester, desktop);
          },
        );
      }
    }
  }

  for (final brightness in Brightness.values) {
    testWidgets('painted source palette $brightness and selectable live prose', (
      tester,
    ) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'saved'};
      desktop.timeline = [
        {
          'id': 'u',
          'type': 'userMessage',
          'text': 'User literal /repo/a.dart:12',
        },
        {
          'id': 'a',
          'type': 'agentMessage',
          'text':
              '# Heading\n\n[Web](https://example.com/path%20name)\n\n```dart\n# untouched\n```',
        },
      ];
      await showConversation(tester, desktop, brightness: brightness);
      final dark = brightness == Brightness.dark;
      final fill = tester.widget<Container>(
        find.byKey(const ValueKey('desktop-user-bubble')),
      );
      final expected = (dark ? DjlColors.dark : DjlColors.light).ink;
      expect((fill.decoration as BoxDecoration).color, expected);
      expect(
        tester.renderObject(find.byKey(const ValueKey('desktop-user-bubble'))),
        paints..rrect(color: expected),
      );
      final bodies = tester
          .widgetList<MarkdownBody>(find.byType(MarkdownBody))
          .toList();
      expect(bodies.first.data, 'User literal /repo/a.dart:12');
      expect(bodies.every((body) => body.selectable), isTrue);
      expect(
        bodies.last.data,
        '**Heading**\n\n[Web](https://example.com/path%20name)\n\n```dart\n# untouched\n```',
      );
      final element = tester.element(find.byKey(const ValueKey<dynamic>('a')));
      desktop.timeline.last['text'] = 'Live replacement keeps stable row';
      desktop.notifyListeners();
      await tester.pumpAndSettle();
      expect(
        tester.element(find.byKey(const ValueKey<dynamic>('a'))),
        same(element),
      );
      expect(find.text('Live replacement keeps stable row'), findsOneWidget);
      expect(find.byTooltip('Read aloud'), findsNothing);
      expect(tester.takeException(), isNull);
      await finishDraft(tester, desktop);
    });
  }

  testWidgets('media-only and context-only messages have no empty text fill', (
    tester,
  ) async {
    final remote = DraftTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    desktop.thread = {'id': 'saved'};
    desktop.timeline = [
      {
        'id': 'media',
        'type': 'userMessage',
        'content': [
          {
            'type': 'image',
            'url':
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          },
        ],
      },
      {
        'id': 'mention',
        'type': 'userMessage',
        'content': [
          {'type': 'skill', 'name': 'review'},
        ],
      },
    ];
    await showConversation(tester, desktop);
    expect(find.byType(DesktopImagePreview), findsOneWidget);
    expect(find.text(r'$review'), findsOneWidget);
    expect(find.byKey(const ValueKey('desktop-user-bubble')), findsNothing);
    expect(tester.takeException(), isNull);
    await finishDraft(tester, desktop);
  });

  testWidgets(
    'normal and focused paths retain logical 12 inset and 14 row gap',
    (tester) async {
      for (final target in [null, 0, 1]) {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: DesktopFocusTimeline(
                count: 3,
                target: target,
                itemBuilder: (_, i) => SizedBox(
                  key: ValueKey('geometry-$i'),
                  height: 40 + i * 10.0,
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final first = tester.getRect(
          find.byKey(ValueKey('geometry-${target ?? 0}')),
        );
        final next = tester.getRect(
          find.byKey(ValueKey('geometry-${(target ?? 0) + 1}')),
        );
        expect(first.left, 16);
        expect(next.top - first.bottom, 14);
        expect(first.top, target == 1 ? 66 : 12);
      }
    },
  );
  testWidgets(
    'actual markdown HTTPS and workspace taps retain destinations and read gates',
    (tester) async {
      final remote = ConversationLinkTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'saved', 'cwd': '/repo'};
      desktop.timeline = [
        {
          'id': 'a',
          'type': 'agentMessage',
          'text':
              '[Web](https://example.com/path%20name)\n\n[File](file:///repo/My%20File.dart#L12)\n\n[Remote](file://another-host/a.dart)\n\n[Unsupported](ftp://example.com/a.dart)',
        },
      ];
      final launched = <MethodCall>[];
      const channel = MethodChannel('plugins.flutter.io/url_launcher');
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
        call,
      ) async {
        launched.add(call);
        return true;
      });
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          channel,
          null,
        ),
      );
      await showConversation(tester, desktop);
      expect(
        remote.calls.where(
          (call) => call['method'].toString().startsWith('workspace/'),
        ),
        isEmpty,
      );
      expect(launched, isEmpty);
      await tester.tap(find.text('Web'));
      await tester.pumpAndSettle();
      expect(
        launched.single.arguments['url'],
        'https://example.com/path%20name',
      );
      for (final label in ['Remote', 'Unsupported']) {
        await tester.tap(find.text(label));
        await tester.pumpAndSettle();
        expect(find.byType(WorkspaceLinkedFilePage), findsNothing);
      }
      expect(
        remote.calls.where(
          (call) => call['method'].toString().startsWith('workspace/'),
        ),
        isEmpty,
      );
      await tester.tap(find.text('File'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<CodeEditor>(find.byType(CodeEditor)).controller!.text,
        'Actual workspace content',
      );
      final reads = remote.calls
          .where((call) => call['method'] == 'workspace/readFile')
          .toList();
      expect(reads, hasLength(1));
      expect(reads.single['params']['path'], '/repo/My File.dart');
      expect(reads.single['params']['cwd'], '/repo');
      expect(
        tester
            .widget<WorkspaceLinkedFilePage>(
              find.byType(WorkspaceLinkedFilePage),
            )
            .repository
            .threadId,
        'saved',
      );
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Read aloud'), findsNothing);
      expect(tester.takeException(), isNull);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'long selectable prose and fences retain complete underlying contents at narrow large text',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(360, 640));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'saved'};
      final text =
          '# Heading\n\n${List.filled(30, 'Full paragraph with `inline` code and words.').join('\n\n')}\n\n- first\n- second\n\n> Full quote\n\n| A | B |\n|---|---|\n| one | two |\n\n~~~dart\n# preserve ${List.filled(90, 'longToken').join()}\n~~~\n\nFinal retained text';
      desktop.timeline = [
        {'id': 'a', 'type': 'agentMessage', 'text': text},
      ];
      await showConversation(
        tester,
        desktop,
        scale: 2.2,
        font: AppFontStyle.geistMono,
      );
      final body = tester.widget<MarkdownBody>(find.byType(MarkdownBody));
      expect(body.selectable, isTrue);
      expect(body.data, text.replaceFirst('# Heading', '**Heading**'));
      expect(desktop.timeline.single['text'], text);
      expect(tester.takeException(), isNull);
      await tester.drag(
        find.byType(DesktopFocusTimeline),
        const Offset(0, -10000),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await finishDraft(tester, desktop);
    },
  );
  testWidgets(
    'short keyboard overflow keeps mounted input and real folder action reachable',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(360, 640));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      final draft = desktop.beginNewChatDraft(
        cwd: '/repo/Long accessible folder name',
      )!;
      await showConversation(tester, desktop, draft: draft, scale: 2.2);
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Keep this unsent draft',
      );
      final input = tester.state(find.byType(EditableText));
      final key = draft.storageKey;
      await showConversation(
        tester,
        desktop,
        draft: draft,
        scale: 2.2,
        keyboard: 300,
      );
      expect(tester.takeException(), isNull);
      expect(tester.state(find.byType(EditableText)), same(input));
      expect(desktop.newChatDraft, same(draft));
      expect(
        desktop.threadList.data.composerDraft(key).text,
        'Keep this unsent draft',
      );
      expect(remote.calls, isEmpty);
      final picker = find.text('New thread');
      await tester.ensureVisible(picker);
      await tester.tap(picker);
      await tester.pumpAndSettle();
      expect(
        remote.calls.where(
          (call) => call['method'] == 'project/quickLocations',
        ),
        hasLength(1),
      );
      expect(find.text('Use'), findsOneWidget);
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
      expect(tester.state(find.byType(EditableText)), same(input));
      expect(
        desktop.threadList.data.composerDraft(key).text,
        'Keep this unsent draft',
      );
      expect(remote.starts, 0);
      await finishDraft(tester, desktop);
    },
  );
  for (final sample in [
    (Brightness.light, DjlColors.light),
    (Brightness.dark, DjlColors.dark),
  ]) {
    testWidgets(
      'user links keep foreground contrast and destinations ${sample.$1}',
      (tester) async {
        final remote = ConversationLinkTransport(
          PairingRepository(TestCredentials()),
        );
        final desktop = await draftDesktop(remote);
        desktop.thread = {'id': 'saved', 'cwd': '/repo'};
        desktop.timeline = [
          {
            'id': 'user-link',
            'type': 'userMessage',
            'text':
                '[Web](https://example.com/path%20name)\n\n[File](file:///repo/My%20File.dart#L12)',
          },
          {
            'id': 'assistant-link',
            'type': 'agentMessage',
            'text': '[Assistant](https://example.com/assistant)',
          },
        ];
        final launched = <MethodCall>[];
        const channel = MethodChannel('plugins.flutter.io/url_launcher');
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          channel,
          (call) async {
            launched.add(call);
            return true;
          },
        );
        addTearDown(
          () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
            channel,
            null,
          ),
        );
        await showConversation(tester, desktop, brightness: sample.$1);
        final row = find.byKey(const ValueKey<dynamic>('user-link'));
        final userBody = tester.widget<MarkdownBody>(
          find.descendant(of: row, matching: find.byType(MarkdownBody)),
        );
        expect(userBody.styleSheet!.a!.color, sample.$2.onInk);
        expect(
          userBody.styleSheet!.a!.decorationStyle,
          TextDecorationStyle.dotted,
        );
        expect(userBody.styleSheet!.a!.decoration, TextDecoration.underline);
        final visibleLinkColors = <Color?>[];
        for (final text in tester.widgetList<SelectableText>(
          find.descendant(of: row, matching: find.byType(SelectableText)),
        )) {
          text.textSpan!.visitChildren((span) {
            if (span is TextSpan && {'Web', 'File'}.contains(span.text)) {
              visibleLinkColors.add(span.style?.color);
            }
            return true;
          });
        }
        expect(visibleLinkColors, [sample.$2.onInk, sample.$2.onInk]);
        final fill =
            (tester
                        .widget<Container>(
                          find.byKey(const ValueKey('desktop-user-bubble')),
                        )
                        .decoration
                    as BoxDecoration)
                .color!;
        final paintedBackground = Color.alphaBlend(fill, sample.$2.surface);
        final linkLuminance = visibleLinkColors.first!.computeLuminance();
        final fillLuminance = paintedBackground.computeLuminance();
        final contrast = linkLuminance > fillLuminance
            ? (linkLuminance + .05) / (fillLuminance + .05)
            : (fillLuminance + .05) / (linkLuminance + .05);
        expect(contrast, greaterThan(4.5));
        final assistantBody = tester.widget<MarkdownBody>(
          find.descendant(
            of: find.byKey(const ValueKey<dynamic>('assistant-link')),
            matching: find.byType(MarkdownBody),
          ),
        );
        expect(assistantBody.styleSheet!.a!.color, sample.$2.ink);
        expect(
          remote.calls.where(
            (call) => call['method'].toString().startsWith('workspace/'),
          ),
          isEmpty,
        );
        expect(launched, isEmpty);
        await tester.tap(find.text('Web'));
        await tester.pumpAndSettle();
        expect(
          launched.single.arguments['url'],
          'https://example.com/path%20name',
        );
        await tester.tap(find.text('File'));
        await tester.pumpAndSettle();
        final reads = remote.calls
            .where((call) => call['method'] == 'workspace/readFile')
            .toList();
        expect(reads, hasLength(1));
        expect(reads.single['params'], {
          'path': '/repo/My File.dart',
          'includeContent': true,
          'cwd': '/repo',
        });
        expect(
          tester.widget<CodeEditor>(find.byType(CodeEditor)).controller!.text,
          'Actual workspace content',
        );
        expect(
          tester
              .widget<WorkspaceLinkedFilePage>(
                find.byType(WorkspaceLinkedFilePage),
              )
              .repository
              .threadId,
          'saved',
        );
        expect(tester.takeException(), isNull);
        await finishDraft(tester, desktop);
      },
    );
  }
}
