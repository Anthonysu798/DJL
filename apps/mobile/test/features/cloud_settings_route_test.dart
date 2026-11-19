import '../support/open_cloud.dart';
import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'cloud_deep_links_test.dart' show client;
import 'desktop_root_routing_test.dart' show RoutingDesktop;
import 'desktop_subagents_test.dart' show SubagentTransport;
import 'settings/app_lock_controller_test.dart' show FakeOwnerAuth;

void main() {
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    testWidgets(
      'Cloud Settings uses a source-shaped root destination on $platform',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        debugDefaultTargetPlatformOverride = platform;
        final vault = TestCredentials()..values['cloud.session'] = 'qa-session';
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
          expect(find.byType(BottomSheet), findsNothing);
          expect(find.text('Account'), findsOneWidget);
          expect(find.text('Appearance'), findsOneWidget);
          expect(find.text('Conversations'), findsOneWidget);
          expect(find.text('Font'), findsNothing);
          expect(find.text('App lock'), findsNothing);
          expect(find.text('Runtime defaults'), findsNothing);
          await tester.binding.handlePopRoute();
          await tester.pumpAndSettle();
          expect(find.byKey(const Key('composer')), findsOneWidget);
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
