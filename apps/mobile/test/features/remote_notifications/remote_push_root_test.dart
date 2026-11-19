import '../../support/open_cloud.dart';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/chat/presentation/chat_page.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import 'package:djl_mobile/features/remote_notifications/presentation/remote_push_controls.dart';
import '../../core/cloud_client_test.dart' show TestCredentials;
import '../cloud_deep_links_test.dart' show client;
import '../desktop_root_routing_test.dart' show RoutingDesktop, savedPair;
import '../desktop_subagents_test.dart' show SubagentTransport;
import '../settings/app_lock_controller_test.dart' show FakeOwnerAuth;
import 'remote_push_test.dart' show PushNative, PushStore, pairedTap, cloudTap;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  for (final (cold, disposition) in [
    (false, 'retained'),
    (false, 'cancelled'),
    (false, 'replaced'),
    (false, 'expired replacement'),
    (false, 'expired current'),
    (true, 'retained'),
    (true, 'cancelled'),
    (true, 'replaced'),
  ]) {
    testWidgets(
      '${cold ? 'cold inactive' : 'warm active B'} push $disposition before foreground return respects navigation revision and forced chooser',
      (tester) async {
        final credentials = TestCredentials();
        final a = savedPair('mac-a'), b = savedPair('mac-b');
        credentials.values['desktop.trusted'] = jsonEncode([b.data, a.data]);
        credentials.values['desktop.active'] = 'mac-b';
        final remote = SubagentTransport()..mac = 'mac-b';
        remote.histories['same-id'] = {'id': 'same-id', 'turns': []};
        final desktop =
            RoutingDesktop(remote, repository: PairingRepository(credentials))
              ..active = b
              ..trusted = [b, a]
              ..state = 'connected';
        await desktop.threadList.attach('mac-b');
        desktop.queueNavigation(const DesktopLinkTarget('same-id', turn: 't1'));
        expect(desktop.navigationNeedsHost, false);
        final native = PushNative(), calls = <String>[];
        final owner = FakeOwnerAuth()..result = !cold;
        final lock = AppLockController(owner);
        if (cold) {
          SharedPreferences.setMockInitialValues({
            'djl.security.biometricLockEnabled': true,
          });
        }
        if (cold) {
          tester.binding.handleAppLifecycleStateChanged(
            AppLifecycleState.inactive,
          );
          addTearDown(() async {
            await tester.pumpWidget(const SizedBox());
            tester.binding.handleAppLifecycleStateChanged(
              AppLifecycleState.resumed,
            );
          });
          native.initial = pairedTap('cold');
        }
        await tester.pumpWidget(
          DjlApp(
            client: client(credentials, calls),
            desktop: desktop,
            appLock: lock,
            linkStream: const Stream.empty(),
            initialLink: Future.value(null),
            remotePushNative: native,
            remotePushStore: PushStore(true),
          ),
        );
        await tester.pumpAndSettle();
        if (!cold) {
          remote.calls.clear();
          if (disposition != 'expired current') {
            lock.lifecycle(AppLifecycleState.inactive);
          }
          final tap = pairedTap('warm');
          if (disposition.startsWith('expired')) {
            tap['receivedAt'] = DateTime.now()
                .subtract(const Duration(seconds: 299))
                .millisecondsSinceEpoch;
          }
          native.stream.add(tap);
          await tester.pumpAndSettle();
          if (disposition == 'expired current') {
            expect(desktop.navigationNeedsHost, true);
            lock.lifecycle(AppLifecycleState.inactive);
          }
        }
        expect(lock.shielded, true);
        if (disposition == 'cancelled') desktop.cancelNavigation();
        if (disposition == 'replaced' || disposition == 'expired replacement') {
          desktop.queueNavigation(
            const DesktopLinkTarget('newer'),
            useActive: false,
          );
        }
        final navigationRevision = desktop.navigationRevision;
        if (disposition != 'retained') {
          unawaited(
            tester
                .state<NavigatorState>(find.byType(Navigator).first)
                .push<void>(
                  MaterialPageRoute(
                    builder: (_) =>
                        const Scaffold(body: Text('Keep newer route')),
                  ),
                ),
          );
          await tester.pumpAndSettle();
        }
        if (disposition.startsWith('expired')) {
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(seconds: 2)),
          );
        }
        // Explicit privacy barrier keeps pending intake away from transport.
        if (lock.shielded) {
          expect(
            find.byType(DesktopChatPage),
            cold || disposition != 'retained' ? findsNothing : findsOneWidget,
          );
          owner.result = true;
          if (cold) {
            tester.binding.handleAppLifecycleStateChanged(
              AppLifecycleState.resumed,
            );
          } else {
            lock.lifecycle(AppLifecycleState.resumed);
          }
          if (lock.requiresUnlock) await lock.authenticate();
        }
        await tester.pumpAndSettle();
        expect(
          desktop.navigationNeedsHost,
          !{'cancelled', 'expired current'}.contains(disposition),
        );
        expect(desktop.active?.macDeviceId, 'mac-b');
        expect(desktop.navigationTarget?.thread, switch (disposition) {
          'cancelled' || 'expired current' => null,
          'replaced' || 'expired replacement' => 'newer',
          _ => 'same-id',
        });
        if (disposition != 'retained') {
          expect(
            desktop.navigationRevision,
            navigationRevision + (disposition == 'expired current' ? 1 : 0),
          );
          expect(find.text('Keep newer route'), findsOneWidget);
        }
        expect(
          remote.calls.where((c) => c['method'] == 'thread/read'),
          isEmpty,
        );
        expect(calls, isEmpty);
        expect(native.prompts, 0);
        expect(native.acks.length, 1);
        expect(find.byType(ChatPage), findsNothing);
        expect(find.byType(DesktopChatPage), findsNothing);
        desktop.cancelNavigation();
        await tester.pumpAndSettle();
        expect(desktop.navigationTarget, isNull);
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
        lock.dispose();
      },
    );
  }
  testWidgets(
    'Cloud initial/live duplicate waits behind privacy then opens once without chat mutation',
    (tester) async {
      final credentials = TestCredentials()..values['cloud.session'] = 's';
      final native = PushNative(), calls = <String>[];
      final lock = AppLockController(FakeOwnerAuth());
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, calls),
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
          remotePushNative: native,
          remotePushStore: PushStore(),
        ),
      );
      await tester.pumpAndSettle();
      await openCloudFromDesktop(tester);
      lock.lifecycle(AppLifecycleState.inactive);
      final tap = cloudTap('queued');
      native.stream.add(tap);
      native.stream.add(tap);
      await tester.pumpAndSettle();
      expect(lock.shielded, true);
      expect(find.byType(ChatPage), findsOneWidget);
      expect(
        tester.widget<ChatPage>(find.byType(ChatPage)).controller.conversation,
        isNull,
      );
      expect(calls.where((c) => c.contains('/v1/conversations/c1')), isEmpty);
      lock.lifecycle(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.byType(ChatPage), findsOneWidget);
      expect(native.acks, ['queued']);
      expect(calls.where((c) => c.startsWith('POST')), isEmpty);
      expect(
        tester
            .widget<ChatPage>(find.byType(ChatPage))
            .controller
            .conversation
            ?.id,
        'c1',
      );
      await tester.pumpWidget(const SizedBox());
      lock.dispose();
    },
  );
  testWidgets('later ordinary Cloud link supersedes pending push behind lock', (
    tester,
  ) async {
    final credentials = TestCredentials()..values['cloud.session'] = 's';
    final native = PushNative(),
        links = StreamController<Uri>.broadcast(sync: true),
        calls = <String>[];
    final lock = AppLockController(FakeOwnerAuth());
    await tester.pumpWidget(
      DjlApp(
        client: client(credentials, calls),
        appLock: lock,
        linkStream: links.stream,
        initialLink: Future.value(null),
        remotePushNative: native,
        remotePushStore: PushStore(),
      ),
    );
    await tester.pumpAndSettle();
    lock.lifecycle(AppLifecycleState.inactive);
    native.stream.add(cloudTap('older'));
    links.add(Uri.parse('djl://cloud/c/ordinary'));
    await tester.pumpAndSettle();
    lock.lifecycle(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<ChatPage>(find.byType(ChatPage))
          .controller
          .conversation
          ?.id,
      'ordinary',
    );
    expect(calls.where((c) => c.contains('/v1/conversations/c1')), isEmpty);
    await tester.pumpWidget(const SizedBox());
    await links.close();
    lock.dispose();
  });
  testWidgets(
    'unknown native source cannot switch Mac-only root into Cloud authentication',
    (tester) async {
      final credentials = TestCredentials();
      final pair = savedPair('mac-b');
      credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
      credentials.values['desktop.active'] = 'mac-b';
      final native = PushNative(), calls = <String>[];
      final remote = SubagentTransport()..mac = 'mac-b';
      final desktop =
          RoutingDesktop(remote, repository: PairingRepository(credentials))
            ..active = pair
            ..trusted = [pair]
            ..state = 'connected';
      await desktop.threadList.attach('mac-b');
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, calls),
          desktop: desktop,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
          remotePushNative: native,
          remotePushStore: PushStore(),
        ),
      );
      await tester.pumpAndSettle();
      remote.calls.clear();
      native.stream.add({...cloudTap('foreign'), 'source': 'untrusted'});
      await tester.pumpAndSettle();
      expect(calls, isEmpty);
      expect(remote.calls, isEmpty);
      expect(native.acks, isEmpty);
      expect(find.text('Welcome to DJL'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
    },
  );
  testWidgets(
    'Cloud Settings exposes real opt-in controls and no permission prompt before Enable',
    (tester) async {
      final credentials = TestCredentials()..values['cloud.session'] = 's';
      final native = PushNative();
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, [], pushConfigured: true),
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
          remotePushNative: native,
          remotePushStore: PushStore(),
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
      await tester.scrollUntilVisible(
        find.text('Enable background alerts'),
        350,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.text('Background alerts'), findsOneWidget);
      expect(native.prompts, 0);
      await tester.ensureVisible(find.text('Enable background alerts'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Enable background alerts'));
      await tester.pumpAndSettle();
      expect(native.prompts, 1);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'local Mac Settings exposes opt-in without Cloud discovery or startup prompt',
    (tester) async {
      final credentials = TestCredentials(), pair = savedPair('mac-b');
      credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
      credentials.values['desktop.active'] = 'mac-b';
      final native = PushNative(), calls = <String>[];
      final remote = SubagentTransport()..mac = 'mac-b';
      final desktop =
          RoutingDesktop(remote, repository: PairingRepository(credentials))
            ..active = pair
            ..trusted = [pair]
            ..state = 'connected';
      final lock = AppLockController(FakeOwnerAuth()..result = true);
      await desktop.threadList.attach('mac-b');
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, calls),
          desktop: desktop,
          appLock: lock,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
          remotePushNative: native,
          remotePushStore: PushStore(),
        ),
      );
      await tester.pumpAndSettle();
      if (find.byTooltip('Settings').evaluate().isEmpty) {
        await tester.tap(find.byTooltip('Open navigation'));
        await tester.pumpAndSettle();
      }
      await tester.tap(find.byTooltip('Settings'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Remote notifications'),
        350,
        scrollable: find.byType(Scrollable).last,
      );
      expect(find.byType(RemotePushControls), findsOneWidget);
      expect(native.prompts, 0);
      expect(calls, isEmpty);
      await tester.ensureVisible(find.text('Remote notifications'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Remote notifications'));
      await tester.pumpAndSettle();
      expect(native.prompts, 1);
      expect(calls, isEmpty);
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
      lock.dispose();
    },
  );
  testWidgets(
    'cold Cloud notification drains once into authenticated history',
    (tester) async {
      final credentials = TestCredentials()..values['cloud.session'] = 's';
      final native = PushNative()..initial = cloudTap('cold-cloud');
      final calls = <String>[];
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, calls),
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
          remotePushNative: native,
          remotePushStore: PushStore(),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(ChatPage), findsOneWidget);
      native.stream.add(native.initial);
      await tester.pumpAndSettle();
      expect(find.byType(ChatPage), findsOneWidget);
      expect(native.acks, ['cold-cloud']);
      expect(calls.where((c) => c == 'GET /v1/conversations/c1').length, 1);
      expect(calls.where((c) => c.startsWith('POST')), isEmpty);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'delayed initial notification cannot replace a newer ordinary link',
    (tester) async {
      final credentials = TestCredentials()..values['cloud.session'] = 's';
      final native = PushNative()..initialGate = Completer();
      final old = cloudTap('delayed');
      old['receivedAt'] = DateTime.now()
          .subtract(const Duration(seconds: 2))
          .millisecondsSinceEpoch;
      final links = StreamController<Uri>.broadcast(sync: true);
      await tester.pumpWidget(
        DjlApp(
          client: client(credentials, []),
          linkStream: links.stream,
          initialLink: Future.value(null),
          remotePushNative: native,
          remotePushStore: PushStore(),
        ),
      );
      await tester.pumpAndSettle();
      links.add(Uri.parse('djl://cloud/c/newer'));
      await tester.pumpAndSettle();
      native.initialGate!.complete(old);
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<ChatPage>(find.byType(ChatPage))
            .controller
            .conversation
            ?.id,
        'newer',
      );
      expect(native.acks, isEmpty);
      await tester.pumpWidget(const SizedBox());
      await links.close();
    },
  );
}
