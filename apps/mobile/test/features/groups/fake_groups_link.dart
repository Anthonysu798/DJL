import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:djl_mobile/features/groups/presentation/groups_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart'
    show RemoteJson;

/// A paired Mac that answers from memory. Tests and preview scenes script it.
class FakeGroupsLink extends ChangeNotifier implements GroupsLink {
  FakeGroupsLink({this.online = true, this.outdated = false});

  @override
  bool online;
  @override
  bool outdated;
  @override
  final groupThreads = <String>{};

  final _messages = StreamController<RemoteJson>.broadcast(sync: true);
  final requests = <(String, RemoteJson)>[];
  final groups = <RemoteJson>[];
  final replies = <RemoteJson>[];
  final history = <String, List<RemoteJson>>{};
  RemoteJson live = {'memberStates': {}, 'drafts': {}};
  List<RemoteJson> agents = [];

  /// Set to make the next request for a method fail.
  final failures = <String, Object>{};

  @override
  Stream<RemoteJson> get messages => _messages.stream;

  void emit(String method, RemoteJson params) =>
      _messages.add({'method': method, 'params': params});

  void setOnline(bool value) {
    online = value;
    notifyListeners();
  }

  @override
  Future<RemoteJson> request(String method, RemoteJson params) async {
    requests.add((method, params));
    final failure = failures.remove(method);
    if (failure != null) throw failure;
    switch (method) {
      case 'djl/groups/list':
        return {'groups': groups, 'replies': replies, 'live': live};
      case 'djl/groups/agents':
        return {'agents': agents};
      case 'djl/groups/create':
        final members = params['members'] as List;
        final group = fakeGroup(
          id: 'group-${groups.length + 1}',
          name: params['name'] as String,
          members: [
            for (final (index, member) in members.indexed)
              fakeMember(
                'member-${groups.length + 1}-$index',
                (member as Map)['provider'] as String,
                (member['provider'] as String),
                index,
              ),
          ],
        );
        groups.add(group);
        return group;
      case 'thread/read':
        return {
          'thread': {
            'id': params['threadId'],
            'turns': [
              {'id': 'history', 'items': history[params['threadId']] ?? []},
            ],
          },
        };
      default:
        return {};
    }
  }
}

RemoteJson fakeMember(
  String id,
  String provider,
  String handle,
  int position,
) => {
  'id': id,
  'groupId': 'group',
  'provider': provider,
  'handle': handle,
  'role': null,
  'model': null,
  'position': position,
};

RemoteJson fakeGroup({
  required String id,
  required String name,
  required List<RemoteJson> members,
  int pendingHandoffs = 0,
  bool skipAllWarning = false,
  int updatedAt = 1,
}) => {
  'id': id,
  'threadId': 'thread-$id',
  'projectId': 'project-$id',
  'name': name,
  'folder': '/groups/$id',
  'folderIsAuto': true,
  'hopLimit': 6,
  'skipAllWarning': skipAllWarning,
  'pendingHandoffs': [
    for (var index = 0; index < pendingHandoffs; index++)
      {'fromMemberId': 'a', 'toMemberId': 'b', 'text': 'more'},
  ],
  'members': members,
  'createdAt': 1,
  'updatedAt': updatedAt,
};

RemoteJson fakeUserItem(String id, String text) => {
  'id': id,
  'type': 'userMessage',
  'role': 'user',
  'content': [
    {'type': 'inputText', 'text': text},
  ],
};

RemoteJson fakeReplyItem(String memberId, String replyId, String text) => {
  'id': 'assistant:turn-1:gm.$memberId.$replyId',
  'type': 'agentMessage',
  'role': 'assistant',
  'content': [
    {'type': 'outputText', 'text': text},
  ],
};
