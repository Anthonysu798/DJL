import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_conversation_view.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_conversation_fidelity_test.dart' show showConversation;
import 'desktop_new_chat_draft_test.dart' show draftDesktop, finishDraft;
import 'desktop_saved_toolbar_test.dart' show SavedToolbarTransport;

const locationPath = '/repo/Chosen folder/';

class LocationTransport extends SavedToolbarTransport {
  LocationTransport(super.pairings);
  bool failRename = false;

  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'thread/name/set' && failRename) {
      calls.add({'method': method, 'params': Map.of(params)});
      throw StateError('QA rename reply unavailable');
    }
    return super.request(method, params, timeout: timeout);
  }
}

Future<void> locationCase(
  WidgetTester tester,
  Future<void> Function(DesktopController, LocationTransport) run, {
  String? cwd = '  /repo/Chosen folder/ \n',
  double scale = 1,
}) async {
  final remote = LocationTransport(PairingRepository(TestCredentials()));
  final desktop = await draftDesktop(remote);
  desktop.thread = {'id': 'location', 'name': 'Location QA', 'cwd': ?cwd};
  desktop.threadList.data.upsert(desktop.thread!);
  try {
    await showConversation(tester, desktop, scale: scale);
    await run(desktop, remote);
  } finally {
    await finishDraft(tester, desktop);
  }
}

Future<void> openLocation(WidgetTester tester) async {
  await tester.tap(find.byType(DesktopConversationTitle));
  await tester.pumpAndSettle();
}

void main() {
  final copies = <String>[];
  var rejectClipboard = false;
  setUp(() {
    copies.clear();
    rejectClipboard = false;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
          if (call.method == 'Clipboard.setData') {
            if (rejectClipboard) {
              throw PlatformException(code: 'qa-unavailable');
            }
            copies.add((call.arguments as Map)['text'] as String);
          }
          return null;
        });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });

  testWidgets(
    'copied feedback expires while rename covers the location sheet',
    (tester) async {
      await locationCase(tester, (desktop, remote) async {
        await openLocation(tester);
        await tester.tap(find.byTooltip('Copy path'));
        await tester.pump();
        expect(find.byTooltip('Path copied'), findsOneWidget);
        await tester.tap(find.byTooltip('Rename conversation'));
        await tester.pumpAndSettle();
        await tester.pump(const Duration(seconds: 2));
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(find.byTooltip('Copy path'), findsOneWidget);
        expect(find.byTooltip('Path copied'), findsNothing);
        expect(copies, [locationPath]);
        expect(
          remote.calls.where((call) => call['method'] == 'thread/name/set'),
          isEmpty,
        );
      });
    },
  );

  testWidgets('location rename reports an unconfirmed desktop update', (
    tester,
  ) async {
    await locationCase(tester, (desktop, remote) async {
      await openLocation(tester);
      await tester.tap(find.byTooltip('Rename conversation'));
      await tester.pumpAndSettle();
      remote.failRename = true;
      await tester.enterText(
        find.byKey(const Key('desktop_chat_name')),
        'Local QA name',
      );
      await tester.tap(find.text('Save name'));
      await tester.pumpAndSettle();
      expect(desktop.threadList.data.renames['location'], 'Local QA name');
      expect(find.textContaining('could not be confirmed'), findsOneWidget);
      expect(find.byTooltip('Rename conversation'), findsOneWidget);
      expect(
        remote.calls.where((call) => call['method'] == 'thread/name/set'),
        hasLength(1),
      );
    });
  });

  testWidgets(
    'title location copies the original path locally and retains its draft',
    (tester) async {
      await locationCase(tester, (desktop, remote) async {
        await tester.enterText(
          find.byKey(const Key('desktop_composer')),
          'Keep the location review unsent',
        );
        final before = remote.calls.length;
        await openLocation(tester);
        expect(find.text(locationPath), findsOneWidget);
        await tester.tap(find.byTooltip('Copy path'));
        await tester.pump();
        expect(copies, [locationPath]);
        expect(find.byTooltip('Path copied'), findsOneWidget);
        expect(find.byKey(const Key('thread.location.sheet')), findsOneWidget);
        await tester.tap(find.byTooltip('Close location'));
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('desktop_composer')))
              .controller!
              .text,
          'Keep the location review unsent',
        );
        expect(remote.calls, hasLength(before));
        expect(remote.starts, 0);
      });
    },
  );

  testWidgets(
    'location rename updates the selected thread while keeping the sheet',
    (tester) async {
      await locationCase(tester, (desktop, remote) async {
        await openLocation(tester);
        await tester.tap(find.byTooltip('Rename conversation'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('desktop_chat_name')),
          'Updated QA',
        );
        await tester.tap(find.text('Save name'));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('thread.location.sheet')), findsOneWidget);
        expect(find.text('Updated QA'), findsWidgets);
        expect(desktop.threadList.data.renames['location'], 'Updated QA');
        final renames = remote.calls.where(
          (call) => call['method'] == 'thread/name/set',
        );
        expect(renames, hasLength(1));
        expect(renames.single['params'], {
          'thread_id': 'location',
          'name': 'Updated QA',
        });
        expect(remote.starts, 0);
      });
    },
  );

  testWidgets('a rootless saved title has no location action', (tester) async {
    await locationCase(tester, (desktop, remote) async {
      expect(
        tester
            .widget<DesktopConversationTitle>(
              find.byType(DesktopConversationTitle),
            )
            .onTap,
        isNull,
      );
      final before = remote.calls.length;
      await openLocation(tester);
      expect(find.byKey(const Key('thread.location.sheet')), findsNothing);
      expect(remote.calls, hasLength(before));
    }, cwd: null);
  });

  testWidgets('a captured title cannot open another conversation location', (
    tester,
  ) async {
    await locationCase(tester, (desktop, remote) async {
      final title = tester.widget<DesktopConversationTitle>(
        find.byType(DesktopConversationTitle),
      );
      expect(title.onTap, isNotNull);
      final callback = title.onTap!;
      await desktop.openThread({'id': 'other', 'cwd': '/repo/Other'});
      await tester.pumpAndSettle();
      final before = remote.calls.length;
      callback();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('thread.location.sheet')), findsNothing);
      expect(remote.calls, hasLength(before));
    });
  });

  testWidgets(
    'an old location copy callback cannot expose a replacement context',
    (tester) async {
      await locationCase(tester, (desktop, remote) async {
        await openLocation(tester);
        final callback = tester
            .widget<IconButton>(
              find.byWidgetPredicate(
                (w) => w is IconButton && w.tooltip == 'Copy path',
              ),
            )
            .onPressed!;
        await desktop.openThread({'id': 'other', 'cwd': '/repo/Other'});
        await tester.pumpAndSettle();
        final before = remote.calls.length;
        callback();
        await tester.pumpAndSettle();
        expect(copies, isEmpty);
        expect(find.text(locationPath), findsNothing);
        expect(remote.calls, hasLength(before));
      });
    },
  );

  for (final change in ['thread', 'session']) {
    testWidgets('location rename confirmation ignores a changed $change', (
      tester,
    ) async {
      await locationCase(tester, (desktop, remote) async {
        await openLocation(tester);
        await tester.tap(find.byTooltip('Rename conversation'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('desktop_chat_name')),
          'Stale name',
        );
        if (change == 'thread') {
          await desktop.openThread({'id': 'other', 'cwd': '/repo/Other'});
        } else {
          remote.session = 'replacement-session';
        }
        await tester.pumpAndSettle();
        await tester.tap(find.text('Save name'));
        await tester.pumpAndSettle();
        expect(desktop.threadList.data.renames['location'], isNull);
        expect(
          remote.calls.where((call) => call['method'] == 'thread/name/set'),
          isEmpty,
        );
      });
    });
  }

  testWidgets(
    'clipboard failure keeps location copy retryable without a false success',
    (tester) async {
      await locationCase(tester, (desktop, remote) async {
        await openLocation(tester);
        rejectClipboard = true;
        await tester.tap(find.byTooltip('Copy path'));
        await tester.pumpAndSettle();
        expect(find.byTooltip('Path copied'), findsNothing);
        expect(find.byTooltip('Copy path'), findsOneWidget);
        rejectClipboard = false;
        await tester.tap(find.byTooltip('Copy path'));
        await tester.pump();
        expect(copies, [locationPath]);
        expect(find.byTooltip('Path copied'), findsOneWidget);
      });
    },
  );

  testWidgets(
    'location path and copy remain reachable at narrow width and 3x text',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(320, 460));
      try {
        await locationCase(tester, (desktop, remote) async {
          await openLocation(tester);
          await tester.ensureVisible(find.byTooltip('Copy path'));
          await tester.pumpAndSettle();
          await tester.tap(find.byTooltip('Copy path'));
          await tester.pump();
          expect(copies, [locationPath]);
          expect(tester.takeException(), isNull);
        }, scale: 3);
      } finally {
        await tester.binding.setSurfaceSize(null);
      }
    },
  );
}
