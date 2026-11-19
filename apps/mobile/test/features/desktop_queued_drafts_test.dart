import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_composer_send_test.dart' show MixedTransport, mixed;
import 'desktop_recovery_test.dart' show RecoveryMemoryStore;
import 'desktop_reasoning_controller_test.dart'
    show ReasoningTransport, reasoningDesktop;

DesktopController queueDesktop(MixedTransport transport) =>
    DesktopController(
        transport.pairings,
        connection: transport,
        localStore: RecoveryMemoryStore(),
      )
      ..thread = {'id': 't1', 'cwd': '/qa'}
      ..turnId = 'running'
      ..model = 'qa';

void main() {
  test('an unobserved Mac round trip clears volatile queued intent', () async {
    final transport = ReasoningTransport();
    final desktop = await reasoningDesktop(transport);
    addTearDown(desktop.dispose);
    final original = desktop.active!;
    desktop.turnId = 'running';
    desktop.model = 'qa';
    expect(
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'old host intent'),
      ),
      isTrue,
    );
    await desktop.connect(
      const Pairing({
        'macDeviceId': 'mac-b',
        'sessionId': 'secure-b',
        'macIdentityPublicKey': 'trusted-pin-b',
      }),
      resolve: false,
    );
    await desktop.connect(original, resolve: false);
    await desktop.openThread({'id': 'thread'}, readOnlyNavigation: true);
    expect(desktop.queuedDrafts, isEmpty);
  });
  test(
    'queued rich drafts retain source order, raw context and captured plan without RPC',
    () async {
      final transport = MixedTransport(PairingRepository(TestCredentials()));
      final desktop = queueDesktop(transport)..plan = true;
      final rich = DesktopComposerDraft(
        text: '  raw follow-up\n',
        cwd: '/qa',
        images: mixed().images,
        contexts: mixed().contexts,
      );
      desktop.threadList.data.setComposerDraft('t1', rich);
      expect(await desktop.submitComposerDraft(rich), isTrue);
      desktop.plan = false;
      expect(
        await desktop.submitComposerDraft(DesktopComposerDraft(text: 'second')),
        isTrue,
      );
      expect(desktop.queuedDrafts.map((row) => row.draft.text), [
        '  raw follow-up\n',
        'second',
      ]);
      expect(desktop.queuedDrafts.map((row) => row.plan), [true, false]);
      expect(desktop.queuedDrafts.first.draft.toJson(), rich.toJson());
      expect(
        desktop.queuedDrafts.first.id,
        isNot(desktop.queuedDrafts.last.id),
      );
      expect(desktop.threadList.data.composerDraft('t1').isEmpty, isTrue);
      expect(desktop.turnId, 'running');
      expect(desktop.timeline, isEmpty);
      expect(transport.calls, isEmpty);
      desktop.dispose();
    },
  );

  test(
    'chat navigation retains separate queues without sending the offscreen chat',
    () async {
      final transport = MixedTransport(PairingRepository(TestCredentials()));
      final desktop = queueDesktop(transport);
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'first chat'),
      );
      desktop.thread = {'id': 't2'};
      await desktop.submitComposerDraft(
        DesktopComposerDraft(text: 'second chat'),
      );
      expect(desktop.queuedDrafts.single.draft.text, 'second chat');
      desktop.thread = {'id': 't1'};
      expect(desktop.queuedDrafts.single.draft.text, 'first chat');
      expect(transport.calls, isEmpty);
      desktop.dispose();
    },
  );

  for (final changed in ['mac', 'pin']) {
    test(
      '$changed context change clears volatile queues; same-host session change retains them',
      () async {
        final transport = MixedTransport(PairingRepository(TestCredentials()));
        final desktop = queueDesktop(transport)
          ..active = const Pairing({
            'macDeviceId': 'mac-a',
            'macIdentityPublicKey': 'pin-a',
            'sessionId': 'old',
          });
        await desktop.submitComposerDraft(
          DesktopComposerDraft(text: 'original owner'),
        );
        desktop.active = const Pairing({
          'macDeviceId': 'mac-a',
          'macIdentityPublicKey': 'pin-a',
          'sessionId': 'new',
        });
        expect(desktop.queuedDrafts.single.draft.text, 'original owner');
        desktop.active = Pairing({
          'macDeviceId': changed == 'mac' ? 'mac-b' : 'mac-a',
          'macIdentityPublicKey': changed == 'pin' ? 'pin-b' : 'pin-a',
        });
        expect(desktop.queuedDrafts, isEmpty);
        desktop.active = const Pairing({
          'macDeviceId': 'mac-a',
          'macIdentityPublicKey': 'pin-a',
        });
        expect(desktop.queuedDrafts, isEmpty);
        expect(transport.calls, isEmpty);
        desktop.dispose();
      },
    );
  }

  test(
    'a known running state without an ID queues without inventing a new turn',
    () async {
      final transport = ReasoningTransport()
        ..history = {
          'id': 'thread',
          'turns': [
            {'status': 'running', 'items': []},
          ],
        };
      final desktop = await reasoningDesktop(transport);
      transport.calls.clear();
      expect(desktop.turnId, isNull);
      expect(desktop.shouldQueueComposer, isTrue);
      expect(
        await desktop.submitComposerDraft(
          DesktopComposerDraft(text: 'wait for this run'),
        ),
        isTrue,
      );
      expect(desktop.queuedDrafts.single.draft.text, 'wait for this run');
      expect(desktop.turnId, isNull);
      expect(transport.calls, isEmpty);
      desktop.dispose();
    },
  );

  test(
    'a stale page or wrong folder cannot enqueue or clear its saved draft',
    () async {
      final transport = MixedTransport(PairingRepository(TestCredentials()));
      final desktop = queueDesktop(transport);
      final draft = DesktopComposerDraft(
        text: 'saved',
        cwd: '/other',
        contexts: mixed().contexts,
      );
      desktop.threadList.data.setComposerDraft('t1', draft);
      expect(
        await desktop.submitComposerDraft(draft, canContinue: () => false),
        isFalse,
      );
      expect(await desktop.submitComposerDraft(draft), isFalse);
      expect(desktop.queuedDrafts, isEmpty);
      expect(
        desktop.threadList.data.composerDraft('t1').toJson(),
        draft.toJson(),
      );
      expect(transport.calls, isEmpty);
      desktop.dispose();
    },
  );

  testWidgets(
    'normal busy follow-up queues without steering or adding a timeline message',
    (tester) async {
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
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      expect(desktop.turnId, 'running');
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'queued public follow-up',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.where(
          (call) => {'turn/start', 'turn/steer'}.contains(call['method']),
        ),
        isEmpty,
      );
      expect(
        desktop.timeline.where((row) => row['type'] == 'userMessage'),
        isEmpty,
      );
      expect(desktop.queuedDrafts.single.draft.text, 'queued public follow-up');
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        isEmpty,
      );
      expect(tester.takeException(), isNull);
    },
  );
}
