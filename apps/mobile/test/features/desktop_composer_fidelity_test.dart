import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_composer_widgets.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_phone_drawer.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/core/design/djl_icons.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_new_chat_draft_test.dart'
    show DraftTransport, draftDesktop, finishDraft;
import 'desktop_composer_picker_test.dart' show PendingImagePicker;
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';

class AccessTransport extends DraftTransport {
  AccessTransport(super.pairings);
  bool failAccess = false;
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'initialize') {
      return {
        'capabilities': {'djlThreadRuntimeModeSync': true},
      };
    }
    if (method == 'djl/thread/runtimeMode/set') {
      calls.add({'method': method, 'params': params});
      if (failAccess) throw StateError('Access change rejected by desktop');
      return {'runtimeMode': params['runtimeMode']};
    }
    return super.request(method, params, timeout: timeout);
  }
}

void main() {
  for (final initialMode in ThemeMode.values) {
    testWidgets(
      'options scroll and track live IME, orientation and $initialMode at 2.2',
      (tester) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = const Size(360, 640);
        tester.view.viewPadding = const FakeViewPadding(top: 24, bottom: 24);
        tester.view.padding = const FakeViewPadding(top: 24);
        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
        addTearDown(tester.view.reset);
        addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
        final mode = ValueNotifier(initialMode);
        addTearDown(mode.dispose);
        final remote = DraftTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        desktop.models = [
          {...desktop.models.first, 'supportsFastMode': true},
        ];
        desktop.model = 'qa';
        desktop.thread = {'id': 'small-keyboard-menu'};
        await tester.pumpWidget(
          ValueListenableBuilder<ThemeMode>(
            valueListenable: mode,
            builder: (context, value, _) => MaterialApp(
              theme: ThemeData.light(),
              darkTheme: ThemeData.dark(),
              themeMode: value,
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  textScaler: const TextScaler.linear(2.2),
                  disableAnimations: true,
                ),
                child: child!,
              ),
              home: DesktopChatPage(controller: desktop),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final field = find.byKey(const Key('desktop_composer'));
        await tester.enterText(field, 'public large text draft');
        await tester.pumpAndSettle();
        final editable = tester.state<EditableTextState>(
          find.byType(EditableText),
        );
        final controller = tester.widget<TextField>(field).controller!;
        final selection = controller.selection;
        final clients = tester.testTextInput.log
            .where((c) => c.method == 'TextInput.setClient')
            .length;
        remote.calls.clear();
        await tester.tap(find.byTooltip('Composer options'));
        await tester.pumpAndSettle();
        final fast = find.text('Fast mode');
        final menuScroll = find.ancestor(
          of: fast,
          matching: find.byType(SingleChildScrollView),
        );
        final scrollable = tester.state<ScrollableState>(
          find.descendant(of: menuScroll, matching: find.byType(Scrollable)),
        );
        expect(scrollable.position.maxScrollExtent, greaterThan(0));
        await tester.drag(menuScroll, const Offset(0, -400));
        await tester.pumpAndSettle();
        expect(scrollable.position.pixels, greaterThan(0));
        await tester.ensureVisible(fast);
        await tester.pumpAndSettle();
        void expectVisible(Finder entry) {
          final rect = tester.getRect(entry);
          final size = tester.view.physicalSize;
          final keyboardTop = size.height - tester.view.viewInsets.bottom;
          expect(rect.top, greaterThanOrEqualTo(32));
          expect(rect.bottom, lessThanOrEqualTo(keyboardTop - 8));
          expect(rect.left, greaterThanOrEqualTo(8));
          expect(rect.right, lessThanOrEqualTo(size.width - 8));
          expect(
            find
                .ancestor(
                  of: entry,
                  matching: find.byWidgetPredicate(
                    (w) => w is PopupMenuItem<String>,
                  ),
                )
                .hitTestable(),
            findsOneWidget,
          );
          expect(tester.takeException(), isNull);
        }

        expectVisible(fast);
        expect(
          Theme.of(tester.element(fast)).brightness,
          initialMode == ThemeMode.light ? Brightness.light : Brightness.dark,
        );
        mode.value = initialMode == ThemeMode.light
            ? ThemeMode.dark
            : ThemeMode.light;
        await tester.pumpAndSettle();
        expect(
          Theme.of(tester.element(fast)).brightness,
          initialMode == ThemeMode.light ? Brightness.dark : Brightness.light,
        );
        for (final configuration in [
          (const Size(411, 923), 0.0),
          (const Size(411, 923), 300.0),
          (const Size(640, 480), 120.0),
          (const Size(360, 640), 300.0),
        ]) {
          tester.view.physicalSize = configuration.$1;
          tester.view.viewInsets = FakeViewPadding(bottom: configuration.$2);
          await tester.pumpAndSettle();
          await tester.ensureVisible(fast);
          await tester.pumpAndSettle();
          expectVisible(fast);
          final menu = tester.getRect(menuScroll);
          final anchor = tester.getRect(find.byTooltip('Composer options'));
          expect(menu.bottom, lessThanOrEqualTo(anchor.top));
          expect(menu.top, greaterThanOrEqualTo(32));
          expect(
            tester.state<EditableTextState>(find.byType(EditableText)),
            same(editable),
          );
          expect(editable.widget.focusNode.hasFocus, isTrue);
          expect(tester.testTextInput.hasAnyClients, isTrue);
          expect(controller.selection, selection);
        }
        expect(remote.calls, isEmpty);
        await tester.tap(
          find
              .ancestor(
                of: fast,
                matching: find.byType(CheckedPopupMenuItem<String>),
              )
              .hitTestable(),
        );
        await tester.pumpAndSettle();
        expect(desktop.serviceTier, 'fast');
        expect(desktop.plan, isFalse);
        await tester.ensureVisible(find.byTooltip('Composer options'));
        await tester.pumpAndSettle();
        expect(
          find.byTooltip('Composer options').hitTestable(),
          findsOneWidget,
        );
        await tester.tap(find.byTooltip('Composer options'));
        await tester.pumpAndSettle();
        final checked = tester.widget<CheckedPopupMenuItem<String>>(
          find.ancestor(
            of: find.text('Fast mode'),
            matching: find.byType(CheckedPopupMenuItem<String>),
          ),
        );
        expect(checked.checked, isTrue);
        final plan = find.text('Plan mode');
        await tester.ensureVisible(plan);
        await tester.pumpAndSettle();
        expectVisible(plan);
        await tester.tap(
          find
              .ancestor(
                of: plan,
                matching: find.byType(CheckedPopupMenuItem<String>),
              )
              .hitTestable(),
        );
        await tester.pumpAndSettle();
        expect(desktop.plan, isTrue);
        await tester.ensureVisible(find.byTooltip('Composer options'));
        await tester.pumpAndSettle();
        expect(
          find.byTooltip('Composer options').hitTestable(),
          findsOneWidget,
        );
        await tester.tap(find.byTooltip('Composer options'));
        await tester.pumpAndSettle();
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.text('Photo library'), findsNothing);
        expect(
          tester.state<EditableTextState>(find.byType(EditableText)),
          same(editable),
        );
        expect(tester.widget<TextField>(field).controller, same(controller));
        expect(editable.widget.focusNode.hasFocus, isTrue);
        expect(controller.text, 'public large text draft');
        expect(controller.selection, selection);
        expect(tester.testTextInput.hasAnyClients, isTrue);
        expect(
          tester.testTextInput.log
              .where((c) => c.method == 'TextInput.setClient')
              .length,
          clients,
        );
        expect(remote.calls, isEmpty);
        expect(tester.takeException(), isNull);
        await finishDraft(tester, desktop);
      },
    );
  }

  testWidgets(
    'options entries are physically above the root overlay keyboard',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(411, 923);
      tester.view.viewPadding = const FakeViewPadding(top: 24, bottom: 24);
      tester.view.padding = const FakeViewPadding(top: 24);
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      addTearDown(tester.view.reset);
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.model = 'qa';
      desktop.thread = {'id': 'keyboard-menu'};
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      final field = find.byKey(const Key('desktop_composer'));
      await tester.enterText(field, 'public unsent keyboard draft');
      await tester.pumpAndSettle();
      final editable = tester.state<EditableTextState>(
        find.byType(EditableText),
      );
      final controller = tester.widget<TextField>(field).controller!;
      final selection = controller.selection;
      final anchor = tester.getRect(find.byTooltip('Composer options'));
      remote.calls.clear();
      await tester.tap(find.byTooltip('Composer options'));
      await tester.pumpAndSettle();
      for (final label in [
        'Photo library',
        'Take a photo',
        'Add desktop context',
        'Plan mode',
      ]) {
        final entry = find.text(label);
        final row = find.ancestor(
          of: entry,
          matching: find.byWidgetPredicate((w) => w is PopupMenuItem<String>),
        );
        final rect = tester.getRect(row);
        expect(rect.top, greaterThanOrEqualTo(24), reason: label);
        expect(
          rect.bottom,
          lessThanOrEqualTo(623),
          reason: '$label behind IME',
        );
        expect(
          find
              .ancestor(
                of: entry,
                matching: find.byWidgetPredicate(
                  (w) => w is PopupMenuItem<String>,
                ),
              )
              .hitTestable(),
          findsOneWidget,
          reason: label,
        );
      }
      expect(
        tester.getRect(find.text('Plan mode')).bottom,
        lessThanOrEqualTo(anchor.top),
      );
      await tester.tapAt(const Offset(400, 100));
      await tester.pumpAndSettle();
      expect(find.text('Photo library'), findsNothing);
      expect(
        tester.state<EditableTextState>(find.byType(EditableText)),
        same(editable),
      );
      expect(tester.widget<TextField>(field).controller, same(controller));
      expect(editable.widget.focusNode.hasFocus, isTrue);
      expect(tester.testTextInput.hasAnyClients, isTrue);
      expect(controller.text, 'public unsent keyboard draft');
      expect(controller.selection, selection);
      expect(remote.calls, isEmpty);
      expect(tester.takeException(), isNull);
      await finishDraft(tester, desktop);
    },
  );

  for (final withImage in [false, true]) {
    testWidgets(
      'expanded ${withImage ? 'image accessory' : 'plain'} input has source row inset and minimum height',
      (tester) async {
        final remote = DraftTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        desktop.thread = {'id': 'row-geometry'};
        if (withImage) {
          desktop.threadList.data.setComposerDraft(
            'row-geometry',
            DesktopComposerDraft(
              images: [
                const DesktopComposerImage(
                  id: 'geometry-image',
                  name: 'photo.png',
                  dataUrl:
                      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                ),
              ],
            ),
          );
        }
        await tester.pumpWidget(
          MaterialApp(home: DesktopChatPage(controller: desktop)),
        );
        await tester.pumpAndSettle();
        final field = find.byKey(const Key('desktop_composer'));
        final editable = tester.state<EditableTextState>(
          find.byType(EditableText),
        );
        await tester.tap(field);
        await tester.pumpAndSettle();
        final surface = tester.getRect(
          find.byKey(const Key('desktop_composer_surface')),
        );
        final input = tester.getRect(field);
        if (withImage) {
          final image = tester.getRect(find.byType(DesktopImagePreview));
          expect(
            image.top - surface.top,
            8,
            reason: 'Image strip retains its own top inset',
          );
          expect(
            input.top - image.bottom,
            10,
            reason: 'Expanded input separates from accessories',
          );
        } else {
          expect(
            input.top - surface.top,
            14,
            reason: 'Expanded plain input starts below the card edge',
          );
        }
        expect(
          input.height,
          34,
          reason: 'Short expanded input retains the source minimum hit row',
        );
        expect(
          tester.state<EditableTextState>(find.byType(EditableText)),
          same(editable),
        );
        if (withImage) {
          await tester.tap(find.byTooltip('Remove image'));
          await tester.pumpAndSettle();
          expect(
            tester.getRect(field).top -
                tester
                    .getRect(find.byKey(const Key('desktop_composer_surface')))
                    .top,
            14,
          );
          expect(
            tester.state<EditableTextState>(find.byType(EditableText)),
            same(editable),
          );
          expect(tester.testTextInput.hasAnyClients, isTrue);
        }
        expect(tester.takeException(), isNull);
        await finishDraft(tester, desktop);
      },
    );
  }

  testWidgets(
    'resting composer retains editable state and connection through focus, menus and blur',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'existing', 'turns': []};
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      remote.calls.clear();
      final field = find.byKey(const Key('desktop_composer'));
      final editable = tester.state<EditableTextState>(
        find.byType(EditableText),
      );
      final controller = tester.widget<TextField>(field).controller;
      final restingHeight = tester
          .getSize(find.byKey(const Key('desktop_composer_surface')))
          .height;
      expect(restingHeight, 46);
      expect(find.byTooltip('Send to desktop'), findsNothing);
      await tester.tap(find.byTooltip('Composer options'));
      await tester.pumpAndSettle();
      expect(editable.widget.focusNode.hasFocus, isFalse);
      expect(find.text('Photo library'), findsOneWidget);
      expect(find.text('Take a photo'), findsOneWidget);
      expect(find.text('Add desktop context'), findsOneWidget);
      await tester.tapAt(const Offset(10, 100));
      await tester.pumpAndSettle();
      await tester.tap(field);
      await tester.pumpAndSettle();
      expect(
        tester.state<EditableTextState>(find.byType(EditableText)),
        same(editable),
      );
      expect(tester.widget<TextField>(field).controller, same(controller));
      expect(tester.testTextInput.hasAnyClients, isTrue);
      final inputClients = tester.testTextInput.log
          .where((call) => call.method == 'TextInput.setClient')
          .length;
      desktop.setPlan(true);
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(field).maxLines, 4);
      expect(
        tester.testTextInput.log
            .where((call) => call.method == 'TextInput.setClient')
            .length,
        inputClients,
      );
      expect(tester.testTextInput.hasAnyClients, isTrue);
      desktop.setPlan(false);
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(field).maxLines, 6);

      expect(
        tester
            .getSize(find.byKey(const Key('desktop_composer_surface')))
            .height,
        greaterThan(restingHeight),
      );
      tester.testTextInput.enterText('retained composing draft');
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Chat controls'));
      await tester.pumpAndSettle();
      await tester.tapAt(const Offset(10, 100));
      await tester.pumpAndSettle();
      expect(
        tester.state<EditableTextState>(find.byType(EditableText)),
        same(editable),
      );
      expect(controller!.text, 'retained composing draft');
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.tapAt(const Offset(780, 300));
      await tester.pumpAndSettle();
      expect(
        tester.state<EditableTextState>(find.byType(EditableText)),
        same(editable),
      );
      expect(controller.text, 'retained composing draft');
      expect(
        tester
            .state<DesktopPhoneDrawerState>(find.byType(DesktopPhoneDrawer))
            .isOpen,
        isFalse,
      );
      await tester.enterText(field, '');
      editable.widget.focusNode.unfocus();
      await tester.pumpAndSettle();
      expect(
        tester
            .getSize(find.byKey(const Key('desktop_composer_surface')))
            .height,
        restingHeight,
      );
      expect(
        tester.state<EditableTextState>(find.byType(EditableText)),
        same(editable),
      );
      expect(remote.calls, isEmpty);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'fresh local draft autofocuses once and drawer dismissal keeps the same unfocused input',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      final draft = desktop.beginNewChatDraft()!;
      await tester.pumpWidget(
        MaterialApp(
          home: DesktopChatPage(controller: desktop, draft: draft),
        ),
      );
      await tester.pumpAndSettle();
      final editable = tester.state<EditableTextState>(
        find.byType(EditableText),
      );
      expect(editable.widget.focusNode.hasFocus, isTrue);
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.tapAt(const Offset(780, 300));
      await tester.pumpAndSettle();
      desktop.threadList.filter(search: '');
      await tester.pumpAndSettle();
      expect(
        tester.state<EditableTextState>(find.byType(EditableText)),
        same(editable),
      );
      expect(editable.widget.focusNode.hasFocus, isFalse);
      expect(find.byTooltip('Send to desktop'), findsNothing);
      expect(remote.calls, isEmpty);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'real photo menu cancellation and failed slot keep errors reachable and input mounted',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'existing'};
      final picker = PendingImagePicker();
      await tester.pumpWidget(
        MaterialApp(
          home: DesktopChatPage(controller: desktop, imagePicker: picker),
        ),
      );
      await tester.pumpAndSettle();
      remote.calls.clear();
      final editable = tester.state<EditableTextState>(
        find.byType(EditableText),
      );
      for (final camera in [false, true]) {
        await tester.tap(find.byTooltip('Composer options'));
        await tester.pumpAndSettle();
        await tester.tap(find.text(camera ? 'Take a photo' : 'Photo library'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(picker.sources.last, camera);
        expect(editable.widget.focusNode.hasFocus, isFalse);
        expect(find.byTooltip('Remove image'), findsOneWidget);
        if (camera) {
          picker.jobs.last.completeError(
            StateError(
              'Camera access denied. Enable camera access in Settings to take a photo.',
            ),
          );
        } else {
          picker.jobs.last.complete(null);
        }
        await tester.pumpAndSettle();
      }
      expect(
        find.textContaining('Enable camera access in Settings'),
        findsOneWidget,
      );
      expect(
        tester.state<EditableTextState>(find.byType(EditableText)),
        same(editable),
      );
      expect(
        tester
            .widget<IconButton>(
              find.widgetWithIcon(IconButton, DjlIcons.arrowUp),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.byTooltip('Remove image'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Enable camera access in Settings'),
        findsNothing,
      );
      expect(find.byTooltip('Send to desktop'), findsNothing);
      expect(remote.calls, isEmpty);
      await finishDraft(tester, desktop);
    },
  );
  testWidgets(
    'composer thumbnails shrink without changing sent images or removal ownership',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'images'};
      const image = DesktopComposerImage(
        id: 'composer-image',
        name: 'photo.png',
        dataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      );
      desktop.threadList.data.setComposerDraft(
        'images',
        DesktopComposerDraft(images: [image]),
      );
      desktop.timeline.add({
        'id': 'sent-image',
        'type': 'userMessage',
        'content': [
          {'type': 'image', 'url': image.dataUrl},
        ],
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      final previews = find.byType(DesktopImagePreview);
      expect(previews, findsNWidgets(2));
      expect(tester.getSize(previews.first), const Size(100, 100));
      expect(tester.getSize(previews.last), const Size(60, 60));
      await tester.tap(find.byTooltip('Remove image'));
      await tester.pumpAndSettle();
      expect(desktop.threadList.data.composerDraft('images').images, isEmpty);
      expect(previews, findsOneWidget);
      expect(tester.getSize(previews), const Size(100, 100));
      expect(desktop.timeline.single['id'], 'sent-image');
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'running empty Stop and microphone never focus text and interrupt exact owner once',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'running-chat'};
      desktop.turnId = 'exact-turn';
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      remote.calls.clear();
      final editable = tester.state<EditableTextState>(
        find.byType(EditableText),
      );
      expect(find.byTooltip('Chat controls'), findsNothing);
      await tester.tap(find.byTooltip('Stop turn'));
      await tester.pumpAndSettle();
      expect(remote.calls, [
        {
          'method': 'turn/interrupt',
          'params': {'threadId': 'running-chat', 'turnId': 'exact-turn'},
        },
      ]);
      expect(editable.widget.focusNode.hasFocus, isFalse);
      desktop.setPlan(true);
      await tester.pumpAndSettle();
      expect(
        find.byTooltip('Stop turn'),
        findsOneWidget,
        reason: 'A mode chip alone is not an outgoing draft',
      );
      await tester.tap(find.byTooltip('Start dictation'));
      await tester.pumpAndSettle();
      expect(editable.widget.focusNode.hasFocus, isFalse);
      expect(
        tester.state<EditableTextState>(find.byType(EditableText)),
        same(editable),
      );
      expect(tester.takeException(), isNull);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'moved runtime model selects normally but stale open picker cannot mutate another chat',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.model = 'qa';
      desktop.thread = {'id': 'runtime-owner'};
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('desktop_composer')));
      await tester.pumpAndSettle();
      remote.calls.clear();
      await tester.tap(find.byTooltip('Chat controls'));
      await tester.pumpAndSettle();
      expect(remote.calls, isEmpty);
      await tester.tap(find.byKey(const Key('desktop_runtime_model')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('runtime.other_models')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('runtime.model.other')));
      await tester.pumpAndSettle();
      expect(desktop.model, 'other');
      expect(desktop.effort, 'high');
      expect(remote.calls, isEmpty);
      await tester.tap(find.byTooltip('Chat controls'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('desktop_runtime_model')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('runtime.other_models')));
      await tester.pumpAndSettle();
      final staleChoice = tester
          .widget<TextButton>(find.byKey(const Key('runtime.model.qa')))
          .onPressed!;
      desktop.thread = {'id': 'replacement'};
      desktop.threadList.filter(search: '');
      await tester.pump();
      staleChoice();
      await tester.pumpAndSettle();
      expect(desktop.model, 'other');
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'compact access preserves explicit confirmation, exact RPC and error rollback',
    (tester) async {
      final remote = AccessTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      await desktop.connect(desktop.active!, resolve: false);
      desktop.thread = {'id': 'access-owner'};
      desktop.model = 'qa';
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('desktop_composer')));
      await tester.pumpAndSettle();
      final original = desktop.access;
      remote.calls.clear();
      Future<void> selectFull() async {
        await tester.tap(find.byKey(const Key('composer.access')));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Full access').last);
        await tester.pumpAndSettle();
        expect(find.text('Allow full desktop access?'), findsOneWidget);
      }

      await selectFull();
      expect(remote.calls, isEmpty);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(desktop.access, original);
      expect(remote.calls, isEmpty);
      remote.failAccess = true;
      await selectFull();
      await tester.tap(find.text('Allow full access'));
      await tester.pumpAndSettle();
      expect(remote.calls, [
        {
          'method': 'djl/thread/runtimeMode/set',
          'params': {'threadId': 'access-owner', 'runtimeMode': 'full-access'},
        },
      ]);
      expect(desktop.access, original);
      expect(
        find.textContaining('Access change rejected by desktop'),
        findsWidgets,
      );
      remote.calls.clear();
      await selectFull();
      desktop.thread = {'id': 'replacement'};
      desktop.threadList.filter(search: '');
      await tester.pump();
      await tester.tap(find.text('Allow full access'));
      await tester.pumpAndSettle();
      expect(
        remote.calls.where((v) => v['method'] == 'djl/thread/runtimeMode/set'),
        isEmpty,
      );
      expect(desktop.access, original);
      await finishDraft(tester, desktop);
    },
  );

  for (final replacement in ['pin', 'thread']) {
    testWidgets(
      'already open options menu is inert after $replacement change',
      (tester) async {
        final remote = DraftTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        desktop.thread = {'id': 'menu-owner'};
        final picker = PendingImagePicker();
        await tester.pumpWidget(
          MaterialApp(
            home: DesktopChatPage(controller: desktop, imagePicker: picker),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Composer options'));
        await tester.pumpAndSettle();
        if (replacement == 'pin') {
          desktop.active = Pairing({
            ...desktop.active!.data,
            'macIdentityPublicKey': 'replacement-pin',
          });
        } else {
          desktop.thread = {'id': 'replacement'};
        }
        desktop.threadList.filter(search: '');
        await tester.pump();
        await tester.tap(find.text('Photo library'));
        await tester.pumpAndSettle();
        expect(picker.jobs, isEmpty);
        expect(find.byTooltip('Remove image'), findsNothing);
        await finishDraft(tester, desktop);
      },
    );
  }

  for (final replacement in ['host', 'pin', 'project']) {
    testWidgets(
      'pending photo selected through menu is rejected after $replacement replacement',
      (tester) async {
        final remote = DraftTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        desktop.thread = {'id': 'owner', 'cwd': '/original'};
        final picker = PendingImagePicker();
        await tester.pumpWidget(
          MaterialApp(
            home: DesktopChatPage(controller: desktop, imagePicker: picker),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Composer options'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Photo library'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(picker.jobs, hasLength(1));
        if (replacement == 'host') {
          desktop.active = Pairing({
            ...desktop.active!.data,
            'macDeviceId': 'replacement-mac',
          });
        } else if (replacement == 'pin') {
          desktop.active = Pairing({
            ...desktop.active!.data,
            'macIdentityPublicKey': 'replacement-pin',
          });
        } else {
          desktop.thread = {'id': 'owner', 'cwd': '/replacement'};
        }
        desktop.threadList.filter(search: '');
        await tester.pump();
        picker.jobs.single.complete(
          const DesktopComposerImage(
            id: 'stale',
            name: 'stale.png',
            dataUrl: 'data:image/png;base64,YQ==',
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byTooltip('Remove image'), findsNothing);
        expect(desktop.threadList.data.composerDraft('owner').images, isEmpty);
        await finishDraft(tester, desktop);
      },
    );
  }
  for (final width in [360.0, 402.0, 411.0]) {
    testWidgets(
      'composer remains usable at width $width with keyboard, insets and large custom text',
      (tester) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = Size(
          width,
          width == 360
              ? 800
              : width == 402
              ? 874
              : 923,
        );
        tester.view.padding = const FakeViewPadding(top: 44, bottom: 34);
        tester.view.viewPadding = const FakeViewPadding(top: 44, bottom: 34);
        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        addTearDown(tester.view.reset);
        final remote = DraftTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        desktop.model = 'qa';
        desktop.thread = {'id': 'layout'};
        desktop.threadList.data.setComposerDraft(
          'layout',
          DesktopComposerDraft(
            contexts: [
              const DesktopComposerContext(
                kind: DesktopContextKind.skill,
                id: 'review',
                name: 'review',
              ),
            ],
            images: [
              const DesktopComposerImage(
                id: 'photo',
                name: 'photo.png',
                dataUrl:
                    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              ),
            ],
          ),
        );
        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(fontFamily: 'Custom QA Font'),
            darkTheme: ThemeData.dark().copyWith(
              textTheme: ThemeData.dark().textTheme.apply(
                fontFamily: 'Custom QA Font',
              ),
            ),
            themeMode: width == 360
                ? ThemeMode.light
                : width == 402
                ? ThemeMode.dark
                : ThemeMode.system,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: const TextScaler.linear(2.2),
                disableAnimations: true,
              ),
              child: child!,
            ),
            home: DesktopChatPage(controller: desktop),
          ),
        );
        await tester.pumpAndSettle();
        final field = find.byKey(const Key('desktop_composer'));
        await tester.enterText(
          field,
          List.generate(12, (i) => 'Editable long line $i').join('\n'),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.ensureVisible(find.byTooltip('Send to desktop'));
        await tester.pumpAndSettle();
        final inputRect = tester.getRect(field),
            sendRect = tester.getRect(find.byTooltip('Send to desktop'));
        expect(inputRect.overlaps(sendRect), isFalse);
        expect(
          sendRect.bottom,
          lessThanOrEqualTo(tester.view.physicalSize.height - 300),
        );
        final editable = tester.state<EditableTextState>(
          find.byType(EditableText),
        );
        expect(
          editable.widget.scrollController?.position.maxScrollExtent ??
              editable.renderEditable.maxScrollExtent,
          greaterThan(0),
        );
        expect(
          tester.widget<TextField>(field).style!.fontFamily,
          'Custom QA Font',
        );
        await tester.tap(find.byTooltip('Composer options'));
        await tester.pumpAndSettle();
        final plan = find.ancestor(
          of: find.text('Plan mode'),
          matching: find.byType(CheckedPopupMenuItem<String>),
        );
        await tester.ensureVisible(plan);
        await tester.tap(plan);
        await tester.pumpAndSettle();
        expect(desktop.plan, isTrue);
        expect(tester.takeException(), isNull);
        expect(
          tester.state<EditableTextState>(find.byType(EditableText)),
          same(editable),
        );
        await finishDraft(tester, desktop);
      },
    );
  }
}
