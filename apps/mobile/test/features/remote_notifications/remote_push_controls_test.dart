import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/remote_notifications/data/remote_push_store.dart';
import 'package:djl_mobile/features/remote_notifications/domain/remote_notification.dart';
import 'package:djl_mobile/features/remote_notifications/presentation/remote_push_controller.dart';
import 'package:djl_mobile/features/remote_notifications/presentation/remote_push_controls.dart';
import '../../core/cloud_client_test.dart' show TestCredentials;
import '../cloud_deep_links_test.dart' show client;
import 'remote_push_test.dart' show PushNative, PushStore;

class _UnreadableStore implements RemotePushStore {
  @override
  Future<bool> read() async => throw StateError('QA read failure');
  @override
  Future<void> write(bool enabled) async {}
}

void main() {
  for (final scale in [1.0, 2.2]) {
    testWidgets(
      'unsupported push leaves following Settings reachable at $scale',
      (tester) async {
        tester.view.physicalSize = const Size(320, 700);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final native = PushNative()..value = const RemotePushState();
        final cloud = client(TestCredentials(), []);
        final controller = RemotePushController(cloud, native, PushStore());
        addTearDown(controller.dispose);
        addTearDown(cloud.close);
        await controller.initialize();
        await tester.pumpWidget(
          MaterialApp(
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(scale)),
              child: child!,
            ),
            home: Scaffold(
              body: ListView(
                children: [
                  RemotePushControls(controller: controller),
                  const ListTile(title: Text('Composer Defaults')),
                ],
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byType(SwitchListTile), findsNothing);
        expect(find.byType(TextButton), findsNothing);
        expect(find.textContaining('Cloud inbox'), findsOneWidget);
        expect(find.text('DJL Cloud push'), findsNothing);
        expect(find.text('Current Mac push'), findsNothing);
        await tester.scrollUntilVisible(
          find.text('Composer Defaults'),
          300,
          scrollable: find.byType(Scrollable),
        );
        await tester.pumpAndSettle();
        expect(
          tester.getBottomRight(find.text('Composer Defaults')).dy,
          lessThanOrEqualTo(700),
        );
        expect(tester.takeException(), isNull);
        expect(native.prompts, 0);
        expect(native.acquisitions, 0);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }

  testWidgets('unsupported saved enrollment can still be turned off', (
    tester,
  ) async {
    final native = PushNative()..value = const RemotePushState();
    final cloud = client(TestCredentials(), []), store = PushStore(true);
    final controller = RemotePushController(cloud, native, store);
    addTearDown(controller.dispose);
    addTearDown(cloud.close);
    await controller.initialize();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: RemotePushControls(controller: controller)),
      ),
    );
    await tester.tap(find.byType(SwitchListTile));
    await tester.pumpAndSettle();
    expect(controller.enabled, isFalse);
    expect(store.value, isFalse);
    expect(find.byType(SwitchListTile), findsNothing);
    expect(native.prompts, 0);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('unsupported preference read failure keeps recovery visible', (
    tester,
  ) async {
    final native = PushNative()..value = const RemotePushState();
    final cloud = client(TestCredentials(), []);
    final controller = RemotePushController(cloud, native, _UnreadableStore());
    addTearDown(controller.dispose);
    addTearDown(cloud.close);
    await controller.initialize();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ListView(
            children: [RemotePushControls(controller: controller)],
          ),
        ),
      ),
    );
    expect(
      find.text('Could not read notification preference. Retry.'),
      findsOneWidget,
    );
    expect(find.text('Retry remote notifications'), findsOneWidget);
    expect(native.prompts, 0);
    await tester.pumpWidget(const SizedBox());
  });
}
