import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/auth/presentation/auth_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

class HeldEmailCredentials extends TestCredentials {
  final started = Completer<void>(), release = Completer<void>();
  @override
  Future<void> write(String key, String? value) async {
    if (key == 'cloud.session' && value == 'late-email-session') {
      started.complete();
      await release.future;
    }
    await super.write(key, value);
  }
}

void main() {
  test(
    'dismissed email form cannot install its delayed response token or publish a notice',
    () async {
      final gate = Completer<http.Response>(), store = TestCredentials();
      final cloud = CloudClient(
        baseUrl: Uri.parse('https://example.test'),
        credentials: store,
        client: MockClient((_) => gate.future),
      );
      final auth = AuthController(cloud);
      var current = true;
      final pending = auth.submit('sign-in/email', {
        'email': 'fixture@example.test',
        'password': 'fixture-password',
      }, formIsCurrent: () => current);
      current = false;
      gate.complete(http.Response('{"token":"late-email-session"}', 200));
      expect(await pending, isFalse);
      expect(store.values['cloud.session'], isNull);
      expect(auth.signedIn, isFalse);
      expect(auth.notice, isNull);
      auth.dispose();
    },
  );
  for (final newer in [false, true]) {
    test(
      'dismissal during an email durable write ${newer ? 'preserves the newer session' : 'rolls back only its own session'}',
      () async {
        final store = HeldEmailCredentials()
          ..values['cloud.session'] = 'previous-session';
        final cloud = CloudClient(
          baseUrl: Uri.parse('https://example.test'),
          credentials: store,
          client: MockClient(
            (_) async => http.Response('{"token":"late-email-session"}', 200),
          ),
        );
        final auth = AuthController(cloud);
        var current = true;
        final pending = auth.submit('sign-in/email', {
          'email': 'fixture@example.test',
          'password': 'fixture-password',
        }, formIsCurrent: () => current);
        await store.started.future;
        current = false;
        final replacement = newer ? cloud.setSession('newer-session') : null;
        store.release.complete();
        expect(await pending, isFalse);
        await replacement;
        expect(
          store.values['cloud.session'],
          newer ? 'newer-session' : 'previous-session',
        );
        expect(auth.signedIn, isFalse);
        auth.dispose();
      },
    );
  }
}
