import 'dart:async';
import 'package:djl_mobile/core/security/credential_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/auth/presentation/auth_controller.dart';
import 'package:djl_mobile/features/chat/data/cloud_composer_draft_store.dart';
import 'cloud_composer_draft_store_test.dart'
    show DraftCredentials, draftRecord;

class DraftAuthCredentials extends DraftCredentials {
  final sessionWrite = Completer<void>();
  bool holdSession = false, reachedSessionWrite = false;
  @override
  Future<void> write(String key, String? value) async {
    if (holdSession && key == 'cloud.session' && value == 'new-session') {
      reachedSessionWrite = true;
      await sessionWrite.future;
    }
    return super.write(key, value);
  }
}

CloudClient authClient(CredentialStore vault) => CloudClient(
  baseUrl: Uri.parse('https://qa.invalid'),
  credentials: vault,
  client: MockClient(
    (request) async => switch (request.url.path) {
      '/v1/auth/token' => http.Response('{"token":"jwt"}', 200),
      '/v1/me' => http.Response('{"user":{"id":"u"},"activeOrgId":"o"}', 200),
      '/v1/auth/sign-in/email' => http.Response('{"token":"new-session"}', 200),
      '/v1/auth/sign-out' => http.Response('{}', 200),
      _ => throw StateError('Unexpected QA request ${request.url.path}'),
    },
  ),
);

void main() {
  test(
    'cold session restore keeps drafts, explicit logout clears them without touching pairing',
    () async {
      final vault = DraftCredentials()
        ..values.addAll({
          'cloud.session': 'saved-session',
          'desktop.identity': 'keep pairing',
        });
      final drafts = CloudComposerDraftStore(vault);
      await drafts.save(
        'u:o',
        'new',
        'saved ordinary draft',
        generation: drafts.generation,
      );
      final oldLease = drafts.generation;
      final client = authClient(vault);
      final auth = AuthController(
        client,
        clearCloudPreferences: drafts.clearAll,
      );
      addTearDown(() {
        auth.dispose();
        client.close();
      });
      await auth.restore();
      expect(await drafts.read('u:o', 'new'), 'saved ordinary draft');
      await auth.signOut();
      expect(auth.signedIn, false);
      expect(vault.values.containsKey(draftRecord), false);
      expect(vault.values['desktop.identity'], 'keep pairing');
      expect(
        await drafts.save('u:o', 'new', 'late old text', generation: oldLease),
        false,
      );
    },
  );

  test(
    'committed sign-in and ended session reset ordinary draft ownership',
    () async {
      final vault = DraftCredentials();
      final drafts = CloudComposerDraftStore(vault);
      await drafts.save(
        'old:o',
        'new',
        'old owner',
        generation: drafts.generation,
      );
      final client = authClient(vault);
      final auth = AuthController(
        client,
        clearCloudPreferences: drafts.clearAll,
      );
      addTearDown(() {
        auth.dispose();
        client.close();
      });
      expect(
        await auth.submit('sign-in/email', {
          'email': 'qa@example.invalid',
          'password': 'fixture',
        }),
        true,
      );
      expect(await drafts.read('old:o', 'new'), '');
      await drafts.save(
        'u:o',
        'new',
        'current owner',
        generation: drafts.generation,
      );
      client.onSessionEnded?.call();
      expect(await drafts.read('u:o', 'new'), '');
      expect(auth.signedIn, false);
    },
  );

  test(
    'an invalidated form rolls its session back without clearing the prior draft',
    () async {
      final vault = DraftAuthCredentials()
        ..values['cloud.session'] = 'saved-session';
      final drafts = CloudComposerDraftStore(vault);
      await drafts.save(
        'u:o',
        'new',
        'keep after cancelled login',
        generation: drafts.generation,
      );
      final lease = drafts.generation;
      final client = authClient(vault);
      final auth = AuthController(
        client,
        clearCloudPreferences: drafts.clearAll,
      );
      addTearDown(() {
        auth.dispose();
        client.close();
      });
      var formCurrent = true;
      vault.holdSession = true;
      final login = auth.submit('sign-in/email', {
        'email': 'qa@example.invalid',
        'password': 'fixture',
      }, formIsCurrent: () => formCurrent);
      for (var i = 0; i < 20 && !vault.reachedSessionWrite; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(vault.reachedSessionWrite, true);
      formCurrent = false;
      vault.sessionWrite.complete();
      expect(await login, false);
      expect(vault.values['cloud.session'], 'saved-session');
      expect(drafts.generation, lease);
      expect(await drafts.read('u:o', 'new'), 'keep after cancelled login');
    },
  );

  test(
    'cleanup failure never restores auth and is surfaced without exposing storage details',
    () async {
      final vault = DraftCredentials()
        ..values['cloud.session'] = 'saved-session';
      final drafts = CloudComposerDraftStore(vault);
      await drafts.save(
        'u:o',
        'new',
        'private fixture',
        generation: drafts.generation,
      );
      final client = authClient(vault);
      final auth = AuthController(
        client,
        clearCloudPreferences: drafts.clearAll,
      );
      addTearDown(() {
        auth.dispose();
        client.close();
      });
      await auth.restore();
      vault.failWrite = true;
      await auth.signOut();
      expect(auth.signedIn, false);
      expect(vault.values['cloud.session'], isNull);
      expect(auth.notice, isNotNull);
      expect(auth.notice, isNot(contains('private fixture')));
      expect(await drafts.read('u:o', 'new'), '');
    },
  );
}
