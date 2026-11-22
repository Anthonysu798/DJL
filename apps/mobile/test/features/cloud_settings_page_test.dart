import 'dart:async';
import 'dart:convert';
import 'package:djl_mobile/features/remote_notifications/domain/remote_notification.dart';
import 'cloud_deep_links_test.dart' as qa;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/core/network/cloud_client.dart';
import 'package:djl_mobile/features/settings/presentation/cloud_settings_page.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/remote_notifications/presentation/remote_push_controller.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'settings/settings_controller_test.dart' show MemorySettingsStore;
import 'remote_notifications/remote_push_test.dart' show PushNative, PushStore;

void main() {
  const channel = MethodChannel('djl.mobile/app-info');
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(
    () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          expect(call.method, 'version');
          return '0.1.0';
        }),
  );
  tearDown(
    () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null),
  );
  for (final scale in [1.0, 3.0]) {
    testWidgets(
      'Cloud Settings live values and persisted controls at text scale $scale',
      (tester) async {
        tester.view.physicalSize = const Size(393, 852);
        tester.view.devicePixelRatio = 1;
        final store = MemorySettingsStore();
        final settings = SettingsController(store);
        await settings.load();
        final calls = <String>[];
        final cloud = CloudClient(
          baseUrl: Uri.parse('https://qa.test/'),
          credentials: TestCredentials()..values['cloud.session'] = 'session',
          client: MockClient((request) async {
            calls.add('${request.method} ${request.url.path}');
            return http.Response(
              jsonEncode(switch (request.url.path) {
                '/v1/auth/token' => {'token': 'jwt'},
                '/v1/credits' => {
                  'display': {'total': '1,234.50'},
                },
                '/v1/client-config' => {
                  'pushConfigured': false,
                  'policyUrls': {
                    'terms': 'https://qa.test/terms',
                    'privacy': 'file:///bad',
                  },
                },
                _ => throw StateError('unexpected request'),
              }),
              200,
            );
          }),
        );
        final push = RemotePushController(cloud, PushNative(), PushStore());
        var account = 0, archived = 0, remote = 0;
        final semantics = tester.ensureSemantics();
        try {
          await tester.pumpWidget(
            MaterialApp(
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(textScaler: TextScaler.linear(scale)),
                child: child!,
              ),
              home: CloudSettingsPage(
                client: cloud,
                settings: settings,
                push: push,
                email: 'qa@example.test',
                onAccount: () => account++,
                onArchived: () => archived++,
                onRemote: () => remote++,
                onEnableBackgroundAlerts: () =>
                    fail('must not enable unavailable background alerts'),
              ),
            ),
          );
          await tester.pumpAndSettle();
          if (scale == 1) {
            expect(
              tester
                  .getSemantics(find.text('Account'))
                  .flagsCollection
                  .isHeader,
              true,
            );
            expect(
              tester
                  .getSemantics(find.byKey(const Key('cloud.settings.account')))
                  .label,
              'qa@example.test',
            );
            expect(
              tester
                  .getSemantics(find.text('Available credits'))
                  .flagsCollection
                  .isButton,
              false,
            );
          }
          await tester.tap(find.byKey(const Key('cloud.settings.account')));
          expect(account, 1);
          expect(find.text('1,234.50'), findsOneWidget);
          await tester.scrollUntilVisible(
            find.byKey(const Key('theme-setting')),
            240,
            scrollable: find.byType(Scrollable).first,
          );
          await Scrollable.ensureVisible(
            tester.element(find.byKey(const Key('theme-setting'))),
            alignment: .5,
          );
          await tester.pumpAndSettle();
          await tester.tap(find.byKey(const Key('theme-setting')));
          await tester.pumpAndSettle();
          // At large text sizes the menu scrolls.
          await tester.ensureVisible(find.text('Dark').last);
          await tester.pumpAndSettle();
          await tester.tap(find.text('Dark').last);
          await tester.pumpAndSettle();
          expect(settings.theme, ThemeMode.dark);
          expect(store.values[SettingsController.themeKey], 'dark');
          for (final label in [
            'Archived chats',
            'Remote access',
            'In-app alerts',
            'Speak new replies',
          ]) {
            await tester.scrollUntilVisible(
              find.text(label),
              240,
              scrollable: find.byType(Scrollable).first,
            );
            await Scrollable.ensureVisible(
              tester.element(find.text(label)),
              alignment: .5,
            );
            await tester.pumpAndSettle();
            await tester.tap(find.text(label));
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull);
          }
          expect(archived, 1);
          expect(remote, 1);
          expect(store.values[SettingsController.inAppAlertsKey], false);
          expect(store.values[SettingsController.spokenRepliesKey], true);
          await tester.scrollUntilVisible(
            find.text('Version'),
            240,
            scrollable: find.byType(Scrollable).first,
          );
          expect(find.text('0.1.0'), findsOneWidget);
          await tester.scrollUntilVisible(
            find.text('Terms'),
            240,
            scrollable: find.byType(Scrollable).first,
          );
          expect(find.text('Terms'), findsOneWidget);
          expect(find.text('Privacy'), findsNothing);
          expect(
            calls.where(
              (c) => c.startsWith('POST') && !c.endsWith('/v1/auth/token'),
            ),
            isEmpty,
          );
          expect(store.values.containsKey(SettingsController.lockKey), false);
          expect(tester.takeException(), isNull);
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          semantics.dispose();
          push.dispose();
          settings.dispose();
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        }
      },
    );
  }
  testWidgets(
    'Cloud Settings retries failed reads and writes and fences a resumed read after dismissal',
    (tester) async {
      final store = MemorySettingsStore();
      final settings = SettingsController(store);
      await settings.load();
      var failRead = true;
      Completer<http.Response>? pendingCredits;
      var creditReads = 0;
      final cloud = CloudClient(
        baseUrl: Uri.parse('https://qa.test/'),
        credentials: TestCredentials()..values['cloud.session'] = 'session',
        client: MockClient((request) async {
          if (request.url.path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          if (request.url.path == '/v1/client-config') {
            return http.Response('{}', 200);
          }
          creditReads++;
          if (pendingCredits != null) return pendingCredits.future;
          return failRead
              ? http.Response('{}', 503)
              : http.Response('{"display":{"total":"25.00"}}', 200);
        }),
      );
      final push = RemotePushController(cloud, PushNative(), PushStore());
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: CloudSettingsPage(
              client: cloud,
              settings: settings,
              push: push,
              onAccount: () {},
              onArchived: () {},
              onRemote: () {},
              onEnableBackgroundAlerts: () =>
                  fail('permission must not be requested'),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          find.text('Could not refresh account and Cloud settings.'),
          findsOneWidget,
        );
        failRead = false;
        await tester.tap(find.text('Retry'));
        await tester.pumpAndSettle();
        expect(find.text('25.00'), findsOneWidget);
        expect(creditReads, 2);
        store.failWrite = true;
        await tester.scrollUntilVisible(
          find.text('In-app alerts'),
          240,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.tap(find.text('In-app alerts'));
        await tester.pumpAndSettle();
        expect(settings.inAppAlerts, true);
        expect(settings.error, contains('previous choice is unchanged'));
        expect(
          store.values.containsKey(SettingsController.inAppAlertsKey),
          false,
        );
        store.failWrite = false;
        await tester.tap(find.text('In-app alerts'));
        await tester.pumpAndSettle();
        expect(settings.inAppAlerts, false);
        expect(settings.error, isNull);
        pendingCredits = Completer<http.Response>();
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.inactive,
        );
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        await tester.pump();
        expect(creditReads, 3);
        await tester.pumpWidget(const SizedBox.shrink());
        pendingCredits.complete(
          http.Response('{"display":{"total":"99.00"}}', 200),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        push.dispose();
        settings.dispose();
      }
    },
  );
  for (final entry in [
    ('ready', 'notDetermined', 'Not enabled', 'Enable background alerts'),
    ('ready', 'denied', 'Off', 'Open notification settings'),
    ('ready', 'authorized', 'Enabled', ''),
    ('simulator', 'authorized', 'Unavailable', ''),
  ]) {
    testWidgets(
      'Cloud background alerts reflect ${entry.$1}/${entry.$2} without automatic permission prompts',
      (tester) async {
        final settings = SettingsController(MemorySettingsStore());
        await settings.load();
        final cloud = qa.client(
          TestCredentials()..values['cloud.session'] = 'session',
          [],
          pushConfigured: true,
        );
        final native = PushNative();
        final push = RemotePushController(cloud, native, PushStore())
          ..enabled = entry.$2 == 'authorized'
          ..state = RemotePushState(
            availability: entry.$1,
            permission: entry.$2,
            environment: 'development',
          );
        var enable = 0, openSettings = 0;
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, (call) async {
              if (call.method == 'version') return '0.1.0';
              expect(call.method, 'openNotificationSettings');
              openSettings++;
              return true;
            });
        try {
          await tester.pumpWidget(
            MaterialApp(
              home: CloudSettingsPage(
                client: cloud,
                settings: settings,
                push: push,
                onAccount: () {},
                onArchived: () {},
                onRemote: () {},
                onEnableBackgroundAlerts: () => enable++,
              ),
            ),
          );
          await tester.pumpAndSettle();
          await tester.scrollUntilVisible(
            find.text('Background alerts'),
            240,
            scrollable: find.byType(Scrollable).first,
          );
          expect(find.text(entry.$3), findsOneWidget);
          expect(native.prompts, 0);
          expect(enable, 0);
          expect(openSettings, 0);
          if (entry.$4.isNotEmpty) {
            await tester.scrollUntilVisible(
              find.text(entry.$4),
              240,
              scrollable: find.byType(Scrollable).first,
            );
            await Scrollable.ensureVisible(
              tester.element(find.text(entry.$4)),
              alignment: .5,
            );
            await tester.pumpAndSettle();
            await tester.tap(find.text(entry.$4));
            await tester.pumpAndSettle();
            expect(enable, entry.$2 == 'notDetermined' ? 1 : 0);
            expect(openSettings, entry.$2 == 'denied' ? 1 : 0);
          } else {
            expect(find.text('Enable background alerts'), findsNothing);
            expect(find.text('Open notification settings'), findsNothing);
          }
          expect(tester.takeException(), isNull);
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          push.dispose();
          settings.dispose();
        }
      },
    );
  }
  testWidgets(
    'delayed Settings metadata cannot cross a Cloud session revision',
    (tester) async {
      final version = Completer<String>();
      var metadataReads = 0, creditReads = 0;
      final credits = Completer<http.Response>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (_) {
            metadataReads++;
            return version.future;
          });
      final settings = SettingsController(MemorySettingsStore());
      await settings.load();
      final cloud = CloudClient(
        baseUrl: Uri.parse('https://qa.test/'),
        credentials: TestCredentials()..values['cloud.session'] = 'old-session',
        client: MockClient((request) async {
          if (request.url.path == '/v1/auth/token') {
            return http.Response('{"token":"jwt"}', 200);
          }
          if (request.url.path == '/v1/credits') {
            creditReads++;
            return credits.future;
          }
          return http.Response('{}', 200);
        }),
      );
      final push = RemotePushController(cloud, PushNative(), PushStore());
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: CloudSettingsPage(
              client: cloud,
              settings: settings,
              push: push,
              onAccount: () {},
              onArchived: () {},
              onRemote: () {},
              onEnableBackgroundAlerts: () {},
            ),
          ),
        );
        for (var i = 0; i < 8; i++) {
          await tester.pump(const Duration(milliseconds: 16));
        }
        expect(metadataReads, 1);
        expect(creditReads, 1);
        await cloud.setSession('new-session');
        version.complete('9.9.9');
        for (var i = 0; i < 8; i++) {
          await tester.pump(const Duration(milliseconds: 16));
        }
        await tester.scrollUntilVisible(
          find.text('Version'),
          240,
          scrollable: find.byType(Scrollable).first,
        );
        expect(find.text('9.9.9'), findsNothing);
        expect(find.text('—'), findsOneWidget);
        expect(
          find.text('Could not refresh account and Cloud settings.'),
          findsNothing,
        );
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        if (!version.isCompleted) version.complete('9.9.9');
        if (!credits.isCompleted) {
          credits.complete(
            http.Response('{"display":{"total":"old-account-value"}}', 200),
          );
        }
        await tester.pumpAndSettle();
        push.dispose();
        settings.dispose();
      }
    },
  );
}
