import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/auth/presentation/auth_controller.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'cloud_composer_draft_auth_test.dart'
    show authClient, DraftAuthCredentials;
import 'cloud_model_selection_store_test.dart'
    show ModelChoiceCredentials, modelChoiceKey;

void main() {
  for (final transition in ['logout', 'expired', 'sign-in']) {
    test(
      'cold auth restore preserves model choice and $transition clears Cloud choices/drafts only',
      () async {
        final vault = ModelChoiceCredentials()
          ..values.addAll({
            'cloud.session': 'saved-session',
            'desktop.identity': 'keep pairing',
          });
        final client = authClient(vault);
        final repository = CloudRepository(client);
        final auth = AuthController(
          client,
          clearCloudPreferences: repository.clearCloudPreferences,
        );
        addTearDown(() {
          auth.dispose();
          client.close();
          repository.modelSelection.dispose();
        });
        await repository.modelSelection.save(
          'text',
          generation: repository.modelSelection.generation,
        );
        await repository.composerDrafts.save(
          'u:o',
          'new',
          'keep review',
          generation: repository.composerDrafts.generation,
        );
        final old = repository.modelSelection.generation;
        await auth.restore();
        expect(vault.values[modelChoiceKey], 'text');
        if (transition == 'logout') {
          await auth.signOut();
        } else if (transition == 'expired') {
          await client.setSession(null);
          client.onSessionEnded?.call();
        } else {
          expect(
            await auth.submit('sign-in/email', {
              'email': 'qa@example.invalid',
              'password': 'fixture',
            }),
            true,
          );
        }
        expect(await repository.modelSelection.read(), isNull);
        expect(vault.values[modelChoiceKey], isNull);
        expect(await repository.composerDrafts.read('u:o', 'new'), '');
        expect(vault.values['desktop.identity'], 'keep pairing');
        expect(
          await repository.modelSelection.save('late old', generation: old),
          false,
        );
      },
    );
  }
  test(
    'invalidated sign-in keeps the previous saved model and pairing',
    () async {
      final vault = DraftAuthCredentials()
        ..values.addAll({
          'cloud.session': 'saved-session',
          'desktop.identity': 'keep pairing',
        });
      final client = authClient(vault);
      final repository = CloudRepository(client);
      final auth = AuthController(
        client,
        clearCloudPreferences: repository.clearCloudPreferences,
      );
      addTearDown(() {
        auth.dispose();
        client.close();
        repository.modelSelection.dispose();
      });
      await repository.modelSelection.save(
        'text',
        generation: repository.modelSelection.generation,
      );
      var current = true;
      vault.holdSession = true;
      final login = auth.submit('sign-in/email', {
        'email': 'qa@example.invalid',
        'password': 'fixture',
      }, formIsCurrent: () => current);
      for (var i = 0; i < 20 && !vault.reachedSessionWrite; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(vault.reachedSessionWrite, true);
      current = false;
      vault.sessionWrite.complete();
      expect(await login, false);
      expect(vault.values[modelChoiceKey], 'text');
      expect(vault.values['cloud.session'], 'saved-session');
      expect(vault.values['desktop.identity'], 'keep pairing');
    },
  );
  test(
    'model cleanup failure does not restore auth or expose storage details',
    () async {
      final vault = ModelChoiceCredentials()
        ..values['cloud.session'] = 'saved-session';
      final client = authClient(vault);
      final repository = CloudRepository(client);
      final auth = AuthController(
        client,
        clearCloudPreferences: repository.clearCloudPreferences,
      );
      addTearDown(() {
        auth.dispose();
        client.close();
        repository.modelSelection.dispose();
      });
      await repository.modelSelection.save(
        'text',
        generation: repository.modelSelection.generation,
      );
      await auth.restore();
      vault.failWrite = true;
      await auth.signOut();
      expect(auth.signedIn, false);
      expect(vault.values['cloud.session'], isNull);
      expect(auth.notice, isNotNull);
      expect(auth.notice, isNot(contains('private storage detail')));
      expect(await repository.modelSelection.read(), isNull);
    },
  );
}
