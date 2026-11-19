import '../support/open_cloud.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/account/presentation/account_page.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import 'cloud_account_confirmation_test.dart' show AccountFixture;
import 'desktop_root_routing_test.dart' show RoutingDesktop;
import 'desktop_subagents_test.dart' show SubagentTransport;
import 'settings/app_lock_controller_test.dart' show FakeOwnerAuth;

void main() {
  testWidgets(
    'Real Account data and its owner survive sheet and keyboard rebuilds',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final f = AccountFixture();
      final desktop = RoutingDesktop(SubagentTransport());
      final lock = AppLockController(FakeOwnerAuth()..result = true);
      try {
        await tester.pumpWidget(
          DjlApp(
            client: f.cloud,
            desktop: desktop,
            appLock: lock,
            linkStream: const Stream.empty(),
            initialLink: Future.value(null),
          ),
        );
        await tester.pumpAndSettle();
        await openCloudFromDesktop(tester);
        await tester.tap(find.byTooltip('Open navigation'));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Settings'));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const Key('cloud.settings.account')));
        await tester.pumpAndSettle();
        final owner = tester
            .widget<AccountPage>(find.byType(AccountPage))
            .controller;
        expect(owner.snapshot?.plan, 'starter');
        expect(
          find.descendant(
            of: find.byType(AccountPage),
            matching: find.text('Starter'),
          ),
          findsOneWidget,
        );
        tester.view.viewInsets = const FakeViewPadding(bottom: 220);
        await tester.pumpAndSettle();
        expect(
          identical(
            tester.widget<AccountPage>(find.byType(AccountPage)).controller,
            owner,
          ),
          true,
        );
        expect(
          find.descendant(
            of: find.byType(AccountPage),
            matching: find.text('123.45'),
          ),
          findsOneWidget,
        );
        tester.view.resetViewInsets();
        await tester.pumpAndSettle();
        expect(
          identical(
            tester.widget<AccountPage>(find.byType(AccountPage)).controller,
            owner,
          ),
          true,
        );
        await tester.tap(find.text('Done'));
        await tester.pumpAndSettle();
        expect(find.text('Appearance'), findsOneWidget);
        expect(f.writes, isEmpty);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        tester.view.resetViewInsets();
        desktop.dispose();
        lock.dispose();
      }
    },
  );
}
