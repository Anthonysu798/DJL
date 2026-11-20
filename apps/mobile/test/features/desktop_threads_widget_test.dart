import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'desktop_threads_controller_test.dart' show ThreadTransport;
import 'desktop_recovery_test.dart' show RecoveryMemoryStore;
import '../core/cloud_client_test.dart' show TestCredentials;

Future<void> action(WidgetTester tester, String label) async {
  await tester.tap(find.byTooltip('Desktop chat actions'));
  await tester.pumpAndSettle();
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'offline chat menus rename, pin, archive, restore and remove without network mutations',
    (tester) async {
      final transport = ThreadTransport()..online = false;
      final desktop = DesktopController(
        PairingRepository(TestCredentials()),
        connection: transport,
        localStore: RecoveryMemoryStore(),
      )..active = const Pairing({'macDeviceId': 'qa-mac'});
      await desktop.threadList.attach('qa-mac');
      desktop.threadList.data.mergeServer([
        {'id': 't1', 'name': 'Original offline chat', 'cwd': '/repo'},
      ]);
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Offline · showing saved chats'), findsOneWidget);
      await tester.tap(find.text('Projects'));
      await tester.pumpAndSettle();
      await action(tester, 'Rename chat');
      await tester.enterText(
        find.byKey(const Key('desktop_chat_name')),
        'Renamed offline chat',
      );
      await tester.tap(find.text('Save name'));
      await tester.pumpAndSettle();
      expect(find.text('Renamed offline chat'), findsOneWidget);
      await action(tester, 'Pin chat');
      expect(desktop.threadList.data.isPinned('t1'), isTrue);
      await action(tester, 'Archive chat');
      expect(desktop.threadList.data.isArchived('t1'), isTrue);
      await tester.tap(find.byTooltip('More actions'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Archived chats'));
      await tester.pumpAndSettle();
      expect(find.text('Renamed offline chat'), findsOneWidget);
      await action(tester, 'Unarchive chat');
      await tester.tap(find.byTooltip('More actions'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Active chats'));
      await tester.pumpAndSettle();
      expect(find.text('Renamed offline chat'), findsOneWidget);
      await action(tester, 'Remove from this device');
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(desktop.threadList.data.deleted, isEmpty);
      await action(tester, 'Remove from this device');
      await tester.tap(find.text('Remove chat'));
      await tester.pumpAndSettle();
      expect(desktop.threadList.data.deleted, contains('t1'));
      expect(transport.calls, isEmpty);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
    },
  );
}
