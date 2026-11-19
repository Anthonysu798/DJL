import 'dart:convert';
import 'dart:math';
import 'package:cryptography/cryptography.dart';
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';
import '../../../core/security/credential_store.dart';
import '../../../core/security/remote_crypto.dart';

typedef RemoteJson = Map<String, dynamic>;

class RemoteRelayUnavailable implements Exception {
  const RemoteRelayUnavailable(this.message);
  final String message;
  @override
  String toString() => message;
}

String normalizePairingCode(String value) {
  final code = value.toUpperCase().replaceAll(RegExp(r'[\s-]'), '');
  if (!RegExp(r'^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$').hasMatch(code)) {
    throw const FormatException(
      'Enter the ten-character code shown in desktop Remote settings.',
    );
  }
  return code;
}

Uri validateRelay(String value, {bool allowLocal = false}) {
  final uri = Uri.parse(value);
  final local = {
    'localhost',
    '127.0.0.1',
    '10.0.2.2',
    '::1',
  }.contains(uri.host);
  if ((uri.scheme != 'wss' && !(allowLocal && local && uri.scheme == 'ws')) ||
      uri.host.isEmpty ||
      uri.userInfo.isNotEmpty ||
      uri.hasQuery ||
      uri.hasFragment) {
    throw const FormatException('Pairing requires a secure relay URL.');
  }
  return uri;
}

class Pairing {
  const Pairing(this.data);
  final RemoteJson data;
  String get sessionId => data['sessionId'] as String;
  String get macDeviceId => data['macDeviceId'] as String;
  String get publicKey => data['macIdentityPublicKey'] as String;
  Uri get relay => Uri.parse(data['relay'] as String);
  String get displayName => data['displayName'] as String? ?? 'Paired Mac';
  factory Pairing.parse(
    String text, {
    bool allowLocal = false,
    bool checkExpiry = true,
  }) {
    try {
      var raw = text.trim();
      if (raw.startsWith('RMX1:')) {
        raw = utf8.decode(
          base64Url.decode(base64Url.normalize(raw.substring(5))),
        );
      }
      RemoteJson value;
      try {
        value = jsonDecode(raw) as RemoteJson;
      } catch (_) {
        throw const FormatException(
          'This is not a DJL pairing QR or pasteable code.',
        );
      }
      if (value['v'] != 2) {
        throw const FormatException(
          'Update DJL on your desktop: this pairing uses a different protocol.',
        );
      }
      for (final key in ['sessionId', 'macDeviceId']) {
        final id = value[key];
        if (id is! String ||
            id.isEmpty ||
            id.length > 256 ||
            id.contains('/') ||
            id.contains('..')) {
          throw const FormatException('Invalid device/session identifier.');
        }
      }
      validateRelay(value['relay'] as String, allowLocal: allowLocal);
      if (base64Decode(value['macIdentityPublicKey'] as String).length != 32) {
        throw const FormatException('Invalid desktop identity key.');
      }
      final expires = value['expiresAt'];
      if (expires is! int ||
          (checkExpiry &&
              expires < DateTime.now().millisecondsSinceEpoch - 60000)) {
        throw const FormatException(
          'This pairing code has expired. Generate a new code on your Mac.',
        );
      }
      return Pairing(value);
    } on FormatException {
      rethrow;
    } catch (_) {
      throw const FormatException(
        'This is not a DJL pairing QR or pasteable code.',
      );
    }
  }
}

List<Uri> resolveCandidates(
  Uri relay,
  String route, {
  bool preservePath = false,
}) {
  final uri = relay.replace(
    scheme: relay.scheme == 'wss'
        ? 'https'
        : relay.scheme == 'ws'
        ? 'http'
        : relay.scheme,
    query: null,
    fragment: null,
  );
  final path = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  final paths = <String>[
    if (preservePath && path.isNotEmpty)
      '/${[...path, 'v1', ...route.split('/')].join('/')}',
    '/${[...path.take(path.lastOrNull == 'relay' ? path.length - 1 : path.length), 'v1', ...route.split('/')].join('/')}',
    '/v1/$route',
  ];
  return paths.toSet().map((p) => uri.replace(path: p)).toList();
}

List<int> secureRandomBytes(int length) {
  final random = Random.secure();
  return List.generate(length, (_) => random.nextInt(256));
}

class PhoneIdentity {
  const PhoneIdentity(this.deviceId, this.seed, this.publicKey);
  final String deviceId, publicKey;
  final List<int> seed;
  RemoteJson toJson() => {
    'phoneDeviceId': deviceId,
    'seed': base64Encode(seed),
    'publicKey': publicKey,
  };
}

/// Local metadata is never inserted into the authenticated pairing payload.
class TrustedDeviceEntry {
  const TrustedDeviceEntry(
    this.pairing,
    this.trustId, {
    this.nickname = '',
    this.visibleInMenu = true,
    this.lastPairedAt,
    this.lastUsedAt,
  });
  final Pairing pairing;
  final String trustId, nickname;
  final bool visibleInMenu;
  final DateTime? lastPairedAt, lastUsedAt;
  DateTime? get lastActivityAt => lastUsedAt ?? lastPairedAt;
  bool matches(Pairing pair) =>
      pairing.macDeviceId == pair.macDeviceId &&
      pairing.publicKey == pair.publicKey;
  RemoteJson toJson() => {
    'djlTrustedEntry': 1,
    'trustId': trustId,
    'pairing': pairing.data,
    'preferences': {'nickname': nickname, 'visibleInMenu': visibleInMenu},
    if (lastPairedAt != null || lastUsedAt != null)
      'activity': {
        if (lastPairedAt != null)
          'lastPairedAt': lastPairedAt!.millisecondsSinceEpoch,
        if (lastUsedAt != null)
          'lastUsedAt': lastUsedAt!.millisecondsSinceEpoch,
      },
  };
}

DateTime? _activityDate(Object? value) =>
    value is int && value >= -8640000000000000 && value <= 8640000000000000
    ? DateTime.fromMillisecondsSinceEpoch(value, isUtc: true)
    : null;

class PairingRepository {
  PairingRepository(
    this.credentials, {
    http.Client? client,
    this.allowLocal = false,
  }) : _client = client ?? http.Client();
  final CredentialStore credentials;
  final http.Client _client;
  final bool allowLocal;
  Future<PhoneIdentity>? _identity;
  int _identityReadFailureRevision = 0;
  int get identityReadFailureRevision => _identityReadFailureRevision;
  Object? _identityReadFailure;
  bool isIdentityReadFailure(Object error, {required int after}) =>
      identityReadFailureRevision > after &&
      identical(error, _identityReadFailure);
  Future<PhoneIdentity> identity() {
    return _identity ??= _loadIdentity().then(
      (value) => value,
      onError: (Object error, StackTrace stack) {
        _identity = null;
        Error.throwWithStackTrace(error, stack);
      },
    );
  }

  Future<PhoneIdentity> _loadIdentity() async {
    final String? raw;
    try {
      raw = await credentials.read('desktop.identity');
    } catch (error) {
      _identityReadFailureRevision++;
      _identityReadFailure = error;
      rethrow;
    }
    if (raw != null) {
      final saved = jsonDecode(raw) as RemoteJson;
      return PhoneIdentity(
        saved['phoneDeviceId'] as String,
        base64Decode(saved['seed'] as String),
        saved['publicKey'] as String,
      );
    }
    final pair = await Ed25519().newKeyPair();
    final seed = await pair.extractPrivateKeyBytes();
    final identity = PhoneIdentity(
      const Uuid().v4(),
      seed,
      base64Encode((await pair.extractPublicKey()).bytes),
    );
    await credentials.write('desktop.identity', jsonEncode(identity.toJson()));
    return identity;
  }

  // One queue for this repository's trusted-list read/modify/write operations.
  // Cursor and active-key cleanup remain separate, fallible operations.
  Future<void> _trustedQueue = Future.value();
  final _legacyTrustIds = <(String, String), String>{};
  Future<T> _serialTrusted<T>(Future<T> Function() action) {
    final result = _trustedQueue.then((_) => action());
    _trustedQueue = result.then<void>((_) {}, onError: (Object _) {});
    return result;
  }

  Future<List<RemoteJson>> _trustedRows() async {
    final raw = await credentials.read('desktop.trusted');
    if (raw == null) return [];
    return (jsonDecode(raw) as List)
        .map((p) => Map<String, dynamic>.from(p as Map))
        .toList();
  }

  Pairing _rowPairing(RemoteJson row) => Pairing.parse(
    jsonEncode(row.containsKey('djlTrustedEntry') ? row['pairing'] : row),
    allowLocal: allowLocal,
    checkExpiry: false,
  );

  Future<List<TrustedDeviceEntry>> _readTrustedEntries() async {
    final rows = await _trustedRows();
    final entries = <TrustedDeviceEntry>[];
    final identities = <(String, String)>{};
    for (final row in rows) {
      final pair = _rowPairing(row);
      final identity = (pair.macDeviceId, pair.publicKey);
      identities.add(identity);
      if (!row.containsKey('djlTrustedEntry')) {
        entries.add(
          TrustedDeviceEntry(
            pair,
            _legacyTrustIds.putIfAbsent(identity, () => const Uuid().v4()),
          ),
        );
        continue;
      }
      final prefs = row['preferences'];
      if (row['djlTrustedEntry'] != 1 ||
          row['trustId'] is! String ||
          (row['trustId'] as String).isEmpty ||
          prefs is! Map ||
          prefs['nickname'] is! String ||
          prefs['visibleInMenu'] is! bool) {
        throw const FormatException(
          'Saved device preferences are unavailable.',
        );
      }
      final activity = row['activity'];
      entries.add(
        TrustedDeviceEntry(
          pair,
          row['trustId'] as String,
          nickname: prefs['nickname'] as String,
          visibleInMenu: prefs['visibleInMenu'] as bool,
          lastPairedAt: activity is Map
              ? _activityDate(activity['lastPairedAt'])
              : null,
          lastUsedAt: activity is Map
              ? _activityDate(activity['lastUsedAt'])
              : null,
        ),
      );
    }
    _legacyTrustIds.removeWhere(
      (identity, _) => !identities.contains(identity),
    );
    return entries;
  }

  Future<List<TrustedDeviceEntry>> trustedEntries() =>
      _serialTrusted(_readTrustedEntries);

  // Transport can still recover a verified pairing if only local metadata is bad.
  Future<List<Pairing>> trusted() => _serialTrusted(
    () async => (await _trustedRows()).map(_rowPairing).toList(),
  );

  Future<void> _writeTrustedEntries(List<TrustedDeviceEntry> entries) =>
      credentials.write(
        'desktop.trusted',
        jsonEncode(entries.map((e) => e.toJson()).toList()),
      );

  Future<void> updateDevicePreferences(
    TrustedDeviceEntry target, {
    String? nickname,
    bool? visibleInMenu,
  }) => _serialTrusted(() async {
    final entries = await _readTrustedEntries();
    final index = entries.indexWhere(
      (e) => e.matches(target.pairing) && e.trustId == target.trustId,
    );
    if (index < 0) {
      throw StateError(
        'This saved device changed. Close and reopen the editor.',
      );
    }
    final current = entries[index];
    entries[index] = TrustedDeviceEntry(
      current.pairing,
      current.trustId,
      nickname: nickname?.trim() ?? current.nickname,
      visibleInMenu: visibleInMenu ?? current.visibleInMenu,
      lastPairedAt: current.lastPairedAt,
      lastUsedAt: current.lastUsedAt,
    );
    await _writeTrustedEntries(entries);
  });

  bool _activeRecoveryRequired = false;

  Future<void> _recoverActiveWrite() async {
    if (!_activeRecoveryRequired) return;
    // A native write may have persisted before throwing. Recover both owners
    // before allowing another active-pointer write; these keys are not atomic.
    try {
      await _trustedRows();
      await credentials.read('desktop.active');
      _activeRecoveryRequired = false;
    } catch (_) {
      throw const RemoteSecurityException(
        'Could not recover the saved selection. Unlock your device and retry before choosing a Mac.',
      );
    }
  }

  Future<void> selectTrustedActive(
    TrustedDeviceEntry target, {
    required bool Function() isCurrent,
  }) => _serialTrusted(() async {
    await _recoverActiveWrite();
    if (!isCurrent()) return;
    final entries = await _readTrustedEntries();
    if (!entries.any(
      (entry) =>
          entry.matches(target.pairing) && entry.trustId == target.trustId,
    )) {
      throw const RemoteSecurityException(
        'The saved device changed. Choose it again.',
      );
    }
    if (!isCurrent()) return;
    try {
      await credentials.write('desktop.active', target.pairing.macDeviceId);
    } catch (_) {
      _activeRecoveryRequired = true;
      throw const RemoteSecurityException(
        'Could not confirm the selected Mac was saved. Unlock your device and choose a saved Mac to recover.',
      );
    }
  });

  Future<void> clearActive() => _serialTrusted(() async {
    await _recoverActiveWrite();
    await credentials.read('desktop.active');
    try {
      await credentials.write('desktop.active', null);
    } catch (_) {
      _activeRecoveryRequired = true;
      await _recoverActiveWrite();
      rethrow;
    }
  });

  Future<void> trust(
    Pairing pair, {
    bool Function()? isCurrent,
    TrustedDeviceEntry? expected,
  }) => _serialTrusted(() async {
    await _recoverActiveWrite();
    if (isCurrent?.call() == false) return;
    if (expected != null) {
      final entries = await _readTrustedEntries();
      if (!entries.any(
        (entry) => entry.matches(pair) && entry.trustId == expected.trustId,
      )) {
        throw const RemoteSecurityException(
          'The saved device changed. Choose it again.',
        );
      }
    }
    final rows = await _trustedRows();
    if (isCurrent?.call() == false) return;
    final previous = rows.where((row) {
      final saved = _rowPairing(row);
      return saved.macDeviceId == pair.macDeviceId &&
          saved.publicKey == pair.publicKey;
    }).firstOrNull;
    rows.removeWhere((row) => _rowPairing(row).macDeviceId == pair.macDeviceId);
    // Refresh transport metadata even if local preferences cannot be decoded.
    // Preserve that metadata verbatim so recovery does not silently reset it.
    final row = previous?.containsKey('djlTrustedEntry') == true
        ? {...previous!, 'pairing': pair.data}
        : TrustedDeviceEntry(
            pair,
            previous == null
                ? const Uuid().v4()
                : _legacyTrustIds.putIfAbsent((
                    pair.macDeviceId,
                    pair.publicKey,
                  ), () => const Uuid().v4()),
          ).toJson();
    final activity = previous?['activity'];
    final now = DateTime.now().millisecondsSinceEpoch;
    rows.add({
      ...row,
      'activity': {
        if (activity is Map) ...Map<String, dynamic>.from(activity),
        if (previous == null) 'lastPairedAt': now,
        'lastUsedAt': now,
      },
    });
    try {
      await credentials.write('desktop.trusted', jsonEncode(rows));
      _legacyTrustIds.removeWhere(
        (identity, _) => identity.$1 == pair.macDeviceId,
      );
      if (isCurrent?.call() == false) return;
      await credentials.write('desktop.active', pair.macDeviceId);
    } catch (_) {
      _activeRecoveryRequired = true;
      rethrow;
    }
  });

  Future<void> forget(Pairing pair) => _serialTrusted(() async {
    final rows = await _trustedRows();
    bool matches(RemoteJson row) {
      final saved = _rowPairing(row);
      return saved.macDeviceId == pair.macDeviceId &&
          saved.publicKey == pair.publicKey;
    }

    if (!rows.any(matches)) return;
    rows.removeWhere(matches);
    await credentials.write('desktop.trusted', jsonEncode(rows));
    _legacyTrustIds.remove((pair.macDeviceId, pair.publicKey));
    await credentials.write('desktop.cursor.${pair.macDeviceId}', null);
    if (await credentials.read('desktop.active') == pair.macDeviceId) {
      await credentials.write('desktop.active', null);
    }
  });

  Future<Pairing> resolveCode(String rawCode, String relayText) async {
    final code = normalizePairingCode(rawCode);
    var uri = Uri.parse(relayText.trim());
    if ({'https', 'http'}.contains(uri.scheme)) {
      uri = uri.replace(scheme: uri.scheme == 'https' ? 'wss' : 'ws');
    }
    validateRelay(uri.toString(), allowLocal: allowLocal);
    final relay = uri.pathSegments.lastOrNull == 'relay'
        ? uri
        : uri.replace(
            path: '${uri.path.replaceFirst(RegExp(r'/$'), '')}/relay',
          );
    final response = await _resolve(uri, 'pairing/code/resolve', {
      'code': code,
    }, preservePath: true);
    return Pairing.parse(
      jsonEncode({...response, 'relay': relay.toString()}),
      allowLocal: allowLocal,
    );
  }

  Future<Pairing> resolveTrusted(Pairing pair) async {
    final phone = await identity();
    final request = <String, dynamic>{
      'macDeviceId': pair.macDeviceId,
      'phoneDeviceId': phone.deviceId,
      'phoneIdentityPublicKey': phone.publicKey,
      'nonce': const Uuid().v4(),
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    };
    final key = await Ed25519().newKeyPairFromSeed(phone.seed);
    request['signature'] = base64Encode(
      (await Ed25519().sign(
        trustedResolveTranscript(request),
        keyPair: key,
      )).bytes,
    );
    final response = await _resolve(
      pair.relay,
      'trusted/session/resolve',
      request,
    );
    if (response['macDeviceId'] != pair.macDeviceId ||
        response['macIdentityPublicKey'] != pair.publicKey) {
      throw const RemoteSecurityException(
        'The trusted relay returned a different desktop identity. Pair again.',
      );
    }
    // A trusted resolution supplies live session metadata, not a new QR expiry.
    return Pairing.parse(
      jsonEncode({
        ...pair.data,
        ...response,
        'v': 2,
        'relay': pair.relay.toString(),
        'expiresAt': DateTime.now()
            .add(const Duration(minutes: 5))
            .millisecondsSinceEpoch,
      }),
      allowLocal: allowLocal,
    );
  }

  Future<RemoteJson> _resolve(
    Uri relay,
    String route,
    RemoteJson body, {
    bool preservePath = false,
  }) async {
    final candidates = resolveCandidates(
      relay,
      route,
      preservePath: preservePath,
    );
    for (var i = 0; i < candidates.length; i++) {
      try {
        final response = await _client
            .post(
              candidates[i],
              headers: {'Content-Type': 'application/json'},
              body: jsonEncode(body),
            )
            .timeout(const Duration(seconds: 8));
        if ({408, 429}.contains(response.statusCode) ||
            response.statusCode >= 500) {
          throw const RemoteRelayUnavailable(
            'The desktop relay is temporarily unavailable.',
          );
        }
        RemoteJson value;
        try {
          value = Map<String, dynamic>.from(jsonDecode(response.body) as Map);
        } catch (_) {
          if (response.statusCode == 404 && i < candidates.length - 1) continue;
          throw const RemoteSecurityException(
            'The desktop relay returned an invalid response.',
          );
        }
        if (!{401, 403}.contains(response.statusCode) &&
            {
              'session_unavailable',
              'mac_offline',
              'host_offline',
            }.contains(value['code'])) {
          throw RemoteRelayUnavailable(
            value['error'] is String
                ? value['error'] as String
                : 'The trusted computer is offline.',
          );
        }
        if (response.statusCode == 404 && i < candidates.length - 1) continue;
        if (response.statusCode < 200 ||
            response.statusCode >= 300 ||
            value['ok'] != true) {
          throw RemoteSecurityException(
            value['error'] is String
                ? value['error'] as String
                : 'The desktop pairing service is unavailable.',
          );
        }
        return value;
      } on http.ClientException {
        // A failed connection is not an identity rejection. The controller may
        // resolve again with a fresh signed nonce; do not disable recovery.
        throw const RemoteRelayUnavailable(
          'Could not reach the desktop relay.',
        );
      }
    }
    throw const RemoteSecurityException(
      'The relay does not support this pairing method.',
    );
  }
}
