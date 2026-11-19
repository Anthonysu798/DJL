import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import '../../integration_test/support/cloud_stream_revocation_fixture.dart';

void main() {
  for (final stage in ['headers', 'body']) {
    for (final changeAccount in [true, false]) {
      test(
        'late revoked stream at $stage cannot affect '
        '${changeAccount ? 'a replacement account' : 'a cancelled watch'}',
        () async {
          final result = await lateRevocation(
            delayedBody: stage == 'body',
            replaceAccount: changeAccount,
          );
          expect(result.session, changeAccount ? 'replacement' : 'old');
          expect(result.ended, 0);
          expect(result.result, isEmpty);
        },
      );
    }
  }

  for (final path in ['exchange', 'request', 'stream', 'push']) {
    test(
      '$path revocation completing a durable clear cannot end a replacement account',
      () async {
        final result = await revocationDuringWrite(path);
        expect(result.session, 'replacement');
        expect(result.pairing, 'retained-pairing');
        expect(result.ended, 0);
        if (path == 'stream') {
          expect(result.result, isEmpty);
        } else {
          expect(result.result, isA<CloudFailure>());
        }
      },
    );
  }

  for (final stage in [
    'read-old',
    'read-new',
    'prepared-request',
    'prepared-stream',
    'write-in',
    'write-out',
  ]) {
    test(
      '$stage preparation cannot use a superseded or uncommitted session',
      () async {
        final result = await requestDuringPreparation(stage);
        expect(result.dispatches, 0);
        expect(result.ended, 0);
        expect(result.session, stage == 'write-out' ? null : 'replacement');
        if (stage == 'write-in') {
          expect(result.result, 'jwt-replacement');
          expect(result.minted, ['replacement']);
        } else if (stage == 'prepared-stream') {
          expect(result.result, isEmpty);
        } else {
          expect(
            result.result,
            isA<CloudFailure>().having(
              (e) => e.code,
              'code',
              stage == 'write-out' ? 'no_session' : 'session_changed',
            ),
          );
          if (stage.startsWith('read-') || stage == 'write-out') {
            expect(result.minted, isEmpty);
          }
        }
      },
    );
  }

  test('a current revoked stream still ends only its Cloud session', () async {
    final store = TestCredentials();
    await store.write('cloud.session', 'current');
    await store.write('desktop.trusted', 'retained-pairing');
    var ended = 0;
    final cloud = CloudClient(
      baseUrl: Uri.parse('https://qa.test/'),
      credentials: store,
      client: MockClient(
        (request) async => request.url.path == '/v1/auth/token'
            ? http.Response('{"token":"jwt"}', 200)
            : http.Response('{"error":{"code":"session_revoked"}}', 401),
      ),
    )..onSessionEnded = () => ended++;
    addTearDown(cloud.close);
    final watch = CloudRepository(cloud).watch('owned');
    await expectLater(watch.stream.toList(), throwsA(isA<CloudFailure>()));
    expect(await store.read('cloud.session'), isNull);
    expect(await store.read('desktop.trusted'), 'retained-pairing');
    expect(ended, 1);
  });
}
