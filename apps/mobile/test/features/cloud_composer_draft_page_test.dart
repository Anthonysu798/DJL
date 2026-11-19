import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/data/cloud_composer_draft_store.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'cloud_composer_draft_store_test.dart'
    show DraftCredentials, draftRecord;
import 'voice_controller_test.dart' show TestVoice;

class DraftPageFixture {
  DraftPageFixture(
    this.vault, {
    this.offlineModels = false,
    this.createReply,
    this.messageReply,
  }) {
    vault.values['cloud.session'] = 'qa-session';
    client = CloudClient(
      baseUrl: Uri.parse('https://qa.invalid'),
      credentials: vault,
      client: MockClient((request) async {
        if (request.method != 'GET') posts++;
        switch (request.url.path) {
          case '/v1/auth/token':
            return http.Response('{"token":"jwt"}', 200);
          case '/v1/models':
            return offlineModels
                ? http.Response('{"error":{"message":"Models offline"}}', 503)
                : http.Response(
                    '{"models":[{"id":"m","displayName":"Model","provider":"anthropic","status":"active","capabilities":["text.chat","vision"]}]}',
                    200,
                  );
          case '/v1/client-config':
            return http.Response('{"tools":{}}', 200);
          case '/v1/conversations':
            creates++;
            return createReply == null ? created() : createReply!.future;
          case '/v1/conversations/created/messages':
            sends++;
            final body = jsonDecode(request.body) as Map;
            sentText = (body['parts'] as List).first['text'] as String;
            return messageReply == null ? accepted() : messageReply!.future;
          case '/v1/runs/r/events':
            return http.Response(
              'data: {"runId":"r","seq":1,"type":"text.delta","payload":{"messageId":"a","text":"reply"}}\n\n'
              'data: {"runId":"r","seq":2,"type":"status","payload":{"status":"succeeded","error":null}}\n\n',
              200,
            );
          default:
            throw StateError('Unexpected QA request ${request.url.path}');
        }
      }),
    );
    repository = CloudRepository(client);
  }
  final DraftCredentials vault;
  final bool offlineModels;
  final Completer<http.Response>? createReply, messageReply;
  late final CloudClient client;
  late final CloudRepository repository;
  int posts = 0, creates = 0, sends = 0;
  String? sentText;
  static http.Response created() =>
      http.Response('{"id":"created","title":"Created"}', 201);
  static http.Response accepted() => http.Response(
    jsonEncode({
      'message': {
        'id': 'u',
        'role': 'user',
        'parts': [
          {'type': 'text', 'text': 'Send once'},
        ],
      },
      'reply': {
        'id': 'a',
        'parentId': 'u',
        'role': 'assistant',
        'runId': 'r',
        'parts': [],
      },
      'run': {'id': 'r', 'status': 'running'},
    }),
    201,
  );
  ChatPage page() => ChatPage(
    controller: ChatController(repository, accountScope: 'u:o'),
    voiceDriver: TestVoice(),
  );
}

void main() {
  test(
    'account reset during draft migration prevents the old controller from sending',
    () async {
      final vault = DraftCredentials();
      final created = Completer<http.Response>();
      final fixture = DraftPageFixture(vault, createReply: created);
      final chat = ChatController(fixture.repository, accountScope: 'u:o');
      addTearDown(() {
        chat.dispose();
        fixture.client.close();
      });
      await chat.initialize();
      chat.updateComposerDraft('Send once');
      await fixture.repository.composerDrafts.read('u:o', 'new');
      final send = chat.send('Send once');
      for (var i = 0; i < 20 && fixture.creates == 0; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(fixture.creates, 1);
      final migration = Completer<void>();
      vault.nextWrite = migration;
      final before = vault.draftWrites;
      created.complete(DraftPageFixture.created());
      for (var i = 0; i < 20 && vault.draftWrites == before; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(vault.draftWrites, before + 1);
      final clear = fixture.repository.composerDrafts.clearAll();
      migration.complete();
      await clear;
      expect(await send, false);
      expect(fixture.sends, 0);
      expect(
        await fixture.repository.composerDrafts.read('u:o', 'created'),
        '',
      );
    },
  );
  testWidgets(
    'saved composer text restores even with models offline and never sends automatically',
    (tester) async {
      final vault = DraftCredentials();
      final store = CloudComposerDraftStore(vault);
      await store.save(
        'u:o',
        'new',
        'draft 🌙\n  spaces  ',
        generation: store.generation,
      );
      final fixture = DraftPageFixture(vault, offlineModels: true);
      await tester.pumpWidget(MaterialApp(home: fixture.page()));
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox.shrink());
        fixture.client.close();
      });
      await tester.pumpAndSettle();
      final composer = find.byKey(const Key('composer'));
      expect(
        tester.widget<TextField>(composer).controller!.text,
        'draft 🌙\n  spaces  ',
      );
      await tester.enterText(composer, 'edited while offline');
      await tester.pumpAndSettle();
      expect(
        await CloudComposerDraftStore(vault).read('u:o', 'new'),
        'edited while offline',
      );
      expect(fixture.posts, 0);
    },
  );

  testWidgets(
    'navigation back and a recreated repository restore the latest ordinary draft',
    (tester) async {
      final vault = DraftCredentials();
      final fixture = DraftPageFixture(vault);
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () {
                  final page = fixture.page();
                  Navigator.of(
                    context,
                  ).push(MaterialPageRoute<void>(builder: (_) => page));
                },
                child: const Text('Open chat'),
              ),
            ),
          ),
        ),
      );
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox.shrink());
        fixture.client.close();
      });
      await tester.tap(find.text('Open chat'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('composer')),
        'latest ordinary draft',
      );
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open chat'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('composer')))
            .controller!
            .text,
        'latest ordinary draft',
      );
      await tester.pumpWidget(const SizedBox.shrink());
      final recreated = DraftPageFixture(vault);
      addTearDown(recreated.client.close);
      await tester.pumpWidget(MaterialApp(home: recreated.page()));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('composer')))
            .controller!
            .text,
        'latest ordinary draft',
      );
      expect(fixture.posts + recreated.posts, 0);
    },
  );

  testWidgets(
    'unreadable saved draft blocks blind editing until an explicit read retry succeeds',
    (tester) async {
      final vault = DraftCredentials()..values[draftRecord] = 'not-json';
      final fixture = DraftPageFixture(vault);
      await tester.pumpWidget(MaterialApp(home: fixture.page()));
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox.shrink());
        fixture.client.close();
      });
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(find.byKey(const Key('composer'))).enabled,
        false,
      );
      expect(vault.values[draftRecord], 'not-json');
      expect(vault.draftWrites, 0);
      vault.values[draftRecord] = '{"u:o":{"new":"kept after retry"}}';
      await tester.tap(find.text('Retry draft'));
      await tester.pumpAndSettle();
      final field = tester.widget<TextField>(find.byKey(const Key('composer')));
      expect(field.enabled, true);
      expect(field.controller!.text, 'kept after retry');
      expect(fixture.posts, 0);
    },
  );

  testWidgets(
    'a failed save keeps visible text and explicit retry persists it',
    (tester) async {
      final vault = DraftCredentials();
      final fixture = DraftPageFixture(vault);
      await tester.pumpWidget(MaterialApp(home: fixture.page()));
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox.shrink());
        fixture.client.close();
      });
      await tester.pumpAndSettle();
      vault.failWrite = true;
      await tester.enterText(
        find.byKey(const Key('composer')),
        'latest unsaved text',
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('composer')))
            .controller!
            .text,
        'latest unsaved text',
      );
      expect(vault.values[draftRecord], isNull);
      expect(find.text('Retry draft'), findsOneWidget);
      vault.failWrite = false;
      await tester.tap(find.text('Retry draft'));
      await tester.pumpAndSettle();
      expect(
        await CloudComposerDraftStore(vault).read('u:o', 'new'),
        'latest unsaved text',
      );
      expect(find.text('Retry draft'), findsNothing);
      expect(fixture.posts, 0);
    },
  );

  for (final stage in ['unchanged', 'creation', 'acknowledgement']) {
    testWidgets(
      'send draft ownership with $stage preserves only the proper follow-up text',
      (tester) async {
        final vault = DraftCredentials();
        final store = CloudComposerDraftStore(vault);
        await store.save(
          'u:o',
          'new',
          'Send once',
          generation: store.generation,
        );
        final held = Completer<http.Response>();
        final fixture = DraftPageFixture(
          vault,
          createReply: stage == 'creation' ? held : null,
          messageReply: stage == 'creation' ? null : held,
        );
        await tester.pumpWidget(MaterialApp(home: fixture.page()));
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox.shrink());
          fixture.client.close();
        });
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('composer')))
              .controller!
              .text,
          'Send once',
        );
        await tester.tap(find.byTooltip('Send message'));
        for (
          var i = 0;
          i < 20 &&
              (stage == 'creation' ? fixture.creates : fixture.sends) == 0;
          i++
        ) {
          await tester.pump(const Duration(milliseconds: 10));
        }
        expect(stage == 'creation' ? fixture.creates : fixture.sends, 1);
        if (stage != 'unchanged') {
          await tester.enterText(
            find.byKey(const Key('composer')),
            'Keep follow-up',
          );
          await tester.pump();
        }
        held.complete(
          stage == 'creation'
              ? DraftPageFixture.created()
              : DraftPageFixture.accepted(),
        );
        await tester.pumpAndSettle();
        final expected = stage == 'unchanged' ? '' : 'Keep follow-up';
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('composer')))
              .controller!
              .text,
          expected,
        );
        final restored = CloudComposerDraftStore(vault);
        expect(await restored.read('u:o', 'new'), '');
        expect(await restored.read('u:o', 'created'), expected);
        expect(fixture.sends, 1);
        expect(fixture.sentText, 'Send once');
        expect(tester.takeException(), isNull);
      },
    );
  }
}
