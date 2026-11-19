import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:uuid/uuid.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

void main() {
  test(
    'existing Cloud service: auth, JWT, history, uploads, streaming, branches and sign-out',
    () async {
      final config =
          jsonDecode(
                File('/tmp/djl-mobile-qa/credentials.json').readAsStringSync(),
              )
              as Json;
      final client = CloudClient(
        baseUrl: Uri.parse(config['endpoint'] as String),
        credentials: TestCredentials(),
      );
      final repository = CloudRepository(client);
      try {
        final token = await client.authenticate('sign-in/email', {
          'email': config['email'],
          'password': config['password'],
        });
        expect(token, isNotNull);
        await client.setSession(token);
        final me = await client.request('GET', 'v1/me');
        expect((me['user'] as Json)['email'], config['email']);
        final catalog = await client.request('GET', 'v1/models');
        final models = (catalog['models'] as List)
            .cast<Json>()
            .where((m) => m['status'] == 'active')
            .toList();
        expect(models, isNotEmpty);
        final model = models.first['id'] as String;
        final creationId = const Uuid().v4();
        final conversation = await repository.create(creationId);
        expect((await repository.create(creationId)).id, conversation.id);
        final attachment = await repository.upload(
          'mobile-qa.txt',
          'text/plain',
          Uint8List.fromList(utf8.encode('Disposable mobile upload test.')),
        );
        expect(attachment['type'], 'file_ref');
        final input = SendInput(
          clientMessageId: const Uuid().v4(),
          parentId: null,
          parts: [
            {'type': 'text', 'text': 'Flutter mobile streaming acceptance'},
            attachment,
          ],
          model: model,
          mode: 'chat',
        );
        final response = await repository.send(conversation.id, input);
        final duplicate = await repository.send(conversation.id, input);
        expect(
          (duplicate['message'] as Json)['id'],
          (response['message'] as Json)['id'],
        );
        final reply = ChatMessage.fromJson(response['reply'] as Json);
        final run = RunReducer(
          runId: (response['run'] as Json)['id'] as String,
          messages: [reply],
        );
        final watch = repository.watch(run.runId);
        try {
          await for (final event in watch.stream.timeout(
            const Duration(seconds: 30),
          )) {
            run.apply(event);
          }
        } finally {
          watch.cancel();
        }
        expect(run.status, 'succeeded', reason: run.error?.toString());
        expect(reply.text, isNotEmpty);
        expect(
          (await repository.detail(conversation.id)).messages,
          hasLength(2),
        );
        await repository.update(conversation.id, {
          'title': 'Flutter mobile QA',
          'pinned': true,
        });
        expect(
          (await repository.detail(conversation.id)).conversation.pinned,
          isTrue,
        );
        expect(
          (await repository.search('Flutter mobile QA'))['results'],
          isNotEmpty,
        );
        final share = await repository.share(conversation.id, reply.id);
        expect(share['url'], isNotNull);
        final regenerated = await repository.regenerate(
          conversation.id,
          reply.id,
          model,
        );
        expect((regenerated['reply'] as Json)['id'], isNot(reply.id));
        await repository.stop((regenerated['run'] as Json)['id'] as String);
        await repository.update(conversation.id, {'archived': true});
        expect(
          (await repository.list(archived: true))['conversations'],
          isNotEmpty,
        );
        await client.signOut();
        expect(await client.signedIn, isFalse);
        await expectLater(
          client.request('GET', 'v1/me'),
          throwsA(
            isA<CloudFailure>().having(
              (e) => e.unauthorized,
              'unauthorized',
              true,
            ),
          ),
        );
      } finally {
        client.close();
      }
    },
    skip: Platform.environment['DJL_LOCAL_QA'] != '1'
        ? 'Requires explicitly started disposable local QA API.'
        : false,
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
