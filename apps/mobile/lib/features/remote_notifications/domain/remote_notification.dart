import '../../../app/desktop_deep_link.dart';

/// Only identifiers cross the notification boundary. No notification content.
class RemoteNotificationTap {
  const RemoteNotificationTap(
    this.eventId,
    this.receivedAt, {
    this.cloudUri,
    this.desktop,
  });
  final String eventId;
  final DateTime receivedAt;
  final Uri? cloudUri;
  final DesktopLinkTarget? desktop;
  static bool validId(Object? value) =>
      value is String &&
      value.isNotEmpty &&
      value.length <= 512 &&
      value.trim() == value &&
      !RegExp(r'[/\\\x00-\x20\x7f?#]').hasMatch(value);

  static RemoteNotificationTap? parse(Object? raw, {DateTime? now}) {
    if (raw is! Map || !validId(raw['eventId']) || raw['receivedAt'] is! num) {
      return null;
    }
    final stamp = (raw['receivedAt'] as num).toDouble();
    if (!stamp.isFinite || stamp < 0 || stamp > 8640000000000000) return null;
    final received = DateTime.fromMillisecondsSinceEpoch(stamp.toInt());
    final age = (now ?? DateTime.now()).difference(received);
    if (age.isNegative || age > const Duration(seconds: 300)) return null;
    final source = raw['source'];
    if (source == 'djl.cloudRun') {
      if (!validId(raw['conversationId']) ||
          !validId(raw['runId']) ||
          !{'succeeded', 'failed'}.contains(raw['status']) ||
          raw['url'] is! String) {
        return null;
      }
      final id = raw['conversationId'] as String;
      // Match the public producer exactly; ordinary links keep their parser.
      if (raw['url'] != 'djl://cloud/c/${Uri.encodeComponent(id)}') return null;
      return RemoteNotificationTap(
        raw['eventId'] as String,
        received,
        cloudUri: Uri.parse(raw['url'] as String),
      );
    }
    if (source == 'codex.runCompletion' ||
        source == 'codex.structuredUserInput' ||
        source == 'djl.runCompletion') {
      if (source == 'djl.runCompletion' &&
          !{'completed', 'failed'}.contains(raw['result'])) {
        return null;
      }
      final turn = source == 'djl.runCompletion' && raw['turnId'] == ''
          ? null
          : raw['turnId'];
      if (!validId(raw['threadId']) || turn != null && !validId(turn)) {
        return null;
      }
      return RemoteNotificationTap(
        raw['eventId'] as String,
        received,
        desktop: DesktopLinkTarget(
          raw['threadId'] as String,
          turn: turn as String?,
        ),
      );
    }
    return null;
  }
}

class RemotePushState {
  const RemotePushState({
    this.availability = 'unsupported',
    this.permission = 'notDetermined',
    this.environment,
    this.token,
    this.provider = 'apns',
  });
  final String availability, permission, provider;
  final String? environment, token;
  bool get available =>
      availability == 'ready' &&
      {'apns', 'fcm'}.contains(provider) &&
      (provider != 'fcm' || environment == 'production') &&
      {'development', 'production'}.contains(environment);
  bool get alerts =>
      {'authorized', 'provisional', 'ephemeral'}.contains(permission);
  bool get hasToken =>
      token != null &&
      (provider == 'fcm'
          ? token!.isNotEmpty &&
                token!.length <= 200 &&
                !RegExp(r'[\s\x00-\x1f\x7f]').hasMatch(token!)
          : provider == 'apns' &&
                RegExp(r'^[0-9a-fA-F]{32,200}$').hasMatch(token!));
  String get cloudEnvironment =>
      environment == 'development' ? 'sandbox' : 'production';
  factory RemotePushState.from(Object? raw) {
    if (raw is! Map) return const RemotePushState();
    const availability = {
      'ready',
      'disabled',
      'simulator',
      'unconfigured',
      'failed',
      'unsupported',
    };
    const permission = {
      'authorized',
      'provisional',
      'ephemeral',
      'denied',
      'notDetermined',
    };
    return RemotePushState(
      provider: raw['provider'] == null
          ? 'apns'
          : raw['provider'] is String
          ? raw['provider'] as String
          : 'invalid',
      availability: availability.contains(raw['availability'])
          ? raw['availability'] as String
          : 'failed',
      permission: permission.contains(raw['permission'])
          ? raw['permission'] as String
          : 'denied',
      environment: raw['environment'] is String
          ? raw['environment'] as String
          : null,
      token: raw['token'] is String ? raw['token'] as String : null,
    );
  }
}
