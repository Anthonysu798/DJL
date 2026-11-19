import 'dart:convert';
import 'package:crypto/crypto.dart';

class DesktopLinkTarget {
  const DesktopLinkTarget(
    this.thread, {
    this.turn,
    this.item,
    this.message,
    this.request,
    this.macId,
    this.macKeySha256,
  });
  final String thread;
  final String? turn, item, message;
  // Internal review focus only; external URL parsing never grants RPC identity.
  final Object? request;
  final String? macId, macKeySha256;
  bool get qualified => macId != null || macKeySha256 != null;
  bool matchesHost(String mac, String publicKey) =>
      !qualified || macId == mac && macKeySha256 == keyFingerprint(publicKey);
  static String? keyFingerprint(String publicKey) {
    try {
      final bytes = base64Decode(publicKey);
      return bytes.length == 32 ? sha256.convert(bytes).toString() : null;
    } on FormatException {
      return null;
    }
  }

  static Uri? statusUri(String thread, String mac, String fingerprint) {
    if (_id(thread) == null ||
        _id(mac) == null ||
        !RegExp(r'^[0-9a-f]{64}$').hasMatch(fingerprint)) {
      return null;
    }
    return Uri(
      scheme: 'djl',
      host: 'thread',
      pathSegments: [thread],
      queryParameters: {'macId': mac, 'macKeySha256': fingerprint},
    );
  }

  bool get hasFocus =>
      turn != null || item != null || message != null || request != null;
  static String? _id(String? value) {
    final trimmed = value?.trim();
    if (trimmed == null ||
        trimmed.isEmpty ||
        RegExp(r'[/\\\x00-\x1f\x7f?#]').hasMatch(trimmed)) {
      return null;
    }
    return trimmed;
  }

  static DesktopLinkTarget? parse(Uri uri) {
    if (uri.scheme.toLowerCase() != 'djl' ||
        uri.userInfo.isNotEmpty ||
        uri.hasPort ||
        uri.hasFragment) {
      return null;
    }
    final parts = uri.pathSegments.toList();
    if (parts.isNotEmpty && parts.last.isEmpty) parts.removeLast();
    final host = uri.host.toLowerCase();
    if (host.isEmpty) {
      if (parts.isEmpty ||
          !{'thread', 'threads'}.contains(parts.removeAt(0).toLowerCase())) {
        return null;
      }
    } else if (!{'thread', 'threads'}.contains(host)) {
      return null;
    }
    if (parts.length > 1) return null;
    String? query(Set<String> aliases) {
      for (final field in uri.query.split('&')) {
        final separator = field.indexOf('=');
        final key = Uri.decodeQueryComponent(
          separator < 0 ? field : field.substring(0, separator),
        ).toLowerCase();
        if (aliases.contains(key)) {
          return separator < 0
              ? null
              : Uri.decodeQueryComponent(field.substring(separator + 1));
        }
      }
      return null;
    }

    try {
      final bindings = <String, List<String>>{};
      for (final field in uri.query.split('&')) {
        final separator = field.indexOf('=');
        final key = Uri.decodeQueryComponent(
          separator < 0 ? field : field.substring(0, separator),
        ).toLowerCase();
        if (key == 'macid' || key == 'mackeysha256') {
          bindings
              .putIfAbsent(key, () => [])
              .add(
                separator < 0
                    ? ''
                    : Uri.decodeQueryComponent(field.substring(separator + 1)),
              );
        }
      }
      String? mac, fingerprint;
      if (bindings.isNotEmpty) {
        if (bindings['macid']?.length != 1 ||
            bindings['mackeysha256']?.length != 1) {
          return null;
        }
        mac = _id(bindings['macid']!.single);
        fingerprint = bindings['mackeysha256']!.single;
        if (mac == null || !RegExp(r'^[0-9a-f]{64}$').hasMatch(fingerprint)) {
          return null;
        }
      }
      final thread = _id(
        parts.isEmpty ? query({'threadid', 'thread'}) : parts.single,
      );
      if (thread == null) return null;
      final turn = query({'turnid', 'turn'}),
          item = query({'itemid', 'item'}),
          message = query({'messageid', 'message'});
      if ([turn, item, message].any(
        (value) =>
            value != null && value.trim().isNotEmpty && _id(value) == null,
      )) {
        return null;
      }
      return DesktopLinkTarget(
        thread,
        turn: _id(turn),
        item: _id(item),
        message: _id(message),
        macId: mac,
        macKeySha256: fingerprint,
      );
    } on FormatException {
      return null;
    }
  }

  int? focusIndex(List<Map<String, dynamic>> rows) {
    if (message != null) {
      final index = rows.indexWhere((row) => row['id'] == message);
      if (index >= 0) return index;
    }
    if (item != null) {
      final index = rows.lastIndexWhere(
        (row) =>
            row['itemId'] == item ||
            row['sourceItemKey'] == item ||
            row['sourceItemId'] == item ||
            row['id'] == item,
      );
      if (index >= 0) return index;
    }
    if (turn != null) {
      final index = rows.lastIndexWhere((row) => row['turnId'] == turn);
      if (index >= 0) return index;
    }
    return null;
  }

  @override
  bool operator ==(Object other) =>
      other is DesktopLinkTarget &&
      thread == other.thread &&
      turn == other.turn &&
      item == other.item &&
      message == other.message &&
      request == other.request &&
      macId == other.macId &&
      macKeySha256 == other.macKeySha256;
  @override
  int get hashCode =>
      Object.hash(thread, turn, item, message, request, macId, macKeySha256);
}
