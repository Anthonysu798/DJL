import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../security/credential_store.dart';

class CloudFailure implements Exception {
  const CloudFailure(
    this.status,
    this.code,
    this.message, {
    this.unauthorized = false,
    this.traceId,
    this.resetsAt,
  });
  final int status;
  final String code;
  final String message;
  final bool unauthorized;
  final String? traceId, resetsAt;
  bool get retryable => status == 0 || status >= 500 || code == 'overloaded';
  @override
  String toString() => message;
  factory CloudFailure.response(int status, String body, {bool auth = false}) {
    Map<String, dynamic> error = {};
    try {
      final decoded = jsonDecode(body) as Map<String, dynamic>;
      error =
          (decoded['error'] is Map ? decoded['error'] : decoded)
              as Map<String, dynamic>;
    } catch (_) {
      /* A gateway can return a non-JSON failure. */
    }
    return CloudFailure(
      status,
      error['code'] as String? ?? 'http_$status',
      error['message'] as String? ??
          (status == 401
              ? 'Your session has ended. Please sign in again.'
              : 'DJL Cloud request failed ($status).'),
      unauthorized: status == 401 && !auth,
      traceId: error['traceId'] as String?,
      resetsAt: error['resetsAt'] as String?,
    );
  }
}

class CloudClient {
  CloudClient({
    required this.baseUrl,
    required this.credentials,
    http.Client? client,
  }) : _client = client ?? http.Client();
  final Uri baseUrl;
  final CredentialStore credentials;
  final http.Client _client;
  String? _jwt, _session;
  DateTime? _expiresAt;
  Future<String>? _exchange;
  Future<void> _sessionWrites = Future<void>.value();
  int _revision = 0;
  void Function()? onSessionEnded;
  int get revision => _revision;
  Uri url(String path, [Map<String, String>? query]) =>
      baseUrl.resolve(path).replace(queryParameters: query);

  Future<bool> get signedIn async =>
      await credentials.read('cloud.session') != null;
  Future<void> setSession(String? token) {
    _revision++;
    _jwt = null;
    _session = null;
    _expiresAt = null;
    _exchange = null;
    final write = _sessionWrites.then(
      (_) => credentials.write('cloud.session', token),
    );
    _sessionWrites = write.then<void>(
      (_) {},
      onError: (Object _, StackTrace _) {},
    );
    return write;
  }

  Future<void> _revoke() async {
    final revokedRevision = _revision + 1;
    await setSession(null);
    if (_revision == revokedRevision) onSessionEnded?.call();
  }

  void _requireRevision(int version) {
    if (_revision != version) {
      throw const CloudFailure(
        401,
        'session_changed',
        'The account changed.',
        unauthorized: true,
      );
    }
  }

  Future<String> accessToken() async {
    final version = _revision;
    await _sessionWrites;
    _requireRevision(version);
    final session = await credentials.read('cloud.session');
    _requireRevision(version);
    if (session == null) {
      throw const CloudFailure(
        401,
        'no_session',
        'Please sign in.',
        unauthorized: true,
      );
    }
    if (_session != session) {
      _jwt = null;
      _expiresAt = null;
      _session = session;
      _exchange = null;
    }
    if (_jwt != null &&
        _expiresAt != null &&
        _expiresAt!.isAfter(DateTime.now().add(const Duration(seconds: 60)))) {
      return _jwt!;
    }
    if (_exchange != null) return _exchange!;
    final task = _mint(session, version);
    _exchange = task;
    try {
      return await task;
    } finally {
      if (identical(_exchange, task)) _exchange = null;
    }
  }

  Future<String> _mint(String session, int version) async {
    final response = await _send(
      http.Request('GET', url('v1/auth/token'))
        ..headers['Authorization'] = 'Bearer $session',
    );
    _requireRevision(version);
    if (response.statusCode == 401) {
      await _revoke();
      throw CloudFailure.response(401, response.body);
    }
    _check(response);
    final body = _object(response.body);
    final token = body['token'] as String?;
    if (token == null || token.isEmpty) {
      throw const CloudFailure(
        0,
        'invalid_response',
        'DJL Cloud returned no access token.',
      );
    }
    _jwt = token;
    _expiresAt =
        DateTime.tryParse(body['expiresAt']?.toString() ?? '') ??
        _jwtExpiry(token) ??
        DateTime.now().add(const Duration(minutes: 5));
    return token;
  }

  DateTime? _jwtExpiry(String token) {
    try {
      final body = _object(
        utf8.decode(base64Url.decode(base64Url.normalize(token.split('.')[1]))),
      );
      return DateTime.fromMillisecondsSinceEpoch(
        (body['exp'] as num).toInt() * 1000,
      );
    } catch (_) {
      return null;
    }
  }

  Future<String?> authenticate(String route, Map<String, dynamic> body) async {
    final request = http.Request('POST', url('v1/auth/$route'))
      ..headers['Content-Type'] = 'application/json'
      ..body = jsonEncode(body);
    final response = await _send(request);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CloudFailure.response(
        response.statusCode,
        response.body,
        auth: true,
      );
    }
    final header = response.headers['set-auth-token'];
    final token = header?.isNotEmpty == true
        ? header
        : _object(response.body)['token'] as String?;
    return token?.isNotEmpty == true ? token : null;
  }

  Future<void> signOut() async {
    final session = await credentials.read('cloud.session');
    await setSession(null);
    if (session == null) return;
    try {
      await _send(
        http.Request('POST', url('v1/auth/sign-out'))
          ..headers.addAll({
            'Authorization': 'Bearer $session',
            'Content-Type': 'application/json',
          })
          ..body = '{}',
      );
    } catch (_) {
      /* Local sign-out succeeds even when the service is offline. */
    }
  }

  Future<http.Request> authorizedRequest(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? query,
  }) async {
    return http.Request(method, url(path, query))
      ..headers.addAll({
        'Authorization': 'Bearer ${await accessToken()}',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      })
      ..body = body == null ? '' : jsonEncode(body);
  }

  Future<http.StreamedResponse> open(http.Request request) async {
    try {
      return await _client.send(request).timeout(const Duration(seconds: 30));
    } on TimeoutException {
      throw const CloudFailure(
        0,
        'timeout',
        'DJL Cloud took too long to respond.',
      );
    } on http.ClientException {
      throw const CloudFailure(
        0,
        'network',
        'Could not reach DJL Cloud. Check your connection.',
      );
    }
  }

  Future<http.Response> _send(http.Request request) async =>
      http.Response.fromStream(await open(request));
  Future<Map<String, dynamic>> request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? query,
    bool authenticated = true,
  }) async {
    final version = _revision;
    for (var attempt = 0; attempt < 2; attempt++) {
      final request = authenticated
          ? await authorizedRequest(method, path, body: body, query: query)
          : (http.Request(method, url(path, query))
              ..headers['Accept'] = 'application/json');
      if (authenticated) _requireRevision(version);
      final response = await _send(request);
      if (authenticated) _requireRevision(version);
      if (authenticated && response.statusCode == 401) {
        final failure = CloudFailure.response(401, response.body);
        if (attempt == 0 && failure.code != 'session_revoked') {
          _jwt = null;
          _expiresAt = null;
          continue;
        }
        await _revoke();
        throw failure;
      }
      _check(response);
      return response.body.isEmpty ? {} : _object(response.body);
    }
    throw const CloudFailure(
      401,
      'session_expired',
      'Please sign in again.',
      unauthorized: true,
    );
  }

  /// Push registration is owned by a current, explicitly enabled session.
  Future<void> registerPushToken({
    required String token,
    required String environment,
    String provider = 'apns',
    required int expectedRevision,
    required bool Function() isCurrent,
  }) async {
    void checkOwner() {
      if (_revision != expectedRevision || !isCurrent()) {
        throw const CloudFailure(
          0,
          'owner_changed',
          'Registration owner changed.',
        );
      }
    }

    final valid = provider == 'fcm'
        ? token.isNotEmpty &&
              token.length <= 200 &&
              !RegExp(r'[\s\x00-\x1f\x7f]').hasMatch(token) &&
              environment == 'production'
        : provider == 'apns' &&
              RegExp(r'^[0-9a-fA-F]{32,200}$').hasMatch(token) &&
              {'sandbox', 'production'}.contains(environment);
    if (!valid) {
      throw const CloudFailure(
        0,
        'invalid_push',
        'Invalid notification registration.',
      );
    }
    for (var attempt = 0; attempt < 2; attempt++) {
      checkOwner();
      final prepared = await authorizedRequest(
        'POST',
        'v1/devices/push-token',
        body: {
          if (provider == 'fcm') 'provider': 'fcm',
          'token': token,
          'environment': environment,
        },
      );
      // Credential reads and token exchange can outlive the captured owner.
      checkOwner();
      final response = await _send(prepared);
      checkOwner();
      if (response.statusCode == 401) {
        final failure = CloudFailure.response(401, response.body);
        if (attempt == 0 && failure.code != 'session_revoked') {
          invalidateAccessToken();
          continue;
        }
        await _revoke();
        throw failure;
      }
      _check(response);
      if (response.statusCode != 204) {
        throw const CloudFailure(
          0,
          'invalid_response',
          'Registration was not acknowledged.',
        );
      }
      return;
    }
  }

  void invalidateAccessToken() {
    _jwt = null;
    _expiresAt = null;
  }

  void _check(http.Response response) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw CloudFailure.response(response.statusCode, response.body);
    }
  }

  Map<String, dynamic> _object(String body) {
    try {
      return jsonDecode(body) as Map<String, dynamic>;
    } catch (_) {
      throw const CloudFailure(
        0,
        'invalid_response',
        'This version could not read the DJL Cloud response.',
      );
    }
  }

  void close() => _client.close();
}
