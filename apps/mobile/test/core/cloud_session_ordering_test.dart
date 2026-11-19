import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/core/security/credential_store.dart';

class DelayedSessionCredentials implements CredentialStore {
  String? session = 'old-session';
  final started = Completer<void>(), release = Completer<void>();
  bool rejectClear = false;
  @override
  Future<String?> read(String key) async => session;
  @override
  Future<void> write(String key, String? value) async {
    if (value == 'pending-session') {
      started.complete();
      await release.future;
    }
    if (value == null && rejectClear) {
      throw StateError('Synthetic storage error');
    }
    session = value;
  }
}

void main() {
  CloudClient client(DelayedSessionCredentials store) => CloudClient(
    baseUrl: Uri.parse('https://example.test'),
    credentials: store,
    client: MockClient((_) async => http.Response('{}', 200)),
  );

  test(
    'sign-out wins over an already in-flight durable session write',
    () async {
      final store = DelayedSessionCredentials();
      final active = client(store);
      addTearDown(active.close);
      final pending = active.setSession('pending-session');
      await store.started.future;
      final signedOut = active.signOut();
      await Future<void>.delayed(Duration.zero);
      store.release.complete();
      await Future.wait([pending, signedOut]);
      expect(store.session, isNull);
      expect(await active.signedIn, isFalse);
    },
  );

  test(
    'a failed durable write does not poison later explicit session changes',
    () async {
      final store = DelayedSessionCredentials()..rejectClear = true;
      final cloud = client(store);
      addTearDown(cloud.close);
      await expectLater(cloud.setSession(null), throwsStateError);
      store.rejectClear = false;
      await cloud.setSession('later-session');
      expect(store.session, 'later-session');
    },
  );
}
