import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/domain/cloud_models.dart';
import 'package:djl_mobile/features/chat/presentation/chat_controller.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'cloud_composer_draft_store_test.dart' show DraftCredentials;
import 'voice_controller_test.dart' show TestVoice;

const originalFile = <String, dynamic>{
  'type': 'file_ref',
  'fileId': '11111111-1111-4111-8111-111111111111',
  'name': 'original.txt',
  'mimeType': 'text/plain',
};
const followUpFile = <String, dynamic>{
  'type': 'file_ref',
  'fileId': '22222222-2222-4222-8222-222222222222',
  'name': 'follow-up.txt',
  'mimeType': 'text/plain',
  '_displayName': 'follow-up.txt',
};

class EditAttachmentsFixture {
  EditAttachmentsFixture() {
    credentials.values['cloud.session'] = 'qa-session';
    client = CloudClient(
      baseUrl: Uri.parse('https://qa.invalid'),
      credentials: credentials,
      client: MockClient((request) async {
        switch (request.url.path) {
          case '/v1/auth/token':
            return http.Response('{"token":"jwt"}', 200);
          case '/v1/client-config':
            return http.Response('{"tools":{}}', 200);
          case '/v1/models':
            return http.Response(
              '{"models":[{"id":"m","displayName":"Model","provider":"anthropic","status":"active","capabilities":["text.chat","vision"]}]}',
              200,
            );
          case '/v1/conversations/c':
            return http.Response(
              jsonEncode({
                'conversation': {'id': 'c'},
                'messages': [original],
              }),
              200,
            );
          case '/v1/conversations/c/messages':
            final input = jsonDecode(request.body) as Json;
            inputs.add(input);
            if (rejectSends) {
              return http.Response(
                '{"error":{"message":"QA unavailable"}}',
                503,
              );
            }
            return http.Response(
              jsonEncode({
                'message': {'id': 'edited', 'role': 'user', ...input},
                'reply': {
                  'id': 'reply',
                  'role': 'assistant',
                  'parentId': 'edited',
                  'runId': 'r',
                  'parts': [],
                },
                'run': {'id': 'r', 'status': 'running'},
              }),
              201,
            );
          case '/v1/runs/r/events':
            return http.Response(
              'data: {"runId":"r","seq":1,"type":"status","payload":{"status":"succeeded","error":null}}\n\n',
              200,
            );
          default:
            throw StateError('Unexpected QA request ${request.url.path}');
        }
      }),
    );
    chat = ChatController(
      CloudRepository(client),
      accountScope: 'u:o',
      conversation: const Conversation(id: 'c'),
    );
  }

  final credentials = DraftCredentials();
  final inputs = <Json>[];
  bool rejectSends = false;
  late final CloudClient client;
  late final ChatController chat;
  final original = <String, dynamic>{
    'id': 'original',
    'role': 'user',
    'parentId': null,
    'parts': [
      {'type': 'text', 'text': 'Owned attached prompt'},
      originalFile,
    ],
  };

  Future<void> submitEdit(WidgetTester tester) async {
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox.shrink());
      client.close();
    });
    await tester.pumpWidget(
      MaterialApp(
        home: ChatPage(controller: chat, voiceDriver: TestVoice()),
      ),
    );
    await tester.pumpAndSettle();
    chat.attachments.add(Map<String, dynamic>.from(followUpFile));
    chat.updateComposerDraft('Unsent follow-up');
    chat.notifyListeners();
    await tester.pumpAndSettle();
    await tester.longPress(find.text('Owned attached prompt'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Edit'));
    await tester.pumpAndSettle();
    final field = find.byWidgetPredicate(
      (widget) =>
          widget is TextField &&
          widget.controller?.text == 'Owned attached prompt',
    );
    await tester.enterText(field, 'Edited attached prompt');
    await tester.pumpAndSettle();
    expect(inputs, isEmpty);
    await tester.tap(find.text('Send'));
    await tester.pumpAndSettle();
  }
}

void main() {
  for (final message in ['The user did not allow camera access.', null]) {
    testWidgets('camera denial is readable and retains the draft: $message', (
      tester,
    ) async {
      const picker = MethodChannel('plugins.flutter.io/image_picker');
      var attempts = 0;
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(picker, (call) async {
        if (call.method != 'pickImage') {
          throw StateError('Unexpected picker call');
        }
        attempts++;
        throw PlatformException(code: 'camera_access_denied', message: message);
      });
      addTearDown(() => messenger.setMockMethodCallHandler(picker, null));
      final fixture = EditAttachmentsFixture();
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox.shrink());
        fixture.client.close();
      });
      await tester.pumpWidget(
        MaterialApp(
          home: ChatPage(controller: fixture.chat, voiceDriver: TestVoice()),
        ),
      );
      await tester.pumpAndSettle();
      final draft = find.byType(TextField).first;
      await tester.enterText(draft, 'Keep this unsent camera QA draft');
      await tester.tap(find.byTooltip('Attach file or image'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Camera'));
      await tester.pumpAndSettle();
      expect(attempts, 1);
      expect(
        find.text(message ?? 'Could not open the picker. Please try again.'),
        findsOneWidget,
      );
      expect(find.textContaining('PlatformException'), findsNothing);
      expect(fixture.inputs, isEmpty);
      expect(fixture.chat.attachments, isEmpty);
      expect(
        tester.widget<TextField>(draft).controller!.text,
        'Keep this unsent camera QA draft',
      );
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Attach file or image'));
      await tester.pumpAndSettle();
      expect(find.text('Choose file'), findsOneWidget);
      expect(find.text('Photo library'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  test(
    'Edit rejects blank text, assistant messages and messages outside this conversation',
    () async {
      final fixture = EditAttachmentsFixture();
      addTearDown(() {
        fixture.chat.dispose();
        fixture.client.close();
      });
      await fixture.chat.initialize();
      expect(
        await fixture.chat.edit(fixture.chat.messages.single, ' \n '),
        isFalse,
      );
      for (final message in [
        ChatMessage(id: 'foreign', role: 'user', parts: const []),
        ChatMessage(id: 'original', role: 'assistant', parts: const []),
      ]) {
        expect(await fixture.chat.edit(message, 'Changed'), isFalse);
      }
      expect(fixture.inputs, isEmpty);
    },
  );

  test(
    'Edit vision validation uses the original message rather than an unrelated draft image',
    () async {
      final fixture = EditAttachmentsFixture();
      addTearDown(() {
        fixture.chat.dispose();
        fixture.client.close();
      });
      await fixture.chat.initialize();
      fixture.chat.models.single['capabilities'] = ['text.chat'];
      final fileMessage = fixture.chat.messages.single;
      const image = <String, dynamic>{
        'type': 'image_ref',
        'fileId': '33333333-3333-4333-8333-333333333333',
        'mimeType': 'image/png',
      };
      final imageMessage = ChatMessage(
        id: 'original',
        role: 'user',
        parts: [image],
      );
      fixture.chat.messages = [imageMessage];
      expect(await fixture.chat.edit(imageMessage, 'Image question'), isFalse);
      expect(fixture.inputs, isEmpty);
      fixture.chat.attachments.add({...image, '_displayName': 'Later image'});
      fixture.chat.messages = [fileMessage];
      expect(
        await fixture.chat.edit(fixture.chat.messages.single, 'File question'),
        isTrue,
      );
      expect(fixture.inputs.single['parts'], [
        {'type': 'text', 'text': 'File question'},
        originalFile,
      ]);
      expect(fixture.chat.attachments.single['fileId'], image['fileId']);
    },
  );

  testWidgets('Editing keeps the original file in the new sibling payload', (
    tester,
  ) async {
    final fixture = EditAttachmentsFixture();
    await fixture.submitEdit(tester);
    expect(fixture.inputs.single['parts'], [
      {'type': 'text', 'text': 'Edited attached prompt'},
      originalFile,
    ]);
    expect(fixture.inputs.single['parentId'], isNull);
    expect(fixture.chat.messages.first.parts, fixture.original['parts']);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'Editing does not send or consume a different composer attachment',
    (tester) async {
      final fixture = EditAttachmentsFixture();
      await fixture.submitEdit(tester);
      expect(fixture.chat.attachments, [followUpFile]);
      expect(fixture.chat.composerDraft, 'Unsent follow-up');
      expect(find.text('follow-up.txt'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Explicit edit retry keeps its id and original file without consuming the composer',
    (tester) async {
      final fixture = EditAttachmentsFixture()..rejectSends = true;
      await fixture.submitEdit(tester);
      expect(fixture.inputs, hasLength(3));
      expect(
        fixture.inputs.every(
          (input) =>
              input['clientMessageId'] ==
              fixture.inputs.first['clientMessageId'],
        ),
        isTrue,
      );
      expect(fixture.chat.attachments, [followUpFile]);
      fixture.rejectSends = false;
      expect(await fixture.chat.retry(), isTrue);
      await tester.pumpAndSettle();
      expect(fixture.inputs, hasLength(4));
      expect(fixture.inputs.last, fixture.inputs.first);
      expect(fixture.inputs.last['parts'], [
        {'type': 'text', 'text': 'Edited attached prompt'},
        originalFile,
      ]);
      expect(fixture.chat.attachments, [followUpFile]);
      expect(fixture.chat.composerDraft, 'Unsent follow-up');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Restored interrupted edit retries only explicitly and keeps later composer attachments',
    (tester) async {
      final fixture = EditAttachmentsFixture()..rejectSends = true;
      await fixture.submitEdit(tester);
      expect(fixture.inputs, hasLength(3));
      await tester.pumpWidget(const SizedBox.shrink());
      final restored = ChatController(
        fixture.chat.repository,
        accountScope: 'u:o',
        conversation: const Conversation(id: 'c'),
      );
      addTearDown(restored.dispose);
      await restored.initialize();
      expect(fixture.inputs, hasLength(3));
      expect(restored.composerDraft, 'Unsent follow-up');
      restored.attachments.add(Map<String, dynamic>.from(followUpFile));
      fixture.rejectSends = false;
      expect(await restored.retry(), isTrue);
      await tester.pumpAndSettle();
      expect(fixture.inputs, hasLength(4));
      expect(fixture.inputs.last, fixture.inputs.first);
      expect(restored.attachments, [followUpFile]);
      expect(restored.composerDraft, 'Unsent follow-up');
      expect(tester.takeException(), isNull);
    },
  );
}
