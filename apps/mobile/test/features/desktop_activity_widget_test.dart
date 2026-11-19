import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/activity/domain/desktop_activity.dart';
import 'package:djl_mobile/features/activity/presentation/activity_card.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'guardian_review_test.dart' show GuardianTransport, guardianDesktop;

class ActivityPreviewTransport extends GuardianTransport {
  ActivityPreviewTransport(super.pairings);
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'workspace/readImage') {
      calls.add({'method': method, 'params': params});
      return {
        'path': params['path'],
        'fileName': 'chart.png',
        'mimeType': 'image/png',
        'byteLength': 68,
        'dataBase64':
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      };
    }
    return super.request(method, params, timeout: timeout);
  }
}

void main() {
  testWidgets(
    'command card opens readable status exit cwd duration and output details',
    (tester) async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport);
      transport.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread-1',
          'turnId': 'turn-1',
          'item': {
            'id': 'command',
            'type': 'commandExecution',
            'command': 'npm test',
            'cwd': '/repo',
            'status': 'failed',
            'exitCode': 2,
            'durationMs': 84,
            'aggregatedOutput': 'Test failed at expected boundary',
          },
        },
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ran 1 command · 1 failed'));
      await tester.pumpAndSettle();
      expect(find.text('Ran npm test'), findsOneWidget);
      await tester.tap(find.text('Ran npm test'));
      await tester.pumpAndSettle();
      expect(find.text('Working directory: /repo'), findsOneWidget);
      expect(find.text('Exit code: 2'), findsOneWidget);
      expect(find.text('Duration: 84 ms'), findsOneWidget);
      expect(find.text('Test failed at expected boundary'), findsOneWidget);
      expect(transport.calls, isEmpty);
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
    },
  );
  for (final terminal in ['completed', 'failed']) {
    testWidgets(
      'streaming command details update output and $terminal state while open',
      (tester) async {
        final semantics = tester.ensureSemantics();
        final transport = GuardianTransport(
          PairingRepository(TestCredentials()),
        );
        final desktop = guardianDesktop(transport);
        transport.events.add({
          'method': 'item/started',
          'params': {
            'threadId': 'thread-1',
            'turnId': 'turn-1',
            'item': {
              'id': 'live',
              'type': 'commandExecution',
              'command': 'echo live',
              'cwd': '/repo',
            },
          },
        });
        await tester.pumpWidget(
          MaterialApp(home: DesktopChatPage(controller: desktop)),
        );
        await tester.pumpAndSettle();
        final activity = desktop.activity.items.values.single;
        final card = find.byKey(ValueKey(activity.id));
        final element = tester.element(card);
        expect(activity.id, 'activity:["mac-a","thread-1","turn-1","live"]');
        await tester.tap(find.text('Running echo live'));
        await tester.pumpAndSettle();
        expect(find.text('No textual output.'), findsOneWidget);
        final sheet = tester.element(find.byType(BottomSheet));
        expect(
          find.byWidgetPredicate(
            (w) => w is SelectableText && w.data == 'echo live',
          ),
          findsOneWidget,
        );
        transport.events.add({
          'method': 'item/commandExecution/outputDelta',
          'params': {
            'threadId': 'thread-1',
            'turnId': 'turn-1',
            'itemId': 'live',
            'delta': 'LIVE OUTPUT',
          },
        });
        await tester.pumpAndSettle();
        expect(find.text('LIVE OUTPUT'), findsOneWidget);
        for (final (thread, turn) in [
          ('thread-1', 'turn-2'),
          ('thread-2', 'turn-1'),
        ]) {
          transport.events.add({
            'method': 'item/started',
            'params': {
              'threadId': thread,
              'turnId': turn,
              'item': {
                'id': 'live',
                'type': 'commandExecution',
                'command': 'echo other scope',
              },
            },
          });
          transport.events.add({
            'method': 'item/commandExecution/outputDelta',
            'params': {
              'threadId': thread,
              'turnId': turn,
              'itemId': 'live',
              'delta': 'OTHER SCOPE OUTPUT',
            },
          });
        }
        await tester.pumpAndSettle();
        expect(find.text('LIVE OUTPUT'), findsOneWidget);
        expect(find.text('OTHER SCOPE OUTPUT'), findsNothing);
        expect(activity.command, 'echo live');

        expect(tester.element(find.byType(BottomSheet)), same(sheet));
        expect(
          tester.element(
            find.byKey(ValueKey(activity.id), skipOffstage: false),
          ),
          same(element),
        );
        transport.events.add({
          'method': 'item/completed',
          'params': {
            'threadId': 'thread-1',
            'turnId': 'turn-1',
            'item': {
              'id': 'live',
              'type': 'commandExecution',
              'status': terminal,
              'exitCode': terminal == 'failed' ? 2 : 0,
              'durationMs': 91,
            },
          },
        });
        await tester.pumpAndSettle();
        expect(
          find.text('Status: ${terminal == 'failed' ? 'Failed' : 'Completed'}'),
          findsOneWidget,
        );
        expect(
          find.text('Exit code: ${terminal == 'failed' ? 2 : 0}'),
          findsOneWidget,
        );
        expect(find.text('Duration: 91 ms'), findsOneWidget);
        final groupTitle = terminal == 'failed'
            ? 'Ran 1 command · 1 failed'
            : 'Ran 1 command';
        expect(find.text(groupTitle, skipOffstage: false), findsOneWidget);
        expect(tester.element(find.byType(BottomSheet)), same(sheet));
        expect(desktop.activity.items[activity.id], same(activity));

        tester.state<NavigatorState>(find.byType(Navigator)).pop();
        await tester.pumpAndSettle();
        await tester.tap(find.text(groupTitle));
        await tester.pumpAndSettle();
        expect(find.text('Ran echo live', skipOffstage: false), findsOneWidget);
        expect(
          find.text('Running echo live', skipOffstage: false),
          findsNothing,
        );
        expect(
          find.bySemanticsLabel(
            'echo live. Status: ${terminal == 'failed' ? 'Failed' : 'Completed'}. Open command details',
          ),
          findsOneWidget,
        );
        expect(transport.calls, isEmpty);
        semantics.dispose();
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      },
    );
  }
  testWidgets(
    'file-change details show path kind totals diff and remain scroll-safe at large text short height',
    (tester) async {
      tester.view.physicalSize = const Size(360, 300);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final changes = ChangeNotifier();
      final a = DesktopActivity.fromItem(
        {
          'id': 'patch',
          'type': 'fileChange',
          'status': 'completed',
          'cwd': '/repo',
          'changes': [
            {
              'path': 'lib/a.dart',
              'kind': {'type': 'update'},
              'diff': '@@ -1 +1 @@\n-old\n+new',
              'additions': 1,
              'deletions': 1,
            },
          ],
        },
        mac: 'mac-a',
        thread: 'thread',
        turn: 'turn',
      )!;
      String? opened;
      bool? openedAsImage;
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(2.2)),
            child: child!,
          ),
          home: Scaffold(
            body: SingleChildScrollView(
              child: ActivityCard(
                activity: a,
                changes: changes,
                onOpenFile: (path, image) {
                  opened = path;
                  openedAsImage = image;
                },
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('1 file changed'));
      await tester.pumpAndSettle();
      for (final text in [
        'lib/a.dart',
        'Kind: update',
        '+1 −1',
        '@@ -1 +1 @@\n-old\n+new',
      ]) {
        await tester.scrollUntilVisible(
          find.text(text),
          80,
          scrollable: find
              .descendant(
                of: find.byType(ListView).last,
                matching: find.byType(Scrollable),
              )
              .first,
        );
        expect(find.text(text), findsOneWidget);
      }
      await tester.scrollUntilVisible(
        find.text('Open lib/a.dart'),
        80,
        scrollable: find
            .descendant(
              of: find.byType(ListView).last,
              matching: find.byType(Scrollable),
            )
            .first,
      );
      await tester.tap(find.text('Open lib/a.dart'));
      expect(opened, 'lib/a.dart');
      expect(openedAsImage, isFalse);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      changes.dispose();
    },
  );
  for (final guard in [
    'connected',
    'unicode',
    'device',
    'thread',
    'disconnected',
  ]) {
    final guarded = guard != 'connected' && guard != 'unicode';
    final filename = guard == 'unicode' ? 'café👩‍💻.png' : 'chart.png';
    testWidgets('command image preview remains explicit with $guard scope', (
      tester,
    ) async {
      final transport = ActivityPreviewTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = guardianDesktop(transport);
      transport.events.add({
        'method': 'item/completed',
        'params': {
          'threadId': 'thread-1',
          'turnId': 'turn-1',
          'item': {
            'id': 'image',
            'type': 'commandExecution',
            'command': guard == 'unicode' ? 'ls images/👩‍💻' : 'ls images',
            'cwd': '/repo',
            'status': 'completed',
            'output': filename,
          },
        },
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      expect(transport.calls, isEmpty);
      await tester.tap(find.text('Ran 1 command'));
      await tester.pumpAndSettle();
      if (guard == 'device') {
        transport.mac = 'mac-b';
        desktop.active = const Pairing({'macDeviceId': 'mac-b'});
      }
      if (guard == 'thread') desktop.thread = {'id': 'other-thread'};
      if (guard == 'disconnected') transport.online = false;
      if (guarded) {
        await tester.tap(find.text('Image · $filename'));
      } else {
        // The linked preview validates raster bytes through the real engine
        // codec before showing them. Let that native future finish in real time.
        await tester.runAsync(() async {
          await tester.tap(find.text('Image · $filename'));
          final deadline = DateTime.now().add(const Duration(seconds: 5));
          while (find.byType(InteractiveViewer).evaluate().isEmpty &&
              DateTime.now().isBefore(deadline)) {
            await Future<void>.delayed(const Duration(milliseconds: 10));
            await tester.pump();
          }
        });
      }
      await tester.pumpAndSettle();
      if (guarded) {
        expect(transport.calls, isEmpty);
        expect(
          find.text(
            'Reopen the activity from its paired workspace to preview this file.',
          ),
          findsOneWidget,
        );
      } else {
        expect(transport.calls.single, {
          'method': 'workspace/readImage',
          'params': {
            'path': guard == 'unicode'
                ? '/repo/images/👩‍💻/$filename'
                : '/repo/images/$filename',
            'includeData': true,
            'maxPixelDimension': 1600,
            'cwd': '/repo',
          },
        });
        expect(find.byType(InteractiveViewer), findsOneWidget);
      }
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
    });
  }
  testWidgets(
    'unknown activity with structured output has a readable fallback without casts or RPCs',
    (tester) async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()));
      final desktop = guardianDesktop(transport)
        ..timeline = [
          {
            'id': 'unknown',
            'type': 'futureActivity',
            'output': {
              'content': [
                {'text': 'Readable unknown result'},
              ],
            },
          },
        ];
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('futureActivity'));
      await tester.pumpAndSettle();
      expect(find.text('Readable unknown result'), findsOneWidget);
      expect(tester.takeException(), isNull);
      expect(transport.calls, isEmpty);
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
    },
  );
}
