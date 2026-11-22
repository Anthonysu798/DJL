import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import '../../../core/network/cloud_client.dart';
import '../../../core/network/sse_parser.dart';
import '../domain/cloud_models.dart';
import '../../account/domain/account_snapshot.dart';
import 'cloud_composer_draft_store.dart';
import 'cloud_model_selection_store.dart';
import '../../../l10n/l10n.dart';

class RunStream {
  RunStream(this.stream, this.cancel);
  final Stream<Json> stream;
  final void Function() cancel;
}

class CloudRepository {
  CloudRepository(this.client)
    : composerDrafts = CloudComposerDraftStore(client.credentials),
      modelSelection = CloudModelSelectionStore(client.credentials);
  final CloudClient client;
  final CloudComposerDraftStore composerDrafts;
  final CloudModelSelectionStore modelSelection;
  Future<void> clearCloudPreferences() async {
    await Future.wait<void>([
      composerDrafts.clearAll(),
      modelSelection.clear(),
    ]);
  }

  Future<CloudUsageSnapshot> usage() async => CloudUsageSnapshot.fromJson(
    await client.request('GET', 'v1/usage/windows'),
  );

  Future<CloudUsageSnapshot> redeemUsageReset(String idempotencyKey) async {
    final response = await client.request(
      'POST',
      'v1/usage/resets/redeem',
      body: {'idempotencyKey': idempotencyKey},
    );
    return CloudUsageSnapshot.fromJson(response['usage'] as Json);
  }

  Future<Json> list({String? cursor, bool archived = false}) => client.request(
    'GET',
    'v1/conversations',
    query: {'archived': '$archived', 'cursor': ?cursor},
  );
  Future<ConversationDetail> detail(String id) async =>
      ConversationDetail.fromJson(
        await client.request(
          'GET',
          'v1/conversations/${Uri.encodeComponent(id)}',
        ),
      );
  Future<Conversation> create(String clientId) async => Conversation.fromJson(
    await client.request(
      'POST',
      'v1/conversations',
      body: {'clientConversationId': clientId},
    ),
  );
  Future<Json> search(String query) =>
      client.request('GET', 'v1/conversations/search', query: {'q': query});
  Future<void> update(String id, Json patch) async {
    await client.request(
      'PATCH',
      'v1/conversations/${Uri.encodeComponent(id)}',
      body: patch,
    );
  }

  Future<void> delete(String id) async {
    await client.request(
      'DELETE',
      'v1/conversations/${Uri.encodeComponent(id)}',
    );
  }

  Future<Json> send(
    String id,
    SendInput input, {
    Duration retryDelay = const Duration(milliseconds: 400),
  }) async {
    for (var attempt = 0; ; attempt++) {
      try {
        return await client.request(
          'POST',
          'v1/conversations/${Uri.encodeComponent(id)}/messages',
          body: input.toJson(),
        );
      } on CloudFailure catch (error) {
        if (!error.retryable || attempt >= 2) rethrow;
        await Future<void>.delayed(retryDelay * (attempt + 1));
      }
    }
  }

  Future<Json> regenerate(
    String id,
    String messageId,
    String model,
  ) => client.request(
    'POST',
    'v1/conversations/${Uri.encodeComponent(id)}/messages/${Uri.encodeComponent(messageId)}/regenerate',
    body: {'model': model},
  );
  Future<Json> image(String id, Json input) => client.request(
    'POST',
    'v1/conversations/${Uri.encodeComponent(id)}/images',
    body: input,
  );
  Future<Json> run(String id) =>
      client.request('GET', 'v1/runs/${Uri.encodeComponent(id)}');
  Future<void> stop(String id) async {
    await client.request('POST', 'v1/runs/${Uri.encodeComponent(id)}/cancel');
  }

  Future<Json> share(String id, String messageId) => client.request(
    'POST',
    'v1/conversations/${Uri.encodeComponent(id)}/shares',
    body: {'messageId': messageId},
  );
  Future<String> fileUrl(String id) async =>
      (await client.request(
            'GET',
            'v1/files/${Uri.encodeComponent(id)}/url',
          ))['url']
          as String;
  Future<Uint8List> fileData(String id) async {
    final url = await fileUrl(id);
    final storage = http.Client();
    try {
      final response = await storage
          .get(Uri.parse(url))
          .timeout(const Duration(seconds: 30));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw CloudFailure.response(response.statusCode, response.body);
      }
      return response.bodyBytes;
    } finally {
      storage.close();
    }
  }

  Future<Json> upload(String name, String mime, Uint8List bytes) async {
    final presign = await client.request(
      'POST',
      'v1/files',
      body: {
        'name': name,
        'mimeType': mime,
        'size': bytes.length,
        'sha256': sha256.convert(bytes).toString(),
        'purpose': mime.startsWith('image/') ? 'image' : 'attachment',
      },
    );
    final upload = presign['upload'] as Json;
    // A dedicated, unauthenticated client prevents bearer leakage to signed storage URLs.
    final storage = http.Client();
    try {
      final request =
          http.Request(
              upload['method'] as String,
              Uri.parse(upload['url'] as String),
            )
            ..headers.addAll(Map<String, String>.from(upload['headers'] as Map))
            ..bodyBytes = bytes;
      final response = await storage
          .send(request)
          .timeout(const Duration(minutes: 2));
      final body = await response.stream.bytesToString();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw CloudFailure.response(response.statusCode, body);
      }
    } finally {
      storage.close();
    }
    final file = await client.request(
      'POST',
      'v1/files/${(presign['file'] as Json)['id']}/complete',
    );
    return {
      'type': mime.startsWith('image/') ? 'image_ref' : 'file_ref',
      'fileId': file['id'],
      'mimeType': mime,
      if (mime.startsWith('image/')) ...{
        'width': null,
        'height': null,
      } else ...{
        'name': name,
        'size': bytes.length,
      },
    };
  }

  RunStream watch(String id, {int after = 0}) {
    final cancelled = Completer<void>();
    final version = client.revision;
    Stream<Json> events() async* {
      var seq = after, failures = 0;
      while (!cancelled.isCompleted && client.revision == version) {
        try {
          final authorized = await client.authorizedRequest(
            'GET',
            'v1/runs/${Uri.encodeComponent(id)}/events',
            query: {'after': '$seq'},
          );
          if (cancelled.isCompleted || client.revision != version) return;
          final request =
              http.AbortableRequest(
                  'GET',
                  authorized.url,
                  abortTrigger: cancelled.future,
                )
                ..headers.addAll(authorized.headers)
                ..headers['Accept'] = 'text/event-stream';
          final response = await client.open(request);
          if (cancelled.isCompleted || client.revision != version) {
            if (!cancelled.isCompleted) cancelled.complete();
            return;
          }
          if (response.statusCode == 401) {
            final body = await response.stream.bytesToString();
            if (cancelled.isCompleted || client.revision != version) return;
            final error = CloudFailure.response(401, body);
            if (error.code == 'session_revoked') {
              await client.setSession(null);
              if (client.revision != version + 1) return;
              client.onSessionEnded?.call();
              throw error;
            }
            client.invalidateAccessToken();
            throw const CloudFailure(0, 'refresh', 'Refreshing session');
          }
          if (response.statusCode != 200) {
            throw CloudFailure.response(
              response.statusCode,
              await response.stream.bytesToString(),
            );
          }
          final parser = SseParser();
          await for (final chunk in response.stream) {
            if (cancelled.isCompleted || client.revision != version) return;
            for (final frame in parser.feed(chunk)) {
              final event = jsonDecode(frame.data) as Json;
              final next = event['seq'] as int;
              if (event['runId'] != id || next <= seq) continue;
              if (next != seq + 1) throw EventGap(seq + 1, next);
              seq = next;
              failures = 0;
              yield event;
              if (event['type'] == 'status' &&
                  {
                    'succeeded',
                    'failed',
                    'cancelled',
                    'blocked_on_usage',
                  }.contains((event['payload'] as Json)['status'])) {
                return;
              }
            }
          }
        } on CloudFailure catch (error) {
          if (!error.retryable) rethrow;
        } on http.RequestAbortedException {
          if (cancelled.isCompleted) return;
        } on EventGap {
          /* Resume from the last contiguous event. */
        } on http.ClientException {
          /* Network changed; resume the same run. */
        }
        if (cancelled.isCompleted) return;
        if (++failures > 8) {
          throw CloudFailure(
            0,
            'disconnected',
            appStrings.cloudChatLostConnection,
          );
        }
        await Future.any([
          Future<void>.delayed(Duration(seconds: failures.clamp(1, 5))),
          cancelled.future,
        ]);
      }
    }

    return RunStream(events(), () {
      if (!cancelled.isCompleted) cancelled.complete();
    });
  }
}
