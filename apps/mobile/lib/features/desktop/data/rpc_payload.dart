import 'dart:convert';
import '../../pairing/data/pairing_repository.dart';

class RpcPayload {
  const RpcPayload(this.messages, this.malformed);
  final List<RemoteJson> messages;
  final bool malformed;
}

RpcPayload decodeRpcPayload(String text) {
  Object? decoded;
  try {
    decoded = jsonDecode(text);
  } catch (_) {
    return const RpcPayload([], true);
  }
  final entries = decoded is List ? decoded : [decoded];
  final messages = <RemoteJson>[];
  var malformed = false;
  for (final entry in entries) {
    if (entry is! Map) {
      malformed = true;
      continue;
    }
    final message = Map<String, dynamic>.from(entry);
    final method = message['method'], error = message['error'];
    if (method != null && method is! String) {
      malformed = true;
      continue;
    }
    if (error != null &&
        (error is! Map ||
            error['code'] is! num ||
            error['message'] is! String)) {
      malformed = true;
      continue;
    }
    messages.add(message);
  }
  return RpcPayload(messages, malformed || messages.isEmpty);
}
