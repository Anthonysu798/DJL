import '../../support/open_cloud.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/status/data/status_surface.dart';
import 'package:djl_mobile/features/status/presentation/status_permission_controls.dart';
import 'package:djl_mobile/features/status/presentation/status_coordinator.dart';
import 'package:djl_mobile/features/status/domain/run_status.dart';
import 'status_coordinator_test.dart' show FakeSurface;
import 'package:djl_mobile/app/djl_app.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/settings/presentation/app_lock_controller.dart';
import '../../core/cloud_client_test.dart' show TestCredentials;
import '../cloud_deep_links_test.dart' show client;
import '../settings/settings_controller_test.dart' show MemorySettingsStore;
import '../settings/app_lock_controller_test.dart' show FakeOwnerAuth;

class Permissions implements StatusPermissionBackend {
  StatusPermission value = const StatusPermission(
    StatusPermissionState.denied,
    canRequest: true,
    canOpenSettings: true,
  );
  int reads = 0, requests = 0, settings = 0;
  @override
  Future<StatusPermission> availability() async {
    reads++;
    return value;
  }

  @override
  Future<StatusPermission> requestPermission() async {
    requests++;
    return value;
  }

  @override
  Future<bool> openSettings() async {
    settings++;
    return true;
  }
}

class PermissionSurface extends FakeSurface implements StatusPermissionBackend {
  final permissions = Permissions();
  @override
  Future<StatusPermission> availability() => permissions.availability();
  @override
  Future<StatusPermission> requestPermission() async {
    available = permissions.value.state == StatusPermissionState.allowed;
    return permissions.requestPermission();
  }

  @override
  Future<bool> openSettings() => permissions.openSettings();
}

void main() {
  testWidgets(
    'actual DjlApp Settings discovers permission without prompt or chat mutation',
    (tester) async {
      final settings = SettingsController(MemorySettingsStore());
      final lock = AppLockController(FakeOwnerAuth());
      final surface = PermissionSurface()..available = false;
      final calls = <String>[];
      await tester.pumpWidget(
        DjlApp(
          client: client(TestCredentials(), calls),
          settings: settings,
          appLock: lock,
          statusSurface: surface,
          linkStream: const Stream.empty(),
          initialLink: Future.value(null),
        ),
      );
      await tester.pumpAndSettle();
      await openCloudFromDesktop(tester);
      final before = List.of(calls);
      expect(surface.permissions.reads, 0);
      expect(surface.permissions.requests, 0);
      await tester.tap(find.text('Pair with a Mac'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Settings'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Task status'),
        300,
        scrollable: find.byType(Scrollable).last,
      );
      await tester.pumpAndSettle();
      expect(surface.permissions.reads, 1);
      expect(surface.permissions.requests, 0);
      surface.permissions.value = const StatusPermission(
        StatusPermissionState.allowed,
      );
      final nativeBefore = surface.calls.length;
      await tester.ensureVisible(find.text('Enable task status'));
      await tester.tap(find.text('Enable task status'));
      await tester.pumpAndSettle();
      expect(surface.permissions.requests, 1);
      expect(surface.calls.skip(nativeBefore).first.$1, 'end');
      expect(calls, before);
      expect(settings.lockEnabled, true);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      settings.dispose();
      lock.dispose();
    },
  );

  testWidgets(
    'retry waits for old native completion then ends before latest generic content',
    (tester) async {
      final status = RunStatusProjector(now: () => DateTime.utc(2026));
      final surface = FakeSurface();
      final coordinator = StatusCoordinator(status, surface);
      coordinator.configure(settingsReady: true, lockEnabled: false);
      await coordinator.flush();
      status.setContext(
        mac: 'm',
        fingerprint: 'a' * 64,
        session: 's',
        connected: true,
        selectedThread: null,
        threads: {'t': const StatusThread('Private', '/secret')},
      );
      status.observe('turn/started', {'threadId': 't', 'turnId': 'a'});
      final old = Completer<bool>();
      surface.delay = old;
      final inFlight = coordinator.flush();
      await tester.pump();
      final count = surface.calls.length;
      final retry = coordinator.retryAvailability();
      coordinator.configure(settingsReady: true, lockEnabled: true);
      old.complete(true);
      await inFlight;
      await retry;
      await coordinator.done;
      final after = surface.calls.skip(count).toList();
      expect(after.map((c) => c.$1), ['end', 'update']);
      expect(after.last.$2['detailed'], false);
      expect(after.last.$2.toString(), isNot(contains('Private')));
      coordinator.dispose();
      await coordinator.done;
      status.dispose();
    },
  );

  testWidgets(
    'Settings reads without prompting; only explicit enable retries after grant',
    (tester) async {
      final backend = Permissions();
      var retries = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StatusPermissionControls(
              backend: backend,
              onRetry: () async {
                retries++;
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(backend.reads, 1);
      expect(backend.requests, 0);
      expect(retries, 0);
      backend.value = const StatusPermission(StatusPermissionState.allowed);
      await tester.tap(find.text('Enable task status'));
      await tester.pumpAndSettle();
      expect(backend.requests, 1);
      expect(retries, 1);
      expect(
        find.text('Task status is allowed on this device.'),
        findsOneWidget,
      );
    },
  );
  testWidgets(
    'denial is quiet; explicit Settings return reads and retries once allowed',
    (tester) async {
      final backend = Permissions();
      var retries = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StatusPermissionControls(
              backend: backend,
              onRetry: () async {
                retries++;
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Enable task status'));
      await tester.pumpAndSettle();
      expect(retries, 0);
      expect(backend.requests, 1);
      await tester.tap(find.text('System settings'));
      await tester.pumpAndSettle();
      expect(backend.settings, 1);
      backend.value = const StatusPermission(StatusPermissionState.allowed);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(backend.reads, 2);
      expect(retries, 1);
      expect(backend.requests, 1);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(retries, 1);
    },
  );
  testWidgets(
    'return after permission revocation requests one retraction barrier without a prompt',
    (tester) async {
      final backend = Permissions()
        ..value = const StatusPermission(
          StatusPermissionState.allowed,
          canOpenSettings: true,
        );
      var retries = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: StatusPermissionControls(
              backend: backend,
              onRetry: () async {
                retries++;
              },
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('System settings'));
      await tester.pumpAndSettle();
      backend.value = const StatusPermission(
        StatusPermissionState.denied,
        canOpenSettings: true,
      );
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(retries, 1);
      expect(backend.requests, 0);
    },
  );

  testWidgets('unsupported backend has no permission or retry action', (
    tester,
  ) async {
    final backend = Permissions()
      ..value = const StatusPermission(StatusPermissionState.unsupported);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatusPermissionControls(
            backend: backend,
            onRetry: () async {
              fail('unsupported retry');
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('Task status is unavailable on this device.'),
      findsOneWidget,
    );
    expect(find.byType(TextButton), findsNothing);
    expect(backend.requests, 0);
  });
  testWidgets(
    'permission bridge rejects malformed states and never prompts on availability',
    (tester) async {
      const channel = MethodChannel('app.djl/local_run_status');
      final calls = <String>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
        call,
      ) async {
        calls.add(call.method);
        return call.method == 'availability'
            ? {'state': 'allowed', 'canRequest': false, 'canOpenSettings': true}
            : {'state': 'invented'};
      });
      const surface = MethodChannelStatusSurface();
      expect(
        (await surface.availability()).state,
        StatusPermissionState.allowed,
      );
      expect(calls, ['availability']);
      expect(
        (await surface.requestPermission()).state,
        StatusPermissionState.unsupported,
      );
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        null,
      );
    },
  );
  testWidgets(
    'explicit retry inserts end barrier and uses latest privacy and host only',
    (tester) async {
      final status = RunStatusProjector(now: () => DateTime.utc(2026));
      final surface = FakeSurface()..available = false;
      final coordinator = StatusCoordinator(status, surface);
      status.setContext(
        mac: 'old',
        fingerprint: 'a' * 64,
        session: 's',
        connected: true,
        selectedThread: null,
        threads: {'old': const StatusThread('Private old', '/secret')},
      );
      status.observe('turn/started', {'threadId': 'old', 'turnId': 'a'});
      coordinator.configure(settingsReady: true, lockEnabled: false);
      await coordinator.flush();
      coordinator.configure(settingsReady: true, lockEnabled: true);
      status.setContext(
        mac: 'new',
        fingerprint: 'b' * 64,
        session: 's2',
        connected: true,
        selectedThread: null,
        threads: {'new': const StatusThread('Private new', '/newsecret')},
      );
      status.observe('turn/started', {'threadId': 'new', 'turnId': 'b'});
      surface.available = true;
      final before = surface.calls.length;
      await coordinator.retryAvailability();
      expect(surface.calls.skip(before).map((c) => c.$1), ['end', 'update']);
      final payload = surface.calls.last.$2;
      expect(payload['detailed'], false);
      expect((payload['buckets'] as Map)['running'], hasLength(1));
      expect(payload.toString(), isNot(contains('Private')));
      expect(payload.toString(), isNot(contains('newsecret')));
      coordinator.dispose();
      await coordinator.done;
      status.dispose();
    },
  );
}
