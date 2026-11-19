import '../support/native_text_search.dart'
    show useAsciiNativeSearch, clearNativeSearchFixture;
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_composer_widgets.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_navigation_menu.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_phone_drawer.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../../integration_test/support/native_draft_interactions.dart';
import '../../integration_test/threads_test.dart' show type;
import '../features/cloud_deep_links_test.dart' show client;
import '../features/desktop_root_routing_test.dart' show savedPair;
import '../features/settings/app_lock_controller_test.dart' show FakeOwnerAuth;
import '../core/cloud_client_test.dart' show TestCredentials;
import '../features/desktop_new_chat_draft_test.dart';

Future<void> _rootlessFooterReplacement(
  WidgetTester tester, {
  required Size physicalSize,
  required double dpr,
  bool diagnoseTransition = false,
}) async {
  tester.view.physicalSize = physicalSize;
  tester.view.devicePixelRatio = dpr;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final credentials = TestCredentials(), pair = savedPair('mac-a');
  credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
  credentials.values['desktop.active'] = pair.macDeviceId;
  final remote = DraftTransport(PairingRepository(credentials));
  final desktop = await draftDesktop(remote);
  final cloudCalls = <String>[];
  final lock = AppLockController(FakeOwnerAuth()..result = true);
  await tester.pumpWidget(
    DjlApp(
      client: client(credentials, cloudCalls),
      desktop: desktop,
      appLock: lock,
      initialLink: Future.value(null),
      linkStream: const Stream.empty(),
    ),
  );
  await tester.pumpAndSettle();
  final entry = find.bySemanticsLabel('New chat');
  await tester.ensureVisible(entry);
  await tester.tap(entry);
  await tester.pumpAndSettle();
  final page = find.byType(DesktopChatPage);
  final allPages = find.byType(DesktopChatPage, skipOffstage: false);
  expect(allPages, findsOneWidget);
  final oldOwner = desktop.newChatDraft!;
  final field = find.byKey(const Key('desktop_composer'));
  await tester.enterText(field, 'Retain outgoing rootless input');
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
  final oldInput = tester.widget<TextField>(field).controller;
  final active = desktop.active;
  final trusted = List.of(desktop.trusted);
  final scope = desktop.threadList.macDeviceId;
  final history = jsonEncode(desktop.threads);
  final calls = remote.calls.length, sent = remote.sent.length;
  final quietCloud = List.of(cloudCalls);
  await tester.tap(find.byTooltip('Open navigation'));
  await tester.pumpAndSettle();
  final oldState = tester.state(page);
  await tapNativeDraftFooterChat(tester);
  if (diagnoseTransition) {
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    final freshPage = find.byWidgetPredicate(
      (widget) =>
          widget is DesktopChatPage &&
          identical(widget.draft, desktop.newChatDraft),
      skipOffstage: false,
    );
    expect(freshPage, findsOneWidget);
    final incoming = ModalRoute.of(tester.element(freshPage))!;
    expect(incoming.transitionDuration, const Duration(milliseconds: 450));
    expect(incoming.animation!.status, AnimationStatus.forward);
    expect(oldState.mounted, isTrue);
    expect(allPages, findsNWidgets(2));
    debugPrint(
      'TASK55_DIAGNOSTIC at400 oldMounted=true allPages=2 status=forward',
    );
    final deadline = tester.binding.clock.now().add(
      const Duration(seconds: 45),
    );
    while (incoming.animation!.status != AnimationStatus.completed &&
        tester.binding.clock.now().isBefore(deadline)) {
      await tester.pump(const Duration(milliseconds: 25));
    }
    expect(incoming.animation!.status, AnimationStatus.completed);
    await tester.pump();
    await tester.pump();
    expect(oldState.mounted, isFalse);
    expect(allPages, findsOneWidget);
    debugPrint('TASK55_DIAGNOSTIC completed oldMounted=false allPages=1');
  }
  await waitForNativeDraftReplacement(
    tester,
    oldState: oldState,
    desktop: desktop,
  );
  final fresh = desktop.newChatDraft!;
  expect(oldState.mounted, isFalse);
  expect(allPages, findsOneWidget);
  expect(tester.widget<DesktopChatPage>(allPages).draft, same(fresh));
  expect(fresh.id, isNot(oldOwner.id));
  expect(fresh.cwd, isNull);
  expect(fresh.source.name, 'generalChat');
  expect(desktop.isCurrentNewChatDraft(oldOwner), isFalse);
  expect(desktop.isCurrentNewChatDraft(fresh), isTrue);
  expect(tester.widget<TextField>(field).controller, isNot(same(oldInput)));
  expect(tester.widget<TextField>(field).controller!.text, isEmpty);
  expect(
    desktop.threadList.data.composerDraft(oldOwner.storageKey).text,
    'Retain outgoing rootless input',
  );
  expect(desktop.active, same(active));
  expect(desktop.trusted, trusted);
  expect(desktop.threadList.macDeviceId, scope);
  expect(desktop.thread, isNull);
  expect(jsonEncode(desktop.threads), history);
  expect(remote.calls.length, calls);
  expect(remote.sent.length, sent);
  expect(requests(remote, 'thread/start'), isEmpty);
  expect(desktop.threadList.data.created, isEmpty);
  expect(cloudCalls, quietCloud);
  expect(tester.takeException(), isNull);
  await finishDraft(tester, desktop);
  lock.dispose();
}

void main() {
  setUp(useAsciiNativeSearch);
  tearDown(clearNativeSearchFixture);
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    final fatal = WidgetController.hitTestWarningShouldBeFatal;
    WidgetController.hitTestWarningShouldBeFatal = true;
    addTearDown(() => WidgetController.hitTestWarningShouldBeFatal = fatal);
  });
  testWidgets(
    'native Android footer waits for replacement lifecycle',
    (tester) async {
      await _rootlessFooterReplacement(
        tester,
        physicalSize: const Size(1080, 2424),
        dpr: 2.625,
      );
    },
    variant: TargetPlatformVariant.only(TargetPlatform.android),
  );
  testWidgets(
    'native Android footer completed transition disposal discriminator',
    (tester) async {
      await _rootlessFooterReplacement(
        tester,
        physicalSize: const Size(1080, 2424),
        dpr: 2.625,
        diagnoseTransition: true,
      );
    },
    variant: TargetPlatformVariant.only(TargetPlatform.android),
  );
  testWidgets(
    'native iPhone footer waits for replacement lifecycle',
    (tester) async {
      await _rootlessFooterReplacement(
        tester,
        physicalSize: const Size(1179, 2556),
        dpr: 3,
      );
    },
    variant: TargetPlatformVariant.only(TargetPlatform.iOS),
  );
  testWidgets(
    'native footer unresolved replacement fails at the 45 second bound',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      await enterDraft(tester, desktop);
      final allPages = find.byType(DesktopChatPage, skipOffstage: false);
      final oldState = tester.state(allPages);
      final started = tester.binding.clock.now();
      Object? failure;
      try {
        await waitForNativeDraftReplacement(
          tester,
          oldState: oldState,
          desktop: desktop,
        );
      } catch (error) {
        failure = error;
      }
      expect(failure, isA<TestFailure>());
      expect(
        tester.binding.clock.now().difference(started),
        const Duration(seconds: 45),
      );
      expect(oldState.mounted, isTrue);
      expect(allPages, findsOneWidget);
      expect(desktop.isCurrentNewChatDraft(desktop.newChatDraft!), isTrue);
      expect(tester.takeException(), isNull);
      await finishDraft(tester, desktop);
    },
  );
  for (final phone in [
    (name: 'Pixel9', size: Size(1080, 2424), dpr: 2.625),
    (name: 'iPhone', size: Size(1206, 2622), dpr: 3.0),
  ]) {
    testWidgets('native search readiness on actual ${phone.name} view', (
      tester,
    ) async {
      tester.view.physicalSize = phone.size;
      tester.view.devicePixelRatio = phone.dpr;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final credentials = TestCredentials(), pair = savedPair('mac-a');
      credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
      credentials.values['desktop.active'] = pair.macDeviceId;
      final remote = DraftTransport(PairingRepository(credentials));
      final desktop = await draftDesktop(remote);
      final cloudCalls = <String>[];
      final lock = AppLockController(FakeOwnerAuth()..result = true);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, cloudCalls),
          desktop: desktop,
          appLock: lock,
          initialLink: Future.value(null),
          linkStream: const Stream.empty(),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Chat').hitTestable());
      await tester.pumpAndSettle();
      final owner = desktop.newChatDraft!;
      final page = find.byType(DesktopChatPage);
      final pageState = tester.state(page);
      final field = find.byKey(const Key('desktop_composer'));
      await type(tester, field, 'Survive search and Settings');
      await tester.tap(field);
      await tester.pump(const Duration(milliseconds: 400));
      await tester.tap(find.byKey(const Key('composer.access')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      final desired = desktop.access == 'on-request'
          ? 'Approve for me'
          : 'Ask for approval';
      await tester.tap(find.text(desired).last);
      await tester.pump(const Duration(milliseconds: 400));
      expect(
        desktop.access,
        desired == 'Ask for approval' ? 'on-request' : 'auto-review',
      );
      await tester.tapAt(const Offset(12, 80));
      await tester.pump(const Duration(milliseconds: 400));
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pump(const Duration(milliseconds: 400));
      final editable = find.descendant(
        of: field,
        matching: find.byType(EditableText),
      );
      final editableState = tester.state(editable);
      final input = tester.widget<TextField>(field);
      final composer = tester
          .widget<DesktopComposerAttachments>(
            find.byType(DesktopComposerAttachments),
          )
          .controller;
      final pin = desktop.active;
      final scope = desktop.threadList.macDeviceId;
      final history = jsonEncode(desktop.threads);
      final calls = remote.calls.length, sent = remote.sent.length;
      final quietCloud = List.of(cloudCalls);
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      expect(find.byType(DesktopPhoneDrawer), findsOneWidget);
      final search = find.byKey(const Key('navigation.search'));
      expect(search, findsNothing);
      await openNativeDraftSearch(tester);
      expect(search.hitTestable(), findsOneWidget);
      await type(tester, search, 'draft-local-search');
      final query = tester.widget<TextField>(search).controller;
      await tester.tap(find.byTooltip('Settings'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      expect(search.hitTestable(), findsOneWidget);
      expect(tester.widget<TextField>(search).controller, same(query));
      expect(query!.text, 'draft-local-search');
      await tapNativeDraftPanelScrim(tester);
      await tester.pumpAndSettle();
      expect(tester.state(page), same(pageState));
      expect(tester.state(editable), same(editableState));
      expect(
        tester.widget<TextField>(field).controller,
        same(input.controller),
      );
      expect(tester.widget<TextField>(field).focusNode, same(input.focusNode));
      expect(input.controller!.text, 'Survive search and Settings');
      expect(
        tester
            .widget<DesktopComposerAttachments>(
              find.byType(DesktopComposerAttachments),
            )
            .controller,
        same(composer),
      );
      expect(desktop.newChatDraft, same(owner));
      expect(desktop.isCurrentNewChatDraft(owner), isTrue);
      expect(owner.cwd, isNull);
      expect(desktop.active, same(pin));
      expect(desktop.threadList.macDeviceId, scope);
      expect(desktop.thread, isNull);
      expect(jsonEncode(desktop.threads), history);
      expect(remote.calls.length, calls);
      expect(remote.sent.length, sent);
      expect(cloudCalls, quietCloud);
      expect(requests(remote, 'thread/start'), isEmpty);
      expect(tester.takeException(), isNull);
      await finishDraft(tester, desktop);
      lock.dispose();
    });
  }
  for (final project in [false, true]) {
    testWidgets(
      'native fresh ${project ? 'project' : 'rootless'} draft autofocus then menu collapse stays local',
      (tester) async {
        final remote = DraftTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        await enterDraft(tester, desktop, project: project);
        final owner = desktop.newChatDraft!;
        final calls = remote.calls.length;
        final sent = remote.sent.length;
        final ids = desktop.threads.map((row) => row['id']).toSet();
        await verifyNativeDraftInitialComposer(tester);
        expect(desktop.newChatDraft, same(owner));
        expect(desktop.isCurrentNewChatDraft(owner), isTrue);
        expect(desktop.thread, isNull);
        expect(desktop.threads.map((row) => row['id']).toSet(), ids);
        expect(remote.calls.length, calls);
        expect(remote.sent.length, sent);
        expect(requests(remote, 'thread/start'), isEmpty);
        expect(tester.takeException(), isNull);
        await finishDraft(tester, desktop);
      },
    );
  }
  for (final width in [360.0, 402.0, 411.0]) {
    testWidgets(
      'native draft visible scrim tap retains exact owner at $width',
      (tester) async {
        tester.view.physicalSize = Size(width, 874);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final remote = DraftTransport(PairingRepository(TestCredentials()));
        final desktop = await draftDesktop(remote);
        await enterDraft(tester, desktop);
        final page = find.byType(DesktopChatPage);
        final owner = desktop.newChatDraft!;
        await tester.enterText(
          find.byKey(const Key('desktop_composer')),
          'Keep local input',
        );
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pumpAndSettle();
        final pageState = tester.state(page);
        final composer = tester
            .widget<DesktopComposerAttachments>(
              find.byType(DesktopComposerAttachments),
            )
            .controller;
        final input = tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller;
        final calls = remote.calls.length;
        await tester.tap(find.byTooltip('Open navigation'));
        await tester.pumpAndSettle();
        final drawer = find.descendant(
          of: page,
          matching: find.byType(DesktopPhoneDrawer),
        );
        final scrim = find.byKey(const Key('navigation.scrim'));
        expect(
          tester.getRect(drawer).contains(tester.getRect(scrim).center),
          isFalse,
        );
        await tapNativeDraftPanelScrim(tester);
        await tester.pumpAndSettle();
        expect(scrim, findsNothing);
        expect(tester.state(page), same(pageState));
        expect(desktop.newChatDraft, same(owner));
        expect(desktop.isCurrentNewChatDraft(owner), isTrue);
        expect(
          tester
              .widget<DesktopComposerAttachments>(
                find.byType(DesktopComposerAttachments),
              )
              .controller,
          same(composer),
        );
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('desktop_composer')))
              .controller,
          same(input),
        );
        expect(input!.text, 'Keep local input');
        expect(desktop.thread, isNull);
        expect(remote.calls.length, calls);
        expect(requests(remote, 'thread/start'), isEmpty);
        expect(tester.takeException(), isNull);
        await finishDraft(tester, desktop);
      },
      variant: TargetPlatformVariant.only(TargetPlatform.iOS),
    );
  }
  testWidgets('native draft scoped footer label taps actual icon button once', (
    tester,
  ) async {
    final remote = DraftTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    await enterDraft(tester, desktop, project: true);
    final owner = desktop.newChatDraft!;
    await tester.enterText(
      find.byKey(const Key('desktop_composer')),
      'Old project input',
    );
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    final calls = remote.calls.length;
    final ids = desktop.threads.map((row) => row['id']).toSet();
    await tester.tap(find.byTooltip('Open navigation'));
    await tester.pumpAndSettle();
    final menu = find.descendant(
      of: find.byType(DesktopChatPage),
      matching: find.byType(DesktopNavigationMenu),
    );
    final footer = find
        .descendant(of: menu, matching: find.text('Chat'))
        .hitTestable();
    expect(footer, findsOneWidget);
    expect(
      find.ancestor(
        of: footer,
        matching: find.byWidgetPredicate((widget) => widget is FilledButton),
      ),
      findsOneWidget,
    );
    expect(find.widgetWithText(FilledButton, 'Chat'), findsNothing);
    await tapNativeDraftFooterChat(tester);
    await tester.pumpAndSettle();
    final fresh = desktop.newChatDraft!;
    expect(fresh.id, isNot(owner.id));
    expect(fresh.cwd, isNull);
    expect(fresh.source.name, 'generalChat');
    expect(desktop.isCurrentNewChatDraft(owner), isFalse);
    expect(desktop.isCurrentNewChatDraft(fresh), isTrue);
    expect(
      desktop.threadList.data.composerDraft(owner.storageKey).text,
      'Old project input',
    );
    expect(find.byType(DesktopChatPage), findsOneWidget);
    expect(find.byKey(const Key('navigation.scrim')), findsNothing);
    expect(desktop.thread, isNull);
    expect(desktop.threads.map((row) => row['id']).toSet(), ids);
    expect(remote.calls.length, calls);
    expect(requests(remote, 'thread/start'), isEmpty);
    expect(tester.takeException(), isNull);
    await finishDraft(tester, desktop);
  });
}
