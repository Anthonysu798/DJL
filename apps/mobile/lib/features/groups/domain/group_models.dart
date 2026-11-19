// Mirrors the desktop's Multi agents contract (packages/contracts/src/groups.ts)
// as the phone bridge sends it.

typedef GroupJson = Map<String, dynamic>;

/// The handle that addresses every member, and its localized spellings.
const groupAllHandle = 'all';
const groupAllAliases = ['所有人', '全体成员', '全体'];

/// Groups this size or larger confirm before a message goes to everyone.
const groupAllWarningMinMembers = 4;

enum GroupMemberState {
  idle,
  working,
  waiting,
  failed;

  static GroupMemberState parse(Object? value) =>
      values.where((state) => state.name == value).firstOrNull ?? idle;

  bool get busy => this == working || this == waiting;
}

class GroupMember {
  const GroupMember({
    required this.id,
    required this.provider,
    required this.handle,
    required this.position,
    this.role,
  });

  factory GroupMember.fromJson(GroupJson json) => GroupMember(
    id: json['id'] as String,
    provider: json['provider'] as String,
    handle: json['handle'] as String,
    position: (json['position'] as num?)?.toInt() ?? 0,
    role: json['role'] as String?,
  );

  final String id, provider, handle;
  final int position;
  final String? role;
}

class Group {
  const Group({
    required this.id,
    required this.threadId,
    required this.name,
    required this.members,
    required this.pendingHandoffs,
    required this.skipAllWarning,
    required this.updatedAt,
  });

  factory Group.fromJson(GroupJson json) => Group(
    id: json['id'] as String,
    threadId: json['threadId'] as String,
    name: json['name'] as String,
    members: [
      for (final member in json['members'] as List? ?? const [])
        GroupMember.fromJson(Map<String, dynamic>.from(member as Map)),
    ]..sort((a, b) => a.position.compareTo(b.position)),
    pendingHandoffs: (json['pendingHandoffs'] as List?)?.length ?? 0,
    skipAllWarning: json['skipAllWarning'] == true,
    updatedAt: (json['updatedAt'] as num?)?.toInt() ?? 0,
  );

  final String id, threadId, name;
  final List<GroupMember> members;

  /// Hand-offs held back when a round reached its limit; the round is paused.
  final int pendingHandoffs;
  final bool skipAllWarning;
  final int updatedAt;

  GroupMember? member(String id) =>
      members.where((member) => member.id == id).firstOrNull;
}

/// What the desktop recorded about one reply. The text itself is the message.
class GroupReply {
  const GroupReply({
    required this.replyId,
    required this.memberId,
    required this.failed,
    required this.empty,
  });

  factory GroupReply.fromJson(GroupJson json) => GroupReply(
    replyId: json['replyId'] as String,
    memberId: json['memberId'] as String,
    failed: json['status'] == 'failed',
    empty: json['status'] == 'empty',
  );

  final String replyId, memberId;
  final bool failed, empty;
}

/// An agent the Mac can add to a new group.
class GroupAgent {
  const GroupAgent({
    required this.provider,
    required this.name,
    required this.ready,
  });

  factory GroupAgent.fromJson(GroupJson json) => GroupAgent(
    provider: json['provider'] as String,
    name: json['displayName'] as String,
    ready: json['ready'] == true,
  );

  final String provider, name;
  final bool ready;
}

class GroupMessage {
  const GroupMessage({
    required this.id,
    required this.text,
    this.memberId,
    this.replyId,
    this.sending = false,
  });

  final String id, text;

  /// Null for the person's own messages.
  final String? memberId, replyId;

  /// Shown at once, before the desktop has confirmed it.
  final bool sending;

  bool get fromUser => memberId == null;
}

final _groupMessageId = RegExp(r'(?:^|:)gm\.([^.:]+)\.([^.:]+)$');

/// Reads the member out of a reply id such as `assistant:<turn>:gm.<member>.<reply>`.
({String memberId, String replyId})? parseGroupMessageId(String messageId) {
  final match = _groupMessageId.firstMatch(messageId);
  return match == null
      ? null
      : (memberId: match.group(1)!, replyId: match.group(2)!);
}

final _handleChar = RegExp(r'[\p{L}\p{N}_-]', unicode: true);
// A mention cannot follow a word character, `.`, `@`, `/` or `\`
// (e-mail addresses, links, paths).
final _blocksMention = RegExp(r'[\p{L}\p{N}_.@/\\-]', unicode: true);
// After a handle, a Latin letter or digit means a longer, different word.
final _continuesWord = RegExp(r'[A-Za-z0-9_-]');

/// Finds `@handle` and `@all` mentions; handles keep their canonical spelling.
({bool all, List<String> handles}) parseGroupMentions(
  String text,
  List<String> handles,
) {
  final candidates = <({List<int> key, String? handle})>[
    for (final handle in handles)
      (key: handle.toLowerCase().runes.toList(), handle: handle),
    for (final alias in [groupAllHandle, ...groupAllAliases])
      (key: alias.toLowerCase().runes.toList(), handle: null),
  ]..sort((a, b) => b.key.length.compareTo(a.key.length));
  final chars = text.runes.toList();
  final lower = text.toLowerCase().runes.toList();
  final found = <String>[];
  var all = false;
  for (var index = 0; index < chars.length; index++) {
    if (chars[index] != 0x40) continue;
    if (index > 0 &&
        _blocksMention.hasMatch(String.fromCharCode(chars[index - 1]))) {
      continue;
    }
    final start = index + 1;
    for (final candidate in candidates) {
      final end = start + candidate.key.length;
      if (candidate.key.isEmpty || end > lower.length) continue;
      var matches = true;
      for (var offset = 0; offset < candidate.key.length && matches; offset++) {
        matches = lower[start + offset] == candidate.key[offset];
      }
      if (!matches) continue;
      if (end < chars.length &&
          _continuesWord.hasMatch(String.fromCharCode(chars[end]))) {
        continue;
      }
      if (candidate.handle == null) {
        all = true;
      } else if (!found.contains(candidate.handle)) {
        found.add(candidate.handle!);
      }
      index = end - 1;
      break;
    }
  }
  return (all: all, handles: found);
}

/// The `@word` the cursor is inside, if any, for the mention picker.
({int start, String query})? activeMentionQuery(String text, int cursor) {
  if (cursor < 0 || cursor > text.length) return null;
  var index = cursor;
  while (index > 0 && _handleChar.hasMatch(text[index - 1])) {
    index--;
  }
  if (index == 0 || text[index - 1] != '@') return null;
  final at = index - 1;
  if (at > 0 && _blocksMention.hasMatch(text[at - 1])) return null;
  return (start: at, query: text.substring(index, cursor));
}
