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
}
