import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'desktop_activity_test.dart' show ActivityCacheStore;
import 'pairing_presentation_test.dart'
    show PairingWrites, ObservedPairingTransport, finish;

void main() {
  for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
    testWidgets('cold overview offers chat without terminal on $platform', (
      tester,
    ) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(402, 874);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);
      final credentials = PairingWrites();
      final pairs = PairingRepository(credentials);
      final transport = ObservedPairingTransport(pairs);
      final desktop = DesktopController(
        pairs,
        connection: transport,
        localStore: ActivityCacheStore(),
      );
      await tester.pumpWidget(
        MaterialApp(
          theme: djlTheme(Brightness.light).copyWith(platform: platform),
          home: PairingPage(controller: desktop),
        ),
      );
      await tester.pumpAndSettle();
      // New chat floats beside the tab bar, inside the screen margins.
      final chat = tester.getRect(find.byTooltip('New chat'));
      final tabs = tester.getRect(find.byKey(const Key('home.tab.attention')));
      expect(chat.left, greaterThan(tabs.right));
      expect(chat.right, lessThanOrEqualTo(386));
      expect(chat.center.dy, closeTo(tabs.center.dy, 1));
      expect(find.byTooltip('SSH terminals'), findsNothing);
      expect(find.text('Terminal'), findsNothing);
      expect(find.text('Workspaces'), findsNothing);
      expect(credentials.writes, 0);
      expect(transport.attempts, 0);
      expect(transport.rpc, isEmpty);
      expect(tester.takeException(), isNull);
      await finish(tester, desktop);
    });

    testWidgets('cold overview exposes status below search on $platform', (
      tester,
    ) async {
      final pairs = PairingRepository(PairingWrites());
      final transport = ObservedPairingTransport(pairs);
      final desktop = DesktopController(
        pairs,
        connection: transport,
        localStore: ActivityCacheStore(),
      );
      final semantics = tester.ensureSemantics();
      await tester.pumpWidget(
        MaterialApp(
          theme: djlTheme(Brightness.light).copyWith(platform: platform),
          home: PairingPage(controller: desktop),
        ),
      );
      await tester.pumpAndSettle();
      final status = find.bySemanticsLabel('Connection status: Offline');
      expect(status, findsOneWidget);
      expect(
        tester.getRect(status).top,
        greaterThan(tester.getRect(find.byType(TextField)).bottom),
      );
      await tester.tap(find.byType(TextField));
      await tester.pumpAndSettle();
      expect(status, findsNothing);
      expect(transport.attempts, 0);
      expect(transport.rpc, isEmpty);
      expect(tester.takeException(), isNull);
      semantics.dispose();
      await finish(tester, desktop);
    });
  }
}
