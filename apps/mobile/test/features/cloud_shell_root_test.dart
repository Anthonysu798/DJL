import '../support/open_cloud.dart';
import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'package:djl_mobile/features/images/presentation/image_gallery_page.dart';
import 'package:djl_mobile/features/notifications/presentation/notification_page.dart';
import 'package:djl_mobile/features/settings/presentation/cloud_settings_page.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import '../../integration_test/threads_test.dart' show macs;
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'cloud_deep_links_test.dart' show client;
import 'desktop_root_routing_test.dart' show RoutingDesktop;
import 'desktop_subagents_test.dart' show SubagentTransport;
import 'settings/app_lock_controller_test.dart' show FakeOwnerAuth;

void main() {
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    testWidgets(
      'Authenticated Cloud starts at source Chat and keeps root destinations in one drawer on $platform',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        debugDefaultTargetPlatformOverride = platform;
        final vault = TestCredentials()..values['cloud.session'] = 'session';
        final calls = <String>[];
        final desktop = RoutingDesktop(SubagentTransport());
        final lock = AppLockController(FakeOwnerAuth()..result = true);
        try {
          await tester.pumpWidget(
            DjlApp(
              client: client(vault, calls),
              desktop: desktop,
              appLock: lock,
              linkStream: const Stream.empty(),
              initialLink: Future.value(null),
            ),
          );
          await tester.pumpAndSettle();
          await openCloudFromDesktop(tester);
          expect(find.byType(ChatPage), findsOneWidget);
          expect(find.text('How can I help?'), findsOneWidget);
          expect(find.text('Search conversations'), findsNothing);
          await tester.enterText(
            find.byKey(const Key('composer')),
            'Retained drawer draft',
          );
          tester.view.viewInsets = const FakeViewPadding(bottom: 180);
          await tester.pumpAndSettle();
          final initialChat = tester
              .widget<ChatPage>(find.byType(ChatPage))
              .controller;
          tester.view.resetViewInsets();
          await tester.pumpAndSettle();
          expect(
            tester.widget<ChatPage>(find.byType(ChatPage)).controller,
            same(initialChat),
          );
          await tester.tap(find.byTooltip('Open navigation'));
          await tester.pumpAndSettle();
          expect(find.text('Pinned'), findsOneWidget);
          expect(find.text('Recent chats'), findsOneWidget);
          expect(find.byTooltip('Search chats'), findsOneWidget);
          await tester.tap(find.byTooltip('Settings'));
          await tester.pumpAndSettle();
          expect(find.byType(CloudSettingsPage), findsOneWidget);
          expect(
            ModalRoute.of(
              tester.element(find.byType(CloudSettingsPage)),
            )!.isFirst,
            true,
          );
          expect(find.byTooltip('Open navigation'), findsOneWidget);
          await tester.binding.handlePopRoute();
          await tester.pumpAndSettle();
          expect(find.byType(ChatPage), findsOneWidget);
          expect(
            tester
                .widget<TextField>(find.byKey(const Key('composer')))
                .controller!
                .text,
            'Retained drawer draft',
          );
          final chat = tester
              .widget<ChatPage>(find.byType(ChatPage))
              .controller;
          await tester.tap(find.byTooltip('Open navigation'));
          await tester.pumpAndSettle();
          await tester.binding.handlePopRoute();
          await tester.pumpAndSettle();
          expect(
            tester.widget<ChatPage>(find.byType(ChatPage)).controller,
            same(chat),
          );
          for (final label in ['Images', 'Notifications']) {
            await tester.tap(find.byTooltip('Open navigation'));
            await tester.pumpAndSettle();
            await tester.tap(find.text(label));
            await tester.pumpAndSettle();
            expect(
              label == 'Images'
                  ? find.byType(ImageGalleryPage)
                  : find.byType(NotificationPage),
              findsOneWidget,
            );
            expect(find.byTooltip('Open navigation'), findsOneWidget);
            await tester.binding.handlePopRoute();
            await tester.pumpAndSettle();
            expect(find.byType(ChatPage), findsOneWidget);
          }
          expect(
            calls.where(
              (c) => c.startsWith('POST') && !c.endsWith('/v1/auth/token'),
            ),
            isEmpty,
          );
          expect(vault.values['cloud.session'], 'session');
          expect(await macs(tester), same(desktop));
          expect(find.byType(PairingPage), findsOneWidget);
          expect(vault.values['cloud.session'], 'session');
          expect(tester.takeException(), isNull);
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          desktop.dispose();
          lock.dispose();
          tester.view.resetViewInsets();
          debugDefaultTargetPlatformOverride = null;
        }
      },
    );
  }
}
