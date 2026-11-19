import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_composer_send_test.dart' show MixedTransport, NewChatTransport;
import 'desktop_composer_picker_test.dart' show PendingImagePicker;
import 'desktop_recovery_test.dart' show RecoveryMemoryStore;

class DelayedComposerCreationTransport extends MixedTransport {
  DelayedComposerCreationTransport(super.pairings);
  Completer<RemoteJson>? creation, listing;
  @override
  String? get macDeviceId => 'mac-a';
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'thread/start') {
      calls.add({'method': method, 'params': params});
      return creation?.future ??
          Future.value({
            'thread': {'id': 'created'},
          });
    }
    if (method == 'thread/list') {
      calls.add({'method': method, 'params': params});
      return listing?.future ??
          Future.value({
            'data': [
              {'id': 'created'},
            ],
          });
    }
    if (method == 'thread/read' || method == 'thread/resume') {
      calls.add({'method': method, 'params': params});
      return {
        'thread': {'id': params['threadId'], 'turns': []},
      };
    }
    return super.request(method, params, timeout: timeout);
  }
}

void main() {
  testWidgets(
    'first-chat promotion retains a loading picker and saves its image when it finishes after creation',
    (tester) async {
      final pairs = PairingRepository(TestCredentials()),
          picker = PendingImagePicker();
      final creation = Completer<RemoteJson>();
      final transport = DelayedComposerCreationTransport(pairs)
        ..creation = creation;
      final desktop =
          DesktopController(
              pairs,
              connection: transport,
              localStore: RecoveryMemoryStore(),
            )
            ..active = const Pairing({'macDeviceId': 'mac-a'})
            ..model = 'qa';
      await desktop.threadList.attach('mac-a');
      await tester.pumpWidget(
        MaterialApp(
          home: DesktopChatPage(controller: desktop, imagePicker: picker),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'sent snapshot',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pump();
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'next draft',
      );
      await tester.tap(find.byTooltip('Composer options'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.text('Photo library'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      creation.complete({
        'thread': {'id': 'created'},
      });
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 20));
      expect(desktop.thread?['id'], 'created');
      expect(desktop.busy, isFalse);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.byTooltip('Remove image'), findsOneWidget);
      picker.jobs.single.complete(
        const DesktopComposerImage(
          id: 'late-new-photo',
          name: 'new.png',
          dataUrl:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        ),
      );
      await tester.pumpAndSettle();
      expect(
        desktop.threadList.data.composerDraft('created').text,
        'next draft',
      );
      expect(
        desktop.threadList.data.composerDraft('created').images.single.id,
        'late-new-photo',
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
    },
  );

  testWidgets(
    'first-chat send never targets another same-Mac chat selected during post-create refresh',
    (tester) async {
      final pairs = PairingRepository(TestCredentials());
      final listing = Completer<RemoteJson>();
      final transport = DelayedComposerCreationTransport(pairs)
        ..listing = listing;
      final desktop =
          DesktopController(
              pairs,
              connection: transport,
              localStore: RecoveryMemoryStore(),
            )
            ..active = const Pairing({'macDeviceId': 'mac-a'})
            ..model = 'qa';
      await desktop.threadList.attach('mac-a');
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'private first draft',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pump();
      expect(desktop.thread?['id'], 'created');
      expect(
        transport.calls.where((v) => v['method'] == 'thread/list'),
        hasLength(1),
      );
      expect(
        transport.calls.where((v) => v['method'] == 'turn/start'),
        isEmpty,
      );
      await desktop.openThread({'id': 'destination'});
      await tester.pump();
      listing.complete({
        'data': [
          {'id': 'created'},
          {'id': 'destination'},
        ],
      });
      await tester.pumpAndSettle();
      expect(
        transport.calls.where(
          (v) => {'turn/start', 'turn/steer'}.contains(v['method']),
        ),
        isEmpty,
      );
      expect(desktop.thread?['id'], 'destination');
      expect(
        desktop.threadList.data.composerDraft('created').text,
        'private first draft',
      );
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
    },
  );
  for (final fails in [false, true]) {
    testWidgets(
      'pending first-chat creation preserves new text and ready images, rejects repeated Send, ${fails ? 'retains failed snapshot' : 'sends frozen snapshot'}',
      (tester) async {
        final pairs = PairingRepository(TestCredentials()),
            picker = PendingImagePicker();
        final creation = Completer<RemoteJson>();
        final transport = DelayedComposerCreationTransport(pairs)
          ..creation = creation;
        if (fails) transport.responses.add(StateError('Disconnected'));
        final desktop =
            DesktopController(
                pairs,
                connection: transport,
                localStore: RecoveryMemoryStore(),
              )
              ..active = const Pairing({'macDeviceId': 'mac-a'})
              ..model = 'qa';
        await desktop.threadList.attach('mac-a');
        await tester.pumpWidget(
          MaterialApp(
            home: DesktopChatPage(controller: desktop, imagePicker: picker),
          ),
        );
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('desktop_composer')),
          'sent snapshot',
        );
        await tester.pump();
        await tester.tap(find.byTooltip('Send to desktop'));
        await tester.pump();
        await tester.enterText(
          find.byKey(const Key('desktop_composer')),
          'new draft during creation',
        );
        await tester.tap(find.byTooltip('Composer options'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        await tester.tap(find.text('Photo library'));
        await tester.pump();
        picker.jobs.single.complete(
          const DesktopComposerImage(
            id: 'new-photo',
            name: 'new.png',
            dataUrl:
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        await tester.tap(find.byTooltip('Send to desktop'));
        await tester.pump();
        expect(
          transport.calls.where((v) => v['method'] == 'thread/start'),
          hasLength(1),
        );
        expect(desktop.busy, isTrue);
        creation.complete({
          'thread': {'id': 'created'},
        });
        await tester.pumpAndSettle();
        final turn = transport.calls.singleWhere(
          (v) => v['method'] == 'turn/start',
        );
        expect((turn['params'] as Map)['input'], [
          {'type': 'text', 'text': 'sent snapshot'},
        ]);
        expect(
          desktop.threadList.data.composerDraft('created').text,
          'new draft during creation',
        );
        expect(
          desktop.threadList.data.composerDraft('created').images.single.id,
          'new-photo',
        );
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('desktop_composer')))
              .controller!
              .text,
          'new draft during creation',
        );
        expect(find.byTooltip('Remove image'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      },
    );
  }

  for (final succeeds in [true, false]) {
    testWidgets(
      'first chat send ${succeeds ? 'clears sent inputs' : 'retains failed inputs'} in the actual composer',
      (tester) async {
        final pairs = PairingRepository(TestCredentials());
        final transport = NewChatTransport(pairs);
        if (!succeeds) transport.responses.add(StateError('Disconnected'));
        final desktop =
            DesktopController(
                pairs,
                connection: transport,
                localStore: RecoveryMemoryStore(),
              )
              ..active = const Pairing({'macDeviceId': 'mac-a'})
              ..model = 'qa';
        await desktop.threadList.attach('mac-a');
        await tester.pumpWidget(
          MaterialApp(home: DesktopChatPage(controller: desktop)),
        );
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('desktop_composer')),
          'first draft',
        );
        await tester.pump();
        await tester.tap(find.byTooltip('Send to desktop'));
        await tester.pumpAndSettle();
        expect(desktop.thread?['id'], 'created');
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('desktop_composer')))
              .controller!
              .text,
          succeeds ? '' : 'first draft',
        );
        expect(
          desktop.threadList.data.composerDraft('created').text,
          succeeds ? '' : 'first draft',
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      },
    );
  }

  testWidgets(
    'composer exposes loading/failure removal and sends a restored context-only encrypted draft',
    (tester) async {
      final pairs = PairingRepository(TestCredentials()),
          picker = PendingImagePicker();
      final transport = MixedTransport(pairs);
      final desktop =
          DesktopController(
              pairs,
              connection: transport,
              localStore: RecoveryMemoryStore(),
            )
            ..active = const Pairing({'macDeviceId': 'mac-a'})
            ..thread = {'id': 't1'}
            ..model = 'qa';
      await desktop.threadList.attach('mac-a');
      desktop.threadList.data.setComposerDraft(
        't1',
        DesktopComposerDraft(
          contexts: [
            const DesktopComposerContext(
              kind: DesktopContextKind.skill,
              id: 'review',
              name: 'review',
            ),
          ],
        ),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: DesktopChatPage(controller: desktop, imagePicker: picker),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('\$review'), findsOneWidget);
      expect(
        tester
            .widget<IconButton>(
              find.widgetWithIcon(IconButton, Icons.arrow_upward),
            )
            .onPressed,
        isNotNull,
      );
      await tester.tap(find.byTooltip('Composer options'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.text('Photo library'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(
        tester
            .widget<IconButton>(
              find.widgetWithIcon(IconButton, Icons.arrow_upward),
            )
            .onPressed,
        isNull,
      );
      picker.jobs.last.completeError(StateError('Photo access denied'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Photo access denied'), findsOneWidget);
      expect(
        tester
            .widget<IconButton>(
              find.widgetWithIcon(IconButton, Icons.arrow_upward),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.byTooltip('Remove image'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.where((v) => v['method'] == 'turn/start'),
        hasLength(1),
      );
      expect(desktop.threadList.data.composerDraft('t1').isEmpty, isTrue);
      final sent = desktop.timeline.singleWhere(
        (row) => row['type'] == 'userMessage',
      );
      expect(find.byKey(ValueKey(sent['id'])), findsOneWidget);
      expect(desktopItemText(sent).trim(), r'$review');
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
    },
  );
  testWidgets(
    'switching chats while phone picker is open cannot place image in destination draft',
    (tester) async {
      final pairs = PairingRepository(TestCredentials()),
          picker = PendingImagePicker();
      final transport = MixedTransport(pairs);
      final desktop =
          DesktopController(
              pairs,
              connection: transport,
              localStore: RecoveryMemoryStore(),
            )
            ..active = const Pairing({'macDeviceId': 'mac-a'})
            ..thread = {'id': 't1'}
            ..model = 'qa';
      await desktop.threadList.attach('mac-a');
      await tester.pumpWidget(
        MaterialApp(
          home: DesktopChatPage(controller: desktop, imagePicker: picker),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'source text',
      );
      await tester.tap(find.byTooltip('Composer options'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.text('Take a photo'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      desktop.thread = {'id': 't2'};
      desktop.threadList.data.setComposerDraft(
        't2',
        DesktopComposerDraft(text: 'destination text'),
      );
      desktop.threadList.filter(search: '');
      await tester.pump();
      picker.jobs.last.complete(
        const DesktopComposerImage(
          id: 'old-photo',
          name: 'old.jpg',
          dataUrl: 'data:image/jpeg;base64,YQ==',
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        'destination text',
      );
      expect(desktop.threadList.data.composerDraft('t2').images, isEmpty);
      expect(desktop.threadList.data.composerDraft('t1').text, 'source text');
      expect(find.byTooltip('Remove image'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
    },
  );
}
