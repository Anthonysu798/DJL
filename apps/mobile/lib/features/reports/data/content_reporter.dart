import 'package:flutter/widgets.dart';

import '../../../core/network/cloud_client.dart';

/// Why someone reports an AI answer. Values match DJL Cloud's `reason`.
enum ReportReason {
  offensive('Offensive or hateful'),
  harmful('Harmful or dangerous'),
  wrong('Wrong or misleading'),
  other('Something else');

  const ReportReason(this.label);
  final String label;
}

/// Sends reports of AI answers to DJL Cloud (`POST v1/reports`).
class ContentReporter {
  ContentReporter(this.client);
  final CloudClient client;

  /// An answer from DJL Cloud chat. Needs a signed-in account.
  Future<void> reportCloud({
    required String conversationId,
    required String messageId,
    required ReportReason reason,
    String? note,
  }) => client.request(
    'POST',
    'v1/reports',
    body: {
      'source': 'cloud',
      'reason': reason.name,
      'conversationId': conversationId,
      'messageId': messageId,
      ..._note(note),
    },
  );

  /// An answer from an agent on the paired Mac. Works without an account.
  Future<void> reportDesktop({
    required String text,
    String? agent,
    required ReportReason reason,
    String? note,
  }) async {
    final trimmedAgent = agent?.trim();
    await client.request(
      'POST',
      'v1/reports',
      authenticated: await client.signedIn,
      body: {
        'source': 'desktop',
        'reason': reason.name,
        'text': text.length > 20000 ? text.substring(0, 20000) : text,
        if (trimmedAgent != null && trimmedAgent.isNotEmpty)
          'agent': trimmedAgent.length > 80
              ? trimmedAgent.substring(0, 80)
              : trimmedAgent,
        ..._note(note),
      },
    );
  }

  static Map<String, String> _note(String? note) {
    final value = note?.trim() ?? '';
    if (value.isEmpty) return const {};
    return {'note': value.length > 1000 ? value.substring(0, 1000) : value};
  }
}

/// Makes the reporter available to every screen; absent in isolated tests,
/// where report buttons stay hidden.
class ContentReportScope extends InheritedWidget {
  const ContentReportScope({
    super.key,
    required this.reporter,
    required super.child,
  });
  final ContentReporter reporter;

  static ContentReporter? maybeOf(BuildContext context) => context
      .dependOnInheritedWidgetOfExactType<ContentReportScope>()
      ?.reporter;

  @override
  bool updateShouldNotify(ContentReportScope oldWidget) =>
      reporter != oldWidget.reporter;
}
