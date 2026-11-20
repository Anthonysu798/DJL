import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/groups/domain/group_models.dart';
import 'package:djl_mobile/features/groups/presentation/groups_controller.dart';
import 'fake_groups_link.dart';

FakeGroupsLink mac() => FakeGroupsLink()
  ..groups.add(
    fakeGroup(
      id: 'g1',
      name: 'Launch',
      members: [
        fakeMember('claude', 'claudeAgent', 'Claude', 0),
        fakeMember('codex', 'codex', 'Codex', 1),
      ],
    ),
  );

void draft(FakeGroupsLink link, String member, String delta, bool restart) =>
    link.emit('djl/groups/draft', {
      'groupId': 'g1',
      'memberId': member,
      'delta': delta,
      'restart': restart,
    });

void state(FakeGroupsLink link, String member, String state) => link.emit(
  'djl/groups/event',
  {'type': 'member.state', 'groupId': 'g1', 'memberId': member, 'state': state},
);

void main() {
  testWidgets('loads groups once the Mac is connected', (tester) async {
    final link = mac()..online = false;
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    expect(controller.available, isFalse);
    expect(link.requests, isEmpty);

    link.setOnline(true);
    await tester.pump();
    expect(controller.loaded, isTrue);
    expect(controller.groups.single.name, 'Launch');
    // The single-agent chat must leave this thread to the group screen.
    expect(link.groupThreads, {'thread-g1'});
  });

  testWidgets('tells an outdated Mac apart from a disconnected one', (
    tester,
  ) async {
    final controller = GroupsController(
      FakeGroupsLink(online: false, outdated: true),
    );
    addTearDown(controller.dispose);
    expect(controller.needsDesktopUpdate, isTrue);
    expect(controller.available, isFalse);
  });

  testWidgets('a client joining mid-reply sees who is writing and what', (
    tester,
  ) async {
    final link = mac()
      ..live = {
        'memberStates': {'claude': 'working'},
        'drafts': {'claude': 'Half a sen'},
      };
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    expect(controller.state('claude'), GroupMemberState.working);
    expect(controller.draft('claude').value, 'Half a sen');
    expect(controller.running(controller.groups.single), isTrue);
  });

  testWidgets('live text updates once a frame without list rebuilds', (
    tester,
  ) async {
    final link = mac();
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    state(link, 'claude', 'working');
    var listChanges = 0, draftChanges = 0;
    controller.addListener(() => listChanges++);
    controller.draft('claude').addListener(() => draftChanges++);

    draft(link, 'claude', 'Hel', true);
    draft(link, 'claude', 'lo ', false);
    draft(link, 'claude', 'there', false);
    expect(controller.draft('claude').value, isEmpty);
    await tester.pump();
    expect(controller.draft('claude').value, 'Hello there');
    expect(draftChanges, 1);
    expect(listChanges, 0);
  });

  testWidgets('a restart replaces what the agent wrote before', (tester) async {
    final link = mac();
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    state(link, 'claude', 'working');
    draft(link, 'claude', 'Let me look.', true);
    await tester.pump();
    draft(link, 'claude', 'more', false);
    draft(link, 'claude', 'The answer', true);
    draft(link, 'claude', ' is 4.', false);
    await tester.pump();
    expect(controller.draft('claude').value, 'The answer is 4.');
  });

  testWidgets('the finished reply replaces the draft without a gap', (
    tester,
  ) async {
    final link = mac();
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    final group = controller.groups.single;
    await controller.open(group);
    state(link, 'claude', 'working');
    draft(link, 'claude', 'Done.', true);
    await tester.pump();

    // Idle arrives first; the draft must survive until the message lands.
    state(link, 'claude', 'idle');
    expect(controller.draft('claude').value, 'Done.');
    link.emit('item/completed', {
      'threadId': 'thread-g1',
      'item': fakeReplyItem('claude', 'r1', 'Done.'),
    });
    expect(controller.draft('claude').value, isEmpty);
    final message = controller.messages(group).single;
    expect(message.memberId, 'claude');
    expect(message.replyId, 'r1');
    expect(message.text, 'Done.');
    await tester.pump(const Duration(seconds: 2));
  });

  testWidgets('a stopped agent leaves no draft behind', (tester) async {
    final link = mac();
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    state(link, 'claude', 'working');
    draft(link, 'claude', 'Half', true);
    await tester.pump();
    state(link, 'claude', 'idle');
    await tester.pump(const Duration(seconds: 2));
    expect(controller.draft('claude').value, isEmpty);
  });

  testWidgets('history and live messages are deduplicated by id', (
    tester,
  ) async {
    final link = mac()
      ..history['thread-g1'] = [
        fakeUserItem('u1', '@Claude hello'),
        fakeReplyItem('claude', 'r1', 'Hello!'),
      ];
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    final group = controller.groups.single;
    await controller.open(group);
    expect(controller.messages(group).map((m) => m.text), [
      '@Claude hello',
      'Hello!',
    ]);
    // The bridge can replay a completed item it already sent as history.
    link.emit('item/completed', {
      'threadId': 'thread-g1',
      'item': fakeReplyItem('claude', 'r1', 'Hello!'),
    });
    expect(controller.messages(group), hasLength(2));
  });

  testWidgets('a sent message shows at once and the echo confirms it', (
    tester,
  ) async {
    final link = mac();
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    final group = controller.groups.single;
    await controller.open(group);

    final sent = controller.send(group, '  @all hi  ');
    expect(controller.messages(group).single.sending, isTrue);
    expect(await sent, isTrue);
    expect(link.requests.last.$1, 'djl/groups/send');
    expect(link.requests.last.$2, {'groupId': 'g1', 'text': '@all hi'});
    link.emit('codex/event/user_message', {
      'threadId': 'thread-g1',
      'itemId': 'djl-message-1',
      'message': '@all hi',
    });
    final confirmed = controller.messages(group).single;
    expect(confirmed.id, 'djl-message-1');
    expect(confirmed.sending, isFalse);
  });

  testWidgets('a failed send is taken back and explained', (tester) async {
    final link = mac();
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    final group = controller.groups.single;
    await controller.open(group);
    link.failures['djl/groups/send'] = const RemoteRpcException(
      -32000,
      'Group not found',
      null,
    );
    expect(await controller.send(group, 'hello'), isFalse);
    expect(controller.messages(group), isEmpty);
    expect(controller.error, 'Group not found');
  });

  testWidgets('a desktop timeout is explained in plain words', (tester) async {
    final link = mac();
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    link.failures['djl/groups/list'] = const RemoteRpcException(
      -32000,
      'DJL Electron request timed out: groups.list',
      null,
    );
    await controller.refresh();
    expect(
      controller.error,
      'Your Mac did not answer in time. Check that DJL is open on it.',
    );
  });

  testWidgets('reconnecting reloads the list and the open chat', (
    tester,
  ) async {
    final link = mac();
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    final group = controller.groups.single;
    await controller.open(group);
    link.setOnline(false);
    link.history['thread-g1'] = [fakeReplyItem('codex', 'r2', 'While away')];
    link.requests.clear();

    link.setOnline(true);
    await tester.pump();
    await tester.pump();
    expect(link.requests.map((request) => request.$1), [
      'djl/groups/list',
      'thread/read',
    ]);
    expect(controller.messages(group).single.text, 'While away');
  });

  testWidgets('events for other chats are ignored', (tester) async {
    final link = mac();
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    link.emit('item/completed', {
      'threadId': 'an-ordinary-chat',
      'item': fakeReplyItem('claude', 'r1', 'Not for the group'),
    });
    expect(controller.messages(controller.groups.single), isEmpty);
  });

  testWidgets('creating a group puts it first in the list', (tester) async {
    final link = mac();
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    final created = await controller.create('Trip', ['codex', 'gemini']);
    expect(created.members.map((m) => m.provider), ['codex', 'gemini']);
    expect(controller.groups.first.name, 'Trip');
    expect(link.groupThreads, contains(created.threadId));
  });

  testWidgets('files upload in pieces and go with the message', (tester) async {
    final link = mac();
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    final group = controller.groups.single;
    await controller.open(group);
    // Large enough to need three pieces of 384 KiB.
    final big = Uint8List.fromList(List.generate(900 * 1024, (i) => i % 251));
    final note = Uint8List.fromList(utf8.encode('print("hi")'));
    final sending = controller.send(
      group,
      '@Claude read these',
      files: [
        (
          name: 'deck.pptx',
          mimeType: 'application/vnd.ms-powerpoint',
          bytes: big,
        ),
        (name: 'main.py', mimeType: 'text/x-python', bytes: note),
      ],
    );
    final local = controller.messages(group).single;
    expect(local.sending, isTrue);
    expect(local.attachments.map((a) => a.name), ['deck.pptx', 'main.py']);
    expect(await sending, isTrue);

    final uploads = link.requests.where((r) => r.$1 == 'djl/groups/upload');
    expect(uploads.length, 4);
    expect(uploads.map((r) => r.$2['offset']), [0, 393216, 786432, 0]);
    expect(uploads.map((r) => r.$2['final']), [false, false, true, true]);
    expect(link.stored['att-1'], big);
    final send = link.requests.lastWhere((r) => r.$1 == 'djl/groups/send').$2;
    expect(send['text'], '@Claude read these');
    expect((send['attachments'] as List).map((a) => (a as Map)['id']), [
      'att-1',
      'att-2',
    ]);
    expect(controller.progress(local.id), isNull);

    // The echo carries the desktop's ids and replaces the local copy, and a
    // sent file previews from memory without another download.
    link.emit('codex/event/user_message', {
      'threadId': group.threadId,
      'itemId': 'user-1',
      'message': '@Claude read these',
      'attachments': [
        {
          'type': 'file',
          'id': 'att-2',
          'name': 'main.py',
          'mimeType': 'text/x-python',
          'sizeBytes': note.length,
        },
        {
          'type': 'file',
          'id': 'att-1',
          'name': 'deck.pptx',
          'mimeType': 'application/vnd.ms-powerpoint',
          'sizeBytes': big.length,
        },
      ],
    });
    final echoed = controller.messages(group).single;
    expect(echoed.sending, isFalse);
    expect(echoed.attachments.first.id, 'att-2');
    expect(await controller.attachmentBytes(echoed.attachments.first), note);
    expect(
      link.requests.where((r) => r.$1 == 'djl/groups/attachment'),
      isEmpty,
    );
  });

  testWidgets('files alone can be sent, and a failed upload takes them back', (
    tester,
  ) async {
    final link = mac();
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    final group = controller.groups.single;
    await controller.open(group);
    final photo = Uint8List.fromList([1, 2, 3]);
    link.failures['djl/groups/upload'] = const RemoteRpcException(
      -32000,
      'Upload out of order',
      null,
    );
    expect(
      await controller.send(
        group,
        '',
        files: [(name: 'a.png', mimeType: 'image/png', bytes: photo)],
      ),
      isFalse,
    );
    expect(controller.messages(group), isEmpty);
    expect(controller.error, 'Upload out of order');
    expect(link.requests.where((r) => r.$1 == 'djl/groups/send'), isEmpty);

    expect(
      await controller.send(
        group,
        '',
        files: [(name: 'a.png', mimeType: 'image/png', bytes: photo)],
      ),
      isTrue,
    );
    final send = link.requests.lastWhere((r) => r.$1 == 'djl/groups/send').$2;
    expect(send['text'], '');
    expect((send['attachments'] as List).single, containsPair('type', 'image'));
  });

  testWidgets('history files download in pages for preview', (tester) async {
    final link = mac();
    link.stored['att-9'] = List.generate(10, (i) => i);
    link.history['thread-g1'] = [
      {
        ...fakeUserItem('user-9', 'see attached'),
        'attachments': [
          {
            'type': 'file',
            'id': 'att-9',
            'name': 'report.pdf',
            'mimeType': 'application/pdf',
            'sizeBytes': 10,
          },
        ],
      },
    ];
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    final group = controller.groups.single;
    await controller.open(group);
    final attachment = controller.messages(group).single.attachments.single;
    expect(attachment.name, 'report.pdf');
    expect(
      await controller.attachmentBytes(attachment),
      List.generate(10, (i) => i),
    );
    // The fake serves four bytes a page.
    expect(
      link.requests.where((r) => r.$1 == 'djl/groups/attachment').length,
      3,
    );
    await controller.attachmentBytes(attachment);
    expect(
      link.requests.where((r) => r.$1 == 'djl/groups/attachment').length,
      3,
    );
  });

  testWidgets('attaching waits for a Mac that takes files', (tester) async {
    final link = mac()..attachments = false;
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pump();
    expect(controller.available, isTrue);
    expect(controller.canAttach, isFalse);
  });
}
