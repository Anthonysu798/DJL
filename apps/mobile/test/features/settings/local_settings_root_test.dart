import 'dart:convert';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/cloud_client_test.dart' show TestCredentials;
import '../cloud_deep_links_test.dart' show client;
import '../desktop_root_routing_test.dart' show RoutingDesktop, savedPair;
import '../desktop_subagents_test.dart' show SubagentTransport;
import 'app_lock_controller_test.dart' show FakeOwnerAuth;

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    WidgetController.hitTestWarningShouldBeFatal = true;
  });
  for (final signedIn in [false, true]) {
    testWidgets(
      'local Settings Done and system Back preserve cached Mac with Cloud session $signedIn',
      (tester) async {
        final credentials = TestCredentials(), pair = savedPair('settings-mac');
        credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
        credentials.values['desktop.active'] = pair.macDeviceId;
        if (signedIn) credentials.values['cloud.session'] = 'existing-session';
        final transport = SubagentTransport()..online = false;
        final desktop = RoutingDesktop(
          transport,
          repository: PairingRepository(credentials),
        )..connects = false;
        final lock = AppLockController(FakeOwnerAuth()..result = true);
        final calls = <String>[];
        await tester.pumpWidget(
          DjlApp(
            client: client(credentials, calls),
            desktop: desktop,
            appLock: lock,
            linkStream: const Stream.empty(),
            initialLink: Future.value(null),
          ),
        );
        await tester.pumpAndSettle();
        if (find.byType(PairingPage).evaluate().isEmpty) {
          if (find.byTooltip('Settings').evaluate().isEmpty) {
            await tester.tap(find.byTooltip('Open navigation'));
            await tester.pumpAndSettle();
          }
          await tester.tap(find.byTooltip('Settings'));
          await tester.pumpAndSettle();
          await tester.scrollUntilVisible(
            find.text('Remote access'),
            250,
            scrollable: find.byType(Scrollable).first,
          );
          await tester.ensureVisible(find.text('Remote access'));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Remote access'));
          await tester.pumpAndSettle();
        }
        final selectedThread = {'id': 'settings-retained-thread'};
        desktop.thread = selectedThread;
        desktop.threadList.data.setComposerDraft(
          'settings-retained-thread',
          DesktopComposerDraft(
            text: 'Unsent Mac draft',
            cwd: '/public-fixture/project',
          ),
        );
        if (!signedIn) expect(calls, isEmpty);
        final before = List<String>.of(calls),
            revision = desktop.selectionRevision,
            connections = desktop.connections;
        final hostCalls = List<Map<String, dynamic>>.of(transport.calls);
        for (final done in [true, false]) {
          if (find.byTooltip('Settings').evaluate().isEmpty) {
            await tester.tap(find.byTooltip('Open navigation'));
            await tester.pumpAndSettle();
          }
          await tester.tap(find.byTooltip('Settings'));
          await tester.pumpAndSettle();
          expect(find.text('Done'), findsOneWidget);
          expect(find.byType(BottomSheet), findsNothing);
          expect(find.byType(BackButton), findsNothing);
          expect(
            find.text(
              signedIn ? 'Open DJL Cloud chat' : 'Sign in to DJL Cloud',
            ),
            findsOneWidget,
          );
          expect(find.text('Account and usage'), findsNothing);
          expect(find.text('Usage'), findsOneWidget);
          expect(find.text('How DJL Works'), findsOneWidget);
          if (done) {
            await tester.ensureVisible(find.text('How DJL Works'));
            await tester.pumpAndSettle();
            await tester.tap(find.text('How DJL Works'));
            await tester.pumpAndSettle();
            expect(find.text('About DJL'), findsOneWidget);
            expect(find.text('Done'), findsNothing);
            expect(desktop.active?.macDeviceId, pair.macDeviceId);
            expect(desktop.selectionRevision, revision);
            expect(calls, before);
            expect(transport.calls, hostCalls);
            await tester.binding.handlePopRoute();
            await tester.pumpAndSettle();
            expect(find.text('Done'), findsOneWidget);
          }
          if (done) {
            await tester.tap(find.text('Done'));
          } else {
            await tester.binding.handlePopRoute();
          }
          await tester.pumpAndSettle();
          expect(find.byType(PairingPage), findsOneWidget);
          expect(find.byTooltip('Settings').hitTestable(), findsOneWidget);
          expect(desktop.active?.macDeviceId, pair.macDeviceId);
          expect(desktop.selectionRevision, revision);
          expect(desktop.thread, same(selectedThread));
          expect(
            desktop.threadList.data
                .composerDraft('settings-retained-thread')
                .text,
            'Unsent Mac draft',
          );
          expect(calls, before);
          expect(transport.calls, hostCalls);
          expect(desktop.connections, connections);
          expect(desktop.active?.publicKey, pair.publicKey);
          expect(
            credentials.values['cloud.session'],
            signedIn ? 'existing-session' : isNull,
          );
        }
        if (find.byTooltip('Settings').evaluate().isEmpty) {
          await tester.tap(find.byTooltip('Open navigation'));
          await tester.pumpAndSettle();
        }
        await tester.tap(find.byTooltip('Settings'));
        await tester.pumpAndSettle();
        expect(find.text('SSH terminals'), findsNothing);
        await tester.tap(
          find.text(signedIn ? 'Open DJL Cloud chat' : 'Sign in to DJL Cloud'),
        );
        await tester.pumpAndSettle();
        expect(find.text('Done'), findsNothing);
        expect(find.byType(PairingPage), findsNothing);
        expect(desktop.active?.macDeviceId, pair.macDeviceId);
        expect(desktop.selectionRevision, revision);
        if (!signedIn) expect(find.text('Welcome to DJL'), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
        desktop.dispose();
        lock.dispose();
      },
    );
  }
}
