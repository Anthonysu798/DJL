import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';
import '../../desktop/data/remote_transport.dart';
import '../../desktop/presentation/desktop_controller.dart';
import '../../pairing/data/pairing_repository.dart' show RemoteJson;
import '../domain/group_models.dart';
import '../../../l10n/l10n.dart';

/// What group chat needs from the connection to the paired Mac.
abstract interface class GroupsLink implements Listenable {
  /// Connected to a Mac whose DJL serves group chats.
  bool get online;

  /// Connected, but the Mac's DJL is older than group chat.
  bool get outdated;
  Stream<RemoteJson> get messages;
  Future<RemoteJson> request(String method, RemoteJson params);

  /// Threads owned by group chats; the single-agent chat ignores their events.
  Set<String> get groupThreads;

  /// The Mac takes files and images in group chats.
  bool get attachments;
}

class DesktopGroupsLink implements GroupsLink {
  const DesktopGroupsLink(this.desktop);
  final DesktopController desktop;
  @override
  bool get online => desktop.state == 'connected' && desktop.supportsGroups;
  @override
  bool get outdated => desktop.state == 'connected' && !desktop.supportsGroups;
  @override
  Stream<RemoteJson> get messages => desktop.transport.messages;
  @override
  Future<RemoteJson> request(String method, RemoteJson params) =>
      desktop.transport.request(method, params);
  @override
  Set<String> get groupThreads => desktop.groupThreads;
  @override
  bool get attachments => desktop.supportsGroupAttachments;
  @override
  void addListener(VoidCallback listener) => desktop.addListener(listener);
  @override
  void removeListener(VoidCallback listener) =>
      desktop.removeListener(listener);
}

/// Group chats on the paired Mac: the list, each chat's messages, and the text
/// every agent is writing right now.
///
/// List-level changes notify listeners. Live text does not: each agent's draft
/// is its own [ValueListenable], updated at most once a frame, so a streaming
/// reply repaints one bubble and nothing else.
class GroupsController extends ChangeNotifier {
  GroupsController(this.link) {
    _subscription = link.messages.listen(_incoming);
    link.addListener(_linkChanged);
    _linkChanged();
  }

  final GroupsLink link;
  late final StreamSubscription<RemoteJson> _subscription;

  List<Group> groups = const [];
  bool loading = false, loaded = false;
  String? error;

  final _replies = <String, GroupReply>{};
  final _states = <String, GroupMemberState>{};
  final _drafts = <String, ValueNotifier<String>>{};
  final _messages = <String, List<GroupMessage>>{};
  final _opened = <String>{};
  final _pending = <String, ({bool restart, StringBuffer text})>{};
  final _draftExpiry = <String, Timer>{};
  bool _flushScheduled = false, _online = false, _disposed = false;
  int _local = 0;

  // Bytes of attachments seen this session, by key and by desktop id, so a
  // sent file previews without downloading it again. Oldest go first.
  final _bytes = <String, Uint8List>{};
  int _cachedBytes = 0;
  final _progress = <String, ValueNotifier<double>>{};

  static const _chunkBytes = 384 * 1024;
  static const _cacheLimit = 160 * 1024 * 1024;

  /// The paired Mac is connected and new enough to serve groups.
  bool get available => _online;

  /// The Mac is connected but its DJL is older than group chat.
  bool get needsDesktopUpdate => link.outdated;

  /// Files and images can be sent to this Mac's groups.
  bool get canAttach => _online && link.attachments;

  /// Upload progress of a message still sending files, from 0 to 1.
  ValueListenable<double>? progress(String messageId) => _progress[messageId];

  Group? group(String id) => groups.where((g) => g.id == id).firstOrNull;
  GroupMemberState state(String memberId) =>
      _states[memberId] ?? GroupMemberState.idle;
  GroupReply? reply(String? replyId) => _replies[replyId];
  bool running(Group group) =>
      group.members.any((member) => state(member.id).busy);
  List<GroupMessage> messages(Group group) =>
      _messages[group.threadId] ?? const [];
  bool messagesLoaded(Group group) => _messages.containsKey(group.threadId);

  /// The text [memberId] has written so far in its current reply.
  ValueListenable<String> draft(String memberId) => _draft(memberId);
  ValueNotifier<String> _draft(String memberId) =>
      _drafts[memberId] ??= ValueNotifier('');

  void _linkChanged() {
    final online = link.online;
    if (online == _online) return;
    _online = online;
    if (online) {
      unawaited(refresh());
    } else {
      _change();
    }
  }

  void _change() {
    if (!_disposed) notifyListeners();
  }

  Future<void> refresh() async {
    if (!_online || loading) return;
    loading = true;
    error = null;
    _change();
    try {
      final result = await link.request('djl/groups/list', {});
      _applySnapshot(result);
      loaded = true;
      for (final threadId in _opened.toList()) {
        final owner = groups.where((g) => g.threadId == threadId).firstOrNull;
        if (owner != null) unawaited(open(owner));
      }
    } catch (failure) {
      error = _message(failure);
    } finally {
      loading = false;
      _change();
    }
  }

  void _applySnapshot(RemoteJson snapshot) {
    _setGroups([
      for (final value in snapshot['groups'] as List? ?? const [])
        Group.fromJson(Map<String, dynamic>.from(value as Map)),
    ]);
    for (final value in snapshot['replies'] as List? ?? const []) {
      final reply = GroupReply.fromJson(
        Map<String, dynamic>.from(value as Map),
      );
      _replies[reply.replyId] = reply;
    }
    final live = snapshot['live'];
    if (live is! Map) return;
    _states
      ..clear()
      ..addAll({
        for (final entry in (live['memberStates'] as Map? ?? const {}).entries)
          entry.key as String: GroupMemberState.parse(entry.value),
      });
    final drafts = live['drafts'] as Map? ?? const {};
    for (final entry in _drafts.entries) {
      if (!drafts.containsKey(entry.key)) entry.value.value = '';
    }
    for (final entry in drafts.entries) {
      _draft(entry.key as String).value = entry.value as String;
    }
  }

  void _setGroups(List<Group> next) {
    groups = next..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    link.groupThreads
      ..clear()
      ..addAll(groups.map((group) => group.threadId));
  }

  /// Loads a chat's history and keeps it current across reconnects.
  Future<void> open(Group group) async {
    _opened.add(group.threadId);
    if (!_online) return;
    try {
      final response = await link.request('thread/read', {
        'threadId': group.threadId,
        'includeTurns': true,
      });
      final history = <GroupMessage>[];
      final thread = response['thread'] as Map? ?? const {};
      for (final turn in thread['turns'] as List? ?? const []) {
        for (final item in (turn as Map)['items'] as List? ?? const []) {
          final message = _fromItem(Map<String, dynamic>.from(item as Map));
          if (message != null) history.add(message);
        }
      }
      final known = history.map((message) => message.id).toSet();
      // Anything that arrived while the history was loading stays at the end.
      _messages[group.threadId] = [
        ...history,
        for (final message in messages(group))
          if (!known.contains(message.id) &&
              !(message.sending &&
                  history.any((h) => h.fromUser && h.text == message.text)))
            message,
      ];
      error = null;
    } catch (failure) {
      _messages.putIfAbsent(group.threadId, () => []);
      error = _message(failure);
    }
    _change();
  }

  void close(Group group) => _opened.remove(group.threadId);

  GroupMessage? _fromItem(RemoteJson item) {
    final id = item['id'] as String?;
    if (id == null) return null;
    final text = [
      for (final part in item['content'] as List? ?? const [])
        if (part is Map && part['text'] is String) part['text'] as String,
    ].join();
    if (item['type'] == 'userMessage') {
      return GroupMessage(
        id: id,
        text: text,
        attachments: GroupAttachment.listFrom(item['attachments']),
      );
    }
    final speaker = parseGroupMessageId(id);
    if (item['type'] != 'agentMessage' || speaker == null) return null;
    return GroupMessage(
      id: id,
      text: text,
      memberId: speaker.memberId,
      replyId: speaker.replyId,
    );
  }

  void _incoming(RemoteJson rpc) {
    final method = rpc['method'];
    if (method is! String || rpc['params'] is! Map) return;
    final params = Map<String, dynamic>.from(rpc['params'] as Map);
    switch (method) {
      case 'djl/groups/draft':
        _queueDraft(
          params['memberId'] as String,
          params['delta'] as String? ?? '',
          params['restart'] == true,
        );
      case 'djl/groups/event':
        _applyEvent(params);
      case 'codex/event/user_message':
        final threadId = params['threadId'];
        final id = params['itemId'];
        if (id is! String || !link.groupThreads.contains(threadId)) return;
        _upsert(
          threadId as String,
          GroupMessage(
            id: id,
            text: params['message'] as String? ?? '',
            attachments: GroupAttachment.listFrom(params['attachments']),
          ),
        );
      case 'item/agentMessage/delta':
        final threadId = params['threadId'];
        final id = params['itemId'];
        if (id is! String || !link.groupThreads.contains(threadId)) return;
        final speaker = parseGroupMessageId(id);
        if (speaker == null) return;
        final list = _messages[threadId as String] ?? const <GroupMessage>[];
        final existing = list.where((m) => m.id == id).firstOrNull;
        _upsert(
          threadId,
          GroupMessage(
            id: id,
            text: '${existing?.text ?? ''}${params['delta'] ?? ''}',
            memberId: speaker.memberId,
            replyId: speaker.replyId,
          ),
        );
      case 'item/completed':
        final threadId = params['threadId'];
        if (params['item'] is! Map || !link.groupThreads.contains(threadId)) {
          return;
        }
        final message = _fromItem(
          Map<String, dynamic>.from(params['item'] as Map),
        );
        if (message != null) _upsert(threadId as String, message);
    }
  }

  void _applyEvent(RemoteJson event) {
    switch (event['type']) {
      case 'snapshot':
        _applySnapshot(event);
        loaded = true;
      case 'group.upserted':
        final next = Group.fromJson(
          Map<String, dynamic>.from(event['group'] as Map),
        );
        _setGroups([
          next,
          for (final group in groups)
            if (group.id != next.id) group,
        ]);
      case 'group.deleted':
        _setGroups([
          for (final group in groups)
            if (group.id != event['groupId']) group,
        ]);
      case 'member.state':
        final memberId = event['memberId'] as String;
        final next = GroupMemberState.parse(event['state']);
        _states[memberId] = next;
        _draftExpiry.remove(memberId)?.cancel();
        if (!next.busy) {
          // The finished reply lands on the thread a moment after the member
          // goes idle; keep its draft until then so the bubble never blinks.
          _draftExpiry[memberId] = Timer(
            const Duration(milliseconds: 1500),
            () => _clearDraft(memberId),
          );
        }
      case 'reply.recorded':
        final reply = GroupReply.fromJson(
          Map<String, dynamic>.from(event['reply'] as Map),
        );
        _replies[reply.replyId] = reply;
      default:
        return;
    }
    _change();
  }

  void _upsert(String threadId, GroupMessage message) {
    final list = _messages.putIfAbsent(threadId, () => []);
    final index = list.indexWhere((m) => m.id == message.id);
    if (index >= 0) {
      list[index] = message;
    } else {
      // The desktop's echo replaces the copy shown while sending.
      final sent = message.fromUser
          ? list.indexWhere(
              (m) =>
                  m.sending &&
                  m.text == message.text &&
                  m.attachments.length == message.attachments.length,
            )
          : -1;
      if (sent >= 0) {
        list[sent] = message;
      } else {
        list.add(message);
      }
    }
    if (message.memberId != null) _clearDraft(message.memberId!);
    _change();
  }

  void _clearDraft(String memberId) {
    _draftExpiry.remove(memberId)?.cancel();
    _pending.remove(memberId);
    final draft = _drafts[memberId];
    if (draft != null && draft.value.isNotEmpty && !_disposed) {
      draft.value = '';
    }
  }

  void _queueDraft(String memberId, String delta, bool restart) {
    final queued = _pending[memberId];
    if (restart || queued == null) {
      _pending[memberId] = (restart: restart, text: StringBuffer(delta));
    } else {
      queued.text.write(delta);
    }
    if (!state(memberId).busy) {
      // The state event was missed (for example across a reconnect).
      _states[memberId] = GroupMemberState.working;
      _change();
    }
    if (_flushScheduled) return;
    _flushScheduled = true;
    SchedulerBinding.instance.scheduleFrameCallback((_) => _flushDrafts());
  }

  void _flushDrafts() {
    _flushScheduled = false;
    if (_disposed) return;
    final queued = Map.of(_pending);
    _pending.clear();
    for (final entry in queued.entries) {
      final draft = _draft(entry.key);
      draft.value = entry.value.restart
          ? entry.value.text.toString()
          : '${draft.value}${entry.value.text}';
    }
  }

  /// Sends [text] and any [files] to the group. The message shows at once
  /// with its files; they upload in pieces, and the desktop's echo confirms it.
  Future<bool> send(
    Group group,
    String text, {
    List<({String name, String mimeType, Uint8List bytes})> files = const [],
  }) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty && files.isEmpty) return false;
    final id = 'local-${++_local}';
    final attachments = [
      for (final (index, file) in files.indexed)
        GroupAttachment(
          key: '$id-$index',
          name: file.name,
          mimeType: file.mimeType,
          sizeBytes: file.bytes.length,
        ),
    ];
    for (final (index, file) in files.indexed) {
      _remember(attachments[index].key, file.bytes);
    }
    final local = GroupMessage(
      id: id,
      text: trimmed,
      sending: true,
      attachments: attachments,
    );
    _messages.putIfAbsent(group.threadId, () => []).add(local);
    if (files.isNotEmpty) _progress[id] = ValueNotifier(0);
    error = null;
    _change();
    try {
      final references = <RemoteJson>[];
      final total = files.fold<int>(0, (sum, file) => sum + file.bytes.length);
      var sent = 0;
      for (final (index, file) in files.indexed) {
        final reference = await _upload(group, id, index, file, (bytes) {
          _progress[id]?.value = total == 0 ? 1 : (sent + bytes) / total;
        });
        sent += file.bytes.length;
        if (reference['id'] case final String stored) {
          _remember(stored, file.bytes);
        }
        references.add(reference);
      }
      await link.request('djl/groups/send', {
        'groupId': group.id,
        'text': trimmed,
        if (references.isNotEmpty) 'attachments': references,
      });
      return true;
    } catch (failure) {
      _messages[group.threadId]?.removeWhere((m) => m.id == local.id);
      error = _message(failure);
      _change();
      return false;
    } finally {
      _progress.remove(id)?.dispose();
    }
  }

  Future<RemoteJson> _upload(
    Group group,
    String messageId,
    int index,
    ({String name, String mimeType, Uint8List bytes}) file,
    void Function(int bytes) onProgress,
  ) async {
    final uploadId =
        '${messageId}_${index}_${DateTime.now().microsecondsSinceEpoch}';
    var offset = 0;
    while (true) {
      final end = (offset + _chunkBytes).clamp(0, file.bytes.length);
      final last = end >= file.bytes.length;
      final result = await link.request('djl/groups/upload', {
        'groupId': group.id,
        'uploadId': uploadId,
        'name': file.name,
        'mimeType': groupUploadMimeType(file.name, file.mimeType),
        'sizeBytes': file.bytes.length,
        'offset': offset,
        'data': base64Encode(Uint8List.sublistView(file.bytes, offset, end)),
        'final': last,
      });
      offset = end;
      onProgress(offset);
      if (last) {
        final reference = result['attachment'];
        if (reference is! Map) {
          throw StateError(appStrings.groupsMacDidNotKeepFile);
        }
        return Map<String, dynamic>.from(reference);
      }
    }
  }

  void _remember(String key, Uint8List bytes) {
    final previous = _bytes.remove(key);
    if (previous != null) _cachedBytes -= previous.length;
    _bytes[key] = bytes;
    _cachedBytes += bytes.length;
    while (_cachedBytes > _cacheLimit && _bytes.length > 1) {
      final oldest = _bytes.keys.first;
      _cachedBytes -= _bytes.remove(oldest)!.length;
    }
  }

  /// The attachment's bytes, from this session or downloaded from the Mac.
  Future<Uint8List> attachmentBytes(GroupAttachment attachment) async {
    final known = _bytes[attachment.key] ?? _bytes[attachment.id];
    if (known != null) return known;
    final id = attachment.id;
    if (id == null) throw StateError(appStrings.groupsFileStillSending);
    final builder = BytesBuilder(copy: false);
    var offset = 0;
    while (true) {
      final page = await link.request('djl/groups/attachment', {
        'attachmentId': id,
        'offset': offset,
      });
      final data = base64Decode(page['data'] as String? ?? '');
      builder.add(data);
      offset += data.length;
      if (page['done'] == true || data.isEmpty) break;
    }
    final bytes = builder.takeBytes();
    _remember(id, bytes);
    return bytes;
  }

  Future<void> stop(Group group) =>
      _act('djl/groups/stop', {'groupId': group.id});

  Future<void> stopMember(Group group, String memberId) => _act(
    'djl/groups/stopMember',
    {'groupId': group.id, 'memberId': memberId},
  );

  /// Lets a paused round carry on, or ends it.
  Future<void> resolvePause(Group group, {required bool carryOn}) =>
      _act('djl/groups/resolvePause', {
        'groupId': group.id,
        'action': carryOn ? 'continue' : 'stop',
        'continueText': 'Continue',
      });

  Future<void> skipAllWarning(Group group) => _act(
    'djl/groups/setSkipAllWarning',
    {'groupId': group.id, 'skipAllWarning': true},
  );

  Future<void> _act(String method, RemoteJson params) async {
    try {
      await link.request(method, params);
      error = null;
    } catch (failure) {
      error = _message(failure);
    }
    _change();
  }

  Future<List<GroupAgent>> agents() async {
    final result = await link.request('djl/groups/agents', {});
    return [
      for (final agent in result['agents'] as List? ?? const [])
        GroupAgent.fromJson(Map<String, dynamic>.from(agent as Map)),
    ];
  }

  Future<Group> create(String name, List<String> providers) async {
    final result = await link.request('djl/groups/create', {
      'name': name,
      'members': [
        for (final provider in providers) {'provider': provider},
      ],
    });
    final created = Group.fromJson(result);
    _setGroups([
      created,
      for (final group in groups)
        if (group.id != created.id) group,
    ]);
    _change();
    return created;
  }

  // The bridge's own errors are plain sentences; its backend timeout is not.
  String _message(Object failure) =>
      failure is RemoteRpcException && !failure.message.contains('timed out')
      ? failure.message
      : failure is TimeoutException || failure is RemoteRpcException
      ? appStrings.groupsMacTimeout
      : appStrings.groupsMacNotConnected;

  @override
  void dispose() {
    _disposed = true;
    unawaited(_subscription.cancel());
    link.removeListener(_linkChanged);
    link.groupThreads.clear();
    for (final timer in _draftExpiry.values) {
      timer.cancel();
    }
    for (final draft in _drafts.values) {
      draft.dispose();
    }
    for (final progress in _progress.values) {
      progress.dispose();
    }
    _progress.clear();
    super.dispose();
  }
}
