import '../../chat/domain/cloud_models.dart';

class CloudNotification {
  const CloudNotification({
    required this.id,
    required this.conversationId,
    required this.status,
    required this.finishedAt,
    this.title,
    this.readAt,
  });
  final String id, conversationId, status;
  final String? title;
  final DateTime finishedAt;
  final DateTime? readAt;
  bool get unread => readAt == null;
  CloudNotification read() => CloudNotification(
    id: id,
    conversationId: conversationId,
    status: status,
    finishedAt: finishedAt,
    title: title,
    readAt: DateTime.now(),
  );
  factory CloudNotification.fromJson(Json json) => CloudNotification(
    id: json['id'] as String,
    conversationId: json['conversationId'] as String,
    title: json['conversationTitle'] as String?,
    status: json['status'] as String,
    finishedAt: DateTime.parse(json['finishedAt'] as String),
    readAt: DateTime.tryParse(json['readAt'] as String? ?? ''),
  );
}
