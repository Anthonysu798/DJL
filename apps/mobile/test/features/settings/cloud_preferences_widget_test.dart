import 'dart:ui' show SemanticsAction;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controller.dart';
import 'package:djl_mobile/features/settings/presentation/settings_controls.dart';
import 'package:djl_mobile/features/notifications/domain/cloud_notification.dart';
import 'package:djl_mobile/features/notifications/presentation/notification_banner.dart';
import 'settings_controller_test.dart' show MemorySettingsStore;

void main() {
  for (final status in ['succeeded', 'failed']) {
    testWidgets(
      'notification $status actions remain usable at phone width and large text',
      (tester) async {
        tester.view.physicalSize = const Size(320, 700);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final semantics = tester.ensureSemantics();
        var opened = 0, dismissed = 0;
        await tester.pumpWidget(
          MaterialApp(
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(2.2)),
              child: child!,
            ),
            home: Scaffold(
              body: CloudNotificationBanner(
                item: CloudNotification(
                  id: 'qa',
                  conversationId: 'c',
                  status: status,
                  finishedAt: DateTime.utc(2026, 10, 30),
                  title:
                      'A long task title that must leave room for the notification dismiss action',
                ),
                onOpen: () => opened++,
                onDismiss: () => dismissed++,
              ),
            ),
          ),
        );
        await tester.tap(
          find.text(status == 'failed' ? 'Task stopped' : 'Task finished'),
        );
        await tester.tap(find.byTooltip('Dismiss notification'));
        expect(opened, 1);
        expect(dismissed, 1);
        expect(
          tester
              .getSemantics(find.byTooltip('Dismiss notification'))
              .getSemanticsData()
              .hasAction(SemanticsAction.tap),
          true,
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        semantics.dispose();
      },
    );
  }
  testWidgets(
    'Cloud preference rows save real choices and stay reachable with large text',
    (tester) async {
      tester.view.physicalSize = const Size(320, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final store = MemorySettingsStore();
      final settings = SettingsController(store);
      await settings.load();
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(2.2)),
            child: child!,
          ),
          home: Scaffold(
            body: SingleChildScrollView(
              child: SettingsControls(
                controller: settings,
                cloudPreferences: true,
              ),
            ),
          ),
        ),
      );
      for (final label in ['In-app alerts', 'Speak new replies']) {
        final row = find.widgetWithText(SwitchListTile, label);
        await tester.ensureVisible(row);
        await tester.pumpAndSettle();
        await tester.tap(row);
        await tester.pumpAndSettle();
      }
      expect(store.values['djl.notifications.inApp'], false);
      expect(store.values['djl.voice.spokenReplies'], true);
      final restored = SettingsController(store);
      await restored.load();
      expect(restored.inAppAlerts, false);
      expect(restored.spokenReplies, true);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      settings.dispose();
      restored.dispose();
    },
  );
}
