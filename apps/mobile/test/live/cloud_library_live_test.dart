import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:uuid/uuid.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'package:djl_mobile/features/account/data/account_repository.dart';
import 'package:djl_mobile/features/images/data/image_repository.dart';
import 'package:djl_mobile/features/images/domain/gallery_image.dart';
import 'package:djl_mobile/features/notifications/data/notification_repository.dart';
import 'package:djl_mobile/features/notifications/domain/cloud_notification.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

void main() {
  test(
    'real queued image generation, signed download, gallery, account and notification read',
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
      try {
        await client.setSession(
          await client.authenticate('sign-in/email', {
            'email': config['email'],
            'password': config['password'],
          }),
        );
        final repository = CloudRepository(client),
            conversation = await CloudRepository(
              client,
            ).create(const Uuid().v4());
        final result = await repository.image(conversation.id, {
          'clientMessageId': const Uuid().v4(),
          'prompt': 'A blue desk for disposable mobile QA',
          'aspectRatio': '4:3',
        });
        final reply = ChatMessage.fromJson(result['reply'] as Json);
        final reducer = RunReducer(
          runId: (result['run'] as Json)['id'] as String,
          messages: [reply],
        );
        final watch = repository.watch(reducer.runId);
        try {
          await for (final event in watch.stream.timeout(
            const Duration(seconds: 75),
          )) {
            reducer.apply(event);
          }
        } finally {
          watch.cancel();
        }
        expect(reducer.status, 'succeeded', reason: reducer.error?.toString());
        final part = reply.parts.firstWhere((p) => p['type'] == 'image_ref');
        final gallery = await ImageRepository(client).page();
        final image = (gallery['images'] as List)
            .map((j) => GalleryImage.fromJson(j as Json))
            .firstWhere((i) => i.fileId == part['fileId']);
        expect(image.conversationId, conversation.id);
        expect(await repository.fileData(image.fileId), isNotEmpty);
        final account = await AccountRepository(client).load();
        expect(account.email, config['email']);
        expect(account.credits, isNotEmpty);
        final notifications = NotificationRepository(client);
        final page = await notifications.page();
        final notice = (page['notifications'] as List)
            .map((j) => CloudNotification.fromJson(j as Json))
            .firstWhere((n) => n.id == reducer.runId);
        expect(notice.unread, isTrue);
        await notifications.markRead([notice.id]);
        final after = await notifications.page();
        expect(
          (after['notifications'] as List)
              .map((j) => CloudNotification.fromJson(j as Json))
              .firstWhere((n) => n.id == notice.id)
              .unread,
          isFalse,
        );
      } finally {
        client.close();
      }
    },
    skip: Platform.environment['DJL_LOCAL_QA'] != '1'
        ? 'Requires disposable local API, storage and worker.'
        : false,
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
