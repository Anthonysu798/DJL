import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_composer_controller.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'desktop_composer_picker_test.dart' show PendingImagePicker;
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_overview.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import 'settings/app_lock_controller_test.dart' show FakeOwnerAuth;
import '../core/cloud_client_test.dart' show TestCredentials;
import 'cloud_deep_links_test.dart' show client;
import 'desktop_composer_widget_test.dart'
    show DelayedComposerCreationTransport;
import 'desktop_recovery_test.dart' show RecoveryMemoryStore;
import 'desktop_root_routing_test.dart' show savedPair;

const projectPath = '/Users/mac/Projects/Exact opaque folder';
const qaModels = <RemoteJson>[
  {
    'id': 'qa',
    'model': 'qa',
    'isDefault': true,
    'supportedReasoningEfforts': ['low', 'high'],
    'defaultReasoningEffort': 'low',
  },
  {
    'id': 'other',
    'model': 'other',
    'supportedReasoningEfforts': ['high'],
    'defaultReasoningEffort': 'high',
  },
];

class DraftTransport extends DelayedComposerCreationTransport {
  DraftTransport(super.pairings);
  String folder = projectPath, host = 'mac-a';
  String? returnedCwd;
  bool online = true, failCreation = false;
  int starts = 0;
  List<RemoteJson> catalog = List.of(qaModels);
  @override
  Future<void> connect(Pairing pair, {required bool bootstrap}) async {
    online = true;
    host = pair.macDeviceId;
  }

  @override
  bool get connected => online;
  @override
  String? get macDeviceId => host;
  @override
  Future<void> disconnect() async {
    online = false;
  }

  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'model/list') {
      calls.add({'method': method, 'params': params});
      return {'data': catalog};
    }
    if (method == 'thread/start') {
      calls.add({'method': method, 'params': params});
      starts++;
      if (failCreation) throw StateError('Creation failed');
      return creation?.future ??
          {
            'approvalsReviewer': params['approvalsReviewer'],
            'thread': {
              'id': 'created-$starts',
              'cwd': returnedCwd ?? params['cwd'] ?? '/host/generated',
            },
          };
    }
    if (method == 'project/quickLocations') {
      calls.add({'method': method, 'params': params});
      return {
        'locations': [
          {'id': 'project', 'label': 'Project', 'path': folder},
        ],
      };
    }
    if (method == 'project/listDirectory') {
      calls.add({'method': method, 'params': params});
      return {'path': folder, 'entries': []};
    }
    final result = await super.request(method, params, timeout: timeout);
    return {'approvalsReviewer': params['approvalsReviewer'], ...result};
  }
}

Future<DesktopController> draftDesktop(DraftTransport remote) async {
  final pair = savedPair('mac-a');
  final desktop =
      DesktopController(
          remote.pairings,
          connection: remote,
          localStore: RecoveryMemoryStore(),
        )
        ..active = pair
        ..trusted = [pair]
        ..state = 'connected'
        ..models = List.of(qaModels);
  await desktop.threadList.attach('mac-a');
  return desktop;
}

List<RemoteJson> requests(DraftTransport remote, String method) =>
    remote.calls.where((c) => c['method'] == method).toList();
Future<void> finishDraft(WidgetTester tester, DesktopController desktop) async {
  await tester.pumpWidget(const SizedBox.shrink());
  desktop.dispose();
  await tester.pump();
}

// Root classification is a read-only overview bootstrap, separate from the
// draft action under test. Retain every other RPC and all outbound events.
void acknowledgeOverviewSetup(DraftTransport remote) {
  for (final call in requests(remote, 'project/projectlessRoots')) {
    expect(call['params'], isEmpty);
  }
  remote.calls.removeWhere(
    (call) => call['method'] == 'project/projectlessRoots',
  );
}

Future<void> enterDraft(
  WidgetTester tester,
  DesktopController desktop, {
  bool project = false,
}) async {
  if (project) {
    desktop.threadList.data.upsert({
      'id': 'draft-entry-project',
      'name': 'Existing project chat',
      'cwd': projectPath,
    });
  }
  await tester.pumpWidget(MaterialApp(home: PairingPage(controller: desktop)));
  await tester.pumpAndSettle();
  acknowledgeOverviewSetup(desktop.transport as DraftTransport);
  if (project) {
    await tester.tap(find.text('Projects'));
    await tester.pumpAndSettle();
  }
  final folder = desktopConversationPathLabel(projectPath);
  final entry = project
      ? find.byTooltip('New chat in $folder')
      : find.bySemanticsLabel('New chat');
  await tester.ensureVisible(entry);
  await tester.tap(entry);
  await tester.pumpAndSettle();
  if (project) {
    await tester.tap(find.bySemanticsLabel('New thread, $folder'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Use'));
    await tester.pumpAndSettle();
  }
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets('root New desktop chat is local through editing and Back', (
    tester,
  ) async {
    final credentials = TestCredentials(), pair = savedPair('mac-a');
    credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
    credentials.values['desktop.active'] = pair.macDeviceId;
    final remote = DelayedComposerCreationTransport(
      PairingRepository(credentials),
    );
    final desktop =
        DesktopController(
            remote.pairings,
            connection: remote,
            localStore: RecoveryMemoryStore(),
          )
          ..active = pair
          ..trusted = [pair]
          ..state = 'connected';
    await desktop.threadList.attach(pair.macDeviceId);
    final cloudCalls = <String>[];
    final lock = AppLockController(FakeOwnerAuth()..result = true);
    await tester.pumpWidget(
      DjlApp(
        appLock: lock,
        client: client(credentials, cloudCalls),
        desktop: desktop,
        initialLink: Future.value(null),
        linkStream: const Stream<Uri>.empty(),
      ),
    );
    await tester.pumpAndSettle();
    desktop.models = List.of(qaModels);
    remote.calls.clear();
    remote.sent.clear();
    cloudCalls.clear();
    await tester.ensureVisible(find.bySemanticsLabel('New chat'));
    await tester.tap(find.bySemanticsLabel('New chat'));
    await tester.pumpAndSettle();
    expect(
      remote.calls,
      isEmpty,
      reason: 'Entry must not allocate a remote thread',
    );
    expect(remote.sent, isEmpty);
    expect(cloudCalls, isEmpty);
    expect(find.byType(DesktopChatPage), findsOneWidget);
    expect(desktop.thread, isNull);
    await tester.enterText(
      find.byKey(const Key('desktop_composer')),
      'local only',
    );
    desktop.setModel('other');
    desktop.setEffort('high');
    await desktop.setAccess('auto-review');
    desktop.setPlan(true);
    await tester.pump();
    await tester.tap(find.byTooltip('Chat controls'));
    await tester.pumpAndSettle();
    Navigator.of(
      tester.element(find.byKey(const Key('composer.runtime.popover'))),
    ).pop();
    await tester.pumpAndSettle();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(remote.calls, isEmpty);
    expect(cloudCalls, isEmpty);
    expect(desktop.thread, isNull);
    expect(desktop.threadList.data.created, isEmpty);
    await tester.pumpWidget(const SizedBox.shrink());
    desktop.dispose();
    lock.dispose();
  });
  testWidgets(
    'project picker reads only on explicit entry; text-only first Send forwards exact cwd once',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      await enterDraft(tester, desktop, project: true);
      expect(remote.calls.map((v) => v['method']), [
        'project/quickLocations',
        'project/listDirectory',
      ]);
      final owner = desktop.newChatDraft!;
      expect(owner.cwd, projectPath);
      expect(owner.source, DesktopDraftSource.folderChat);
      expect(find.text(projectPath), findsNothing);
      expect(find.text('Exact opaque folder'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'project text',
      );
      expect(remote.calls.length, 2);
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pumpAndSettle();
      expect(requests(remote, 'thread/start'), hasLength(1));
      expect(
        requests(remote, 'thread/start').single['params'],
        containsPair('cwd', projectPath),
      );
      expect(
        requests(remote, 'thread/start').single['params'],
        containsPair('djlScope', 'project'),
      );
      expect(requests(remote, 'turn/start'), hasLength(1));
      expect(
        requests(remote, 'turn/start').single['params'],
        containsPair('threadId', 'created-1'),
      );
      expect(jsonEncode(remote.calls), isNot(contains(owner.id)));
      expect(
        desktop.timeline.where((v) => v['type'] == 'userMessage'),
        hasLength(1),
      );
      expect(
        desktop.threadList.data.composerDrafts.containsKey(owner.storageKey),
        false,
      );
      expect(
        desktop.threadList.data.drafts.containsKey(owner.storageKey),
        false,
      );
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'rootless uses defaults and host cwd; local runtime snapshot is sent',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      desktop.thread = {'id': 'old', 'cwd': '/old/project'};
      desktop.model = 'other';
      desktop.access = 'full-access';
      desktop.timeline = [
        {'id': 'old-row', 'type': 'userMessage', 'text': 'old message'},
      ];
      desktop.threadList.data.setComposerDraft(
        'old',
        DesktopComposerDraft(text: 'old draft'),
      );
      await enterDraft(tester, desktop);
      expect(desktop.model, 'qa');
      expect(desktop.access, 'on-request');
      expect(desktop.newChatDraft!.cwd, isNull);
      expect(remote.calls, isEmpty);
      desktop.setModel('other');
      await desktop.setAccess('auto-review');
      desktop.setEffort('high');
      desktop.setPlan(true);
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'rootless',
      );
      expect(remote.calls, isEmpty);
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pumpAndSettle();
      final params = requests(remote, 'thread/start').single['params'] as Map;
      expect(params['djlScope'], 'studio');
      expect(params.containsKey('cwd'), false);
      expect(params['model'], 'other');
      expect(desktop.thread?['cwd'], '/host/generated');
      expect(requests(remote, 'turn/start'), hasLength(1));
      expect(desktop.threadList.data.composerDraft('old').text, 'old draft');
      expect(desktop.threadList.data.timelines['old']!.single['id'], 'old-row');
      expect(desktop.threadList.data.runtimes['old']!['access'], 'full-access');
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'double tap creates one local route; Back keeps encrypted draft and fresh entry has fresh identity',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      final entry = find.bySemanticsLabel('New chat');
      await tester.ensureVisible(entry);
      acknowledgeOverviewSetup(remote);
      await tester.tap(entry);
      await tester.tap(entry);
      await tester.pumpAndSettle();
      final owner = desktop.newChatDraft!;
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'retained locally',
      );
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(DesktopChatPage), findsNothing);
      expect(desktop.newChatDraft, isNull);
      expect(desktop.thread, isNull);
      expect(
        desktop.threadList.data.composerDraft(owner.storageKey).text,
        'retained locally',
      );
      await tester.ensureVisible(entry);
      await tester.tap(entry);
      await tester.pumpAndSettle();
      expect(desktop.newChatDraft!.id, isNot(owner.id));
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        isEmpty,
      );
      expect(remote.calls, isEmpty);
      expect(remote.sent, isEmpty);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets('project picker Cancel leaves no draft or thread', (
    tester,
  ) async {
    final remote = DraftTransport(PairingRepository(TestCredentials()));
    final desktop = await draftDesktop(remote);
    await tester.pumpWidget(
      MaterialApp(home: PairingPage(controller: desktop)),
    );
    await tester.pumpAndSettle();
    acknowledgeOverviewSetup(remote);
    await tester.tap(find.byTooltip('More actions'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('New Project'));
    await tester.tap(find.text('New Project'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    expect(desktop.newChatDraft, isNull);
    expect(desktop.thread, isNull);
    expect(remote.calls.map((v) => v['method']), [
      'project/quickLocations',
      'project/listDirectory',
    ]);
    await finishDraft(tester, desktop);
  });

  testWidgets(
    'Back cancels first Send at pop before closing animation completes',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()))
        ..creation = Completer<RemoteJson>();
      final desktop = await draftDesktop(remote);
      await enterDraft(tester, desktop);
      final owner = desktop.newChatDraft!;
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'keep source',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pump();
      await tester.binding.handlePopRoute();
      expect(
        desktop.newChatDraft,
        isNull,
        reason: 'Pop, not eventual dispose, cancels ownership',
      );
      remote.creation!.complete({
        'thread': {'id': 'late-created'},
      });
      await tester.pumpAndSettle();
      expect(desktop.thread, isNull);
      expect(requests(remote, 'turn/start'), isEmpty);
      expect(desktop.threadList.data.created, contains('late-created'));
      expect(
        desktop.threadList.data.composerDraft(owner.storageKey).text,
        'keep source',
      );
      expect(
        desktop.threadList.data.composerDraft('late-created').text,
        'keep source',
      );
      await finishDraft(tester, desktop);
    },
  );

  for (final replacement in ['thread', 'link', 'pin', 'mac', 'suspend']) {
    testWidgets(
      'pending creation fenced by $replacement replacement and never sends to destination',
      (tester) async {
        final remote = DraftTransport(PairingRepository(TestCredentials()))
          ..creation = Completer<RemoteJson>();
        final desktop = await draftDesktop(remote);
        await enterDraft(tester, desktop);
        final owner = desktop.newChatDraft!;
        await tester.enterText(
          find.byKey(const Key('desktop_composer')),
          'source secret',
        );
        await tester.pump();
        await tester.tap(find.byTooltip('Send to desktop'));
        await tester.pump();
        switch (replacement) {
          case 'thread':
            await desktop.openThread({'id': 'destination'});
          case 'link':
            desktop.queueNavigation(
              DesktopLinkTarget(
                'destination',
                macId: 'mac-a',
                macKeySha256: DesktopLinkTarget.keyFingerprint(
                  desktop.active!.publicKey,
                ),
              ),
            );
          case 'pin':
            desktop.active = Pairing({
              ...desktop.active!.data,
              'macIdentityPublicKey': base64Encode(List.filled(32, 8)),
            });
            desktop.setModel('qa');
          case 'mac':
            desktop.active = savedPair('mac-b');
            remote.host = 'mac-b';
            await desktop.threadList.attach('mac-b');
            desktop.setModel('qa');
          case 'suspend':
            desktop.suspend();
        }
        remote.creation!.complete({
          'thread': {'id': 'late-created'},
        });
        await tester.pumpAndSettle();
        expect(requests(remote, 'turn/start'), isEmpty);
        expect(requests(remote, 'turn/steer'), isEmpty);
        expect(
          desktop.thread?['id'],
          replacement == 'thread' ? 'destination' : isNull,
        );
        if (replacement != 'mac') {
          expect(
            desktop.threadList.data.composerDraft(owner.storageKey).text,
            'source secret',
          );
        }
        if (replacement == 'suspend') {
          remote.online = true;
          desktop.state = 'connected';
          desktop.setModel('other');
          expect(desktop.isCurrentNewChatDraft(owner), true);
          expect(requests(remote, 'thread/start'), hasLength(1));
          remote.creation = null;
          await tester.pump();
          await tester.tap(find.byTooltip('Send to desktop'));
          await tester.pumpAndSettle();
          expect(requests(remote, 'thread/start'), hasLength(2));
          expect(requests(remote, 'turn/start'), hasLength(1));
        }
        await finishDraft(tester, desktop);
      },
    );
  }

  for (final failTurn in [false, true]) {
    testWidgets(
      '${failTurn ? 'first turn' : 'creation'} failure retains latest inputs without automatic retry',
      (tester) async {
        final remote = DraftTransport(PairingRepository(TestCredentials()))
          ..creation = Completer<RemoteJson>();
        if (failTurn) remote.responses.add(StateError('Turn failed'));
        final desktop = await draftDesktop(remote);
        await enterDraft(tester, desktop);
        final owner = desktop.newChatDraft!;
        await tester.enterText(
          find.byKey(const Key('desktop_composer')),
          'snapshot',
        );
        await tester.pump();
        await tester.tap(find.byTooltip('Send to desktop'));
        await tester.pump();
        await tester.enterText(
          find.byKey(const Key('desktop_composer')),
          'latest input',
        );
        expect(await desktop.send('duplicate'), false);
        if (failTurn) {
          remote.creation!.complete({
            'thread': {'id': 'real-created'},
          });
        } else {
          remote.creation!.completeError(StateError('Creation failed'));
        }
        await tester.pumpAndSettle();
        expect(requests(remote, 'thread/start'), hasLength(1));
        expect(requests(remote, 'turn/start'), hasLength(failTurn ? 1 : 0));
        expect(desktop.thread?['id'], failTurn ? 'real-created' : isNull);
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('desktop_composer')))
              .controller!
              .text,
          'latest input',
        );
        expect(
          desktop.threadList.data
              .composerDraft(failTurn ? 'real-created' : owner.storageKey)
              .text,
          'latest input',
        );
        await finishDraft(tester, desktop);
      },
    );
  }

  testWidgets(
    'project cwd mismatch preserves local owner and never dispatches a turn',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()))
        ..returnedCwd = '/wrong';
      final desktop = await draftDesktop(remote);
      await enterDraft(tester, desktop, project: true);
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'correct project only',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pumpAndSettle();
      expect(requests(remote, 'turn/start'), isEmpty);
      expect(desktop.thread, isNull);
      expect(desktop.error, contains('another project'));
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        'correct project only',
      );
      expect(desktop.newChatDraft!.cwd, projectPath);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'folder change retains text and scope-bound context until removed',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      final owner = desktop.beginNewChatDraft(cwd: projectPath)!;
      desktop.threadList.data.setComposerDraft(
        owner.storageKey,
        DesktopComposerDraft(
          text: 'retain text',
          cwd: projectPath,
          contexts: [
            const DesktopComposerContext(
              kind: DesktopContextKind.file,
              id: 'a',
              name: 'a',
              path: 'src/a.dart',
            ),
          ],
        ),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: DesktopChatPage(controller: desktop, draft: owner),
        ),
      );
      await tester.pumpAndSettle();
      remote.folder = '/new/opaque';
      await tester.tap(find.text('New thread'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Use'));
      await tester.pumpAndSettle();
      expect(desktop.newChatDraft, same(owner));
      expect(owner.cwd, '/new/opaque');
      expect(
        desktop.threadList.data.composerDraft(owner.storageKey).cwd,
        projectPath,
      );
      expect(find.textContaining('project folder changed'), findsOneWidget);
      expect(
        tester
            .widget<IconButton>(
              find.byWidgetPredicate(
                (w) => w is IconButton && w.tooltip == 'Send to desktop',
              ),
            )
            .onPressed,
        isNull,
      );
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        'retain text',
      );
      expect(remote.calls.map((v) => v['method']), [
        'project/quickLocations',
        'project/listDirectory',
      ]);
      await finishDraft(tester, desktop);
    },
  );

  test(
    'distinct null-thread draft identity rejects pending picker; same draft promotion retains it',
    () async {
      final picker = PendingImagePicker();
      final c = DesktopComposerController(picker: picker);
      const scope = (mac: 'mac-a', thread: null, cwd: projectPath);
      c.bind(scope, DesktopComposerDraft(), draftId: 'first');
      final pending = c.pickImage();
      c.bind(scope, DesktopComposerDraft(text: 'second'), draftId: 'second');
      picker.jobs.single.complete(
        const DesktopComposerImage(
          id: 'wrong',
          name: 'wrong.png',
          dataUrl: 'data:image/png;base64,YQ==',
        ),
      );
      await pending;
      expect(c.slots, isEmpty);
      expect(c.text, 'second');
      final promoted = c.pickImage();
      c.adoptCreatedThread((mac: 'mac-a', thread: 'real', cwd: projectPath));
      picker.jobs.last.complete(
        const DesktopComposerImage(
          id: 'right',
          name: 'right.png',
          dataUrl: 'data:image/png;base64,YQ==',
        ),
      );
      await promoted;
      expect(c.draft.images.single.id, 'right');
      c.dispose();
    },
  );
  testWidgets(
    'image-only project draft promotes late picker and frozen first payload without duplicate rows',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()))
        ..creation = Completer<RemoteJson>();
      final desktop = await draftDesktop(remote), picker = PendingImagePicker();
      final owner = desktop.beginNewChatDraft(cwd: projectPath)!;
      const image = DesktopComposerImage(
        id: 'first-image',
        name: 'first.png',
        dataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      );
      desktop.threadList.data.setComposerDraft(
        owner.storageKey,
        DesktopComposerDraft(images: [image]),
      );
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
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pump();
      expect(
        requests(remote, 'thread/start').single['params'],
        containsPair('cwd', projectPath),
      );
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'later text',
      );
      await tester.tap(find.byTooltip('Composer options'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.text('Photo library'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(await desktop.send('duplicate'), false);
      remote.creation!.complete({
        'thread': {'id': 'created-image', 'cwd': projectPath},
      });
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 30));
      picker.jobs.single.complete(
        DesktopComposerImage(
          id: 'later-image',
          name: 'later.png',
          dataUrl: image.dataUrl,
        ),
      );
      await tester.pumpAndSettle();
      final input =
          (requests(remote, 'turn/start').single['params'] as Map)['input']
              as List;
      expect(input, hasLength(1));
      expect((input.single as Map)['type'], 'image');
      expect(
        desktop.threadList.data.composerDraft('created-image').text,
        'later text',
      );
      expect(
        desktop.threadList.data.composerDraft('created-image').images.single.id,
        'later-image',
      );
      expect(
        desktop.timeline.where((v) => v['type'] == 'userMessage'),
        hasLength(1),
      );
      expect(requests(remote, 'thread/start'), hasLength(1));
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'same Mac navigation during post-create refresh preserves promoted input without turn',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()))
        ..listing = Completer<RemoteJson>();
      final desktop = await draftDesktop(remote);
      await enterDraft(tester, desktop);
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'source',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pump();
      expect(desktop.thread?['id'], 'created-1');
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'latest source',
      );
      await desktop.openThread({'id': 'destination'});
      remote.listing!.complete({'data': []});
      await tester.pumpAndSettle();
      expect(desktop.thread?['id'], 'destination');
      expect(requests(remote, 'turn/start'), isEmpty);
      expect(
        desktop.threadList.data.composerDraft('created-1').text,
        'latest source',
      );
      expect(
        desktop.threadList.data.composerDraft('destination').isEmpty,
        true,
      );
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'completed promotion becomes a normal real chat that can refresh and send again',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      await enterDraft(tester, desktop);
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'first',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pumpAndSettle();
      expect(desktop.newChatDraft, isNull);
      await tester.tap(find.byTooltip('Thread actions'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('More actions'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Refresh from desktop'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'second',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pumpAndSettle();
      expect(requests(remote, 'thread/start'), hasLength(1));
      expect(requests(remote, 'turn/start'), hasLength(2));
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'late project entry result cannot replace another same Mac selected chat',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()));
      final desktop = await draftDesktop(remote);
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      acknowledgeOverviewSetup(remote);
      await tester.tap(find.byTooltip('More actions'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('New Project'));
      await tester.tap(find.text('New Project'));
      await tester.pumpAndSettle();
      await desktop.openThread({'id': 'destination'});
      await tester.tap(find.text('Use'));
      await tester.pumpAndSettle();
      expect(desktop.newChatDraft, isNull);
      expect(desktop.thread?['id'], 'destination');
      expect(find.byType(DesktopChatPage), findsNothing);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'reconnect keeps explicit draft runtime and reports unavailable model without fallback Send',
    (tester) async {
      final credentials = TestCredentials(), pair = savedPair('mac-a');
      credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
      final remote = DraftTransport(PairingRepository(credentials));
      final desktop = await draftDesktop(remote);
      await enterDraft(tester, desktop);
      final owner = desktop.newChatDraft!;
      desktop.setModel('other');
      desktop.setEffort('high');
      desktop.setPlan(true);
      await desktop.setAccess('auto-review');
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'retained reconnect',
      );
      desktop.suspend();
      await desktop.connect(pair, resolve: false);
      await tester.pumpAndSettle();
      expect(desktop.newChatDraft, same(owner));
      expect(desktop.model, 'other');
      expect(desktop.effort, 'high');
      expect(desktop.plan, true);
      expect(desktop.access, 'auto-review');
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('desktop_composer')))
            .controller!
            .text,
        'retained reconnect',
      );
      remote.catalog = [qaModels.first];
      desktop.suspend();
      await desktop.connect(pair, resolve: false);
      await tester.pumpAndSettle();
      expect(desktop.model, 'other');
      expect(desktop.error, contains('unavailable'));
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pumpAndSettle();
      expect(requests(remote, 'thread/start'), isEmpty);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets(
    'cancelled first creation cannot retry a rejected runtime parameter',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()))
        ..creation = Completer<RemoteJson>();
      final desktop = await draftDesktop(remote);
      await enterDraft(tester, desktop);
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'source',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pump();
      await tester.binding.handlePopRoute();
      remote.creation!.completeError(
        RemoteRpcException(-32602, 'sandboxPolicy unsupported', null),
      );
      await tester.pumpAndSettle();
      expect(requests(remote, 'thread/start'), hasLength(1));
      expect(requests(remote, 'turn/start'), isEmpty);
      expect(desktop.error, isNull);
      await finishDraft(tester, desktop);
    },
  );
  testWidgets(
    'route removal invalidates local ownership before pending creation resolves',
    (tester) async {
      final remote = DraftTransport(PairingRepository(TestCredentials()))
        ..creation = Completer<RemoteJson>();
      final desktop = await draftDesktop(remote);
      await enterDraft(tester, desktop);
      await tester.enterText(
        find.byKey(const Key('desktop_composer')),
        'removed draft',
      );
      await tester.pump();
      await tester.tap(find.byTooltip('Send to desktop'));
      await tester.pump();
      final context = tester.element(find.byType(DesktopChatPage));
      Navigator.of(context).removeRoute(ModalRoute.of(context)!);
      remote.creation!.complete({
        'thread': {'id': 'removed-result'},
      });
      await tester.pumpAndSettle();
      expect(desktop.newChatDraft, isNull);
      expect(desktop.thread, isNull);
      expect(requests(remote, 'turn/start'), isEmpty);
      await finishDraft(tester, desktop);
    },
  );
}
