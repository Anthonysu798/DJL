import 'dart:convert';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/account/data/account_repository.dart';
import 'package:djl_mobile/features/account/presentation/account_controller.dart';
import 'package:djl_mobile/features/account/presentation/account_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;

class AccountFixture {
  final vault = TestCredentials()..values['cloud.session'] = 'session';
  final writes = <String>[];
  int signOuts = 0, macs = 0;
  late final cloud = CloudClient(
    baseUrl: Uri.parse('https://qa.test/'),
    credentials: vault,
    client: MockClient((request) async {
      if (request.method != 'GET') {
        writes.add('${request.method} ${request.url.path}');
      }
      final now = DateTime.now();
      final body = switch (request.url.path) {
        '/v1/auth/token' => {'token': 'jwt'},
        '/v1/me' => {
          'user': {'id': 'u', 'email': 'a-long-local-qa-account@example.test'},
          'activeOrgId': 'o',
        },
        '/v1/credits' => {
          'display': {'total': '123.45'},
        },
        '/v1/usage/windows' => {
          'planId': 'starter',
          'windows': {
            'fiveHour': {
              'limit': '100',
              'used': '56',
              'resetsAt': now
                  .add(const Duration(minutes: 24))
                  .toIso8601String(),
            },
            'week': {
              'limit': '100',
              'used': '34',
              'resetsAt': now.add(const Duration(days: 6)).toIso8601String(),
            },
          },
          'banks': {
            'count': 5,
            'nextExpiresAt': now
                .add(const Duration(days: 29))
                .toIso8601String(),
          },
        },
        _ => <String, dynamic>{},
      };
      return http.Response(jsonEncode(body), 200);
    }),
  );
  late final controller = AccountController(AccountRepository(cloud));
  Widget page({double scale = 1}) => MaterialApp(
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(scale)),
      child: child!,
    ),
    home: AccountPage(
      controller: controller,
      onSignOut: () async {
        signOuts++;
      },
      onMyMacs: () => macs++,
    ),
  );
}

void main() {
  for (final scale in [1.0, 3.0]) {
    testWidgets(
      'Sign-out uses the source popover and outside dismissal at $scale',
      (tester) async {
        tester.view.physicalSize = const Size(393, 852);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final f = AccountFixture();
        try {
          await tester.pumpWidget(f.page(scale: scale));
          await tester.pumpAndSettle();
          await tester.scrollUntilVisible(
            find.text('Sign out'),
            250,
            scrollable: find.byType(Scrollable).last,
          );
          await Scrollable.ensureVisible(
            tester.element(find.text('Sign out')),
            alignment: .5,
          );
          await tester.pumpAndSettle();
          await tester.tap(find.text('Sign out'));
          await tester.pumpAndSettle();
          expect(find.text('Sign out of DJL Cloud?'), findsOneWidget);
          final popover = find.byKey(
            const ValueKey('cloud-signout-confirmation'),
          );
          expect(popover, findsOneWidget);
          expect(find.byType(CupertinoAlertDialog), findsNothing);
          expect(find.text('Cancel'), findsNothing);
          expect(tester.getSize(popover).width, 240);
          expect(tester.getTopLeft(popover).dy, 10);
          final action = find.widgetWithText(TextButton, 'Sign out');
          expect(action, findsOneWidget);
          expect(tester.getRect(action).bottom, lessThan(852));
          await tester.tapAt(const Offset(4, 700));
          await tester.pumpAndSettle();
          expect(popover, findsNothing);
          expect(f.signOuts, 0);
          expect(f.writes, isEmpty);
          expect(f.vault.values['cloud.session'], 'session');
          expect(tester.takeException(), isNull);
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
        }
      },
    );
  }

  testWidgets('Account sign-out is explicit and cancelling keeps the session', (
    tester,
  ) async {
    final f = AccountFixture();
    try {
      await tester.pumpWidget(f.page());
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Sign out'),
        250,
        scrollable: find.byType(Scrollable).last,
      );
      await tester.tap(find.text('Sign out'));
      await tester.pumpAndSettle();
      expect(f.signOuts, 0);
      expect(find.text('Sign out of DJL Cloud?'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(f.signOuts, 0);
      expect(f.vault.values['cloud.session'], 'session');
      expect(f.writes, isEmpty);
      await tester.tap(find.text('Sign out'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Sign out'));
      await tester.pumpAndSettle();
      expect(f.signOuts, 1);
      expect(tester.takeException(), isNull);
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
    }
  });
  testWidgets(
    'Pending Account confirmation cannot sign out a replacement account',
    (tester) async {
      final f = AccountFixture();
      try {
        await tester.pumpWidget(f.page());
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.text('Sign out'),
          250,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.tap(find.text('Sign out'));
        await tester.pumpAndSettle();
        await f.cloud.setSession('replacement');
        await tester.tap(find.widgetWithText(TextButton, 'Sign out'));
        await tester.pumpAndSettle();
        expect(f.signOuts, 0);
        expect(f.vault.values['cloud.session'], 'replacement');
        expect(f.writes, isEmpty);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
      }
    },
  );
  testWidgets(
    'Account invalid DELETE and cancellation never send deletion requests',
    (tester) async {
      final f = AccountFixture();
      try {
        await tester.pumpWidget(f.page());
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.text('Delete account'),
          250,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.tap(find.text('Delete account'));
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(CupertinoTextField), 'wrong');
        await tester.tap(
          find.widgetWithText(CupertinoDialogAction, 'Delete account'),
        );
        await tester.pumpAndSettle();
        expect(find.text('Type DELETE to confirm.'), findsOneWidget);
        expect(f.writes, isEmpty);
        expect(f.signOuts, 0);
        await tester.tap(find.text('OK'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Delete account'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(f.writes, isEmpty);
        expect(f.vault.values['cloud.session'], 'session');
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
      }
    },
  );
  for (final scale in [1.0, 3.0]) {
    testWidgets(
      'Grouped Account values and My Macs remain usable at text scale $scale',
      (tester) async {
        tester.view.physicalSize = const Size(393, 852);
        tester.view.devicePixelRatio = 1;
        final f = AccountFixture();
        try {
          await tester.pumpWidget(f.page(scale: scale));
          await tester.pumpAndSettle();
          expect(find.text('Starter'), findsOneWidget);
          expect(find.text('123.45'), findsOneWidget);
          await tester.scrollUntilVisible(
            find.text('56% used'),
            200,
            scrollable: find.byType(Scrollable).last,
          );
          expect(find.text('Resets in 24 minutes'), findsOneWidget);
          await tester.scrollUntilVisible(
            find.text('My Macs'),
            200,
            scrollable: find.byType(Scrollable).last,
          );
          await Scrollable.ensureVisible(
            tester.element(find.text('My Macs')),
            alignment: .5,
          );
          await tester.pumpAndSettle();
          await tester.tap(find.text('My Macs'));
          await tester.pumpAndSettle();
          expect(f.macs, 1);
          expect(f.writes, isEmpty);
          expect(tester.takeException(), isNull);
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        }
      },
    );
  }
}
