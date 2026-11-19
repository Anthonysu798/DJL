import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/settings/presentation/local_settings_page.dart';
import 'package:djl_mobile/features/settings/presentation/archived_chat_row.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import '../desktop_activity_test.dart' show ActivityCacheStore;
import '../host/host_controller_test.dart' show HostTransport;
import 'settings_controller_test.dart' show MemorySettingsStore;

class ArchiveTransport extends HostTransport {
  bool online = false;
  String selectedMac = 'mac-a';
  @override
  bool get connected => online;
  @override
  String? get macDeviceId => selectedMac;
}

Future<
  ({
    DesktopController desktop,
    ArchiveTransport transport,
    ActivityCacheStore cache,
  })
>
showArchiveSettings(
  WidgetTester tester, {
  bool empty = true,
  double scale = 1,
  Brightness brightness = Brightness.light,
}) async {
  final settings = SettingsController(MemorySettingsStore());
  await settings.load();
  final transport = ArchiveTransport(), cache = ActivityCacheStore();
  if (!empty) {
    await cache.save('mac-a', {
      'threads': [
        {
          'id': 'older',
          'name': 'Older archive',
          'archived': true,
          'updatedAt': 100,
        },
        {
          'id': 'newer',
          'name': 'Newer archive',
          'archived': true,
          'updatedAt': 300,
        },
        {'id': 'active', 'name': 'Active chat', 'updatedAt': 400},
      ],
      'drafts': {'active': 'Keep this unsent draft'},
    });
  }
  final desktop = DesktopController(
    transport.pairings,
    connection: transport,
    localStore: cache,
    settings: settings,
  );
  await desktop.threadList.attach('mac-a');
  desktop.threadList.filter(search: 'unchanged main query');
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox());
    desktop.dispose();
    settings.dispose();
  });
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(brightness),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: LocalSettingsPage(
        controller: settings,
        desktop: desktop,
        signedIn: false,
        onCloud: () {},
        onMyMacs: () {},
        taskStatus: const Text('Task status unavailable'),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (desktop: desktop, transport: transport, cache: cache);
}

Future<void> openArchives(WidgetTester tester) async {
  await tester.ensureVisible(find.text('Archived Chats'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Archived Chats'));
  await tester.pumpAndSettle();
}

Future<void> archiveMenu(
  WidgetTester tester,
  String title,
  String action,
) async {
  await tester.longPress(find.text(title));
  await tester.pumpAndSettle();
  await tester.tap(find.text(action));
  await tester.pumpAndSettle();
}

Future<void> dismissArchiveRemoval(WidgetTester tester) async {
  final height = tester.view.physicalSize.height / tester.view.devicePixelRatio;
  await tester.tapAt(Offset(4, height / 2));
  await tester.pumpAndSettle();
}

void main() {
  for (final selected in ['newer', 'active']) {
    testWidgets(
      'confirmed local removal closes only the selected target $selected',
      (tester) async {
        final f = await showArchiveSettings(tester, empty: false);
        f.desktop.thread = {'id': selected};
        f.desktop.timeline = [
          {
            'id': 'cached',
            'type': 'agentMessage',
            'text': 'Synthetic cached reply',
          },
        ];
        await openArchives(tester);
        await archiveMenu(tester, 'Newer archive', 'Remove from Phone');
        await tester.tap(find.text('Remove from Phone'));
        await tester.pumpAndSettle();
        expect(f.desktop.thread?['id'], selected == 'newer' ? null : 'active');
        expect(
          f.desktop.timeline,
          selected == 'newer' ? isEmpty : hasLength(1),
        );
        expect(f.desktop.threadList.data.deleted, contains('newer'));
        expect(
          f.desktop.threadList.data.drafts['active'],
          'Keep this unsent draft',
        );
        expect(f.transport.calls, isEmpty);
      },
    );
  }
  testWidgets('elapsed refresh pauses in background and updates on resume', (
    tester,
  ) async {
    const channel = MethodChannel('djl.mobile/app-info');
    var resumed = false;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
      call,
    ) async {
      if (call.method != 'relativeDate') return false;
      return resumed ? 'Resumed elapsed caption' : 'Initial elapsed caption';
    });
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        null,
      ),
    );
    try {
      await showArchiveSettings(tester, empty: false);
      await openArchives(tester);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      resumed = true;
      await tester.pump(const Duration(seconds: 2));
      await tester.pumpAndSettle();
      expect(find.text('Initial elapsed caption'), findsNWidgets(2));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.text('Resumed elapsed caption'), findsNWidgets(2));
    } finally {
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    }
  });
  testWidgets(
    'archive captions request the source elapsed style rather than an ago phrase',
    (tester) async {
      const channel = MethodChannel('djl.mobile/app-info');
      final requests = <Map<Object?, Object?>>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
        call,
      ) async {
        if (call.method != 'relativeDate') return false;
        final args = Map<Object?, Object?>.from(call.arguments as Map);
        requests.add(args);
        return args['elapsed'] == true ? '1 hr, 0 mins' : '1 hr ago';
      });
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          channel,
          null,
        ),
      );
      await showArchiveSettings(tester, empty: false);
      await openArchives(tester);
      expect(find.text('1 hr, 0 mins'), findsNWidgets(2));
      expect(requests.every((args) => args['elapsed'] == true), isTrue);
      expect(find.text('1 hr ago'), findsNothing);
    },
  );
  testWidgets(
    'visible elapsed captions refresh as time passes without a server read',
    (tester) async {
      const channel = MethodChannel('djl.mobile/app-info');
      var updated = false;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
        call,
      ) async {
        if (call.method != 'relativeDate') return false;
        return updated ? 'Updated elapsed caption' : 'Initial elapsed caption';
      });
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          channel,
          null,
        ),
      );
      final f = await showArchiveSettings(tester, empty: false);
      await openArchives(tester);
      expect(find.text('Initial elapsed caption'), findsNWidgets(2));
      updated = true;
      await tester.pump(const Duration(seconds: 2));
      await tester.pumpAndSettle();
      expect(find.text('Updated elapsed caption'), findsNWidgets(2));
      expect(f.transport.calls, isEmpty);
    },
  );
  for (final encoded in <Map<String, Object?>>[
    {'updatedAt': '1700000000'},
    {'updatedAt': '1700000000000'},
    {'updatedAt': '1700000000000000'},
    {'updatedAt': '1700000000000000000'},
    {'updated_at': 1700000000},
    {'updatedAt': 'bad', 'created_at': '1700000000'},
    {'updatedAt': ' 2023-11-14T22:13:20Z '},
  ]) {
    testWidgets('archived dates preserve Swift timestamp shape $encoded', (
      tester,
    ) async {
      const channel = MethodChannel('djl.mobile/app-info');
      final calls = <Map<Object?, Object?>>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
        call,
      ) async {
        if (call.method != 'relativeDate') return false;
        calls.add(Map<Object?, Object?>.from(call.arguments as Map));
        return 'Localized archive date';
      });
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          channel,
          null,
        ),
      );
      final f = await showArchiveSettings(tester, empty: false);
      f.desktop.threadList.data.upsert({
        'id': 'encoded',
        'name': 'Encoded archive',
        'archived': true,
        ...encoded,
      });
      await openArchives(tester);
      expect(
        calls.where((call) => call['date'] == 1700000000000),
        hasLength(1),
      );
      expect(
        tester.getTopLeft(find.text('Encoded archive')).dy,
        lessThan(tester.getTopLeft(find.text('Newer archive')).dy),
      );
    });
  }
  testWidgets(
    'accessible Unarchive performs the same local action without a swipe',
    (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        final f = await showArchiveSettings(tester, empty: false);
        await openArchives(tester);
        final row = find.widgetWithText(ArchivedChatRow, 'Newer archive');
        final node = tester.getSemantics(row);
        final actions = node.getSemanticsData().customSemanticsActionIds ?? [];
        final labels = {
          for (final id in actions)
            CustomSemanticsAction.getAction(id)!.label: id,
        };
        expect(labels.keys, containsAll(['Unarchive', 'Remove from Phone']));
        tester
            .renderObject(row)
            .owner!
            .semanticsOwner!
            .performAction(
              node.id,
              SemanticsAction.customAction,
              labels['Unarchive'],
            );
        await tester.pumpAndSettle();
        expect(f.desktop.threadList.data.isArchived('newer'), isFalse);
        expect(find.text('Newer archive'), findsNothing);
        expect(f.transport.calls, isEmpty);
      } finally {
        semantics.dispose();
      }
    },
  );
  testWidgets(
    'Settings always opens the separate local Archived Chats page offline',
    (tester) async {
      final f = await showArchiveSettings(tester);
      expect(find.text('Archived Chats'), findsOneWidget);
      await tester.ensureVisible(find.text('Archived Chats'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Archived Chats'));
      await tester.pumpAndSettle();
      expect(find.text('No archived chats'), findsOneWidget);
      expect(f.desktop.threadList.showArchived, isFalse);
      expect(f.desktop.threadList.query, 'unchanged main query');
      expect(f.transport.calls, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'local archive count and newest-first rows ignore the main filter and preserve draft',
    (tester) async {
      final f = await showArchiveSettings(tester, empty: false);
      expect(find.text('2 saved locally'), findsOneWidget);
      await openArchives(tester);
      expect(find.text('Active chat'), findsNothing);
      expect(
        tester.getTopLeft(find.text('Newer archive')).dy,
        lessThan(tester.getTopLeft(find.text('Older archive')).dy),
      );
      await tester.tap(find.byTooltip('Back'));
      await tester.pumpAndSettle();
      expect(find.text('2 saved locally'), findsOneWidget);
      expect(f.desktop.threadList.query, 'unchanged main query');
      expect(f.desktop.threadList.showArchived, isFalse);
      expect(
        f.desktop.threadList.data.drafts['active'],
        'Keep this unsent draft',
      );
      expect(f.transport.calls, isEmpty);
    },
  );
  testWidgets(
    'archive ordering falls back to created date without mutating cached order',
    (tester) async {
      final f = await showArchiveSettings(tester, empty: false);
      f.desktop.threadList.data.upsert({
        'id': 'created',
        'name': 'Created archive',
        'archived': true,
        'createdAt': 200,
      });
      final original = f.desktop.threadList.data.snapshots
          .map((t) => t['id'])
          .toList();
      await openArchives(tester);
      expect(
        tester.getTopLeft(find.text('Newer archive')).dy,
        lessThan(tester.getTopLeft(find.text('Created archive')).dy),
      );
      expect(
        tester.getTopLeft(find.text('Created archive')).dy,
        lessThan(tester.getTopLeft(find.text('Older archive')).dy),
      );
      expect(f.desktop.threadList.data.snapshots.map((t) => t['id']), original);
    },
  );
  for (final leading in [true, false]) {
    testWidgets(
      'a ${leading ? 'leading' : 'trailing'} archive swipe follows source commit behavior',
      (tester) async {
        final f = await showArchiveSettings(tester, empty: false);
        await openArchives(tester);
        final row = find.text('Newer archive');
        await tester.drag(row, Offset(leading ? 600 : -600, 0));
        await tester.pumpAndSettle();
        if (leading) {
          expect(f.desktop.threadList.data.isArchived('newer'), isFalse);
          expect(find.text('Newer archive'), findsNothing);
        } else {
          expect(f.desktop.threadList.data.deleted, isEmpty);
          expect(
            find.text('Remove "Newer archive" from this phone?'),
            findsNothing,
          );
          await tester.tap(find.text('Remove').hitTestable());
          await tester.pumpAndSettle();
          expect(
            find.text('Remove "Newer archive" from this phone?'),
            findsOneWidget,
          );
          await dismissArchiveRemoval(tester);
          expect(f.desktop.threadList.data.deleted, isEmpty);
        }
      },
    );
  }
  testWidgets(
    'Unarchive persists the subtree and emits only the existing owned RPC',
    (tester) async {
      final f = await showArchiveSettings(tester, empty: false);
      final list = f.desktop.threadList;
      list.data.upsert({
        'id': 'child',
        'parentThreadId': 'newer',
        'name': 'Child archive',
        'archived': true,
      });
      f.transport.online = true;
      await openArchives(tester);
      await archiveMenu(tester, 'Newer archive', 'Unarchive');
      expect(find.text('Newer archive'), findsNothing);
      expect(find.text('Child archive'), findsNothing);
      expect(list.data.isArchived('newer'), isFalse);
      expect(list.data.isArchived('child'), isFalse);
      expect(
        (f.cache.records['mac-a']!['archiveOverrides'] as Map),
        containsPair('newer', false),
      );
      expect(
        (f.cache.records['mac-a']!['archiveOverrides'] as Map),
        containsPair('child', false),
      );
      expect(f.transport.calls, hasLength(1));
      expect(f.transport.calls.single.$1, 'thread/unarchive');
      expect(f.transport.calls.single.$2, {'threadId': 'newer'});
      expect(list.query, 'unchanged main query');
    },
  );
  for (final cancel in [true, false]) {
    testWidgets(
      'Remove from Phone ${cancel ? 'Cancel' : 'confirmation'} stays local',
      (tester) async {
        final f = await showArchiveSettings(tester, empty: false);
        f.transport.online = true;
        await openArchives(tester);
        await archiveMenu(tester, 'Newer archive', 'Remove from Phone');
        expect(
          find.text('Remove "Newer archive" from this phone?'),
          findsOneWidget,
        );
        expect(f.desktop.threadList.data.deleted, isEmpty);
        expect(f.transport.calls, isEmpty);
        if (cancel) {
          await dismissArchiveRemoval(tester);
        } else {
          await tester.tap(find.text('Remove from Phone'));
          await tester.pumpAndSettle();
        }
        expect(f.desktop.threadList.data.deleted.contains('newer'), !cancel);
        expect(
          find.text('Newer archive'),
          cancel ? findsOneWidget : findsNothing,
        );
        expect(f.transport.calls, isEmpty);
        expect(
          f.desktop.threadList.data.drafts['active'],
          'Keep this unsent draft',
        );
      },
    );
  }
  for (final action in ['Unarchive', 'Remove from Phone']) {
    testWidgets(
      '$action cannot cross a selected-Mac/cache change with colliding IDs',
      (tester) async {
        final f = await showArchiveSettings(tester, empty: false);
        await openArchives(tester);
        await tester.longPress(find.text('Newer archive'));
        await tester.pumpAndSettle();
        if (action == 'Remove from Phone') {
          await tester.tap(find.text(action));
          await tester.pumpAndSettle();
        }
        await f.cache.save('mac-b', {
          'threads': [
            {'id': 'newer', 'name': 'Other Mac archive', 'archived': true},
          ],
        });
        f.transport.selectedMac = 'mac-b';
        await f.desktop.threadList.attach('mac-b');
        await tester.pumpAndSettle();
        await tester.tap(find.text(action));
        await tester.pumpAndSettle();
        expect(f.desktop.threadList.data.isArchived('newer'), isTrue);
        expect(f.desktop.threadList.data.deleted, isEmpty);
        expect(find.text('Other Mac archive'), findsOneWidget);
        expect(f.transport.calls, isEmpty);
      },
    );
  }
  testWidgets('remote unarchive invalidates an open Remove confirmation', (
    tester,
  ) async {
    final f = await showArchiveSettings(tester, empty: false);
    await openArchives(tester);
    await archiveMenu(tester, 'Newer archive', 'Remove from Phone');
    f.desktop.threadList.data.archive('newer', false);
    f.desktop.threadList.filter();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Remove from Phone'));
    await tester.pumpAndSettle();
    expect(f.desktop.threadList.data.deleted, isEmpty);
    expect(f.desktop.threadList.data.find('newer'), isNotNull);
    expect(f.transport.calls, isEmpty);
  });
  testWidgets(
    'an unconfirmed remote Unarchive retains the local result and shows sync warning',
    (tester) async {
      final f = await showArchiveSettings(tester, empty: false);
      f.transport.online = true;
      f.transport.handler = (_, _) async => throw StateError('refused');
      await openArchives(tester);
      await archiveMenu(tester, 'Newer archive', 'Unarchive');
      expect(f.desktop.threadList.data.isArchived('newer'), isFalse);
      expect(find.textContaining('could not be confirmed'), findsOneWidget);
      expect(f.transport.calls, hasLength(1));
      expect(f.transport.calls.single.$1, 'thread/unarchive');
      expect(f.transport.calls.single.$2, {'threadId': 'newer'});
    },
  );
  for (final brightness in Brightness.values) {
    testWidgets(
      'archive actions remain usable at narrow large text in $brightness',
      (tester) async {
        tester.view.physicalSize = const Size(320, 740);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await showArchiveSettings(
          tester,
          empty: false,
          scale: 2.2,
          brightness: brightness,
        );
        await openArchives(tester);
        await archiveMenu(tester, 'Newer archive', 'Remove from Phone');
        expect(find.text('Remove from Phone').hitTestable(), findsOneWidget);
        await dismissArchiveRemoval(tester);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
