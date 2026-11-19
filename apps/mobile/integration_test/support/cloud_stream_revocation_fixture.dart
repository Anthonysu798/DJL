// Volatile response fixture; never reads platform storage or contacts a service.
import 'dart:async';
import 'dart:convert';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class RevocationCredentials implements CredentialStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String? value) async {
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }
}

Future<({String? session, int ended, Object? result})> lateRevocation({
  required bool delayedBody,
  required bool replaceAccount,
}) async {
  final store = RevocationCredentials()..values['cloud.session'] = 'old';
  final requested = Completer<void>();
  final response = Completer<http.StreamedResponse>();
  final bodyRead = Completer<void>();
  final body = StreamController<List<int>>(onListen: () => bodyRead.complete());
  var ended = 0;
  final cloud = CloudClient(
    baseUrl: Uri.parse('https://volatile-qa.test/'),
    credentials: store,
    client: MockClient.streaming((request, _) async {
      if (request.url.path == '/v1/auth/token') {
        return http.StreamedResponse(
          Stream.value(utf8.encode('{"token":"old-jwt"}')),
          200,
        );
      }
      if (request.method != 'GET' ||
          request.url.path != '/v1/runs/owned/events' ||
          request.headers['Authorization'] != 'Bearer old-jwt') {
        throw StateError('Unexpected volatile stream request');
      }
      requested.complete();
      return delayedBody
          ? http.StreamedResponse(body.stream, 401)
          : response.future;
    }),
  )..onSessionEnded = () => ended++;
  try {
    final watch = CloudRepository(cloud).watch('owned');
    final result = watch.stream.toList().then<Object?>(
      (events) => events,
      onError: (Object error) => error,
    );
    await requested.future;
    if (delayedBody) await bodyRead.future;
    if (replaceAccount) {
      await cloud.setSession('replacement');
    } else {
      watch.cancel();
    }
    final bytes = utf8.encode(
      '{"error":{"code":"session_revoked","message":"Revoked old session"}}',
    );
    if (delayedBody) {
      body.add(bytes);
      await body.close();
    } else {
      response.complete(http.StreamedResponse(Stream.value(bytes), 401));
    }
    final settled = await result;
    return (
      session: await store.read('cloud.session'),
      ended: ended,
      result: settled,
    );
  } finally {
    cloud.close();
  }
}

class HeldClearCredentials extends RevocationCredentials {
  final clearing = Completer<void>(), release = Completer<void>();
  @override
  Future<void> write(String key, String? value) async {
    if (key == 'cloud.session' && value == null) {
      clearing.complete();
      await release.future;
    }
    await super.write(key, value);
  }
}

Future<({String? session, String? pairing, int ended, Object? result})>
revocationDuringWrite(String path) async {
  final store = HeldClearCredentials()
    ..values['cloud.session'] = 'old'
    ..values['desktop.trusted'] = 'retained-pairing';
  var ended = 0;
  final cloud = CloudClient(
    baseUrl: Uri.parse('https://volatile-qa.test/'),
    credentials: store,
    client: MockClient((request) async {
      if (request.url.path == '/v1/auth/token' && path != 'exchange') {
        return http.Response('{"token":"old-jwt"}', 200);
      }
      final expected = switch (path) {
        'exchange' => '/v1/auth/token',
        'request' => '/v1/me',
        'stream' => '/v1/runs/owned/events',
        'push' => '/v1/devices/push-token',
        _ => throw StateError('Unknown volatile revocation path'),
      };
      if (request.url.path != expected ||
          request.method != (path == 'push' ? 'POST' : 'GET')) {
        throw StateError('Unexpected volatile revocation request');
      }
      return http.Response('{"error":{"code":"session_revoked"}}', 401);
    }),
  )..onSessionEnded = () => ended++;
  try {
    final Future<Object?> pending = switch (path) {
      'exchange' => cloud.accessToken(),
      'request' => cloud.request('GET', 'v1/me'),
      'stream' => CloudRepository(cloud).watch('owned').stream.toList(),
      'push' => cloud.registerPushToken(
        token: 'a' * 64,
        environment: 'sandbox',
        expectedRevision: cloud.revision,
        isCurrent: () => true,
      ),
      _ => throw StateError('Unknown volatile revocation path'),
    };
    final settled = pending.then<Object?>(
      (value) => value,
      onError: (Object e) => e,
    );
    await store.clearing.future.timeout(const Duration(seconds: 10));
    final replacement = cloud.setSession('replacement');
    store.release.complete();
    await replacement;
    final result = await settled;
    return (
      session: await store.read('cloud.session'),
      pairing: await store.read('desktop.trusted'),
      ended: ended,
      result: result,
    );
  } finally {
    if (!store.release.isCompleted) store.release.complete();
    cloud.close();
  }
}

class HeldReadCredentials extends RevocationCredentials {
  HeldReadCredentials(this.returnLatest);
  final bool returnLatest;
  final started = Completer<void>(), release = Completer<void>();
  bool held = false;
  @override
  Future<String?> read(String key) async {
    if (key == 'cloud.session' && !held) {
      held = true;
      final snapshot = values[key];
      started.complete();
      await release.future;
      return returnLatest ? values[key] : snapshot;
    }
    return super.read(key);
  }
}

class HeldSessionWriteCredentials extends RevocationCredentials {
  HeldSessionWriteCredentials(this.value);
  final String? value;
  final started = Completer<void>(), release = Completer<void>();
  @override
  Future<void> write(String key, String? next) async {
    if (key == 'cloud.session' && next == value) {
      started.complete();
      await release.future;
    }
    await super.write(key, next);
  }
}

class HeldPreparedClient extends CloudClient {
  HeldPreparedClient(CredentialStore store, http.Client transport)
    : super(
        baseUrl: Uri.parse('https://volatile-qa.test/'),
        credentials: store,
        client: transport,
      );
  final prepared = Completer<void>(), release = Completer<void>();
  @override
  Future<http.Request> authorizedRequest(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? query,
  }) async {
    final request = await super.authorizedRequest(
      method,
      path,
      body: body,
      query: query,
    );
    prepared.complete();
    await release.future;
    return request;
  }
}

Future<
  ({
    String? session,
    int dispatches,
    int ended,
    Object? result,
    List<String> minted,
  })
>
requestDuringPreparation(String stage) async {
  final read = stage.startsWith('read-')
      ? HeldReadCredentials(stage == 'read-new')
      : null;
  final write = stage.startsWith('write-')
      ? HeldSessionWriteCredentials(stage == 'write-out' ? null : 'replacement')
      : null;
  final store = read ?? write ?? RevocationCredentials();
  store.values['cloud.session'] = 'old';
  final minted = <String>[];
  var dispatches = 0, ended = 0;
  final transport = MockClient((request) async {
    if (request.url.path == '/v1/auth/token') {
      final session = request.headers['Authorization']!.substring(7);
      if (!['old', 'replacement'].contains(session)) {
        throw StateError('Unexpected volatile session');
      }
      minted.add(session);
      return http.Response(jsonEncode({'token': 'jwt-$session'}), 200);
    }
    if (![
      '/v1/owned-action',
      '/v1/runs/owned/events',
    ].contains(request.url.path)) {
      throw StateError('Unexpected volatile action');
    }
    dispatches++;
    return http.Response('{}', 200);
  });
  final prepared = stage.startsWith('prepared-')
      ? HeldPreparedClient(store, transport)
      : null;
  final cloud =
      prepared ??
      CloudClient(
        baseUrl: Uri.parse('https://volatile-qa.test/'),
        credentials: store,
        client: transport,
      );
  cloud.onSessionEnded = () => ended++;
  Future<Object?> settle(Future<Object?> future) =>
      future.then<Object?>((v) => v, onError: (Object e) => e);
  try {
    late final Future<Object?> pending;
    if (write != null) {
      final saving = cloud.setSession(write.value);
      await write.started.future.timeout(const Duration(seconds: 10));
      pending = settle(cloud.accessToken());
      write.release.complete();
      await saving;
    } else {
      pending = settle(
        stage == 'prepared-stream'
            ? CloudRepository(cloud).watch('owned').stream.toList()
            : cloud.request('POST', 'v1/owned-action', body: {'owner': 'old'}),
      );
      await (read?.started.future ?? prepared!.prepared.future).timeout(
        const Duration(seconds: 10),
      );
      await cloud.setSession('replacement');
      (read?.release ?? prepared!.release).complete();
    }
    final result = await pending;
    return (
      session: store.values['cloud.session'],
      dispatches: dispatches,
      ended: ended,
      result: result,
      minted: minted,
    );
  } finally {
    for (final release in [read?.release, write?.release, prepared?.release]) {
      if (release != null && !release.isCompleted) release.complete();
    }
    cloud.close();
  }
}
