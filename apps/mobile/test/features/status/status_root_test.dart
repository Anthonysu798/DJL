import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import '../../core/cloud_client_test.dart' show TestCredentials;
import '../cloud_deep_links_test.dart' show client;
import '../desktop_subagents_test.dart' show SubagentTransport;
import '../desktop_root_routing_test.dart' show RoutingDesktop, savedPair;
import '../desktop_activity_test.dart' show ActivityCacheStore;
import '../settings/settings_controller_test.dart' show MemorySettingsStore;
import '../settings/app_lock_controller_test.dart' show FakeOwnerAuth;
import 'status_coordinator_test.dart' show FakeSurface;

void main() {
  for (final preference in ['enabled', 'disabled', 'load-failure']) {
    testWidgets(
      'root owns real status hook, startup reconciliation, settings privacy and disposal: $preference',
      (tester) async {
        final credentials = TestCredentials(), pair = savedPair('mac-a');
        credentials.values['desktop.trusted'] = jsonEncode([pair.data]);
        credentials.values['desktop.active'] = 'mac-a';
        final cache = ActivityCacheStore();
        cache.records['mac-a'] = {
          'threads': [
            {
              'id': 'secret-thread',
              'title': 'secret-title',
              'cwd': '/secret/path/secret-folder',
            },
          ],
        };
        final remote = SubagentTransport();
        final desktop =
            RoutingDesktop(
                remote,
                repository: PairingRepository(credentials),
                cache: cache,
              )
              ..active = pair
              ..trusted = [pair];
        await desktop.threadList.attach('mac-a');
        final store = MemorySettingsStore()
          ..failRead = preference == 'load-failure';
        store.values[SettingsController.lockKey] = preference != 'disabled';
        final settings = SettingsController(store),
            lock = AppLockController(FakeOwnerAuth()..result = true);
        final surface = FakeSurface();
        await tester.pumpWidget(
          DjlApp(
            client: client(credentials, []),
            desktop: desktop,
            settings: settings,
            appLock: lock,
            statusSurface: surface,
            linkStream: const Stream.empty(),
            initialLink: Future.value(null),
          ),
        );
        await tester.pumpAndSettle();
        remote.events.add({
          'method': 'turn/started',
          'params': {'threadId': 'secret-thread', 'turnId': 'secret-turn'},
        });
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 350));
        await tester.pump();
        expect(surface.calls.first.$1, 'end');
        final updates = surface.calls.where((c) => c.$1 == 'update').toList();
        expect(updates, isNotEmpty);
        final payload = jsonEncode(updates.last.$2);
        if (preference == 'disabled') {
          expect(payload, contains('secret-title'));
          expect(payload, contains('macKeySha256'));
          await settings.setLockEnabled(true);
          await tester.pumpAndSettle();
          expect(surface.calls.last.$1, 'update');
          expect(jsonEncode(surface.calls.last.$2), isNot(contains('secret')));
        } else {
          for (final call in surface.calls) {
            expect(jsonEncode(call.$2), isNot(contains('secret')));
          }
        }
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
        expect(surface.calls.last.$1, 'end');
        desktop.dispose();
        settings.dispose();
        lock.dispose();
      },
    );
  }
}
