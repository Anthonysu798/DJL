import 'package:djl_mobile/features/desktop/presentation/desktop_focus_timeline.dart';
import 'package:flutter/material.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_new_chat_draft_test.dart'
    show DraftTransport, draftDesktop, finishDraft;
import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final prefix in [0, 1]) {
    testWidgets(
      'a tall early reply cannot scroll into a blank leading viewport prefix=$prefix',
      (tester) async {
        tester.view.physicalSize = const Size(360, 480);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(platform: TargetPlatform.iOS),
            home: Scaffold(
              body: DesktopFocusTimeline(
                count: 2 + prefix,
                tailAnchor: prefix,
                itemBuilder: (_, i) => SizedBox(
                  height: i == 1 + prefix ? 1000 : 80,
                  child: Text(
                    i == 0 ? 'Earliest readable prompt' : 'Tall reply $i',
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        for (var i = 0; i < 6; i++) {
          await tester.dragFrom(const Offset(180, 150), const Offset(0, 250));
          await tester.pumpAndSettle();
        }
        expect(find.text('Earliest readable prompt'), findsOneWidget);
        expect(
          tester
              .getRect(find.text('Earliest readable prompt'))
              .overlaps(const Rect.fromLTWH(0, 0, 360, 480)),
          isTrue,
        );
        expect(
          tester.getTopLeft(find.text('Earliest readable prompt')).dy,
          lessThanOrEqualTo(16),
        );
        expect(tester.takeException(), isNull);
      },
    );
  }
  Future<void> viewport(WidgetTester tester) async {
    tester.view.physicalSize = const Size(360, 480);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }

  for (final brightness in Brightness.values) {
    testWidgets(
      'ordinary $brightness history opens at latest lazily with uneven large rows',
      (tester) async {
        await viewport(tester);
        var built = 0;
        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(brightness: brightness),
            home: MediaQuery(
              data: const MediaQueryData(textScaler: TextScaler.linear(2)),
              child: Scaffold(
                body: DesktopFocusTimeline(
                  count: 2000,
                  itemBuilder: (context, index) {
                    built++;
                    return SizedBox(
                      height: index.isEven ? 125 : 900,
                      child: Align(
                        alignment: Alignment.bottomLeft,
                        child: Text('End row $index', key: ValueKey(index)),
                      ),
                    );
                  },
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('End row 1999'), findsOneWidget);
        expect(
          tester
              .getRect(find.text('End row 1999'))
              .overlaps(const Rect.fromLTWH(0, 0, 360, 480)),
          isTrue,
        );
        expect(find.text('End row 0'), findsNothing);
        expect(built, lessThan(30));
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('following latest keeps appended and growing text visible', (
    tester,
  ) async {
    await viewport(tester);
    var count = 30;
    var height = 80.0;
    late StateSetter update;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) {
              update = setState;
              return DesktopFocusTimeline(
                count: count,
                itemBuilder: (context, index) => SizedBox(
                  height: index == count - 1 ? height : 100,
                  child: Align(
                    alignment: Alignment.bottomLeft,
                    child: Text('End row $index', key: ValueKey(index)),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('End row 29').hitTestable(), findsOneWidget);
    update(() {
      count++;
      height = 800;
    });
    await tester.pumpAndSettle();
    expect(find.text('End row 30').hitTestable(), findsOneWidget);
    update(() => height = 1200);
    await tester.pumpAndSettle();
    expect(find.text('End row 30').hitTestable(), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('late ordinary history opens directly at its newest row', (
    tester,
  ) async {
    await viewport(tester);
    var count = 0;
    late StateSetter update;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) {
              update = setState;
              return DesktopFocusTimeline(
                count: count,
                itemBuilder: (_, index) =>
                    SizedBox(height: 140, child: Text('Late row $index')),
              );
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    update(() => count = 1000);
    await tester.pumpAndSettle();
    expect(find.text('Late row 999').hitTestable(), findsOneWidget);
    expect(find.text('Late row 0'), findsNothing);
  });
  testWidgets(
    'reading older rows stays anchored through new output until explicit latest',
    (tester) async {
      await viewport(tester);
      var count = 40;
      late StateSetter update;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StatefulBuilder(
              builder: (context, setState) {
                update = setState;
                return DesktopFocusTimeline(
                  count: count,
                  itemBuilder: (_, index) => SizedBox(
                    height: index == count - 1 ? 700 : 100,
                    child: Align(
                      alignment: Alignment.bottomLeft,
                      child: Text('Reader row $index', key: ValueKey(index)),
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Reader row 39').hitTestable(), findsOneWidget);
      await tester.drag(
        find.byType(DesktopFocusTimeline),
        const Offset(0, 550),
      );
      await tester.pumpAndSettle();
      final candidates = find
          .textContaining('Reader row ')
          .evaluate()
          .map((e) => e.widget as Text)
          .where((w) {
            final rect = tester.getRect(find.text(w.data!));
            return rect.center.dy > 100 && rect.center.dy < 350;
          })
          .toList();
      expect(candidates, isNotEmpty);
      final label = candidates.first.data!;
      final before = tester.getTopLeft(find.text(label)).dy;
      update(() => count++);
      await tester.pumpAndSettle();
      expect(tester.getTopLeft(find.text(label)).dy, closeTo(before, 1));
      expect(find.byTooltip('Scroll to latest message'), findsOneWidget);
      await tester.tap(find.byTooltip('Scroll to latest message'));
      await tester.pumpAndSettle();
      expect(find.text('Reader row 40').hitTestable(), findsOneWidget);
      expect(find.byTooltip('Scroll to latest message'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'following tail remains visible when the keyboard shrinks its viewport',
    (tester) async {
      await viewport(tester);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: DesktopFocusTimeline(
              count: 100,
              itemBuilder: (_, i) => SizedBox(
                height: 120,
                child: Align(
                  alignment: Alignment.bottomLeft,
                  child: Text('Resize row $i'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Resize row 99').hitTestable(), findsOneWidget);
      tester.view.physicalSize = const Size(360, 300);
      await tester.pumpAndSettle();
      expect(find.text('Resize row 99').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'real conversation switch opens the new tail without inheriting reader offset',
    (tester) async {
      await viewport(tester);
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'first-scroll-chat'};
      desktop.timeline = List.generate(
        60,
        (i) => <String, dynamic>{
          'id': 'first-$i',
          'type': 'userMessage',
          'text': 'First history $i',
        },
      );
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      expect(find.text('First history 59').hitTestable(), findsOneWidget);
      await tester.drag(
        find.byType(DesktopFocusTimeline),
        const Offset(0, 500),
      );
      await tester.pumpAndSettle();
      desktop.thread = {'id': 'second-scroll-chat'};
      desktop.timeline = List.generate(
        100,
        (i) => <String, dynamic>{
          'id': 'second-$i',
          'type': 'userMessage',
          'text': 'Second history $i',
        },
      );
      desktop.notifyListeners();
      await tester.pumpAndSettle();
      expect(find.text('Second history 99').hitTestable(), findsOneWidget);
      expect(remote.calls.where((c) => c['method'] == 'turn/start'), isEmpty);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'real local Send follows its new message after the user reads older history',
    (tester) async {
      await viewport(tester);
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'send-scroll-chat'};
      desktop.model = 'qa';
      desktop.timeline = List.generate(
        60,
        (i) => <String, dynamic>{
          'id': 'old-$i',
          'type': 'userMessage',
          'text': 'Older history $i',
        },
      );
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Older history 59').hitTestable(), findsOneWidget);
      await tester.drag(
        find.byType(DesktopFocusTimeline),
        const Offset(0, 500),
      );
      await tester.pumpAndSettle();
      expect(find.byTooltip('Scroll to latest message'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'New public scroll QA message',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump();
      expect(
        remote.calls.where((c) => c['method'] == 'turn/start'),
        hasLength(1),
      );
      expect(
        find.text('New public scroll QA message').hitTestable(),
        findsOneWidget,
      );
      expect(find.byTooltip('Scroll to latest message'), findsNothing);
      await finishDraft(tester, desktop);
    },
  );
  testWidgets(
    'reading older history stays anchored when transient response rows collapse',
    (tester) async {
      await viewport(tester);
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'collapse-scroll-chat'};
      final stable = List.generate(
        60,
        (i) => <String, dynamic>{
          'id': 'stable-$i',
          'type': 'userMessage',
          'text': 'Stable history $i',
        },
      );
      desktop.timeline = [
        ...stable,
        ...List.generate(
          10,
          (i) => <String, dynamic>{
            'id': 'live-$i',
            'type': 'agentMessage',
            'text': 'Live output $i',
          },
        ),
      ];
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Live output 9').hitTestable(), findsOneWidget);
      await tester.drag(
        find.byType(DesktopFocusTimeline),
        const Offset(0, 1000),
      );
      await tester.pumpAndSettle();
      final candidates =
          [
            for (var i = 0; i < 60; i++)
              if (find.text('Stable history $i').evaluate().length == 1)
                'Stable history $i',
          ].where((label) {
            final rect = tester.getRect(find.text(label));
            return rect.center.dy > 100 && rect.center.dy < 300;
          }).toList();
      expect(candidates, isNotEmpty);
      final label = candidates.first;
      final y = tester.getTopLeft(find.text(label)).dy;
      desktop.timeline = [
        ...stable,
        {
          'id': 'final',
          'type': 'agentMessage',
          'text': 'Final canonical reply',
        },
      ];
      desktop.notifyListeners();
      await tester.pumpAndSettle();
      expect(find.text(label), findsOneWidget);
      expect(tester.getTopLeft(find.text(label)).dy, closeTo(y, 1));
      expect(find.byTooltip('Scroll to latest message'), findsOneWidget);
      expect(remote.calls.where((c) => c['method'] == 'turn/start'), isEmpty);
      await finishDraft(tester, desktop);
    },
  );
  testWidgets('same-chat folder metadata keeps the reader position', (
    tester,
  ) async {
    await viewport(tester);
    final remote = DraftTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    desktop.thread = {'id': 'same-chat', 'cwd': '/original'};
    desktop.timeline = List.generate(
      60,
      (i) => <String, dynamic>{
        'id': 'same-$i',
        'type': 'userMessage',
        'text': 'Same chat row $i',
      },
    );
    await tester.pumpWidget(
      MaterialApp(home: DesktopChatPage(controller: desktop)),
    );
    await tester.pumpAndSettle();
    await tester.drag(find.byType(DesktopFocusTimeline), const Offset(0, 500));
    await tester.pumpAndSettle();
    final labels = [
      for (var i = 0; i < 60; i++)
        if (find.text('Same chat row $i').evaluate().length == 1)
          'Same chat row $i',
    ];
    final label = labels.firstWhere((v) {
      final y = tester.getRect(find.text(v)).center.dy;
      return y > 100 && y < 300;
    });
    final before = tester.getTopLeft(find.text(label)).dy;
    desktop.thread = {...desktop.thread!, 'cwd': '/updated/folder'};
    desktop.notifyListeners();
    await tester.pumpAndSettle();
    expect(find.text(label), findsOneWidget);
    expect(tester.getTopLeft(find.text(label)).dy, closeTo(before, 1));
    expect(remote.calls.where((c) => c['method'] == 'turn/start'), isEmpty);
    await finishDraft(tester, desktop);
  });
  testWidgets('reader keeps the same line when keyboard viewport changes', (
    tester,
  ) async {
    await viewport(tester);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: DesktopFocusTimeline(
            count: 40,
            itemBuilder: (_, i) =>
                SizedBox(height: 100, child: Text('Reader resize $i')),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.drag(find.byType(DesktopFocusTimeline), const Offset(0, 500));
    await tester.pumpAndSettle();
    final labels = [
      for (var i = 0; i < 40; i++)
        if (find.text('Reader resize $i').evaluate().length == 1)
          'Reader resize $i',
    ];
    final label = labels.firstWhere((v) {
      final y = tester.getRect(find.text(v)).center.dy;
      return y > 100 && y < 250;
    });
    final before = tester.getTopLeft(find.text(label)).dy;
    tester.view.physicalSize = const Size(360, 360);
    await tester.pumpAndSettle();
    expect(find.text(label), findsOneWidget);
    expect(tester.getTopLeft(find.text(label)).dy, closeTo(before, 1));
    expect(find.byTooltip('Scroll to latest message'), findsOneWidget);
    tester.view.physicalSize = const Size(360, 480);
    await tester.pumpAndSettle();
    expect(tester.getTopLeft(find.text(label)).dy, closeTo(before, 1));
    expect(tester.takeException(), isNull);
  });
}
