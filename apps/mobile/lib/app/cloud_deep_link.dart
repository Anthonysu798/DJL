/// Matches CloudDeepLink in the Swift reference. A link selects a conversation;
/// it never carries authentication or authorizes sending a message.
String? cloudConversationId(Uri uri) {
  if (uri.scheme.toLowerCase() != 'djl' ||
      uri.host.toLowerCase() != 'cloud' ||
      uri.userInfo.isNotEmpty ||
      uri.hasPort) {
    return null;
  }
  final parts = uri.pathSegments;
  if (parts.length != 2 || parts.first != 'c') return null;
  final id = parts.last;
  return id.trim().isEmpty || id.contains('/') ? null : id;
}
