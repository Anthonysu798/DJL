import '../../pairing/data/pairing_repository.dart';

class LoginIdentity {
  const LoginIdentity(this.device, this.pin);
  final String device, pin;
  @override
  bool operator ==(Object other) =>
      other is LoginIdentity && other.device == device && other.pin == pin;
  @override
  int get hashCode => Object.hash(device, pin);
}

DateTime? loginDate(Object? value) {
  if (value is num && value.isFinite) {
    return DateTime.fromMillisecondsSinceEpoch(
      (value.abs() < 100000000000 ? value * 1000 : value).toInt(),
      isUtc: true,
    );
  }
  return value is String ? DateTime.tryParse(value)?.toUtc() : null;
}

Uri safeLoginUrl(String value, {bool allowLocal = false}) {
  final uri = Uri.tryParse(value);
  final local =
      uri != null && {'localhost', '127.0.0.1', '::1'}.contains(uri.host);
  if (uri == null ||
      !uri.hasAuthority ||
      uri.host.isEmpty ||
      uri.userInfo.isNotEmpty ||
      (uri.scheme != 'https' &&
          !(allowLocal && local && uri.scheme == 'http'))) {
    throw const FormatException('The host returned an unsafe sign-in address.');
  }
  return uri;
}

class PendingLogin {
  const PendingLogin(
    this.loginId,
    this.authUrl,
    this.createdAt,
    this.expiresAt,
  );
  final String loginId, authUrl;
  final DateTime createdAt;
  final DateTime? expiresAt;
  bool expired(DateTime now) => expiresAt != null && !expiresAt!.isAfter(now);
  factory PendingLogin.decode(
    RemoteJson raw, {
    required DateTime now,
    bool allowLocal = false,
  }) {
    final id = raw['loginId'] ?? raw['login_id'],
        address = raw['authUrl'] ?? raw['auth_url'];
    if (raw['type'] != 'chatgpt' ||
        id is! String ||
        id.trim().isEmpty ||
        address is! String) {
      throw const FormatException(
        'The host did not return a ChatGPT sign-in flow.',
      );
    }
    final url = safeLoginUrl(address, allowLocal: allowLocal);
    return PendingLogin(
      id,
      url.toString(),
      now,
      loginDate(raw['expiresAt'] ?? raw['expires_at']),
    );
  }
  RemoteJson toJson() => {
    'type': 'chatgpt',
    'loginId': loginId,
    'authUrl': authUrl,
    'createdAt': createdAt.toIso8601String(),
    if (expiresAt != null) 'expiresAt': expiresAt!.toIso8601String(),
  };
}

class LoginCallback {
  const LoginCallback(this.loginId, this.url, this.receivedAt);
  final String loginId, url;
  final DateTime receivedAt;
  bool expired(DateTime now) =>
      !receivedAt.add(const Duration(minutes: 10)).isAfter(now);
  RemoteJson toJson() => {
    'loginId': loginId,
    'callbackUrl': url,
    'createdAt': receivedAt.toIso8601String(),
  };
}

class LoginRecord {
  const LoginRecord({
    this.pending,
    this.callback,
    this.uncertainStart = false,
    this.remoteUnconfirmed = false,
    this.callbackAttempted = false,
  });
  final PendingLogin? pending;
  final LoginCallback? callback;
  final bool uncertainStart, remoteUnconfirmed, callbackAttempted;
  RemoteJson toJson() => {
    if (pending != null) 'pending': pending!.toJson(),
    if (callback != null) 'callback': callback!.toJson(),
    'uncertainStart': uncertainStart,
    'remoteUnconfirmed': remoteUnconfirmed,
    'callbackAttempted': callbackAttempted,
  };
}
