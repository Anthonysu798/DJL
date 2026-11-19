import '../support/open_cloud.dart';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/account/presentation/account_page.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'cloud_deep_links_test.dart' show client;
import 'desktop_root_routing_test.dart' show RoutingDesktop, savedPair;
import 'desktop_subagents_test.dart' show SubagentTransport;
import 'settings/app_lock_controller_test.dart' show FakeOwnerAuth;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final paired in [false, true]) {
    for (final ended in [false, true]) {
      testWidgets(
        'Cloud account route closes on ${ended ? 'session expiry' : 'logout'} with saved Mac=$paired',
        (tester) async {
          final vault = TestCredentials()
            ..values['cloud.session'] = 'qa-session';
          final pair = savedPair('mac-a');
          if (paired) {
            vault.values['desktop.trusted'] = jsonEncode([pair.data]);
            vault.values['desktop.active'] = pair.macDeviceId;
          }
          final remote = SubagentTransport();
          (remote.pairings.credentials as TestCredentials).values.addAll(
            vault.values,
          );
          final desktop = RoutingDesktop(remote);
          final lock = AppLockController(FakeOwnerAuth()..result = true);
          final calls = <String>[];
          final cloud = client(vault, calls);
          await tester.pumpWidget(
            DjlApp(
              client: cloud,
              desktop: desktop,
              appLock: lock,
              linkStream: const Stream.empty(),
              initialLink: Future.value(null),
            ),
          );
          addTearDown(() async {
            await tester.pumpWidget(const SizedBox.shrink());
            desktop.dispose();
            lock.dispose();
          });
          await tester.pumpAndSettle();
          await openCloudFromDesktop(tester);
          await tester.tap(find.byTooltip('Open navigation'));
          await tester.pumpAndSettle();
          await tester.tap(find.byTooltip('Settings'));
          await tester.pumpAndSettle();
          await tester.scrollUntilVisible(
            find.byKey(const Key('cloud.settings.account')),
            400,
            scrollable: find.byType(Scrollable).last,
          );
          await tester.tap(find.byKey(const Key('cloud.settings.account')));
          await tester.pumpAndSettle();
          expect(find.byType(AccountPage), findsOneWidget);
          final pairedBefore = vault.values['desktop.trusted'];
          if (ended) {
            await cloud.setSession(null);
            cloud.onSessionEnded?.call();
          } else {
            await tester.ensureVisible(find.text('Sign out'));
            await tester.tap(find.text('Sign out'));
            await tester.pumpAndSettle();
            await tester.tap(find.text('Sign out').last);
          }
          await tester.pumpAndSettle();
          expect(find.byType(AccountPage), findsNothing);
          expect(vault.values['cloud.session'], isNull);
          expect(vault.values['desktop.trusted'], pairedBefore);
          expect(
            calls.where((call) => call.contains('sign-out')).length,
            ended ? 0 : 1,
          );
          expect(find.text('Welcome to DJL'), findsOneWidget);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
}
