import '../support/open_cloud.dart';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'package:djl_mobile/features/notifications/presentation/notification_banner.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'settings/settings_controller_test.dart' show MemorySettingsStore;
import 'notification_alert_test.dart' show notification;

void main() {
  testWidgets(
    'held alert read cannot navigate using a replacement Cloud session',
    (tester) async {
      final credentials = TestCredentials()
        ..values['cloud.session'] = 'old-session';
      final settings = SettingsController(MemorySettingsStore());
      final held = Completer<http.Response>();
      var pages = 0, targetReads = 0, markStarted = false;
      final client = CloudClient(
        baseUrl: Uri.parse('https://qa.invalid'),
        credentials: credentials,
        client: MockClient((request) async {
          final path = request.url.path;
          Object body = {};
          if (path == '/v1/auth/token') body = {'token': 'jwt'};
          if (path == '/v1/me') {
            body = {
              'user': {'id': 'user'},
              'activeOrgId': 'org',
            };
          }
          if (path == '/v1/models') body = {'models': []};
          if (path == '/v1/conversations') {
            body = {'conversations': [], 'nextCursor': null};
          }
          if (path == '/v1/notifications') {
            pages++;
            body = {
              'notifications': [
                if (pages > 1)
                  notification('held', conversation: 'old-account-chat'),
              ],
              'unreadCount': pages == 1 ? 0 : 1,
              'nextCursor': null,
            };
          }
          if (path == '/v1/notifications/read') {
            markStarted = true;
            return held.future;
          }
          if (path == '/v1/conversations/old-account-chat') {
            targetReads++;
            body = {
              'conversation': {'id': 'old-account-chat'},
              'messages': [],
            };
          }
          return http.Response(jsonEncode(body), 200);
        }),
      );
      await tester.pumpWidget(
        DjlApp(
          client: client,
          settings: settings,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox.shrink());
        settings.dispose();
      });
      await tester.pumpAndSettle();
      await openCloudFromDesktop(tester);
      await tester.pump(const Duration(seconds: 15));
      await tester.pumpAndSettle();
      final oldBanner = tester.widget<CloudNotificationBanner>(
        find.byType(CloudNotificationBanner),
      );
      await tester.tap(find.text('Task finished'));
      await tester.pump();
      expect(markStarted, true);
      await client.setSession('replacement-session');
      held.complete(http.Response('{"unreadCount":0}', 200));
      await tester.pumpAndSettle();
      expect(targetReads, 0);
      expect(find.byType(ChatPage), findsOneWidget);
      expect(
        tester.widget<ChatPage>(find.byType(ChatPage)).controller.conversation,
        isNull,
      );
      await settings.setTheme(ThemeMode.dark);
      await tester.pumpAndSettle();
      oldBanner.onOpen();
      await tester.pumpAndSettle();
      expect(targetReads, 0);
      expect(find.byType(ChatPage), findsOneWidget);
      expect(
        tester.widget<ChatPage>(find.byType(ChatPage)).controller.conversation,
        isNull,
      );
    },
  );
  testWidgets(
    'account-scoped foreground banner opens its server conversation, respects the alert switch, and never sends',
    (tester) async {
      final credentials = TestCredentials()
        ..values['cloud.session'] = 'qa-session';
      final settings = SettingsController(MemorySettingsStore());
      var pages = 0, sends = 0;
      final reads = <String>[], marked = <List<dynamic>>[];
      final client = CloudClient(
        baseUrl: Uri.parse('https://qa.invalid'),
        credentials: credentials,
        client: MockClient((request) async {
          final path = request.url.path;
          Object body = {};
          if (path == '/v1/auth/token') body = {'token': 'jwt'};
          if (path == '/v1/me') {
            body = {
              'user': {'id': 'user', 'email': 'qa@example.invalid'},
              'activeOrgId': 'org',
            };
          }
          if (path == '/v1/conversations') {
            body = {'conversations': [], 'nextCursor': null};
          }
          if (path == '/v1/notifications') {
            pages++;
            body = {
              'notifications': [
                if (pages > 1)
                  notification(
                    'new-$pages',
                    conversation: 'destination-$pages',
                  ),
                notification('old'),
              ],
              'unreadCount': pages == 1 ? 1 : 2,
              'nextCursor': null,
            };
          }
          if (path == '/v1/notifications/read') {
            marked.add((jsonDecode(request.body) as Map)['ids'] as List);
            body = {'unreadCount': 1};
          }
          if (path == '/v1/models') body = {'models': []};
          if (path.startsWith('/v1/conversations/')) {
            reads.add(path);
            if (request.method == 'POST') sends++;
            body = {
              'conversation': {
                'id': request.url.pathSegments.last,
                'title': 'Banner destination',
              },
              'messages': [],
            };
          }
          return http.Response(jsonEncode(body), 200);
        }),
      );
      await tester.pumpWidget(
        DjlApp(
          client: client,
          settings: settings,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox.shrink());
        settings.dispose();
      });
      await tester.pumpAndSettle();
      await openCloudFromDesktop(tester);
      expect(pages, 1);
      final nextPoll = tester.binding.clock.now().add(
        const Duration(seconds: 15),
      );
      expect(find.text('Task finished'), findsNothing);
      if (find.byTooltip('Settings').evaluate().isEmpty) {
        await tester.tap(find.byTooltip('Open navigation'));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.byTooltip('Settings'));
      await tester.pumpAndSettle();
      for (final label in ['In-app alerts', 'Speak new replies']) {
        final row = find.byKey(Key('cloud.settings.$label'));
        await tester.ensureVisible(row);
        await tester.pumpAndSettle();
        await tester.tap(row);
        await tester.pumpAndSettle();
        await tester.tap(row);
        await tester.pumpAndSettle();
      }
      expect(settings.inAppAlerts, true);
      expect(settings.spokenReplies, false);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      // Advance to the poll, without also consuming the six-second banner lifetime.
      await tester.pump(nextPoll.difference(tester.binding.clock.now()));
      await tester.pumpAndSettle();
      expect(pages, 2);
      expect(find.text('Task finished'), findsOneWidget);
      final semantics = tester.ensureSemantics();
      late Rect nativeHitBounds;
      try {
        await tester.pump();
        final node = tester.getSemantics(find.text('Task finished'));
        expect(node.getSemanticsData().hasAction(SemanticsAction.tap), true);
        nativeHitBounds = node.rect;
        for (
          SemanticsNode? current = node;
          current != null;
          current = current.parent
        ) {
          if (current.transform case final transform?) {
            nativeHitBounds = MatrixUtils.transformRect(
              transform,
              nativeHitBounds,
            );
          }
        }
        final ratio = tester.view.devicePixelRatio;
        nativeHitBounds = Rect.fromLTRB(
          nativeHitBounds.left / ratio,
          nativeHitBounds.top / ratio,
          nativeHitBounds.right / ratio,
          nativeHitBounds.bottom / ratio,
        );
      } finally {
        semantics.dispose();
      }
      await tester.tapAt(nativeHitBounds.center);
      await tester.pumpAndSettle();
      expect(
        marked,
        [
          ['new-2'],
        ],
        reason:
            'Tap at the native accessibility bounds center: $nativeHitBounds',
      );
      expect(reads, ['/v1/conversations/destination-2']);
      expect(
        tester
            .widget<ChatPage>(find.byType(ChatPage))
            .controller
            .conversation
            ?.id,
        'destination-2',
      );
      expect(find.text('Task finished'), findsNothing);
      await settings.setInAppAlerts(false);
      await tester.pump(const Duration(seconds: 15));
      await tester.pumpAndSettle();
      expect(pages, 3);
      expect(find.text('Task finished'), findsNothing);
      await settings.setInAppAlerts(true);
      for (
        var i = 0;
        i < 15 && find.text('Task finished').evaluate().isEmpty;
        i++
      ) {
        await tester.pump(const Duration(seconds: 1));
      }
      await tester.pumpAndSettle();
      expect(settings.inAppAlerts, true);
      expect(pages, 4);
      expect(find.text('Task finished'), findsOneWidget);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pumpAndSettle();
      expect(find.text('Task finished'), findsNothing);
      expect(
        find.text('Your session is hidden while DJL is inactive.'),
        findsOneWidget,
      );
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump(const Duration(seconds: 30));
      expect(pages, 4);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(pages, 5);
      expect(find.text('Task finished'), findsOneWidget);
      await client.setSession(null);
      client.onSessionEnded?.call();
      await tester.pumpAndSettle();
      expect(find.text('Welcome to DJL'), findsOneWidget);
      expect(find.text('Task finished'), findsNothing);
      await tester.pump(const Duration(seconds: 30));
      expect(pages, 5);
      expect(sends, 0);
      expect(tester.takeException(), isNull);
    },
  );
}
