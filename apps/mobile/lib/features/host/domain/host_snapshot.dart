import '../../pairing/data/pairing_repository.dart';

String? _text(Object? value) =>
    value is String && value.trim().isNotEmpty ? value.trim() : null;

enum HostPlatform { macos, windows, linux, unknown }

class HostCapabilities {
  const HostCapabilities({
    this.desktopHandoff = false,
    this.displayWake = false,
    this.keepAwake = false,
    this.hostBrowserLogin = false,
    this.terminal = true,
    this.bridgeUpdate = false,
  });
  final bool desktopHandoff,
      displayWake,
      keepAwake,
      hostBrowserLogin,
      terminal,
      bridgeUpdate;

  factory HostCapabilities.decode(Map raw) {
    bool flag(String camel, String snake, {bool fallback = false}) =>
        (raw.containsKey(camel) ? raw[camel] : raw[snake]) is bool
        ? (raw.containsKey(camel) ? raw[camel] : raw[snake]) as bool
        : fallback;
    return HostCapabilities(
      desktopHandoff: flag('desktopHandoff', 'desktop_handoff'),
      displayWake: flag('displayWake', 'display_wake'),
      keepAwake: flag('keepAwake', 'keep_awake'),
      hostBrowserLogin: flag('hostBrowserLogin', 'host_browser_login'),
      terminal: flag('terminal', 'terminal', fallback: true),
      bridgeUpdate: flag('bridgeUpdate', 'bridge_update'),
    );
  }
  RemoteJson toJson() => {
    'desktopHandoff': desktopHandoff,
    'displayWake': displayWake,
    'keepAwake': keepAwake,
    'hostBrowserLogin': hostBrowserLogin,
    'terminal': terminal,
    'bridgeUpdate': bridgeUpdate,
  };
}

/// An in-memory allowlist. Raw account responses are never retained or persisted.
class HostSnapshot {
  HostSnapshot._(this._safe, this.advertised);
  final RemoteJson _safe;
  final HostCapabilities? advertised;
  factory HostSnapshot.decode(RemoteJson payload) {
    final safe = <String, dynamic>{};
    for (final key in const [
      'status',
      'authMethod',
      'email',
      'planType',
      'expiresAt',
      'bridgeVersion',
      'bridgeLatestVersion',
      'codexTransportMode',
      'hostPlatform',
    ]) {
      final value = _text(payload[key]);
      if (value != null) safe[key] = value;
    }
    // Some older hosts use epoch milliseconds for expiry.
    if (payload['expiresAt'] is num) safe['expiresAt'] = payload['expiresAt'];
    for (final key in const ['loginInFlight', 'needsReauth', 'tokenReady']) {
      if (payload[key] is bool) safe[key] = payload[key];
    }
    final raw = payload['hostCapabilities'] ?? payload['host_capabilities'];
    final caps = raw is Map ? HostCapabilities.decode(raw) : null;
    if (caps != null) safe['hostCapabilities'] = caps.toJson();
    return HostSnapshot._(safe, caps);
  }
  RemoteJson toJson() => {
    ..._safe,
    if (advertised != null) 'hostCapabilities': advertised!.toJson(),
  };
  String get status => _safe['status'] as String? ?? 'unknown';
  String? get authMethod => _safe['authMethod'] as String?;
  String? get email => _safe['email'] as String?;
  String? get planType => _safe['planType'] as String?;
  String? get bridgeVersion => _safe['bridgeVersion'] as String?;
  String? get bridgeLatestVersion => _safe['bridgeLatestVersion'] as String?;
  bool get authenticated => status == 'authenticated';
  bool get tokenReady => _safe['tokenReady'] == true;
  bool get loginInFlight => _safe['loginInFlight'] == true;
  bool get needsReauth => _safe['needsReauth'] == true;
  Object? get expiresAt => _safe['expiresAt'];
  String? get codexTransportMode => _safe['codexTransportMode'] as String?;
  bool get voiceReady =>
      tokenReady &&
      authenticated &&
      {
        'chatgpt',
        'chatgptauthtokens',
      }.contains(authMethod?.toLowerCase().replaceAll(RegExp('[^a-z0-9]'), ''));
  HostPlatform get platform => switch (_safe['hostPlatform']) {
    'macos' || 'darwin' => HostPlatform.macos,
    'windows' || 'win32' => HostPlatform.windows,
    'linux' => HostPlatform.linux,
    _ => HostPlatform.unknown,
  };
  HostCapabilities capabilities({required bool trusted}) =>
      advertised ??
      (trusted && platform == HostPlatform.macos
          ? const HostCapabilities(
              desktopHandoff: true,
              displayWake: true,
              keepAwake: true,
              hostBrowserLogin: true,
            )
          : const HostCapabilities());
}
