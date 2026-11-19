import '../support/open_cloud.dart';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_root_routing_test.dart' show RoutingDesktop;
import 'desktop_subagents_test.dart' show SubagentTransport;
import 'settings/app_lock_controller_test.dart' show FakeOwnerAuth;

void main() {
  for (final action in ['Archive', 'Delete', 'Stale Delete']) {
    testWidgets(
      'Source drawer cancels deletion, closes for linked chat, and resets only the $action selection',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        final vault = TestCredentials()..values['cloud.session'] = 'session';
        final writes = <String>[];
        var archived = false, conversationCreated = false;
        final cloud = CloudClient(
          baseUrl: Uri.parse('https://example.test'),
          credentials: vault,
          client: MockClient((request) async {
            final path = request.url.path;
            if (request.method == 'PATCH' || request.method == 'DELETE') {
              writes.add('${request.method} $path ${request.body}');
              archived = true;
            }
            if (path == '/v1/conversations/c1') conversationCreated = true;
            final Object response = switch (path) {
              '/v1/auth/token' => {'token': 'jwt'},
              '/v1/me' => {
                'user': {'id': 'u'},
                'activeOrgId': 'o',
              },
              '/v1/models' => {'models': []},
              '/v1/conversations' => {
                'conversations': [
                  if (!archived && conversationCreated)
                    {'id': 'c1', 'title': 'Owned drawer chat', 'pinned': true},
                ],
                'nextCursor': null,
              },
              '/v1/conversations/c1' => {
                'conversation': {'id': 'c1', 'title': 'Owned drawer chat'},
                'messages': [],
              },
              _ => {},
            };
            return http.Response(jsonEncode(response), 200);
          }),
        );
        final links = StreamController<Uri>.broadcast(sync: true);
        final desktop = RoutingDesktop(SubagentTransport());
        final lock = AppLockController(FakeOwnerAuth()..result = true);
        try {
          await tester.pumpWidget(
            DjlApp(
              client: cloud,
              desktop: desktop,
              appLock: lock,
              linkStream: links.stream,
              initialLink: Future.value(null),
            ),
          );
          await tester.pumpAndSettle();
          await openCloudFromDesktop(tester);
          await tester.tap(find.byTooltip('Open navigation'));
          await tester.pumpAndSettle();
          links.add(Uri.parse('djl://cloud/c/c1'));
          await tester.pumpAndSettle();
          expect(
            find.text('Pinned'),
            findsNothing,
            reason: 'An external selection closes the drawer.',
          );
          expect(
            tester
                .widget<ChatPage>(find.byType(ChatPage))
                .controller
                .conversation
                ?.id,
            'c1',
          );
          await tester.tap(find.byTooltip('Open navigation'));
          await tester.pumpAndSettle();
          await tester.longPress(find.text('Owned drawer chat'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Delete'));
          await tester.pumpAndSettle();
          expect(
            find.byKey(const ValueKey('cloud-chat-delete-confirmation')),
            findsOneWidget,
          );
          expect(find.text('Delete this chat?'), findsNothing);
          expect(find.text('Cancel'), findsNothing);
          final popup = tester.getRect(
            find.byKey(const ValueKey('cloud-chat-delete-confirmation')),
          );
          expect(popup.width, 240);
          expect(popup.left, greaterThan(0));
          expect(popup.right, lessThanOrEqualTo(800));
          await tester.tapAt(const Offset(790, 100));
          await tester.pumpAndSettle();
          expect(writes, isEmpty);
          expect(
            tester
                .widget<ChatPage>(find.byType(ChatPage))
                .controller
                .conversation
                ?.id,
            'c1',
          );
          await tester.longPress(find.text('Owned drawer chat'));
          await tester.pumpAndSettle();
          await tester.tap(
            find.text(action == 'Stale Delete' ? 'Delete' : action),
          );
          await tester.pumpAndSettle();
          if (action != 'Archive') {
            expect(
              writes,
              isEmpty,
              reason: 'Opening the review must not delete.',
            );
            if (action == 'Stale Delete') await cloud.setSession('replacement');
            await tester.tap(find.text('Delete'));
            await tester.pumpAndSettle();
          }
          if (action == 'Stale Delete') {
            expect(writes, isEmpty);
            expect(
              tester
                  .widget<ChatPage>(find.byType(ChatPage))
                  .controller
                  .conversation
                  ?.id,
              'c1',
            );
            expect(tester.takeException(), isNull);
            return;
          }
          expect(find.text('Pinned'), findsNothing);
          expect(
            tester
                .widget<ChatPage>(find.byType(ChatPage))
                .controller
                .conversation,
            isNull,
          );
          expect(writes, [
            action == 'Archive'
                ? 'PATCH /v1/conversations/c1 {"archived":true}'
                : 'DELETE /v1/conversations/c1 ',
          ]);
          expect(tester.takeException(), isNull);
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          await links.close();
          desktop.dispose();
          lock.dispose();
        }
      },
    );
  }
}
