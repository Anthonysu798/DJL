import 'dart:ui' show Tristate;
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart'
    show CupertinoColors, CupertinoDynamicColor;
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_new_chat_draft_test.dart'
    show DraftTransport, draftDesktop, finishDraft;
import 'desktop_model_catalog_refresh_test.dart' show CatalogRefreshTransport;

class Runtime125RestoreTransport extends DraftTransport {
  Runtime125RestoreTransport(super.pairings);
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'thread/read' || method == 'thread/resume') {
      calls.add({'method': method, 'params': params});
      return {
        'thread': {'id': params['threadId'], 'model': 'qa-b', 'turns': []},
      };
    }
    return super.request(method, params, timeout: timeout);
  }
}

List<RemoteJson> runtime125Models() => [
  {
    'id': 'gpt-5.5',
    'model': 'gpt-5.5',
    'displayName': 'GPT-5.5',
    'supportsFastMode': true,
    'supportedReasoningEfforts': ['low', 'medium', 'high', 'xhigh'],
    'defaultReasoningEffort': 'medium',
  },
  {
    'id': 'gpt-5.4',
    'model': 'gpt-5.4',
    'displayName': 'GPT-5.4',
    'supportedReasoningEfforts': ['low', 'high'],
    'defaultReasoningEffort': 'high',
  },
  {
    'id': 'opaque::other',
    'model': 'qa-other',
    'displayName': 'QA Other Model',
    'supportedReasoningEfforts': ['low', 'high'],
    'defaultReasoningEffort': 'low',
  },
];

Future<DesktopController> runtime125Page(
  WidgetTester tester,
  DraftTransport remote, {
  List<RemoteJson>? models,
  bool running = false,
  String draft = 'Unsent runtime125',
  GlobalKey<NavigatorState>? navigator,
  double textScale = 1,
  ThemeData? theme,
}) async {
  final desktop = await draftDesktop(remote);
  desktop.models = models ?? runtime125Models();
  desktop.model = desktop.models.first['id'] as String?;
  desktop.effort = 'high';
  desktop.thread = {'id': 'runtime125-widget'};
  desktop.turnId = running ? 'active125' : null;
  await tester.pumpWidget(
    MaterialApp(
      navigatorKey: navigator,
      theme: theme,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: DesktopChatPage(controller: desktop),
    ),
  );
  await tester.pumpAndSettle();
  if (draft.isEmpty) {
    await tester.tap(find.byKey(const Key('desktop_composer')));
  } else {
    await tester.enterText(find.byKey(const Key('desktop_composer')), draft);
  }
  await tester.pumpAndSettle();
  remote.calls.clear();
  return desktop;
}

Future<void> runtime125Open(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Chat controls'));
  await tester.pumpAndSettle();
}

Future<void> runtime125Catalog(
  WidgetTester tester, {
  bool provider = false,
}) async {
  await runtime125Open(tester);
  await tester.tap(find.byKey(const Key('desktop_runtime_model')));
  await tester.pumpAndSettle();
  if (!provider) {
    await tester.tap(find.byKey(const Key('runtime.other_models')));
    await tester.pumpAndSettle();
  }
  expect(find.byKey(const Key('runtime.catalog.search')), findsOneWidget);
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
    'source catalog blue and leading provider alignment ignore monochrome app accent',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await runtime125Page(
        tester,
        remote,
        theme: ThemeData(
          colorScheme: const ColorScheme.light(primary: Colors.black),
        ),
      );
      await runtime125Catalog(tester);
      final all = find.byKey(const Key('runtime.provider.all'));
      final button = tester.widget<TextButton>(all);
      final blue = CupertinoDynamicColor.resolve(
        CupertinoColors.activeBlue,
        tester.element(all),
      );
      expect(button.style!.backgroundColor!.resolve({}), blue);
      expect(
        tester.getTopLeft(all).dx,
        tester.getTopLeft(find.byKey(const Key('runtime.catalog.list'))).dx +
            20,
      );
      final selectedIcon = tester.widget<Icon>(
        find
            .descendant(
              of: find.byKey(const Key('runtime.model.gpt-5.5')),
              matching: find.byType(Icon),
            )
            .first,
      );
      expect(selectedIcon.color, blue);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets('catalog selection belongs to the actionable semantic node', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final remote = DraftTransport(PairingRepository(TestCredentials()));
    final desktop = await runtime125Page(tester, remote);
    await runtime125Catalog(tester);
    expect(
      tester
          .getSemantics(find.byKey(const Key('runtime.model.gpt-5.5')))
          .getSemanticsData()
          .flagsCollection
          .isSelected,
      Tristate.isTrue,
    );
    expect(
      tester
          .getSemantics(find.byKey(const Key('runtime.provider.all')))
          .getSemanticsData()
          .flagsCollection
          .isSelected,
      Tristate.isTrue,
    );
    handle.dispose();
    await finishDraft(tester, desktop);
  });

  testWidgets(
    'empty catalog can recover through the source all-models refresh workflow',
    (tester) async {
      final remote = CatalogRefreshTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await runtime125Page(tester, remote);
      desktop.models = [];
      desktop.threadList.filter(search: '');
      await tester.pumpAndSettle();
      await runtime125Catalog(tester);
      expect(find.text('No models available'), findsOneWidget);
      await tester.tap(find.byTooltip('Refresh models'));
      await tester.pump();
      expect(desktop.isLoadingModels, isTrue);
      remote.pending.complete({
        'data': [
          {
            'id': 'recovered::opaque',
            'model': 'recovered',
            'displayName': 'Recovered Model',
            'supportedReasoningEfforts': ['medium'],
            'defaultReasoningEffort': 'medium',
          },
        ],
      });
      await tester.pumpAndSettle();
      final model = find.byKey(const Key('runtime.model.recovered::opaque'));
      await tester.ensureVisible(model);
      await tester.tap(model);
      await tester.pumpAndSettle();
      expect(desktop.model, 'recovered::opaque');
      expect(desktop.effort, 'medium');
      expect(remote.calls, [
        {'method': 'model/list', 'params': <String, Object?>{}},
      ]);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'catalog refresh failure is visible locally while retaining models and chat error',
    (tester) async {
      final remote = CatalogRefreshTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await runtime125Page(tester, remote);
      desktop.error = 'Original stream error';
      final original = desktop.models;
      await runtime125Catalog(tester);
      await tester.tap(find.byTooltip('Refresh models'));
      await tester.pump();
      remote.pending.completeError(StateError('Catalog unavailable125'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Catalog unavailable125'), findsOneWidget);
      expect(desktop.models, same(original));
      expect(desktop.error, 'Original stream error');
      await tester.enterText(
        find.byKey(const Key('runtime.catalog.search')),
        'no such model125',
      );
      await tester.pumpAndSettle();
      expect(find.text('No matching models'), findsOneWidget);
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        'Unsent runtime125',
      );
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'large runtime menu scrolls within live keyboard and rotation bounds',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(360, 800);
      tester.view.padding = const FakeViewPadding(top: 24);
      tester.view.viewPadding = const FakeViewPadding(top: 24, bottom: 24);
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      addTearDown(tester.view.reset);
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await runtime125Page(tester, remote, textScale: 3);
      await runtime125Open(tester);
      for (final configuration in [
        (const Size(360, 800), 300.0),
        (const Size(640, 480), 120.0),
        (const Size(411, 923), 0.0),
      ]) {
        tester.view.physicalSize = configuration.$1;
        tester.view.viewInsets = FakeViewPadding(bottom: configuration.$2);
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Speed'));
        await tester.pumpAndSettle();
        final rect = tester.getRect(
          find.byKey(const Key('composer.runtime.popover')),
        );
        expect(rect.top, greaterThanOrEqualTo(32));
        expect(
          rect.bottom,
          lessThanOrEqualTo(configuration.$1.height - configuration.$2 - 8),
        );
        expect(rect.left, greaterThanOrEqualTo(8));
        expect(rect.right, lessThanOrEqualTo(configuration.$1.width - 8));
        expect(find.text('Speed').hitTestable(), findsOneWidget);
        expect(tester.takeException(), isNull);
      }
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'large searchable catalog keeps bottom search and choices usable above IME',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(360, 800);
      tester.view.padding = const FakeViewPadding(top: 24, bottom: 24);
      tester.view.viewPadding = const FakeViewPadding(top: 24, bottom: 24);
      addTearDown(tester.view.reset);
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await runtime125Page(tester, remote, textScale: 3);
      await runtime125Open(tester);
      await tester.ensureVisible(
        find.byKey(const Key('desktop_runtime_model')),
      );
      await tester.tap(find.byKey(const Key('desktop_runtime_model')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('runtime.other_models')));
      await tester.tap(find.byKey(const Key('runtime.other_models')));
      await tester.pumpAndSettle();
      final search = find.byKey(const Key('runtime.catalog.search'));
      await tester.enterText(search, 'Other');
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      await tester.pumpAndSettle();
      expect(tester.getRect(search).bottom, lessThanOrEqualTo(500));
      expect(find.text('Done').hitTestable(), findsOneWidget);
      final title = find.text('QA Other Model');
      await tester.scrollUntilVisible(
        title,
        80,
        scrollable: find.descendant(
          of: find.byKey(const Key('runtime.catalog.list')),
          matching: find.byType(Scrollable),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tapAt(tester.getTopLeft(title) + const Offset(16, 16));
      await tester.pumpAndSettle();
      expect(desktop.model, 'opaque::other');
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'a removed catalog model cannot be chosen through a captured row',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await runtime125Page(tester, remote);
      await runtime125Catalog(tester);
      final oldChoice = tester
          .widget<TextButton>(
            find.byKey(const Key('runtime.model.opaque::other')),
          )
          .onPressed!;
      desktop.models = desktop.models
          .where((m) => m['id'] != 'opaque::other')
          .toList();
      desktop.threadList.filter(search: '');
      await tester.pumpAndSettle();
      oldChoice();
      await tester.pumpAndSettle();
      expect(desktop.model, 'gpt-5.5');
      expect(find.byKey(const Key('runtime.catalog.search')), findsOneWidget);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets('a speed callback rechecks refreshed model capability', (
    tester,
  ) async {
    final remote = DraftTransport(PairingRepository(TestCredentials()));
    final desktop = await runtime125Page(tester, remote);
    await runtime125Open(tester);
    await tester.tap(find.byKey(const Key('runtime.speed')));
    await tester.pumpAndSettle();
    final fast = tester
        .widget<TextButton>(find.byKey(const Key('runtime.speed.fast')))
        .onPressed!;
    desktop.models = [
      for (final model in desktop.models) {...model, 'supportsFastMode': false},
    ];
    desktop.threadList.filter(search: '');
    await tester.pumpAndSettle();
    fast();
    await tester.pumpAndSettle();
    expect(desktop.serviceTier, 'default');
    expect(find.text('Speed'), findsNothing);
    await finishDraft(tester, desktop);
  });

  testWidgets(
    'restoring another thread does not inherit the prior thread reasoning choice',
    (tester) async {
      final remote = Runtime125RestoreTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await runtime125Page(
        tester,
        remote,
        models: [
          for (final id in ['qa-a', 'qa-b'])
            {
              'id': id,
              'model': id,
              'supportedReasoningEfforts': ['low', 'high'],
              'defaultReasoningEffort': 'high',
            },
        ],
      );
      desktop.setEffort('low');
      await desktop.openThread({'id': 'fresh-runtime125', 'model': 'qa-b'});
      await tester.pumpAndSettle();
      expect(desktop.model, 'qa-b');
      expect(desktop.effort, 'high');
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'running intelligence and speed changes preserve active turn and queued draft Plan',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await runtime125Page(tester, remote, running: true);
      desktop.plan = true;
      final queued = DesktopComposerDraft(text: '  queued runtime125\n');
      expect(await desktop.submitComposerDraft(queued), isTrue);
      desktop.plan = false;
      remote.calls.clear();
      await runtime125Open(tester);
      await tester.tap(find.byKey(const Key('runtime.effort.low')));
      await tester.pumpAndSettle();
      expect(desktop.effort, 'low');
      await runtime125Open(tester);
      await tester.tap(find.byKey(const Key('runtime.speed')));
      await tester.pumpAndSettle();
      expect(
        tester.getTopLeft(find.text('Fast')).dy,
        lessThan(tester.getTopLeft(find.text('Normal').last).dy),
      );
      await tester.tap(find.byKey(const Key('runtime.speed.fast')));
      await tester.pumpAndSettle();
      expect(desktop.serviceTier, 'fast');
      expect(desktop.turnId, 'active125');
      expect(desktop.queuedDrafts.single.draft.toJson(), queued.toJson());
      expect(desktop.queuedDrafts.single.plan, isTrue);
      expect(remote.calls, isEmpty);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'model submenu follows UIKit order and selects featured models while running',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await runtime125Page(tester, remote, running: true);
      await runtime125Open(tester);
      await tester.tap(find.byKey(const Key('desktop_runtime_model')));
      await tester.pumpAndSettle();
      expect(find.text('Intelligence'), findsNothing);
      expect(find.text('Speed'), findsNothing);
      expect(
        tester.getTopLeft(find.byKey(const Key('runtime.other_models'))).dy,
        lessThan(
          tester.getTopLeft(find.byKey(const Key('runtime.model.gpt-5.4'))).dy,
        ),
      );
      expect(
        tester.getTopLeft(find.byKey(const Key('runtime.model.gpt-5.4'))).dy,
        lessThan(
          tester.getTopLeft(find.byKey(const Key('runtime.model.gpt-5.5'))).dy,
        ),
      );
      await tester.tap(find.byKey(const Key('runtime.model.gpt-5.4')));
      await tester.pumpAndSettle();
      expect(desktop.model, 'gpt-5.4');
      expect(desktop.effort, 'high');
      expect(desktop.turnId, 'active125');
      expect(remote.calls, isEmpty);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'Other models sheet searches and Models chip retains untagged providers',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await runtime125Page(tester, remote);
      await runtime125Catalog(tester);
      await tester.tap(find.byKey(const Key('runtime.provider.Models')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('runtime.model.gpt-5.5')), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('runtime.catalog.search')),
        'Other',
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('runtime.model.gpt-5.5')), findsNothing);
      final other = find.byKey(const Key('runtime.model.opaque::other'));
      await tester.ensureVisible(other);
      await tester.pumpAndSettle();
      await tester.tap(other);
      await tester.pumpAndSettle();
      expect(desktop.model, 'opaque::other');
      expect(desktop.effort, 'high');
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        'Unsent runtime125',
      );
      expect(remote.calls, isEmpty);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'provider filter distinguishes duplicate labels and keeps opaque model identity',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final models = [
        for (final provider in ['First', 'Second'])
          {
            'id': '$provider::opaque125',
            'model': '$provider-raw125',
            'displayName': 'Shared model',
            'djlProvider': provider,
            'providerDisplayName': provider,
            'supportedReasoningEfforts': ['low', 'high'],
            'defaultReasoningEffort': 'low',
          },
      ];
      final desktop = await runtime125Page(tester, remote, models: models);
      await runtime125Catalog(tester, provider: true);
      await tester.tap(find.byKey(const Key('runtime.provider.Second')));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('runtime.model.First::opaque125')),
        findsNothing,
      );
      final choice = find.byKey(const Key('runtime.model.Second::opaque125'));
      await tester.ensureVisible(choice);
      await tester.tap(choice);
      await tester.pumpAndSettle();
      expect(desktop.model, 'Second::opaque125');
      expect(desktop.effort, 'high');
      expect(remote.calls, isEmpty);
      await finishDraft(tester, desktop);
    },
  );

  for (final stale in [
    'covered',
    'dismissed',
    'pin',
    'thread',
    'model',
    'detached',
  ]) {
    testWidgets('captured intelligence callback ignores $stale menu', (
      tester,
    ) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final navigator = GlobalKey<NavigatorState>();
      final desktop = await runtime125Page(
        tester,
        remote,
        navigator: navigator,
        draft: stale == 'detached' ? '' : 'Unsent',
      );
      await runtime125Open(tester);
      final choose = tester
          .widget<TextButton>(find.byKey(const Key('runtime.effort.low')))
          .onPressed!;
      if (stale == 'covered') {
        navigator.currentState!.push(
          MaterialPageRoute<void>(
            builder: (_) => const Scaffold(body: Text('Cover125')),
          ),
        );
      } else if (stale == 'dismissed') {
        navigator.currentState!.pop();
      } else if (stale == 'pin') {
        desktop.active = Pairing({
          ...desktop.active!.data,
          'macIdentityPublicKey': 'new-pin125',
        });
        desktop.threadList.filter(search: '');
      } else if (stale == 'thread') {
        desktop.thread = {'id': 'replacement125'};
        desktop.threadList.filter(search: '');
      } else if (stale == 'model') {
        desktop.setModel('gpt-5.4');
      } else {
        tester
            .state<EditableTextState>(find.byType(EditableText))
            .widget
            .focusNode
            .unfocus();
      }
      await tester.pumpAndSettle();
      final previous = desktop.effort;
      remote.calls.clear();
      choose();
      await tester.pumpAndSettle();
      expect(desktop.effort, previous);
      if (stale == 'covered') expect(find.text('Cover125'), findsOneWidget);
      expect(remote.calls, isEmpty);
      expect(tester.takeException(), isNull);
      await finishDraft(tester, desktop);
    });
  }

  testWidgets(
    'model switching retains supported reasoning and fast selection',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.models = [
        for (final id in ['qa-a', 'qa-b'])
          {
            'id': id,
            'model': id,
            'supportsFastMode': true,
            'supportedReasoningEfforts': ['low', 'medium', 'high'],
            'defaultReasoningEffort': 'high',
          },
      ];
      desktop.model = 'qa-a';
      desktop.effort = 'low';
      desktop.serviceTier = 'fast';
      desktop.thread = {'id': 'runtime125-switch'};
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      remote.calls.clear();
      desktop.setModel('qa-b');
      await tester.pumpAndSettle();
      expect(desktop.model, 'qa-b');
      expect(desktop.effort, 'low');
      expect(desktop.serviceTier, 'fast');
      expect(remote.calls, isEmpty);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets('model switching normalizes only unsupported choices', (
    tester,
  ) async {
    final remote = DraftTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    desktop.models = [
      {
        'id': 'qa-old',
        'model': 'qa-old',
        'supportsFastMode': true,
        'supportedReasoningEfforts': ['high'],
        'defaultReasoningEffort': 'high',
      },
      {
        'id': 'qa-next',
        'model': 'qa-next',
        'supportedReasoningEfforts': ['low', 'medium'],
        'defaultReasoningEffort': 'unsupported',
      },
    ];
    desktop.model = 'qa-old';
    desktop.effort = 'high';
    desktop.serviceTier = 'fast';
    desktop.thread = {'id': 'runtime125-capabilities'};
    await tester.pumpWidget(
      MaterialApp(home: DesktopChatPage(controller: desktop)),
    );
    await tester.pumpAndSettle();
    remote.calls.clear();
    desktop.setModel('qa-next');
    await tester.pumpAndSettle();
    expect(desktop.effort, 'medium');
    expect(desktop.serviceTier, 'default');
    expect(remote.calls, isEmpty);
    await finishDraft(tester, desktop);
  });

  testWidgets(
    'runtime opens the source hierarchy with direct intelligence choices',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.models = [
        {
          'id': 'gpt-5.5',
          'model': 'gpt-5.5',
          'displayName': 'GPT-5.5',
          'supportsFastMode': true,
          'supportedReasoningEfforts': ['low', 'medium', 'high', 'xhigh'],
          'defaultReasoningEffort': 'medium',
        },
        {
          'id': 'gpt-5.4',
          'model': 'gpt-5.4',
          'displayName': 'GPT-5.4',
          'supportedReasoningEfforts': ['low', 'high'],
          'defaultReasoningEffort': 'high',
        },
      ];
      desktop.model = 'gpt-5.5';
      desktop.effort = 'high';
      desktop.thread = {'id': 'runtime125'};
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Keep this runtime draft',
      );
      await tester.pumpAndSettle();
      final editable = tester.state<EditableTextState>(
        find.byType(EditableText),
      );
      final selection = editable.widget.controller.selection;
      remote.calls.clear();
      await tester.tap(find.byTooltip('Chat controls'));
      await tester.pumpAndSettle();
      expect(find.text('Intelligence'), findsOneWidget);
      for (final effort in ['Low', 'Medium', 'High', 'Extra High']) {
        expect(
          find.descendant(
            of: find.byKey(const Key('composer.runtime.popover')),
            matching: find.text(effort),
          ),
          findsOneWidget,
        );
      }
      expect(
        tester.getTopLeft(find.text('Low')).dy,
        lessThan(tester.getTopLeft(find.text('Extra High')).dy),
      );
      expect(find.text('Model'), findsOneWidget);
      expect(find.text('Speed'), findsOneWidget);
      expect(find.text('Normal'), findsOneWidget);
      expect(find.text('Plan mode'), findsNothing);
      expect(find.byType(BottomSheet), findsNothing);
      expect(
        tester.getSize(find.byKey(const Key('composer.runtime.popover'))).width,
        250,
      );
      Navigator.of(tester.element(find.text('Intelligence'))).pop();
      await tester.pumpAndSettle();
      expect(editable.widget.controller.text, 'Keep this runtime draft');
      expect(editable.widget.controller.selection, selection);
      expect(editable.widget.focusNode.hasFocus, isTrue);
      expect(remote.calls, isEmpty);
      await finishDraft(tester, desktop);
    },
  );
}
