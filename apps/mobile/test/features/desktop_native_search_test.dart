import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'desktop_drawer_pin_menu_test.dart' show mountPinMenu;
import 'desktop_new_chat_draft_test.dart' show finishDraft;

const channel = MethodChannel('djl.mobile/app-info');

void main() {
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  testWidgets('phone search retains the native sharp-S match and clears it', (
    tester,
  ) async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          if (call.method != 'searchMatches') return null;
          final args = call.arguments as Map;
          expect(args['query'], 'strasse');
          expect(args['titles'], ['Straße']);
          // The actual iOS Foundation reference verifies this expansion.
          return [0];
        });
    final f = await mountPinMenu(tester);
    try {
      f.desktop.threadList.data.rename('pin-owned', 'Straße');
      await tester.tap(find.byTooltip('Search chats'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('navigation.search')),
        'strasse',
      );
      await tester.pumpAndSettle();
      expect(find.text('Straße'), findsOneWidget);
      expect(find.text('No matching chats'), findsNothing);
      await tester.tap(find.byTooltip('Close search'));
      await tester.pumpAndSettle();
      expect(find.text('Straße'), findsOneWidget);
      expect(f.remote.calls, isEmpty);
    } finally {
      await finishDraft(tester, f.desktop);
    }
  });

  testWidgets('old native search completion cannot replace a newer query', (
    tester,
  ) async {
    final old = Completer<List<int>>();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          if (call.method != 'searchMatches') return null;
          final args = call.arguments as Map;
          return args['query'] == 'first' ? old.future : <int>[];
        });
    final f = await mountPinMenu(tester);
    try {
      await tester.tap(find.byTooltip('Search chats'));
      await tester.pumpAndSettle();
      final field = find.byKey(const Key('navigation.search'));
      await tester.enterText(field, 'first');
      await tester.pump();
      await tester.enterText(field, 'second');
      await tester.pumpAndSettle();
      expect(find.text('No matching chats'), findsOneWidget);
      old.complete([0]);
      await tester.pumpAndSettle();
      expect(find.text('Owned chat'), findsNothing);
      expect(find.text('No matching chats'), findsOneWidget);
    } finally {
      if (!old.isCompleted) old.complete([]);
      await finishDraft(tester, f.desktop);
    }
  });

  testWidgets('a title update replaces the pending native search snapshot', (
    tester,
  ) async {
    final old = Completer<List<int>>();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          if (call.method != 'searchMatches') return null;
          final args = call.arguments as Map;
          return (args['titles'] as List).single == 'Owned chat'
              ? old.future
              : [0];
        });
    final f = await mountPinMenu(tester);
    try {
      await tester.tap(find.byTooltip('Search chats'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('navigation.search')),
        'name',
      );
      await tester.pump();
      f.desktop.threadList.data.rename('pin-owned', 'Renamed');
      await f.desktop.threadList.pin('pin-owned', true);
      await tester.pumpAndSettle();
      expect(find.text('Renamed'), findsOneWidget);
      old.complete([]);
      await tester.pumpAndSettle();
      expect(find.text('Renamed'), findsOneWidget);
      expect(f.remote.calls, isEmpty);
    } finally {
      if (!old.isCompleted) old.complete([]);
      await finishDraft(tester, f.desktop);
    }
  });

  testWidgets('native search failure is distinct from no matches and retries', (
    tester,
  ) async {
    var attempts = 0;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          if (call.method != 'searchMatches') return null;
          if (++attempts == 1) {
            throw PlatformException(code: 'search_unavailable');
          }
          return [0];
        });
    final f = await mountPinMenu(tester);
    try {
      await tester.tap(find.byTooltip('Search chats'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('navigation.search')),
        'owned',
      );
      await tester.pumpAndSettle();
      expect(find.text('Could not search chats.'), findsOneWidget);
      expect(find.text('No matching chats'), findsNothing);
      await tester.tap(find.text('Retry search'));
      await tester.pumpAndSettle();
      expect(find.text('Owned chat'), findsOneWidget);
      expect(find.text('Could not search chats.'), findsNothing);
      expect(f.remote.calls, isEmpty);
    } finally {
      await finishDraft(tester, f.desktop);
    }
  });
}
