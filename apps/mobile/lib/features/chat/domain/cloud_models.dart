import '../../../l10n/l10n.dart';

typedef Json = Map<String, dynamic>;

class Conversation {
  const Conversation({
    required this.id,
    this.title,
    this.pinned = false,
    this.archived = false,
  });
  final String id;
  final String? title;
  final bool pinned, archived;
  String get displayTitle =>
      title?.isNotEmpty == true ? title! : appStrings.cloudChatNewChat;
  factory Conversation.fromJson(Json json) => Conversation(
    id: json['id'] as String,
    title: json['title'] as String?,
    pinned: json['pinned'] as bool? ?? false,
    archived: json['archived'] as bool? ?? false,
  );
}

class ChatMessage {
  ChatMessage({
    required this.id,
    required this.role,
    required this.parts,
    this.parentId,
    this.runId,
    this.model,
  });
  final String id, role;
  final String? parentId, runId, model;
  final List<Json> parts;
  String get text => parts
      .where((p) => p['type'] == 'text')
      .map((p) => p['text'] as String)
      .join();
  factory ChatMessage.fromJson(Json json) => ChatMessage(
    id: json['id'] as String,
    role: json['role'] as String,
    parts: (json['parts'] as List)
        .map((p) => Map<String, dynamic>.from(p as Map))
        .toList(),
    parentId: json['parentId'] as String?,
    runId: json['runId'] as String?,
    model: json['model'] as String?,
  );
}

class ConversationDetail {
  const ConversationDetail(this.conversation, this.messages);
  final Conversation conversation;
  final List<ChatMessage> messages;
  factory ConversationDetail.fromJson(Json json) => ConversationDetail(
    Conversation.fromJson(json['conversation'] as Json),
    (json['messages'] as List)
        .map((m) => ChatMessage.fromJson(m as Json))
        .toList(),
  );
}

class SendInput {
  const SendInput({
    required this.clientMessageId,
    required this.parentId,
    required this.parts,
    required this.model,
    required this.mode,
  });
  final String clientMessageId, model, mode;
  final String? parentId;
  final List<Json> parts;
  Json toJson() => {
    'clientMessageId': clientMessageId,
    'parentId': parentId,
    'parts': parts,
    'model': model,
    'mode': mode,
  };
}

class EventGap implements Exception {
  const EventGap(this.expected, this.received);
  final int expected, received;
}

class RunReducer {
  RunReducer({required this.runId, required this.messages, this.lastSeq = 0});
  final String runId;
  final List<ChatMessage> messages;
  int lastSeq;
  String status = 'running';
  Json? error, usage;
  final List<Json> steps = [];
  bool get terminal => {'succeeded', 'failed', 'cancelled'}.contains(status);
  bool apply(Json event) {
    if (event['runId'] != runId) return false;
    final seq = event['seq'] as int;
    if (seq <= lastSeq) return false;
    if (seq != lastSeq + 1) throw EventGap(lastSeq + 1, seq);
    final payload = event['payload'] as Json;
    switch (event['type']) {
      case 'text.delta':
        final message = messages
            .where((m) => m.id == payload['messageId'])
            .firstOrNull;
        if (message == null) {
          throw const FormatException('Run event references a missing message');
        }
        final parts = message.parts;
        if (parts.isNotEmpty && parts.last['type'] == 'text') {
          parts.last['text'] = '${parts.last['text']}${payload['text']}';
        } else {
          parts.add({'type': 'text', 'text': payload['text']});
        }
      case 'message.part':
        final message = messages
            .where((m) => m.id == payload['messageId'])
            .firstOrNull;
        if (message == null) {
          throw const FormatException('Run event references a missing message');
        }
        message.parts.add(Map<String, dynamic>.from(payload['part'] as Map));
      case 'step.started':
        if (!steps.any((s) => s['step'] == payload['step'])) steps.add(payload);
      case 'usage':
        usage = payload;
      case 'status':
        status = payload['status'] as String;
        error = payload['error'] as Json?;
      default:
        throw FormatException('Unknown run event ${event['type']}');
    }
    lastSeq = seq;
    return true;
  }
}

List<ChatMessage> visibleBranch(
  List<ChatMessage> messages,
  Map<String, String> selections,
) {
  final branch = <ChatMessage>[];
  final visited = <String>{};
  String? parent;
  while (true) {
    final siblings = messages.where((m) => m.parentId == parent).toList();
    if (siblings.isEmpty) return branch;
    final chosen = selections[parent ?? 'root'];
    final message =
        siblings.where((m) => m.id == chosen).firstOrNull ?? siblings.last;
    if (!visited.add(message.id)) return branch;
    branch.add(message);
    parent = message.id;
  }
}
