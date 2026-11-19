import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/app/cloud_navigation.dart';
import 'package:djl_mobile/app/cloud_shell.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/data/cloud_repository.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'package:djl_mobile/features/conversations/presentation/conversation_controller.dart';
import 'package:djl_mobile/features/images/presentation/image_gallery_page.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'settings/settings_controller_test.dart' show MemorySettingsStore;

void main() {
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    for (final outcome in [
      'cancel',
      'cancel during keyboard exit',
      'accepted',
      'navigate away',
      'switch owner',
    ]) {
      testWidgets(
        'gallery creation $outcome keeps its navigation owner on $platform',
        (tester) async {
          debugDefaultTargetPlatformOverride = platform;
          final calls = <String>[];
          final pending = Completer<http.Response>();
          final imageInputs = <Map<String, dynamic>>[];
          final client = CloudClient(
            baseUrl: Uri.parse('https://qa.invalid'),
            credentials: TestCredentials()
              ..values['cloud.session'] = 'qa-session',
            client: MockClient((request) async {
              calls.add('${request.method} ${request.url.path}');
              if (request.url.path == '/v1/conversations/created/images') {
                imageInputs.add(
                  jsonDecode(request.body) as Map<String, dynamic>,
                );
                return pending.future;
              }
              if (request.url.path == '/v1/runs/r/events') {
                return http.Response(
                  'data: {"runId":"r","seq":1,"type":"status","payload":{"status":"succeeded","error":null}}\n\n',
                  200,
                );
              }
              final Object data = switch (request.url.path) {
                '/v1/auth/token' => {'token': 'jwt'},
                '/v1/models' => {
                  'models': [
                    {
                      'id': 'm',
                      'provider': 'anthropic',
                      'status': 'active',
                      'capabilities': ['text.chat'],
                    },
                  ],
                },
                '/v1/client-config' => {
                  'tools': {'imageGeneration': true},
                },
                '/v1/images' => {'images': <Object>[], 'nextCursor': null},
                '/v1/conversations' =>
                  request.method == 'POST'
                      ? {'id': 'created'}
                      : {'conversations': <Object>[], 'nextCursor': null},
                '/v1/conversations/created' => {
                  'conversation': {'id': 'created'},
                  'messages': <Object>[],
                },
                _ => throw StateError(
                  'Unexpected gallery route ${request.url.path}',
                ),
              };
              return http.Response(jsonEncode(data), 200);
            }),
          );
          final repository = CloudRepository(client);
          final nav = CloudNavigationController()
            ..bindOwner('u:o')
            ..show(CloudDestination.images);
          final history = ConversationController(repository);
          final settings = SettingsController(MemorySettingsStore());
          try {
            await tester.pumpWidget(
              MaterialApp(
                theme: djlTheme(Brightness.light),
                home: CloudShell(
                  navigation: nav,
                  history: history,
                  repository: repository,
                  settings: settings,
                  accountScope: 'u:o',
                  contentAllowed: true,
                  settingsPage: (_, _) => const SizedBox.shrink(),
                  onRemote: () {},
                  onAction: (_, _, _) async {},
                  onRefreshProfile: () {},
                ),
              ),
            );
            await tester.pumpAndSettle();
            final galleryState = tester.state(find.byType(ImageGalleryPage));
            await tester.tap(find.byTooltip('Create image'));
            await tester.pumpAndSettle();
            expect(find.text('Make something yours.'), findsOneWidget);
            expect(nav.destination, CloudDestination.images);
            if (outcome.startsWith('cancel')) {
              if (outcome == 'cancel during keyboard exit') {
                tester.view.viewInsets = const FakeViewPadding(bottom: 250);
                await tester.pump();
              }
              await tester.tap(find.widgetWithText(TextButton, 'Close'));
              if (outcome == 'cancel during keyboard exit') {
                await tester.pump(const Duration(milliseconds: 20));
                tester.view.viewInsets = const FakeViewPadding(bottom: 80);
                await tester.pump();
                tester.view.resetViewInsets();
              }
              await tester.pumpAndSettle();
              expect(find.byType(ImageGalleryPage), findsOneWidget);
              expect(
                tester.state(find.byType(ImageGalleryPage)),
                same(galleryState),
              );
              expect(find.byType(ChatPage), findsNothing);
              expect(nav.conversationId, isNull);
              expect(
                calls.where(
                  (c) => c.startsWith('POST') && !c.endsWith('/v1/auth/token'),
                ),
                isEmpty,
              );
            } else {
              await tester.enterText(
                find.byKey(const Key('cloud.images.prompt')),
                'Public gallery QA',
              );
              await tester.pump();
              await tester.tap(
                find.widgetWithText(FilledButton, 'Create image'),
              );
              await tester.pump(const Duration(milliseconds: 100));
              expect(find.text('Starting…'), findsOneWidget);
              expect(nav.destination, CloudDestination.images);
              if (outcome == 'navigate away') {
                nav.show(CloudDestination.notifications);
              }
              if (outcome == 'switch owner') {
                nav.bindOwner('next:o');
                nav.show(CloudDestination.images);
              }
              await tester.pump();
              pending.complete(
                http.Response(
                  jsonEncode({
                    'message': {
                      'id': 'u',
                      'role': 'user',
                      'parts': [
                        {'type': 'text', 'text': 'Public gallery QA'},
                      ],
                    },
                    'reply': {
                      'id': 'a',
                      'parentId': 'u',
                      'role': 'assistant',
                      'runId': 'r',
                      'parts': <Object>[],
                    },
                    'run': {'id': 'r', 'mode': 'task', 'status': 'queued'},
                  }),
                  201,
                ),
              );
              await tester.pumpAndSettle();
              expect(imageInputs, hasLength(1));
              expect(imageInputs.single['prompt'], 'Public gallery QA');
              expect(imageInputs.single['aspectRatio'], '1:1');
              if (outcome == 'accepted') {
                expect(nav.destination, CloudDestination.chat);
                expect(nav.conversationId, 'created');
                expect(
                  tester
                      .widget<ChatPage>(find.byType(ChatPage))
                      .controller
                      .conversation
                      ?.id,
                  'created',
                );
              } else {
                expect(
                  nav.destination,
                  outcome == 'navigate away'
                      ? CloudDestination.notifications
                      : CloudDestination.images,
                );
                expect(nav.conversationId, isNull);
                expect(find.byType(ChatPage), findsNothing);
                if (outcome == 'switch owner') expect(nav.owner, 'next:o');
              }
            }
            expect(tester.takeException(), isNull);
          } finally {
            tester.view.resetViewInsets();
            if (!pending.isCompleted) {
              pending.complete(http.Response('{}', 503));
            }
            await tester.pumpWidget(const SizedBox.shrink());
            await tester.pumpAndSettle();
            nav.dispose();
            history.dispose();
            settings.dispose();
            client.close();
            debugDefaultTargetPlatformOverride = null;
          }
        },
      );
    }
  }
}
