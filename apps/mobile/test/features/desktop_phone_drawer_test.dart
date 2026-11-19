import '../support/native_text_search.dart'
    show useAsciiNativeSearch, clearNativeSearchFixture;
import 'dart:async';
import 'dart:convert';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/status/domain/run_status.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_focus_timeline.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'desktop_composer_picker_test.dart' show PendingImagePicker;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_new_chat_draft_test.dart';

class PhoneHistoryTransport extends DraftTransport {
  PhoneHistoryTransport(super.pairings);
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'thread/resume' || method == 'thread/read') {
      calls.add({'method': method, 'params': params});
      return {
        'thread': {
          'id': params['threadId'],
          'turns': [
            {
              'id': 'old-turn',
              'status': 'completed',
              'items': [
                for (var i = 0; i < 80; i++)
                  {
                    'id': 'item-$i',
                    'type': 'userMessage',
                    'text': 'History message $i',
                  },
              ],
            },
          ],
        },
      };
    }
    return super.request(method, params, timeout: timeout);
  }
}

void main() {
  setUp(useAsciiNativeSearch);
  tearDown(clearNativeSearchFixture);
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets(
    'hamburger reveals cached menu without Remote filter or RPC changes',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.threadList.data.upsert({'id': 'one', 'title': 'Alpha'});
      desktop.threadList.filter(search: 'remote filter', archived: true);
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      final calls = remote.calls.length;
      expect(find.text('Recent chats').hitTestable(), findsNothing);
      expect(find.byTooltip('Open navigation'), findsOneWidget);
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      expect(find.text('Recent chats').hitTestable(), findsOneWidget);
      expect(find.text('Alpha').hitTestable(), findsOneWidget);
      await tester.tap(find.byTooltip('Search chats'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('navigation.search')),
        'missing',
      );
      await tester.pumpAndSettle();
      expect(find.text('No matching chats').hitTestable(), findsOneWidget);
      await tester.tap(find.byTooltip('Close search'));
      await tester.pumpAndSettle();
      expect(find.text('Alpha').hitTestable(), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.text('Recent chats').hitTestable(), findsNothing);
      expect(desktop.threadList.query, 'remote filter');
      expect(desktop.threadList.showArchived, isTrue);
      expect(remote.calls.length, calls);
      await finishDraft(tester, desktop);
    },
  );
  testWidgets(
    'drawer Back retains draft owner and text; closed Back cancels it',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      await enterDraft(tester, desktop);
      final page = tester.state(find.byType(DesktopChatPage));
      final draft = desktop.newChatDraft!;
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Keep this draft',
      );
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(tester.state(find.byType(DesktopChatPage)), same(page));
      expect(desktop.newChatDraft, same(draft));
      expect(find.text('Keep this draft'), findsOneWidget);
      expect(requests(remote, 'thread/start'), isEmpty);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(desktop.newChatDraft, isNull);
      expect(find.byType(PairingPage), findsOneWidget);
      await finishDraft(tester, desktop);
    },
  );
  for (final size in [
    const Size(360, 800),
    const Size(402, 874),
    const Size(411, 923),
  ]) {
    testWidgets('phone controls and last row reachable at 2.2 scale $size', (
      tester,
    ) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      for (var i = 0; i < 20; i++) {
        desktop.threadList.data.upsert({
          'id': 'row-$i',
          'title': 'Chat $i',
          'updatedAt': 2000000000 - i,
        });
      }
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: const TextScaler.linear(2.2),
              padding: const EdgeInsets.only(top: 44, bottom: 34),
              viewPadding: const EdgeInsets.only(top: 44, bottom: 34),
            ),
            child: child!,
          ),
          home: PairingPage(controller: desktop, onSettings: () {}),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final chat = tester.getRect(
        find
            .ancestor(
              of: find.text('Chat'),
              matching: find.byWidgetPredicate((w) => w is FilledButton),
            )
            .first,
      );
      final settings = tester.getRect(find.byTooltip('Settings').hitTestable());
      expect(chat.right, lessThanOrEqualTo(settings.left));
      expect(
        tester.getSize(find.text('Chat').hitTestable()).height,
        lessThan(60),
      );
      expect(
        tester.getSize(find.text('DJL').hitTestable()).height,
        lessThan(70),
      );
      expect(chat.bottom, lessThanOrEqualTo(size.height - 34));
      final scrim = tester.getRect(find.byKey(const Key('navigation.scrim')));
      expect(scrim.left, closeTo(size.width * .7, .01));
      await tester.scrollUntilVisible(
        find.byKey(const Key('navigation.thread.row-19')),
        220,
        scrollable: find.descendant(
          of: find.byKey(const Key('navigation.list')),
          matching: find.byType(Scrollable),
        ),
      );
      await tester.drag(
        find.byKey(const Key('navigation.list')),
        const Offset(0, -180),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('navigation.thread.row-19')).hitTestable(),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      await finishDraft(tester, desktop);
    });
  }

  testWidgets(
    'edge rejects short and vertical motion, opens and closes without route replacement',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      await enterDraft(tester, desktop);
      final page = tester.state(find.byType(DesktopChatPage));
      await tester.dragFrom(const Offset(8, 250), const Offset(8, 0));
      await tester.pumpAndSettle();
      expect(find.text('Recent chats').hitTestable(), findsNothing);
      await tester.dragFrom(const Offset(8, 250), const Offset(30, 160));
      await tester.pumpAndSettle();
      expect(find.text('Recent chats').hitTestable(), findsNothing);
      await tester.dragFrom(const Offset(8, 250), const Offset(300, 0));
      await tester.pumpAndSettle();
      expect(find.text('Recent chats').hitTestable(), findsOneWidget);
      await tester.tapAt(const Offset(750, 300));
      await tester.pumpAndSettle();
      expect(find.text('Recent chats').hitTestable(), findsNothing);
      expect(tester.state(find.byType(DesktopChatPage)), same(page));
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'Chat replaces draft once with fresh rootless owner and Remote only returns',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      await enterDraft(tester, desktop, project: true);
      final old = desktop.newChatDraft!;
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Old local input',
      );
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      await tester.tap(
        find
            .ancestor(
              of: find.text('Chat'),
              matching: find.byWidgetPredicate((w) => w is FilledButton),
            )
            .first,
      );
      await tester.pumpAndSettle();
      final fresh = desktop.newChatDraft!;
      expect(fresh, isNot(same(old)));
      expect(fresh.cwd, isNull);
      expect(desktop.isCurrentNewChatDraft(fresh), isTrue);
      expect(
        desktop.threadList.data.composerDraft(old.storageKey).text,
        'Old local input',
      );
      expect(find.byType(DesktopChatPage), findsOneWidget);
      expect(find.text('Old local input'), findsNothing);
      expect(requests(remote, 'thread/start'), isEmpty);
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pumpAndSettle();
      final count = remote.calls.length;
      await tester.tap(find.text('Remote').hitTestable());
      await tester.pumpAndSettle();
      expect(find.byType(PairingPage), findsOneWidget);
      expect(find.byType(DesktopChatPage), findsNothing);
      expect(desktop.newChatDraft, isNull);
      expect(remote.calls.length, count);
      await finishDraft(tester, desktop);
    },
  );
  testWidgets('uncapped fifth running row expires in untouched open drawer', (
    tester,
  ) async {
    final remote = DraftTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    var now = DateTime.utc(2026, 10, 29);
    final status = RunStatusProjector(now: () => now);
    final threads = {
      for (final id in ['a', 'b', 'c', 'd', 'z']) id: StatusThread(id, ''),
    };
    for (final id in threads.keys) {
      desktop.threadList.data.upsert({'id': id, 'title': id});
    }
    status.setContext(
      mac: 'mac-a',
      fingerprint: DesktopLinkTarget.keyFingerprint(desktop.active!.publicKey),
      session: 's',
      connected: true,
      selectedThread: null,
      threads: threads,
    );
    status.observe('turn/started', {'threadId': 'z', 'turnId': 'old'});
    now = now.add(const Duration(minutes: 29));
    for (final id in ['a', 'b', 'c', 'd']) {
      status.observe('turn/started', {'threadId': id, 'turnId': id});
    }
    expect(status.project().running.map((r) => r.thread), ['a', 'b', 'c']);
    await tester.pumpWidget(
      MaterialApp(
        home: PairingPage(controller: desktop, runStatus: status),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Open navigation'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump();
    await tester.drag(
      find.byKey(const Key('navigation.list')),
      const Offset(0, -250),
    );
    await tester.pump(const Duration(seconds: 1));
    final fifth = find.descendant(
      of: find.byKey(const Key('navigation.thread.z')),
      matching: find.byType(CircularProgressIndicator),
    );
    expect(fifth, findsOneWidget);
    now = now.add(const Duration(minutes: 1));
    await tester.pump(const Duration(minutes: 1));
    await tester.pump();
    expect(fifth, findsNothing);
    expect(
      status
          .liveRunningThreads(
            mac: 'mac-a',
            fingerprint: DesktopLinkTarget.keyFingerprint(
              desktop.active!.publicKey,
            )!,
          )
          .ids,
      {'a', 'b', 'c', 'd'},
    );
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    await finishDraft(tester, desktop);
    status.dispose();
  });

  testWidgets(
    'pending image and selected runtime retain their owner across drawer toggles',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote), picker = PendingImagePicker();
      final owner = desktop.beginNewChatDraft()!;
      await tester.pumpWidget(
        MaterialApp(
          home: DesktopChatPage(
            controller: desktop,
            draft: owner,
            imagePicker: picker,
          ),
        ),
      );
      await tester.pumpAndSettle();
      final page = tester.state(find.byType(DesktopChatPage));
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Pending photo text',
      );
      await tester.tap(find.byTooltip('Chat controls'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('desktop_runtime_model')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('runtime.other_models')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('runtime.model.other')));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Composer options'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.text('Photo library'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(desktop.newChatDraft, same(owner));
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      picker.jobs.single.complete(
        const DesktopComposerImage(
          id: 'photo',
          name: 'photo.png',
          dataUrl:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.state(find.byType(DesktopChatPage)), same(page));
      expect(desktop.model, 'other');
      expect(
        desktop.threadList.data
            .composerDraft(owner.storageKey)
            .images
            .single
            .id,
        'photo',
      );
      expect(find.text('Pending photo text'), findsOneWidget);
      expect(remote.calls, isEmpty);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'pending first Send keeps exact owner while drawer is opened and searched',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()))
        ..creation = Completer<RemoteJson>();
      final desktop = await draftDesktop(remote);
      await enterDraft(tester, desktop);
      final owner = desktop.newChatDraft!;
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'Send exactly once',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pump();
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      await tester.tap(find.byTooltip('Search chats'));
      await tester.pump();
      await tester.enterText(
        find.byKey(const Key('navigation.search')),
        'local',
      );
      await tester.pump();
      expect(desktop.newChatDraft, same(owner));
      expect(requests(remote, 'thread/start'), hasLength(1));
      expect(
        tester
            .widget<FilledButton>(
              find
                  .ancestor(
                    of: find.text('Chat'),
                    matching: find.byWidgetPredicate((w) => w is FilledButton),
                  )
                  .first,
            )
            .onPressed,
        isNull,
      );
      remote.creation!.complete({
        'thread': {'id': 'created-1'},
      });
      await tester.pumpAndSettle();
      expect(desktop.thread?['id'], 'created-1');
      expect(requests(remote, 'turn/start'), hasLength(1));
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(DesktopChatPage), findsOneWidget);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'iOS edge opens drawer without route pop and retains timeline scroll',
    (tester) async {
      final remote = PhoneHistoryTransport(
        PairingRepository(TestCredentials()),
      );
      final desktop = await draftDesktop(remote);
      desktop.threadList.data.upsert({'id': 'history', 'title': 'History'});
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(platform: TargetPlatform.iOS),
          home: PairingPage(controller: desktop),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('History'));
      await tester.pumpAndSettle();
      final page = tester.state(find.byType(DesktopChatPage));
      final scroll = find
          .descendant(
            of: find.byType(DesktopFocusTimeline),
            matching: find.byType(Scrollable),
          )
          .first;
      await tester.drag(
        find.byType(DesktopFocusTimeline),
        const Offset(0, -400),
      );
      await tester.pumpAndSettle();
      final position = tester.state<ScrollableState>(scroll).position;
      final offset = position.pixels;
      expect(offset, greaterThan(0));
      await tester.dragFrom(const Offset(8, 250), const Offset(300, 0));
      await tester.pumpAndSettle();
      expect(find.text('Recent chats').hitTestable(), findsOneWidget);
      expect(tester.state(find.byType(DesktopChatPage)), same(page));
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(tester.state<ScrollableState>(scroll).position, same(position));
      expect(position.pixels, offset);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(DesktopChatPage), findsNothing);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'reduced motion opens immediately; keyboard preserves physical footer inset and menu semantics',
    (tester) async {
      tester.view.physicalSize = const Size(402, 874);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      final keyboard = ValueNotifier<double>(0);
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => ValueListenableBuilder<double>(
            valueListenable: keyboard,
            builder: (context, bottom, _) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                disableAnimations: true,
                padding: EdgeInsets.only(top: 44, bottom: bottom > 0 ? 0 : 34),
                viewPadding: const EdgeInsets.only(top: 44, bottom: 34),
                viewInsets: EdgeInsets.only(bottom: bottom),
              ),
              child: child!,
            ),
          ),
          home: PairingPage(controller: desktop),
        ),
      );
      await tester.pumpAndSettle();
      final semantics = tester.ensureSemantics();
      expect(find.bySemanticsLabel('Recent chats'), findsNothing);
      await tester.tap(find.byTooltip('Open navigation'));
      await tester.pump();
      expect(
        tester.getRect(find.byKey(const Key('navigation.scrim'))).left,
        closeTo(281.4, .01),
      );
      expect(find.bySemanticsLabel('Recent chats'), findsOneWidget);
      await tester.tap(find.byTooltip('Search chats'));
      await tester.pumpAndSettle();
      keyboard.value = 300;
      await tester.pumpAndSettle();
      final search = tester.getRect(find.byKey(const Key('navigation.search')));
      expect(search.bottom, lessThan(574));
      final footer = tester.getRect(
        find
            .ancestor(
              of: find.text('Chat'),
              matching: find.byWidgetPredicate((w) => w is FilledButton),
            )
            .first,
      );
      expect(footer.bottom, closeTo(840, .01));
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.bySemanticsLabel('Recent chats'), findsNothing);
      expect(tester.takeException(), isNull);
      semantics.dispose();
      await finishDraft(tester, desktop);
      keyboard.dispose();
    },
  );

  testWidgets(
    'a horizontal start that ends vertically does not commit the drawer',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      final gesture = await tester.startGesture(const Offset(8, 100));
      await gesture.moveBy(const Offset(300, 0));
      await tester.pump(const Duration(milliseconds: 200));
      await gesture.moveBy(const Offset(0, 400));
      await tester.pump(const Duration(milliseconds: 200));
      await gesture.up();
      await tester.pumpAndSettle();
      expect(find.text('Recent chats').hitTestable(), findsNothing);
      await finishDraft(tester, desktop);
    },
  );
  testWidgets('disposing an open menu cancels its pending live deadline', (
    tester,
  ) async {
    final remote = DraftTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    desktop.threadList.data.upsert({'id': 'run', 'title': 'Live run'});
    var now = DateTime.utc(2026, 10, 29), clockReads = 0;
    final status = RunStatusProjector(
      now: () {
        clockReads++;
        return now;
      },
    );
    status.setContext(
      mac: 'mac-a',
      fingerprint: DesktopLinkTarget.keyFingerprint(desktop.active!.publicKey),
      session: 'old',
      connected: true,
      selectedThread: null,
      threads: {'run': const StatusThread('Live run', '')},
    );
    status.observe('turn/started', {'threadId': 'run', 'turnId': 'turn'});
    await tester.pumpWidget(
      MaterialApp(
        home: PairingPage(controller: desktop, runStatus: status),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Open navigation'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    now = now.add(const Duration(minutes: 5));
    await tester.pump(const Duration(minutes: 5));
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    final reads = clockReads;
    now = now.add(const Duration(minutes: 1));
    await tester.pump(const Duration(minutes: 1));
    expect(clockReads, reads);
    expect(tester.takeException(), isNull);
    // The deadline is still 24 minutes away. The test binding rejects any
    // leaked pending timer at teardown, even if its callback checks mounted.
    desktop.dispose();
    status.dispose();
  });

  testWidgets('open menu rebinds its live deadline to replacement pin scope', (
    tester,
  ) async {
    final remote = DraftTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    desktop.threadList.data.upsert({'id': 'run', 'title': 'Live run'});
    var now = DateTime.utc(2026, 10, 29), clockReads = 0;
    final status = RunStatusProjector(
      now: () {
        clockReads++;
        return now;
      },
    );
    void bind(String session) => status.setContext(
      mac: 'mac-a',
      fingerprint: DesktopLinkTarget.keyFingerprint(desktop.active!.publicKey),
      session: session,
      connected: true,
      selectedThread: null,
      threads: {'run': const StatusThread('Live run', '')},
    );
    bind('old');
    status.observe('turn/started', {'threadId': 'run', 'turnId': 'old-turn'});
    await tester.pumpWidget(
      MaterialApp(
        home: PairingPage(controller: desktop, runStatus: status),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Open navigation'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    now = now.add(const Duration(minutes: 10));
    await tester.pump(const Duration(minutes: 10));
    final replacement = Pairing({
      ...desktop.active!.data,
      'macIdentityPublicKey': base64Encode(List.filled(32, 7)),
    });
    await desktop.connect(replacement, resolve: false);
    remote.events.add({
      'method': 'thread/started',
      'params': {
        'thread': {'id': 'run', 'title': 'Live run'},
      },
    });
    bind('replacement');
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    status.observe('turn/started', {'threadId': 'run', 'turnId': 'new-turn'});
    await tester.pump();
    expect(desktop.threadList.data.find('run'), isNotNull);
    expect(
      status
          .liveRunningThreads(
            mac: 'mac-a',
            fingerprint: DesktopLinkTarget.keyFingerprint(
              desktop.active!.publicKey,
            )!,
          )
          .ids,
      {'run'},
    );
    await tester.scrollUntilVisible(
      find.byKey(const Key('navigation.thread.run')),
      80,
      scrollable: find.descendant(
        of: find.byKey(const Key('navigation.list')),
        matching: find.byType(Scrollable),
      ),
    );
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    final reads = clockReads;
    now = now.add(const Duration(minutes: 20));
    await tester.pump(const Duration(minutes: 20));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(
      clockReads,
      reads,
      reason: 'The old pin deadline must not call back into the new menu owner',
    );
    now = now.add(const Duration(minutes: 10));
    await tester.pump(const Duration(minutes: 10));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(tester.takeException(), isNull);
    await finishDraft(tester, desktop);
    status.dispose();
  });
}
