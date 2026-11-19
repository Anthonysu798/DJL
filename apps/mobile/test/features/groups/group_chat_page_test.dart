import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/groups/presentation/group_chat_page.dart';
import 'package:djl_mobile/features/groups/presentation/groups_controller.dart';
import 'package:djl_mobile/features/groups/presentation/groups_page.dart';
import 'fake_groups_link.dart';

FakeGroupsLink mac({int pendingHandoffs = 0, int members = 2}) {
  const agents = [
    ('claude', 'claudeAgent', 'Claude'),
    ('codex', 'codex', 'Codex'),
    ('gemini', 'gemini', 'Gemini'),
    ('grok', 'grok', 'Grok'),
  ];
  return FakeGroupsLink()
    ..groups.add(
      fakeGroup(
        id: 'g1',
        name: 'Launch',
        pendingHandoffs: pendingHandoffs,
        members: [
          for (final (index, agent) in agents.take(members).indexed)
            fakeMember(agent.$1, agent.$2, agent.$3, index),
        ],
      ),
    );
}

Future<GroupsController> open(
  WidgetTester tester,
  FakeGroupsLink link, {
  Brightness brightness = Brightness.light,
}) async {
  final controller = GroupsController(link);
  addTearDown(controller.dispose);
  await tester.pumpWidget(
    MaterialApp(
      theme: djlTheme(brightness),
      home: GroupChatPage(controller: controller, groupId: 'g1'),
    ),
  );
  await tester.pump();
  await tester.pump();
  return controller;
}

void event(FakeGroupsLink link, String member, String state) => link.emit(
  'djl/groups/event',
  {'type': 'member.state', 'groupId': 'g1', 'memberId': member, 'state': state},
);

void main() {
  testWidgets('a new group invites the first message', (tester) async {
    await open(tester, mac());
    expect(find.text('Everyone is here'), findsOneWidget);
    await tester.tap(find.text('Ask everyone to say hello'));
    await tester.pump();
    final input = tester.widget<TextField>(
      find.byKey(const Key('group-composer-input')),
    );
    expect(input.controller!.text, startsWith('@all '));
  });

  testWidgets('history shows who said what', (tester) async {
    final link = mac()
      ..history['thread-g1'] = [
        fakeUserItem('u1', '@all reply only: received'),
        fakeReplyItem('claude', 'r1', 'Received'),
        fakeReplyItem('codex', 'r2', 'Received'),
      ];
    await open(tester, link);
    expect(find.text('@all reply only: received'), findsOneWidget);
    expect(find.text('Received'), findsNWidgets(2));
    expect(find.text('Claude'), findsOneWidget);
    expect(find.text('Codex'), findsOneWidget);
  });

  testWidgets('a reply is drawn as it is written, then settles in place', (
    tester,
  ) async {
    final link = mac();
    final controller = await open(tester, link);
    event(link, 'claude', 'working');
    await tester.pump();
    // Read out together with the agent's name, as one element.
    expect(find.bySemanticsLabel(RegExp('Writing')), findsOneWidget);

    link.emit('djl/groups/draft', {
      'groupId': 'g1',
      'memberId': 'claude',
      'delta': 'Hello',
      'restart': true,
    });
    await tester.pump();
    expect(find.text('Hello'), findsOneWidget);
    link.emit('djl/groups/draft', {
      'groupId': 'g1',
      'memberId': 'claude',
      'delta': ' there',
      'restart': false,
    });
    await tester.pump();
    expect(find.text('Hello there'), findsOneWidget);

    event(link, 'claude', 'idle');
    link.emit('item/completed', {
      'threadId': 'thread-g1',
      'item': fakeReplyItem('claude', 'r1', 'Hello there'),
    });
    await tester.pump();
    // One bubble, not a draft beside a finished copy.
    expect(find.text('Hello there'), findsOneWidget);
    expect(controller.draft('claude').value, isEmpty);
    await tester.pump(const Duration(seconds: 2));
  });

  testWidgets('sending shows the message at once and clears the field', (
    tester,
  ) async {
    final link = mac();
    await open(tester, link);
    await tester.enterText(
      find.byKey(const Key('group-composer-input')),
      '@Claude hello',
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('group-composer-action')));
    await tester.pump();
    expect(find.text('@Claude hello'), findsOneWidget);
    expect(link.requests.last.$1, 'djl/groups/send');
    expect(link.requests.last.$2['text'], '@Claude hello');
    final input = tester.widget<TextField>(
      find.byKey(const Key('group-composer-input')),
    );
    expect(input.controller!.text, isEmpty);
  });

  testWidgets('the send button stops the agents while they work', (
    tester,
  ) async {
    final link = mac();
    await open(tester, link);
    event(link, 'codex', 'working');
    await tester.pump();
    expect(find.bySemanticsLabel('Stop the agents'), findsOneWidget);
    await tester.tap(find.byKey(const Key('group-composer-action')));
    await tester.pump();
    expect(link.requests.last.$1, 'djl/groups/stop');
    event(link, 'codex', 'idle');
    await tester.pump(const Duration(seconds: 2));
  });

  testWidgets('typing @ offers everyone and each agent', (tester) async {
    await open(tester, mac());
    await tester.tap(find.byKey(const Key('group-composer-input')));
    await tester.enterText(find.byKey(const Key('group-composer-input')), '@');
    await tester.pump();
    expect(find.text('Everyone'), findsOneWidget);
    await tester.tap(find.widgetWithText(InkWell, 'Codex'));
    await tester.pump();
    final input = tester.widget<TextField>(
      find.byKey(const Key('group-composer-input')),
    );
    expect(input.controller!.text, '@Codex ');
  });

  testWidgets('asking everyone in a large group is confirmed first', (
    tester,
  ) async {
    final link = mac(members: 4);
    await open(tester, link);
    await tester.enterText(
      find.byKey(const Key('group-composer-input')),
      '@all thoughts?',
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('group-composer-action')));
    await tester.pumpAndSettle();
    expect(find.text('Ask everyone?'), findsOneWidget);
    expect(
      link.requests.where((request) => request.$1 == 'djl/groups/send'),
      isEmpty,
    );
    await tester.tap(find.text('Ask everyone'));
    await tester.pumpAndSettle();
    expect(link.requests.last.$1, 'djl/groups/send');
  });

  testWidgets('a paused round can be continued or ended', (tester) async {
    final link = mac(pendingHandoffs: 2);
    await open(tester, link);
    expect(find.text('The agents paused'), findsOneWidget);
    await tester.tap(find.text('Let them continue'));
    await tester.pump();
    expect(link.requests.last.$1, 'djl/groups/resolvePause');
    expect(link.requests.last.$2['action'], 'continue');
  });

  testWidgets('an offline Mac is explained instead of spinning forever', (
    tester,
  ) async {
    final link = mac()..online = false;
    final controller = GroupsController(link);
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: djlTheme(Brightness.dark),
        home: Scaffold(body: GroupsList(controller: controller)),
      ),
    );
    await tester.pump();
    expect(find.text('Connect to your Mac'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });

  testWidgets('an older desktop asks for an update', (tester) async {
    final controller = GroupsController(
      FakeGroupsLink(online: false, outdated: true),
    );
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: djlTheme(Brightness.light),
        home: Scaffold(body: GroupsList(controller: controller)),
      ),
    );
    await tester.pump();
    expect(find.text('Update DJL on your Mac'), findsOneWidget);
  });
}
