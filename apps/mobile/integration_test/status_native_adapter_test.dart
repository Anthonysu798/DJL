// TEST ONLY standalone adapter. Does not start DjlApp, authenticate, pair a Mac,
// connect a gateway or prove the normal-main trusted deep-link route.
import 'dart:async';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:djl_mobile/features/status/data/status_surface.dart';
import 'package:djl_mobile/features/status/domain/run_status.dart';
import 'package:djl_mobile/features/status/presentation/status_coordinator.dart';
import 'package:djl_mobile/features/status/presentation/status_permission_controls.dart';
import 'support/native_status_acceptance.dart';

class _Lifecycle with WidgetsBindingObserver {
  _Lifecycle(this.phases);
  final NativeStatusPhases phases;
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    unawaited(phases.lifecycle(state.name));
  }
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.shouldPropagateDevicePointerEvents = true;
  testWidgets(
    'real local native status adapter and protected host phases',
    (tester) async {
      nativeStatusRequire(const bool.fromEnvironment('DJL_STATUS_QA_ENABLED'));
      final phases = NativeStatusPhases(
        token: const String.fromEnvironment('DJL_STATUS_QA_TOKEN'),
        host: const String.fromEnvironment(
          'DJL_STATUS_QA_HOST',
          defaultValue: '127.0.0.1',
        ),
        tick: tester.pump,
      );
      const surface = MethodChannelStatusSurface();
      final probe = NativeStatusProbe(), projector = RunStatusProjector();
      final coordinator = StatusCoordinator(projector, surface);
      final lifecycle = _Lifecycle(phases);
      WidgetsBinding.instance.addObserver(lifecycle);
      var retries = 0, disposedCoordinator = false;
      final links = <Uri>[];
      final linkSubscription = AppLinks().uriLinkStream.listen(
        links.add,
        onError: (Object _) {},
      );
      final session = NativeStatusSession(surface);
      Future<void> until(Future<bool> Function() predicate) async {
        final deadline = DateTime.now().add(const Duration(minutes: 4));
        while (!await predicate()) {
          nativeStatusRequire(DateTime.now().isBefore(deadline));
          await tester.pump(const Duration(milliseconds: 200));
        }
      }

      Future<void> foreground() => until(
        () async =>
            WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed,
      );
      Future<NativeStatusMeta> meta(int count) async {
        final value = await probe.read();
        nativeStatusRequire(value.count == count);
        return value;
      }

      try {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              appBar: AppBar(
                title: const Text('DJL native status — TEST ONLY'),
              ),
              body: ListView(
                children: [
                  const ListTile(
                    title: Text('Public synthetic adapter fixtures'),
                    subtitle: Text(
                      'Host controls real OS permission dialogs and acknowledges native captures.',
                    ),
                  ),
                  StatusPermissionControls(
                    backend: surface,
                    onRetry: () async {
                      await coordinator.retryAvailability();
                      retries++;
                    },
                  ),
                ],
              ),
            ),
          ),
        );
        await tester.pump();
        await coordinator.done;
        await phases.connected();
        await phases.stage('permission_discovery', (await meta(0)).checkpoint);
        // Host explicitly uses the real widget/OS controls to deny before ACK.
        await until(
          () async =>
              (await surface.availability()).state ==
              StatusPermissionState.denied,
        );
        coordinator.configure(settingsReady: true, lockEnabled: true);
        projector.setContext(
          mac: 'qa-status-public-mac',
          fingerprint: 'a' * 64,
          session: 'qa-public-session',
          connected: true,
          selectedThread: null,
          threads: {
            'qa-status-public-thread': const StatusThread(
              'DJL QA PUBLIC TITLE',
              '/qa/qa-public-folder',
            ),
          },
        );
        projector.observe('turn/started', {
          'threadId': 'qa-status-public-thread',
          'turnId': 'qa-public-turn',
        });
        await coordinator.flush();
        await phases.stage('permission_denied', {
          ...(await meta(0)).checkpoint,
          'permissionDenied': true,
        });
        // No app-generated permission request. Root taps Enable/System settings in
        // the actual widget, operates OS access and returns to trigger real retry.
        await until(
          () async =>
              (await surface.availability()).state ==
                  StatusPermissionState.allowed &&
              retries > 0 &&
              coordinator.availability == StatusAvailability.available &&
              (await probe.read()).count == 1,
        );
        final permissionMeta = await meta(1);
        nativeStatusRequire(permissionMeta.genericSafe);
        await phases.stage('permission_allowed', {
          ...permissionMeta.checkpoint,
          'permissionAllowed': true,
          'coordinatorRetried': true,
          'genericSafe': true,
        });
        coordinator.dispose();
        await coordinator.done;
        disposedCoordinator = true;
        projector.dispose();
        await tester.pumpWidget(
          const MaterialApp(
            home: Scaffold(
              body: Center(
                child: Text('TEST ONLY · Host native status phases'),
              ),
            ),
          ),
        );
        await meta(0);

        await foreground();
        await session.restart();
        await session.publish(
          nativeStatusPayload(DateTime.now().millisecondsSinceEpoch),
        );
        var value = await meta(1);
        nativeStatusRequire(
          value.genericSafe && value.flag('genericInitialOrder'),
        );
        await phases.stage('generic', {
          ...value.checkpoint,
          'genericSafe': true,
          'orderMatches': true,
        });
        nativeStatusRequire(nativeStatusOrdinaryOpen(links));
        final genericPid = value.pid, genericPlatform = value.platform;
        await session.publish(
          nativeStatusPayload(
            DateTime.now().millisecondsSinceEpoch,
            updated: true,
          ),
        );
        value = await nativeStatusObserveGenericUpdate(
          expectedPid: genericPid,
          expectedPlatform: genericPlatform,
          read: probe.read,
          tick: tester.pump,
        );
        nativeStatusRequire(
          value.genericSafe && value.flag('genericUpdatedOrder'),
        );
        await phases.stage('generic_updated', {
          ...value.checkpoint,
          'genericSafe': true,
          'orderMatches': true,
        });
        nativeStatusRequire(nativeStatusOrdinaryOpen(links));
        await session.end();
        await phases.stage('generic_ended', (await meta(0)).checkpoint);

        await foreground();
        await session.restart();
        final oldDetail = await session.publish(
          nativeStatusPayload(
            DateTime.now().millisecondsSinceEpoch,
            detailed: true,
          ),
        );
        value = await meta(1);
        nativeStatusRequire(value.flag('detailedCanaryMatches'));
        links.clear();
        await phases.stage('detailed_tap', {
          ...value.checkpoint,
          'detailedCanary': true,
        });
        await until(
          () async => links.any((uri) => uri == nativeStatusPublicURL),
        );
        nativeStatusRequire(
          links.every(
            (uri) =>
                uri == nativeStatusPublicURL || nativeStatusOrdinaryOpen([uri]),
          ),
        );
        links.clear();
        await foreground();
        await session.restart();
        await session.publish(
          nativeStatusPayload(DateTime.now().millisecondsSinceEpoch),
        );
        nativeStatusRequire(!await session.attempt(oldDetail));
        nativeStatusRequire(
          !await session.attempt({
            ...oldDetail,
            ...session.identity,
            'epoch': 0,
          }),
        );
        value = await meta(1);
        nativeStatusRequire(value.genericSafe);
        await phases.stage('privacy_barrier', {
          ...value.checkpoint,
          'genericSafe': true,
          'linkDelivered': true,
        });
        nativeStatusRequire(nativeStatusOrdinaryOpen(links));
        await session.publish(
          nativeStatusPayload(
            DateTime.now().millisecondsSinceEpoch,
            detailed: true,
          ),
        );
        final malformed = nativeStatusPayload(
          DateTime.now().millisecondsSinceEpoch,
        );
        (((malformed['buckets'] as Map)['running'] as List).first
                as Map)['title'] =
            'DJL QA PUBLIC TITLE';
        nativeStatusRequire(
          !await session.attempt({...malformed, ...session.identity}),
        );
        await phases.stage('malformed_retracted', (await meta(0)).checkpoint);

        await foreground();
        await session.restart();
        links.clear();
        final deadlinePayload = nativeStatusPayload(
          DateTime.now().millisecondsSinceEpoch,
          detailed: true,
          shortDeadline: true,
        );
        await session.publish(deadlinePayload);
        final deadline = deadlinePayload['nextDeadline']! as int;
        value = await probe.read(deadline: deadline);
        nativeStatusBeforeDeadlineHold(value, deadline);
        final beforePid = value.pid;
        final after = await session.holdDeadline(
          pid: beforePid,
          waitForHost: () => phases.stage('deadline', {
            ...value.checkpoint,
            'deadlineMatches': true,
            'permissionAllowed': true,
            'deadlineEpochMs': deadline,
          }),
          readNative: () => probe.read(deadline: deadline),
        );
        await phases.stage('deadline_verified', {
          ...after.checkpoint,
          'samePid': true,
          'noWritesWhileStopped': true,
          'permissionAllowed': after.flag('permissionAllowed'),
          if (after.platform == 'ios') 'stale': after.flag('stale'),
        });
        // Root captures/taps the stale shell (iOS) or ordinarily reopens the app
        // (Android). No status writer ran before the post-resume native read.
        nativeStatusRequire(nativeStatusOrdinaryOpen(links));
        await session.end();
        await phases.stage('end_verified', (await meta(0)).checkpoint);
        await phases.stage('finished', (await meta(0)).checkpoint);
      } catch (_, stack) {
        debugPrint('DJL_STATUS_ADAPTER_FAILED');
        await phases.failed();
        Error.throwWithStackTrace(
          StateError('Native status adapter acceptance failed.'),
          stack,
        );
      } finally {
        if (!disposedCoordinator) {
          coordinator.dispose();
          await coordinator.done;
          projector.dispose();
        }
        WidgetsBinding.instance.removeObserver(lifecycle);
        await linkSubscription.cancel();
        phases.close();
      }
    },
    timeout: const Timeout(Duration(minutes: 25)),
  );
}
