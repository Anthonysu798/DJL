import '../support/open_cloud.dart';
import 'dart:async';
import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/account/presentation/account_page.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'cloud_deep_links_test.dart' show client;
import 'desktop_root_routing_test.dart' show RoutingDesktop;
import 'desktop_subagents_test.dart' show SubagentTransport;
import 'settings/app_lock_controller_test.dart' show FakeOwnerAuth;

void main() {
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    for (final account in [true, false]) {
      testWidgets(
        'Cloud ${account ? 'Account sheet' : 'Archived page'} returns to Settings on $platform',
        (tester) async {
          SharedPreferences.setMockInitialValues({});
          debugDefaultTargetPlatformOverride = platform;
          final vault = TestCredentials()
            ..values['cloud.session'] = 'qa-session';
          final desktop = RoutingDesktop(SubagentTransport());
          final lock = AppLockController(FakeOwnerAuth()..result = true);
          final calls = <String>[];
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
            if (find.byTooltip('Settings').evaluate().isEmpty) {
              await tester.tap(find.byTooltip('Open navigation'));
              await tester.pumpAndSettle();
            }
            await tester.tap(find.byTooltip('Settings'));
            await tester.pumpAndSettle();
            if (account) {
              await tester.tap(find.byKey(const Key('cloud.settings.account')));
              await tester.pumpAndSettle();
              expect(
                ModalRoute.of(tester.element(find.byType(AccountPage)))!.opaque,
                false,
              );
              expect(find.text('Done'), findsOneWidget);
              await tester.tap(find.text('Done'));
            } else {
              await tester.tap(find.text('Archived chats'));
              await tester.pumpAndSettle();
              expect(find.text('No archived chats'), findsOneWidget);
              await tester.binding.handlePopRoute();
            }
            await tester.pumpAndSettle();
            expect(find.text('Appearance'), findsOneWidget);
            expect(
              find.byKey(const Key('cloud.settings.account')),
              findsOneWidget,
            );
            expect(vault.values['cloud.session'], 'qa-session');
            expect(
              calls.where(
                (c) => c.contains('/messages') || c.contains('/sign-out'),
              ),
              isEmpty,
            );
            expect(tester.takeException(), isNull);
          } finally {
            await tester.pumpWidget(const SizedBox.shrink());
            desktop.dispose();
            lock.dispose();
            debugDefaultTargetPlatformOverride = null;
          }
        },
      );
    }
  }
}
