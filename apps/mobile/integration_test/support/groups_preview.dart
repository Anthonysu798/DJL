// Interactive rendering fixture for group chat. Never used by the ordinary app entrypoint.
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/groups/presentation/group_chat_page.dart';
import 'package:djl_mobile/features/groups/presentation/group_create_sheet.dart';
import 'package:djl_mobile/features/groups/presentation/groups_controller.dart';
import 'package:djl_mobile/features/groups/presentation/groups_page.dart';
import '../../test/features/groups/fake_groups_link.dart';

/// Edit and hot restart to move between scenes:
/// list, chat, stream, paused, empty, create, offline.
String get _scene => 'stream';
ThemeMode get _mode => ThemeMode.dark;

const _providers = [
  ('claudeAgent', 'Claude'),
  ('codex', 'Codex'),
  ('gemini', 'Gemini'),
  ('grok', 'Grok'),
  ('cursor', 'Cursor'),
];

FakeGroupsLink _link() {
  final members = [
    for (final (index, agent) in _providers.indexed)
      fakeMember('m$index', agent.$1, agent.$2, index),
  ];
  final link = FakeGroupsLink()
    ..agents = [
      for (final agent in _providers)
        {'provider': agent.$1, 'displayName': agent.$2, 'ready': true},
      {'provider': 'qwen', 'displayName': 'Qwen Code', 'ready': false},
      {'provider': 'kimi', 'displayName': 'Kimi Code', 'ready': false},
    ]
    ..groups.addAll([
      fakeGroup(
        id: 'launch',
        name: 'Launch plan',
        members: members,
        updatedAt: 3,
        pendingHandoffs: _scene == 'paused' ? 2 : 0,
      ),
      fakeGroup(
        id: 'trip',
        name: 'Lisbon trip',
        members: members.sublist(0, 2),
        updatedAt: 2,
      ),
      fakeGroup(id: 'empty', name: 'Book club', members: members.sublist(1, 4)),
    ]);
  link.history['thread-launch'] = [
    fakeUserItem('u1', '@all reply only: received'),
    for (final (index, _) in _providers.indexed)
      fakeReplyItem('m$index', 'r$index', 'Received'),
    fakeUserItem('u2', '@Claude are you there?'),
    fakeReplyItem(
      'm0',
      'r9',
      'I am here. What would you like help with?\n\n'
          '- I can draft the **launch plan**\n- or review what the others wrote',
    ),
  ];
  return link;
}

/// Plays one round of replies word by word, as the desktop would send them.
void _stream(FakeGroupsLink link) {
  const replies = [
    (
      'm1',
      'Here is a short plan: announce on Monday, open the waitlist on '
          'Wednesday, and publish the demo video on Friday.',
    ),
    (
      'm2',
      'I would move the demo video earlier. People sign up after they '
          'see it, not before.',
    ),
  ];
  var tick = 0;
  for (final reply in replies) {
    link.emit('djl/groups/event', {
      'type': 'member.state',
      'groupId': 'launch',
      'memberId': reply.$1,
      'state': 'working',
    });
  }
  final words = [for (final reply in replies) reply.$2.split(' ')];
  Timer.periodic(const Duration(milliseconds: 60), (timer) {
    var busy = false;
    for (final (index, reply) in replies.indexed) {
      final start = index * 12;
      final at = tick - start;
      if (at < 0) {
        busy = true;
      } else if (at < words[index].length) {
        busy = true;
        link.emit('djl/groups/draft', {
          'groupId': 'launch',
          'memberId': reply.$1,
          'delta': '${at == 0 ? '' : ' '}${words[index][at]}',
          'restart': at == 0,
        });
      } else if (at == words[index].length) {
        busy = true;
        link.emit('djl/groups/event', {
          'type': 'member.state',
          'groupId': 'launch',
          'memberId': reply.$1,
          'state': 'idle',
        });
        link.emit('item/completed', {
          'threadId': 'thread-launch',
          'item': fakeReplyItem(reply.$1, 'live$index', reply.$2),
        });
      }
    }
    tick++;
    if (!busy) timer.cancel();
  });
}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final link = _link();
  if (_scene == 'offline') link.online = false;
  final controller = GroupsController(link);
  runApp(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: djlTheme(Brightness.light),
      darkTheme: djlTheme(Brightness.dark),
      themeMode: _mode,
      home: _Scene(controller: controller, link: link),
    ),
  );
}

class _Scene extends StatefulWidget {
  const _Scene({required this.controller, required this.link});
  final GroupsController controller;
  final FakeGroupsLink link;
  @override
  State<_Scene> createState() => _SceneState();
}

class _SceneState extends State<_Scene> {
  @override
  void initState() {
    super.initState();
    if (_scene == 'stream') {
      Timer(const Duration(seconds: 2), () => _stream(widget.link));
    }
    if (_scene == 'create') {
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          showDragHandle: true,
          builder: (_) => GroupCreateSheet(controller: widget.controller),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) => switch (_scene) {
    'chat' ||
    'stream' ||
    'paused' => GroupChatPage(controller: widget.controller, groupId: 'launch'),
    'empty' => GroupChatPage(controller: widget.controller, groupId: 'empty'),
    _ => Scaffold(
      appBar: AppBar(title: const Text('Groups')),
      body: GroupsList(controller: widget.controller),
    ),
  };
}
