import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_composer_controller.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_queued_drafts_sheet.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_focus_timeline.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_composer_send_test.dart' show MixedTransport;
import 'desktop_recovery_test.dart' show RecoveryMemoryStore;
import 'desktop_composer_picker_test.dart' show PendingImagePicker;
import 'desktop_queued_delivery_test.dart'
    show
        QueueDeliveryTransport,
        deliveryDesktop,
        finishQueueRun,
        queueMutations;

(DesktopController, MixedTransport) queuedWidgetDesktop() {
  final pairs = PairingRepository(TestCredentials());
  final transport = MixedTransport(pairs);
  final desktop =
      DesktopController(
          pairs,
          connection: transport,
          localStore: RecoveryMemoryStore(),
        )
        ..thread = {'id': 't1'}
        ..turnId = 'running'
        ..model = 'qa';
  return (desktop, transport);
}

IconButton queuedRestoreButton(WidgetTester tester) =>
    tester.widget<IconButton>(
      find.byWidgetPredicate(
        (widget) =>
            widget is IconButton && widget.tooltip == 'Move draft into input',
      ),
    );

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final sheetOpen in [false, true]) {
    testWidgets(
      'idle delivery waits for a covering dialog then resumes with queue sheet=$sheetOpen',
      (tester) async {
        final transport = QueueDeliveryTransport();
        final desktop = (await tester.runAsync(
          () => deliveryDesktop(transport),
        ))!;
        await desktop.submitComposerDraft(
          DesktopComposerDraft(text: 'after the dialog'),
        );
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox());
          desktop.dispose();
        });
        await tester.pumpWidget(
          MaterialApp(home: DesktopChatPage(controller: desktop)),
        );
        await tester.pumpAndSettle();
        if (sheetOpen) {
          await tester.tap(find.byTooltip('Queued messages'));
          await tester.pumpAndSettle();
        }
        unawaited(
          showDialog<void>(
            context: tester.element(find.byType(DesktopChatPage)),
            builder: (dialog) => AlertDialog(
              title: const Text('Newer decision'),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialog).pop(),
                  child: const Text('Close decision'),
                ),
              ],
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.runAsync(() => finishQueueRun(transport, desktop));
        await tester.pumpAndSettle();
        expect(queueMutations(transport), isEmpty);
        await tester.tap(find.text('Close decision'));
        await tester.pumpAndSettle();
        expect(queueMutations(transport), hasLength(1));
        expect(desktop.queuedDrafts, isEmpty);
        expect(tester.takeException(), isNull);
      },
    );
  }
  for (final profile in [
    (const Size(1080, 2424), 2.625),
    (const Size(1206, 2622), 3.0),
  ]) {
    testWidgets(
      'queueing a follow-up preserves the manually read history position at ${profile.$2}x',
      (tester) async {
        tester.view.physicalSize = profile.$1;
        tester.view.devicePixelRatio = profile.$2;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final (desktop, transport) = queuedWidgetDesktop();
        desktop.timeline = List.generate(
          60,
          (i) => <String, dynamic>{
            'id': 'old-$i',
            'type': 'userMessage',
            'text': 'Older history $i',
          },
        );
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox());
          desktop.dispose();
        });
        await tester.pumpWidget(
          MaterialApp(home: DesktopChatPage(controller: desktop)),
        );
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('desktop_composer')),
          'queued follow-up',
        );
        await tester.pumpAndSettle();
        await tester.drag(
          find.byType(DesktopFocusTimeline),
          const Offset(0, 350),
        );
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('desktop_composer')))
              .decoration
              ?.hintText,
          'Follow up',
        );
        final label = List.generate(60, (i) => 'Older history $i').firstWhere(
          (text) => find.text(text).hitTestable().evaluate().isNotEmpty,
        );
        final reading = find.text(label);
        final before = tester.getRect(reading);
        await tester.tap(find.byTooltip('Send to desktop'));
        await tester.pumpAndSettle();
        Offset pixels(Rect rect) => Offset(
          (rect.left * profile.$2).roundToDouble(),
          (rect.top * profile.$2).roundToDouble(),
        );
        expect(pixels(tester.getRect(find.text(label))), pixels(before));
        expect(desktop.queuedDrafts.single.draft.text, 'queued follow-up');
        expect(
          transport.calls.where(
            (call) => {'turn/start', 'turn/steer'}.contains(call['method']),
          ),
          isEmpty,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'restoring an unsupported queued Plan keeps its mode and raw draft intact',
    (tester) async {
      final (desktop, _) = queuedWidgetDesktop();
      desktop.plan = true;
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'planned raw input'),
      );
      desktop.plan = false;
      desktop.supportsPlan = false;
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Queued messages'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Move draft into input'));
      await tester.pumpAndSettle();
      expect(desktop.queuedDrafts.single.plan, isTrue);
      expect(desktop.queuedDrafts.single.draft.text, 'planned raw input');
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        isEmpty,
      );
      expect(
        find.textContaining('Choose a model that supports Plan mode'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );
  for (final brightness in Brightness.values) {
    testWidgets(
      'queued sheet is scroll-safe at320px and large text in $brightness',
      (tester) async {
        tester.view.physicalSize = const Size(320, 700);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final (desktop, _) = queuedWidgetDesktop();
        for (var i = 0; i < 12; i++) {
          await desktop.submitComposerDraft(
            DesktopComposerDraft(
              text: 'Queued public message $i with a long readable description',
            ),
          );
        }
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox());
          desktop.dispose();
        });
        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(brightness: brightness),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(2.2)),
              child: child!,
            ),
            home: DesktopChatPage(controller: desktop),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Queued messages'));
        await tester.pumpAndSettle();
        expect(find.text('Done'), findsOneWidget);
        await tester.drag(
          find.byType(CustomScrollView).last,
          const Offset(0, -400),
        );
        await tester.pumpAndSettle();
        expect(find.text('Done').hitTestable(), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'keyboard insets hide the capsule without replacing the focused input or selection',
    (tester) async {
      final (desktop, _) = queuedWidgetDesktop();
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'queued'));
      var inset = 0.0;
      late StateSetter change;
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(
          home: StatefulBuilder(
            builder: (context, setState) {
              change = setState;
              return MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(viewInsets: EdgeInsets.only(bottom: inset)),
                child: DesktopChatPage(controller: desktop),
              );
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      final field = find.byKey(const Key('desktop_composer'));
      await tester.enterText(field, 'keep this draft');
      final original = tester.element(field);
      final text = tester.widget<TextField>(field).controller!;
      text.selection = const TextSelection(baseOffset: 2, extentOffset: 7);
      change(() => inset = 300);
      await tester.pumpAndSettle();
      expect(find.byTooltip('Queued messages'), findsNothing);
      expect(tester.element(field), same(original));
      expect(text.text, 'keep this draft');
      expect(
        text.selection,
        const TextSelection(baseOffset: 2, extentOffset: 7),
      );
      change(() => inset = 0);
      await tester.pumpAndSettle();
      expect(find.byTooltip('Queued messages'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'an existing input disables queued restore and keeps both drafts',
    (tester) async {
      final (desktop, _) = queuedWidgetDesktop();
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'queued'));
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'keep input',
      );
      await tester.tap(find.byTooltip('Queued messages'));
      await tester.pumpAndSettle();
      expect(queuedRestoreButton(tester).onPressed, isNull);
      expect(desktop.queuedDrafts.single.draft.text, 'queued');
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        'keep input',
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a loading picker blocks restore until cancellation without overwriting its slot',
    (tester) async {
      final (desktop, _) = queuedWidgetDesktop();
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'queued'));
      final picker = PendingImagePicker();
      final composer = DesktopComposerController(picker: picker)
        ..bind((mac: null, thread: 't1', cwd: null), DesktopComposerDraft());
      final picking = composer.pickImage();
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        composer.dispose();
        desktop.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => DesktopQueuedDraftsSheet(
                    controller: desktop,
                    composer: composer,
                    isCurrent: () => true,
                  ),
                ),
                child: const Text('Open queue'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open queue'));
      await tester.pumpAndSettle();
      expect(queuedRestoreButton(tester).onPressed, isNull);
      expect(composer.slots, hasLength(1));
      picker.jobs.single.complete(null);
      await picking;
      await tester.pumpAndSettle();
      expect(queuedRestoreButton(tester).onPressed, isNotNull);
      expect(desktop.queuedDrafts.single.draft.text, 'queued');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'emptying a covered queue removes only that sheet and retains the newer dialog',
    (tester) async {
      final (desktop, _) = queuedWidgetDesktop();
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'disposable'),
      );
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Queued messages'));
      await tester.pumpAndSettle();
      unawaited(
        showDialog<void>(
          context: tester.element(find.byType(DesktopChatPage)),
          builder: (_) => const AlertDialog(title: Text('Newer decision')),
        ),
      );
      await tester.pumpAndSettle();
      desktop.removeQueuedDraft(desktop.queuedDrafts.single.id);
      await tester.pumpAndSettle();
      expect(find.text('Newer decision'), findsOneWidget);
      expect(find.byType(DesktopQueuedDraftsSheet), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a captured restore callback cannot change the next chat after its sheet closes',
    (tester) async {
      final (desktop, _) = queuedWidgetDesktop();
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'old queued'),
      );
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Queued messages'));
      await tester.pumpAndSettle();
      final stale = queuedRestoreButton(tester).onPressed!;
      desktop.threadList.data.setComposerDraft(
        'other',
        DesktopComposerDraft(text: 'next chat draft'),
      );
      desktop.thread = {'id': 'other'};
      desktop.turnId = 'other-running';
      desktop.setPlan(false);
      await tester.pumpAndSettle();
      stale();
      await tester.pumpAndSettle();
      expect(find.byType(DesktopQueuedDraftsSheet), findsNothing);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        'next chat draft',
      );
      desktop.thread = {'id': 't1'};
      expect(desktop.queuedDrafts.single.draft.text, 'old queued');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'the visible page automatically delivers one FIFO head after the running turn ends',
    (tester) async {
      final transport = QueueDeliveryTransport();
      final desktop = (await tester.runAsync(
        () => deliveryDesktop(transport),
      ))!;
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'first'));
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'second'));
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.runAsync(() => finishQueueRun(transport, desktop));
      await tester.pumpAndSettle();
      expect(queueMutations(transport), hasLength(1));
      expect((queueMutations(transport).single['params'] as Map)['input'], [
        {'type': 'text', 'text': 'first'},
      ]);
      expect(desktop.queuedDrafts.single.draft.text, 'second');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'the queue sheet Steer action consumes one item without starting a replacement turn',
    (tester) async {
      final transport = QueueDeliveryTransport()
        ..replies.add({'turnId': 'running'});
      final desktop = (await tester.runAsync(
        () => deliveryDesktop(transport),
      ))!;
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'chosen'));
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Queued messages'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Steer'));
      await tester.pumpAndSettle();
      expect(queueMutations(transport).single['method'], 'turn/steer');
      expect(desktop.queuedDrafts, isEmpty);
      expect(find.byType(DesktopQueuedDraftsSheet), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Resume stays usable without clearing the current unsent composer',
    (tester) async {
      final transport = QueueDeliveryTransport()
        ..replies.add(TimeoutException('lost reply'));
      final desktop = (await tester.runAsync(
        () => deliveryDesktop(transport),
      ))!;
      await desktop.submitComposerDraft(DesktopComposerDraft(text: 'queued'));
      await tester.runAsync(() => finishQueueRun(transport, desktop));
      await tester.runAsync(desktop.flushQueuedDrafts);
      desktop.threadList.data.setComposerDraft(
        'thread',
        DesktopComposerDraft(text: 'keep this input'),
      );
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      expect(find.byTooltip('Resume queued messages'), findsOneWidget);
      await tester.tap(find.byTooltip('Resume queued messages'));
      await tester.pumpAndSettle();
      expect(queueMutations(transport), hasLength(2));
      expect(desktop.queuedDrafts, isEmpty);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        'keep this input',
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'Queued capsule opens source controls and Done reviews without mutation',
    (tester) async {
      final (desktop, transport) = queuedWidgetDesktop();
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'queued public follow-up'),
      );
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      expect(find.byTooltip('Queued messages'), findsOneWidget);
      await tester.tap(find.byTooltip('Queued messages'));
      await tester.pumpAndSettle();
      expect(find.text('queued public follow-up'), findsOneWidget);
      expect(find.text('Done'), findsOneWidget);
      expect(find.text('Steer'), findsOneWidget);
      expect(find.byTooltip('Move draft into input'), findsOneWidget);
      expect(find.byTooltip('Delete queued message'), findsOneWidget);
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      expect(find.text('Done'), findsNothing);
      expect(desktop.queuedDrafts, hasLength(1));
      expect(
        transport.calls.where(
          (call) => {'turn/start', 'turn/steer'}.contains(call['method']),
        ),
        isEmpty,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'queued restore returns exact raw input, image, context and Plan mode then closes only its empty sheet',
    (tester) async {
      final (desktop, transport) = queuedWidgetDesktop();
      desktop.plan = true;
      final raw = DesktopComposerDraft(
        text: '  restore this\n',
        images: [
          const DesktopComposerImage(
            id: 'public-image',
            name: 'public.png',
            dataUrl:
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          ),
        ],
        contexts: [
          const DesktopComposerContext(
            kind: DesktopContextKind.file,
            id: 'lib/a.dart',
            name: 'a.dart',
            path: 'lib/a.dart',
          ),
        ],
      );
      await desktop.submitComposerDraft(raw);
      desktop.plan = false;
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Queued messages'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Move draft into input'));
      await tester.pumpAndSettle();
      expect(desktop.queuedDrafts, isEmpty);
      expect(find.text('Done'), findsNothing);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        raw.text,
      );
      expect(
        desktop.threadList.data.composerDraft('t1').toJson(),
        raw.toJson(),
      );
      expect(desktop.plan, isTrue);
      expect(
        transport.calls.where(
          (call) => {'turn/start', 'turn/steer'}.contains(call['method']),
        ),
        isEmpty,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'deleting a disposable queued row closes its empty sheet without sending',
    (tester) async {
      final (desktop, transport) = queuedWidgetDesktop();
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'disposable queued row'),
      );
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Queued messages'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Delete queued message'));
      await tester.pumpAndSettle();
      expect(desktop.queuedDrafts, isEmpty);
      expect(find.text('Done'), findsNothing);
      expect(
        transport.calls.where(
          (call) => {'turn/start', 'turn/steer'}.contains(call['method']),
        ),
        isEmpty,
      );
      expect(tester.takeException(), isNull);
    },
  );
}
