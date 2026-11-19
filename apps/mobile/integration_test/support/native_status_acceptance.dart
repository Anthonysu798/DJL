// TEST ONLY. Actual target uses the production surface, native observer and
// permission widget. Test doubles belong only in host unit tests.
import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/status/data/status_surface.dart';

final nativeStatusPublicURL = DesktopLinkTarget.statusUri(
  'qa-status-public-thread',
  'qa-status-public-mac',
  'a' * 64,
)!;

bool nativeStatusOrdinaryOpen(Iterable<Uri> links) => links.every(
  (uri) =>
      uri.scheme == 'djl' &&
      uri.host == 'home' &&
      {'', '/'}.contains(uri.path) &&
      !uri.hasQuery &&
      !uri.hasFragment &&
      uri.userInfo.isEmpty &&
      !uri.hasPort,
);

void nativeStatusRequire(bool condition) {
  if (!condition) throw StateError('Native status QA assertion refused.');
}

Map<String, Object?> nativeStatusPayload(
  int now, {
  bool detailed = false,
  bool updated = false,
  bool shortDeadline = false,
}) {
  Map<String, Object?> row(String state, {bool canary = false}) {
    final outcome = state == 'failed' || state == 'ready';
    final expiry =
        now +
        (shortDeadline
            ? (outcome ? 25000 : 45000)
            : (outcome ? 120000 : 240000));
    return {
      'state': state,
      'startedAt': now - 1000,
      'staleAt': outcome ? expiry : now + (shortDeadline ? 30000 : 180000),
      'expiresAt': expiry,
      if (detailed && canary) ...{
        'threadId': 'qa-status-public-thread',
        'title': 'DJL QA PUBLIC TITLE',
        'detail': 'qa-public-folder',
        'url': nativeStatusPublicURL.toString(),
      },
    };
  }

  final running = shortDeadline
      ? [row('running', canary: true), row('running'), row('running')]
      : updated
      ? [row('finishing'), row('paused')]
      : [row('running', canary: true)];
  final failed = detailed || updated || shortDeadline
      ? <Map<String, Object?>>[]
      : [row('failed')];
  final ready = detailed && !shortDeadline
      ? <Map<String, Object?>>[]
      : [row('ready')];
  final deadline = [...running, ...failed, ...ready]
      .expand((row) => [row['staleAt'] as int, row['expiresAt'] as int])
      .reduce((a, b) => a < b ? a : b);
  return {
    'schemaVersion': 1,
    'detailed': detailed,
    'counts': {
      'running': running.length,
      'failed': failed.length,
      'ready': ready.length,
    },
    'buckets': {'running': running, 'failed': failed, 'ready': ready},
    'action': 'openApp',
    'nextDeadline': deadline,
  };
}

class NativeStatusMeta {
  NativeStatusMeta._(this._values);
  final Map<String, Object?> _values;
  static const _booleans = {
    'supported',
    'permissionAllowed',
    'genericPrivateFieldsAbsent',
    'nonsemanticAttributes',
    'readableGenericFieldsSafe',
    'publicGeneric',
    'privateVisibility',
    'channelLow',
    'contentIntentOwned',
    'contentIntentImmutable',
    'genericInitialOrder',
    'genericUpdatedOrder',
    'detailedCanaryMatches',
    'deadlineMatches',
    'stale',
  };
  static const _integers = {
    'pid',
    'count',
    'runningCount',
    'failedCount',
    'readyCount',
    'lineCount',
  };
  static const _diagnostics = {
    'nativeObservedAtEpochMs',
    'nativeStaleDateEpochMs',
    'nativeActivityStateCode',
  };
  factory NativeStatusMeta.decode(Map<String, Object?> raw) {
    nativeStatusRequire(
      raw.keys.every(
        (key) =>
            _booleans.contains(key) ||
            _integers.contains(key) ||
            _diagnostics.contains(key) ||
            key == 'platform',
      ),
    );
    nativeStatusRequire(
      raw.entries.every(
        (e) => _booleans.contains(e.key)
            ? e.value is bool
            : _integers.contains(e.key)
            ? e.value is int
            : true,
      ),
    );
    nativeStatusRequire(
      raw['supported'] == true &&
          {'ios', 'android'}.contains(raw['platform']) &&
          raw['pid'] is int &&
          (raw['pid'] as int) > 1 &&
          raw['count'] is int &&
          (raw['count'] as int) >= 0 &&
          (raw['count'] as int) <= 1,
    );
    nativeStatusRequire(
      raw.entries
          .where(
            (e) =>
                _integers.contains(e.key) && !{'pid', 'count'}.contains(e.key),
          )
          .every((e) => (e.value! as int) >= 0 && (e.value! as int) <= 3),
    );
    final diagnosticCount = raw.keys.where(_diagnostics.contains).length;
    nativeStatusRequire(diagnosticCount == 0 || diagnosticCount == 3);
    if (diagnosticCount != 0) {
      nativeStatusRequire(raw['platform'] == 'ios');
      for (final key in _diagnostics) {
        final value = raw[key];
        nativeStatusRequire(value is int);
        final number = value! as int;
        nativeStatusRequire(
          number >= (key == 'nativeObservedAtEpochMs' ? 1 : 0) &&
              number <=
                  (key == 'nativeActivityStateCode' ? 4 : 9007199254740991),
        );
      }
      nativeStatusRequire(
        raw['stale'] == (raw['nativeActivityStateCode'] == 1),
      );
    }
    return NativeStatusMeta._(Map.unmodifiable(raw));
  }
  String get platform => _values['platform']! as String;
  int get pid => _values['pid']! as int;
  int get count => _values['count']! as int;
  bool flag(String key) => _values[key] == true;
  bool get genericSafe =>
      count == 1 &&
      (platform == 'ios'
          ? flag('genericPrivateFieldsAbsent') && flag('nonsemanticAttributes')
          : [
              'readableGenericFieldsSafe',
              'publicGeneric',
              'privateVisibility',
              'channelLow',
              'contentIntentOwned',
              'contentIntentImmutable',
            ].every(flag));
  int? get nativeObservedAtEpochMs =>
      _values['nativeObservedAtEpochMs'] as int?;
  int? get nativeActivityStateCode =>
      _values['nativeActivityStateCode'] as int?;
  int? get nativeStaleDateEpochMs => _values['nativeStaleDateEpochMs'] as int?;
  String get diagnosticScalars {
    nativeStatusRequire(_diagnostics.every(_values.containsKey));
    return 'nativeObservedAtEpochMs=$nativeObservedAtEpochMs '
        'nativeStaleDateEpochMs=$nativeStaleDateEpochMs '
        'nativeActivityStateCode=$nativeActivityStateCode';
  }

  Map<String, Object?> get checkpoint => {'pid': pid, 'count': count};
}

void nativeStatusBeforeDeadlineHold(NativeStatusMeta value, int deadline) {
  nativeStatusRequire(
    value.count == 1 &&
        value.flag('deadlineMatches') &&
        value.flag('permissionAllowed'),
  );
  if (value.platform == 'ios') {
    debugPrint('DJL_STATUS_DIAG_BEFORE_HOLD ${value.diagnosticScalars}');
    nativeStatusRequire(value.nativeStaleDateEpochMs == deadline);
  }
}

// Read-only observation after one successful update. Only the exact safe initial
// state may remain pending; the original updated oracle still decides success.
Future<NativeStatusMeta> nativeStatusObserveGenericUpdate({
  required int expectedPid,
  required String expectedPlatform,
  required Future<NativeStatusMeta> Function() read,
  required Future<void> Function(Duration) tick,
  // Host tests inject monotonic elapsed time; the native target uses Stopwatch.
  Duration Function()? elapsed,
}) async {
  final watch = Stopwatch()..start();
  final monotonic = elapsed ?? () => watch.elapsed;
  final started = monotonic();
  Duration remaining() {
    final value = const Duration(seconds: 2) - (monotonic() - started);
    return value > Duration.zero ? value : Duration.zero;
  }

  try {
    while (true) {
      nativeStatusRequire(remaining() > Duration.zero);
      final value = await Future.sync(read).timeout(
        remaining(),
        onTimeout: () =>
            throw StateError('Native status update observation timed out.'),
      );
      nativeStatusRequire(remaining() > Duration.zero);
      nativeStatusRequire(value.platform == expectedPlatform);
      nativeStatusRequire(value.pid == expectedPid);
      nativeStatusRequire(value.count == 1);
      nativeStatusRequire(value.genericSafe);
      if (value.flag('genericUpdatedOrder')) {
        nativeStatusRequire(remaining() > Duration.zero);
        return value;
      }
      nativeStatusRequire(value.flag('genericInitialOrder'));
      final tickBudget = remaining();
      nativeStatusRequire(tickBudget > Duration.zero);
      final cadence = const Duration(milliseconds: 200);
      await Future.sync(
        () => tick(tickBudget < cadence ? tickBudget : cadence),
      ).timeout(
        remaining(),
        onTimeout: () =>
            throw StateError('Native status update observation timed out.'),
      );
    }
  } finally {
    watch.stop();
  }
}

class NativeStatusProbe {
  static const _channel = MethodChannel(
    'app.djl/test_only_run_status_observer',
  );
  Future<NativeStatusMeta> read({int? deadline}) async {
    try {
      final values = await _channel.invokeMapMethod<String, Object?>(
        'snapshot',
        {'deadline': ?deadline},
      );
      nativeStatusRequire(values != null);
      return NativeStatusMeta.decode(values!);
    } catch (_) {
      throw StateError('Native status read-only observer unavailable.');
    }
  }
}

class NativeStatusSession {
  NativeStatusSession(this._surface);
  final StatusSurface _surface;
  String _instance = const Uuid().v4();
  int _epoch = 0, _writes = 0;
  bool _holding = false;
  Map<String, Object?> get identity => {
    'schemaVersion': 1,
    'epoch': _epoch,
    'instance': _instance,
  };
  void _writable() => nativeStatusRequire(!_holding);
  Future<void> restart() async {
    _writable();
    _instance = const Uuid().v4();
    _epoch = 0;
    _writes++;
    nativeStatusRequire(await _surface.end(identity));
  }

  Future<Map<String, Object?>> publish(Map<String, Object?> payload) async {
    _writable();
    _epoch++;
    final value = {...payload, ...identity};
    nativeStatusRequire(await attempt(value));
    return value;
  }

  Future<bool> attempt(Map<String, Object?> payload) async {
    _writable();
    _writes++;
    return _surface.update(payload);
  }

  Future<void> end() async {
    _writable();
    _epoch++;
    _writes++;
    nativeStatusRequire(await _surface.end(identity));
  }

  Future<NativeStatusMeta> holdDeadline({
    required int pid,
    required Future<void> Function() waitForHost,
    required Future<NativeStatusMeta> Function() readNative,
  }) async {
    _writable();
    _holding = true;
    final before = _writes;
    try {
      try {
        await waitForHost();
      } catch (error, stack) {
        // Failure remains terminal. This read runs under the write lock and
        // cannot acknowledge the host or manufacture expiry with an update.
        try {
          final watch = Stopwatch()..start();
          const budget = Duration(seconds: 2);
          final pending = Future.sync(readNative);
          final remaining = budget - watch.elapsed;
          final meta = await pending.timeout(
            remaining > Duration.zero ? remaining : Duration.zero,
          );
          nativeStatusRequire(watch.elapsed < budget);
          debugPrint(
            'DJL_STATUS_DIAG_AFTER_FAILED_HOLD ${meta.diagnosticScalars} '
            'samePid=${meta.pid == pid} noWrites=${_writes == before}',
          );
        } catch (_) {
          debugPrint('DJL_STATUS_DIAG_AFTER_FAILED_HOLD UNAVAILABLE');
        }
        Error.throwWithStackTrace(error, stack);
      }
      // This read is deliberately before any subsequent end/update, so expiry
      // cannot be manufactured by app foreground reconciliation.
      final meta = await readNative();
      nativeStatusRequire(
        before == _writes && meta.pid == pid && meta.flag('permissionAllowed'),
      );
      nativeStatusRequire(
        meta.platform == 'android'
            ? meta.count == 0
            : meta.count == 1 && meta.flag('stale'),
      );
      return meta;
    } finally {
      _holding = false;
    }
  }
}

class NativeStatusPhases {
  NativeStatusPhases({
    required this.token,
    required String host,
    required this.tick,
  }) : base = Uri.parse('http://$host:8857') {
    nativeStatusRequire(
      RegExp(r'^[0-9a-f]{64}$').hasMatch(token) &&
          {'127.0.0.1', '10.0.2.2'}.contains(host),
    );
  }
  final String token;
  final Uri base;
  final Future<void> Function(Duration) tick;
  final _client = http.Client();
  Future<Map<String, dynamic>> _request(
    String route, [
    Map<String, Object?>? body,
  ]) async {
    try {
      final response =
          await (body == null
                  ? _client.get(base.resolve(route))
                  : _client.post(
                      base.resolve(route),
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer $token',
                      },
                      body: jsonEncode(body),
                    ))
              .timeout(const Duration(seconds: 15));
      nativeStatusRequire(response.statusCode == 200);
      final raw = jsonDecode(response.body);
      nativeStatusRequire(raw is Map<String, dynamic> && raw['failed'] != true);
      return raw as Map<String, dynamic>;
    } catch (_) {
      throw StateError('Native status protected phase refused.');
    }
  }

  Future<void> _wait(
    bool Function(Map<String, dynamic>) done,
    Duration timeout,
  ) async {
    final until = DateTime.now().add(timeout);
    do {
      if (done(await _request('/status'))) return;
      await tick(const Duration(milliseconds: 200));
    } while (DateTime.now().isBefore(until));
    throw StateError('Native status host acknowledgment timed out.');
  }

  Future<void> connected() => _wait(
    (value) => value['driverConnected'] == true,
    const Duration(seconds: 60),
  );
  Future<void> stage(String name, Map<String, Object?> meta) async {
    await _request('/stage', {'phase': name, 'meta': meta});
    debugPrint('DJL_STATUS_ADAPTER_${name.toUpperCase()}');
    await _wait(
      (value) => value['phase'] == name && value['ack'] == true,
      const Duration(minutes: 5),
    );
  }

  Future<void> lifecycle(String state) async {
    try {
      await _request('/lifecycle', {'state': state});
    } catch (_) {
      /* Guard will refuse suspension without a fresh paused proof. */
    }
  }

  Future<void> failed() async {
    try {
      await _request('/failed', {});
    } catch (_) {
      /* Driver exit still propagates failure. */
    }
  }

  void close() => _client.close();
}
