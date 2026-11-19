import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/remote_notifications/data/remote_push_native.dart';
import 'package:djl_mobile/features/remote_notifications/data/remote_push_store.dart';
import 'package:djl_mobile/features/remote_notifications/domain/remote_notification.dart';
import 'package:djl_mobile/features/remote_notifications/presentation/remote_push_controller.dart';
import '../../core/cloud_client_test.dart' show TestCredentials;

class PushNative implements RemotePushNative {
  final stream = StreamController<Object?>.broadcast(sync: true);
  RemotePushState value = const RemotePushState(
    availability: 'ready',
    permission: 'authorized',
    environment: 'development',
  );
  int prompts = 0, acquisitions = 0, clears = 0;
  final disableRequests = <bool>[];
  final acks = <String>[];
  Object? initial;
  Completer<RemotePushState>? acquisition;
  Completer<Object?>? initialGate;
  @override
  Stream<Object?> get events => stream.stream;
  @override
  Future<RemotePushState> status() async => value;
  @override
  Future<RemotePushState> enable() async {
    prompts++;
    return value;
  }

  @override
  Future<RemotePushState> register() async {
    acquisitions++;
    return acquisition?.future ?? value;
  }

  @override
  Future<Object?> initialTap() async => initialGate?.future ?? initial;
  @override
  Future<void> acknowledge(String id) async {
    acks.add(id);
  }

  @override
  Future<void> clearToken({bool disable = false}) async {
    clears++;
    disableRequests.add(disable);
  }

  @override
  void dispose() {
    unawaited(stream.close());
  }

  void token(
    String token, {
    String permission = 'authorized',
    String environment = 'development',
  }) {
    value = RemotePushState(
      availability: 'ready',
      permission: permission,
      environment: environment,
      token: token,
    );
    stream.add({
      'availability': 'ready',
      'permission': permission,
      'environment': environment,
      'token': token,
    });
  }
}

class PushStore implements RemotePushStore {
  PushStore([this.value = false]);
  bool value;
  @override
  Future<bool> read() async => value;
  @override
  Future<void> write(bool enabled) async {
    value = enabled;
  }
}

Map<String, Object> cloudTap(String event, {String id = 'c1'}) => {
  'eventId': event,
  'receivedAt': DateTime.now().millisecondsSinceEpoch,
  'source': 'djl.cloudRun',
  'runId': 'r1',
  'conversationId': id,
  'status': 'succeeded',
  'url': 'djl://cloud/c/$id',
};
Map<String, Object> pairedTap(String event) => {
  'eventId': event,
  'receivedAt': DateTime.now().millisecondsSinceEpoch,
  'source': 'codex.runCompletion',
  'threadId': 'same-id',
  'turnId': 't1',
};
Future<void> flush() async {
  for (var i = 0; i < 8; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  test(
    'strict push parser rejects incoherent, foreign, stale and action-bearing URLs without tightening ordinary links',
    () {
      expect(
        RemoteNotificationTap.parse(cloudTap('valid'))?.cloudUri.toString(),
        'djl://cloud/c/c1',
      );
      for (final changes in <Map<String, Object?>>[
        {'source': 'foreign'},
        {'url': 'https://evil.test/c1'},
        {'url': 'djl://cloud/c/c2'},
        {'url': 'djl://cloud/c/c1?approve=true'},
        {'url': 'djl://cloud/c/c1#x'},
        {'status': 'running'},
        {'runId': ''},
        {'conversationId': '../x'},
        {'eventId': ''},
        {
          'receivedAt': DateTime.now()
              .subtract(const Duration(seconds: 301))
              .millisecondsSinceEpoch,
        },
        {
          'receivedAt': DateTime.now()
              .add(const Duration(seconds: 10))
              .millisecondsSinceEpoch,
        },
        {'receivedAt': double.nan},
      ]) {
        expect(
          RemoteNotificationTap.parse({...cloudTap('invalid'), ...changes}),
          isNull,
          reason: '$changes',
        );
      }
      for (final source in [
        'codex.runCompletion',
        'codex.structuredUserInput',
      ]) {
        final tap = RemoteNotificationTap.parse({
          ...pairedTap('p'),
          'source': source,
          'macId': 'untrusted',
        });
        expect(tap?.desktop?.thread, 'same-id');
        expect(tap?.desktop?.qualified, false);
      }
      for (final changes in [
        {'threadId': ''},
        {'turnId': '../x'},
        {'threadId': 42},
      ]) {
        expect(
          RemoteNotificationTap.parse({...pairedTap('p'), ...changes}),
          isNull,
        );
      }
    },
  );
  late PushNative native;
  late CloudClient cloud;
  late RemotePushController controller;
  late List<http.Request> requests;
  late TestCredentials credentials;
  late PushStore store;
  Completer<http.Response>? postGate;
  var configured = true;
  setUp(() {
    native = PushNative();
    requests = [];
    credentials = TestCredentials()..values['cloud.session'] = 's';
    store = PushStore();
    configured = true;
    postGate = null;
    cloud = CloudClient(
      baseUrl: Uri.parse('https://example.test'),
      credentials: credentials,
      client: MockClient((request) async {
        requests.add(request);
        if (request.url.path == '/v1/auth/token') {
          return http.Response('{"token":"jwt"}', 200);
        }
        if (request.url.path == '/v1/client-config') {
          return http.Response(jsonEncode({'pushConfigured': configured}), 200);
        }
        return postGate?.future ?? http.Response('', 204);
      }),
    );
    controller = RemotePushController(cloud, native, store);
  });
  tearDown(() {
    controller.dispose();
    cloud.close();
  });
  test(
    'disabled default and locked/Mac-only context never prompt or fetch Cloud config',
    () async {
      await controller.initialize();
      controller.updateContext(allowed: true, cloudOwner: 'u:o');
      await flush();
      expect(native.prompts, 0);
      expect(requests, isEmpty);
      await controller.setEnabled(true);
      expect(native.prompts, 1);
      controller.updateContext(allowed: false, cloudOwner: 'u:o');
      native.token('a' * 64);
      await flush();
      expect(requests, isEmpty);
      controller.updateContext(allowed: true);
      await flush();
      expect(requests, isEmpty);
    },
  );
  for (final gate in [
    'unsupported',
    'simulator',
    'disabled',
    'unconfigured',
    'failed',
  ]) {
    test('$gate never registers or reads Cloud capability', () async {
      store.value = true;
      native.value = RemotePushState(
        availability: gate,
        environment: 'production',
        permission: 'authorized',
        token: 'a' * 64,
      );
      await controller.initialize();
      controller.updateContext(allowed: true, cloudOwner: 'u:o');
      await flush();
      expect(requests, isEmpty);
      expect(native.acquisitions, 0);
      expect(native.prompts, 0);
    });
  }
  test(
    'token refresh, exact payload, opt-in dedup and explicit retry',
    () async {
      await controller.initialize();
      controller.updateContext(allowed: true, cloudOwner: 'u:o');
      await controller.setEnabled(true);
      native.token('a' * 64);
      await flush();
      expect(requests.where((r) => r.method == 'POST').length, 1);
      expect(jsonDecode(requests.last.body), {
        'token': 'a' * 64,
        'environment': 'sandbox',
      });
      native.token('a' * 64);
      await flush();
      expect(requests.where((r) => r.method == 'POST').length, 1);
      native.token('b' * 64, environment: 'production');
      await flush();
      expect(jsonDecode(requests.last.body), {
        'token': 'b' * 64,
        'environment': 'production',
      });
      await controller.retry();
      await flush();
      expect(requests.where((r) => r.method == 'POST').length, 3);
    },
  );
  test(
    'new account waits for old response and never inherits old acknowledgement',
    () async {
      await controller.initialize();
      controller.updateContext(allowed: true, cloudOwner: 'old:o');
      await controller.setEnabled(true);
      postGate = Completer();
      native.token('a' * 64);
      await flush();
      expect(requests.where((r) => r.method == 'POST').length, 1);
      await cloud.setSession('new');
      controller.updateContext(allowed: true, cloudOwner: 'new:o');
      expect(controller.cloudStatus, 'Not enrolled');
      final oldGate = postGate!;
      postGate = null;
      oldGate.complete(http.Response('', 204));
      await flush();
      expect(requests.where((r) => r.method == 'POST').length, 2);
      expect(controller.cloudStatus, contains('acknowledged'));
    },
  );
  test(
    'disable/signout fences late responses and does not invent unregister',
    () async {
      await controller.initialize();
      controller.updateContext(allowed: true, cloudOwner: 'u:o');
      await controller.setEnabled(true);
      postGate = Completer();
      native.token('a' * 64);
      await flush();
      await controller.setEnabled(false);
      await cloud.setSession(null);
      controller.updateContext(allowed: true);
      postGate!.complete(http.Response('', 204));
      await flush();
      expect(controller.cloudStatus, isNot(contains('acknowledged')));
      expect(requests.where((r) => r.method == 'POST').length, 1);
      expect(requests.any((r) => r.method == 'DELETE'), false);
      expect(native.clears, 2);
    },
  );
  test(
    'paired skipped is failure; same secure session reconnect and permission revoke re-register',
    () async {
      final calls = <Map<String, dynamic>>[];
      var ok = false;
      PairedPushOwner owner(int revision) =>
          PairedPushOwner('mac:key:session:$revision', (method, params) async {
            expect(method, 'notifications/push/register');
            calls.add(params);
            return {'ok': ok, if (!ok) 'skipped': true};
          });
      await controller.initialize();
      controller.updateContext(allowed: true, paired: owner(1));
      await controller.setEnabled(true);
      native.token('a' * 64);
      await flush();
      expect(controller.pairedStatus, contains('skipped'));
      expect(calls.single, {
        'deviceToken': 'a' * 64,
        'alertsEnabled': true,
        'authorizationStatus': 'authorized',
        'appEnvironment': 'development',
      });
      ok = true;
      controller.updateContext(allowed: true, paired: owner(2));
      await flush();
      expect(calls.length, 2);
      expect(controller.pairedStatus, contains('acknowledged'));
      native.token('a' * 64, permission: 'denied');
      await flush();
      expect(calls.last['alertsEnabled'], false);
      expect(calls.last['authorizationStatus'], 'denied');
      expect(requests, isEmpty);
    },
  );
  test(
    'old host completion does not suppress registration with newly selected host',
    () async {
      final gate = Completer<Object?>();
      var newCalls = 0;
      await controller.initialize();
      controller.updateContext(
        allowed: true,
        paired: PairedPushOwner('a:key:s:1', (_, _) => gate.future),
      );
      await controller.setEnabled(true);
      native.token('a' * 64);
      await flush();
      controller.updateContext(
        allowed: true,
        paired: PairedPushOwner('b:key:s:1', (_, _) async {
          newCalls++;
          return {'ok': true};
        }),
      );
      gate.complete({'ok': true});
      await flush();
      expect(newCalls, 1);
      expect(controller.pairedStatus, contains('acknowledged'));
    },
  );
  test(
    'held native acquisition after owner change cannot dispatch the old result',
    () async {
      store.value = true;
      native.acquisition = Completer();
      await controller.initialize();
      controller.updateContext(allowed: true, cloudOwner: 'old:o');
      await flush();
      controller.updateContext(allowed: true);
      native.acquisition!.complete(
        RemotePushState(
          availability: 'ready',
          permission: 'authorized',
          environment: 'development',
          token: 'a' * 64,
        ),
      );
      await flush();
      expect(requests, isEmpty);
    },
  );
  test(
    'native tap initial/live dedup, bounded IDs, no ACK on rejected intake',
    () async {
      final tap = cloudTap('one');
      native.initial = tap;
      var accepted = 0;
      controller.onTap = (_) {
        accepted++;
        return true;
      };
      await controller.initialize();
      native.stream.add(tap);
      await flush();
      expect(accepted, 1);
      expect(native.acks, ['one']);
      controller.onTap = (_) => false;
      native.stream.add(cloudTap('rejected'));
      await flush();
      expect(native.acks, ['one']);
      controller.onTap = (_) {
        accepted++;
        return true;
      };
      for (var i = 0; i < 33; i++) {
        native.stream.add(cloudTap('id$i'));
      }
      native.stream.add(tap);
      await flush();
      expect(accepted, 35);
    },
  );
  test(
    'stale account identity cannot authorize a new session after revision changed',
    () async {
      await controller.initialize();
      controller.updateContext(allowed: true, cloudOwner: 'old:o');
      await controller.setEnabled(true);
      await cloud.setSession('new');
      native.token('a' * 64);
      await flush();
      expect(requests, isEmpty);
    },
  );
  test(
    'explicit retry retries native failure without another permission prompt',
    () async {
      store.value = true;
      native.value = const RemotePushState(
        availability: 'failed',
        environment: 'development',
        permission: 'authorized',
      );
      await controller.initialize();
      controller.updateContext(allowed: true, cloudOwner: 'u:o');
      await controller.retry();
      expect(native.acquisitions, 1);
      expect(native.prompts, 0);
    },
  );
  test(
    'newer live tap supersedes an older initial drain held by startup',
    () async {
      native.initialGate = Completer();
      final accepted = <String>[];
      controller.onTap = (tap) {
        accepted.add(tap.eventId);
        return true;
      };
      final initialize = controller.initialize();
      native.stream.add(cloudTap('new-live'));
      native.initialGate!.complete(cloudTap('old-initial'));
      await initialize;
      expect(accepted, ['new-live']);
      expect(native.acks, ['new-live']);
    },
  );
}
