import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_navigation_menu.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_composer_widgets.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_phone_drawer.dart';

Finder _draftDrawer() => find.descendant(
  of: find.byType(DesktopChatPage),
  matching: find.byType(DesktopPhoneDrawer),
);

// These are the actual native draft journey gestures, shared with host checks.
Future<void> tapNativeDraftPanelScrim(WidgetTester tester) async {
  final drawer = _draftDrawer();
  expect(drawer, findsOneWidget);
  final scrim = find.descendant(
    of: drawer,
    matching: find.byKey(const Key('navigation.scrim')),
  );
  final visible = tester.getRect(scrim).intersect(tester.getRect(drawer));
  expect(visible.isEmpty, isFalse);
  await tester.tapAt(visible.center);
}

Future<void> tapNativeDraftFooterChat(WidgetTester tester) async {
  final menu = find.descendant(
    of: _draftDrawer(),
    matching: find.byType(DesktopNavigationMenu),
  );
  final chat = find
      .descendant(of: menu, matching: find.text('Chat'))
      .hitTestable();
  await tester.tap(chat);
}

Future<void> waitForNativeDraftReplacement(
  WidgetTester tester, {
  required State oldState,
  required DesktopController desktop,
}) async {
  final pages = find.byType(DesktopChatPage, skipOffstage: false);
  bool ready() {
    final draft = desktop.newChatDraft;
    return !oldState.mounted &&
        pages.evaluate().length == 1 &&
        draft != null &&
        desktop.isCurrentNewChatDraft(draft) &&
        identical(tester.widget<DesktopChatPage>(pages).draft, draft);
  }

  final deadline = tester.binding.clock.now().add(const Duration(seconds: 45));
  while (!ready() && tester.binding.clock.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 200));
  }
  expect(ready(), isTrue, reason: 'Draft native replacement did not complete.');
  await tester.pump();
}

Future<void> verifyNativeDraftInitialComposer(WidgetTester tester) async {
  final page = find.byType(DesktopChatPage);
  expect(page, findsOneWidget);
  final pageState = tester.state(page);
  final field = find.byKey(const Key('desktop_composer'));
  expect(field, findsOneWidget);
  final editable = find.descendant(
    of: field,
    matching: find.byType(EditableText),
  );
  expect(editable, findsOneWidget);
  final editableState = tester.state(editable);
  final input = tester.widget<TextField>(field);
  final composer = tester
      .widget<DesktopComposerAttachments>(
        find.byType(DesktopComposerAttachments),
      )
      .controller;
  expect(input.controller!.text, isEmpty);
  expect(input.focusNode!.hasFocus, isTrue);
  final send = find.byTooltip('Send to desktop');
  expect(send, findsOneWidget);
  expect(
    tester
        .widget<IconButton>(
          find.ancestor(of: send, matching: find.byType(IconButton)),
        )
        .onPressed,
    isNull,
  );
  await tester.tap(find.byTooltip('Open navigation'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 600));
  expect(find.byKey(const Key('navigation.scrim')), findsOneWidget);
  await tapNativeDraftPanelScrim(tester);
  await tester.pump();
  final deadline = tester.binding.clock.now().add(const Duration(seconds: 3));
  while (find.byKey(const Key('navigation.scrim')).evaluate().isNotEmpty &&
      tester.binding.clock.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  expect(find.byKey(const Key('navigation.scrim')), findsNothing);
  expect(send, findsNothing);
  expect(tester.state(page), same(pageState));
  expect(tester.state(editable), same(editableState));
  expect(tester.widget<TextField>(field).controller, same(input.controller));
  expect(tester.widget<TextField>(field).focusNode, same(input.focusNode));
  expect(input.focusNode!.hasFocus, isFalse);
  expect(input.controller!.text, isEmpty);
  expect(
    tester
        .widget<DesktopComposerAttachments>(
          find.byType(DesktopComposerAttachments),
        )
        .controller,
    same(composer),
  );
}

Future<void> openNativeDraftSearch(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Search chats'));
  final field = find.byKey(const Key('navigation.search'));
  final deadline = DateTime.now().add(const Duration(seconds: 45));
  while (field.hitTestable().evaluate().length != 1 &&
      DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 200));
  }
  expect(field, findsOneWidget);
  expect(field.hitTestable(), findsOneWidget);
}
