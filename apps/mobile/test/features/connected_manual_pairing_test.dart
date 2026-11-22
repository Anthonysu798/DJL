import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'desktop_connected_switch_test.dart';
import 'pairing_presentation_test.dart' show more;
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';

void expectRecordedUseOnly(String before, String after, int startedAt) {
  final oldRows = jsonDecode(before) as List;
  final newRows = jsonDecode(after) as List;
  final oldA =
      oldRows.singleWhere((r) => r['pairing']['macDeviceId'] == 'A') as Map;
  final newA =
      newRows.singleWhere((r) => r['pairing']['macDeviceId'] == 'A') as Map;
  final oldActivity = oldA['activity'] as Map;
  final activity = newA['activity'] as Map;
  expect(
    activity['lastUsedAt'],
    inInclusiveRange(startedAt, DateTime.now().millisecondsSinceEpoch),
  );
  expect(
    activity['lastUsedAt'],
    greaterThanOrEqualTo(oldActivity['lastUsedAt'] as int),
  );
  activity['lastUsedAt'] = oldActivity['lastUsedAt'];
  expect(newRows, oldRows);
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  test(
    'connected manual entry pauses transport and retains saved context',
    () async {
      final f = await switchFixture();
      addTearDown(f.desktop.dispose);
      final saved = Map.of(f.credentials.values);
      final thread = {'id': 'manual-entry-history', 'name': 'Retained history'};
      f.desktop.thread = thread;
      f.desktop.timeline = [
        {
          'id': 'message',
          'type': 'agentMessage',
          'text': 'Retained public reply',
        },
      ];
      expect(f.desktop.canEnterManualPairing, isTrue);
      f.desktop.pauseForManualPairing();
      await drainSwitch();
      expect(f.desktop.connected, isFalse);
      expect(f.desktop.state, 'disconnected');
      expect(f.desktop.automaticConnectionAllowed, isFalse);
      expect(f.desktop.active?.macDeviceId, 'A');
      expect(f.desktop.thread, thread);
      expect(f.desktop.timeline.single['text'], 'Retained public reply');
      expect(f.desktop.trusted.map((p) => p.macDeviceId), ['B', 'A']);
      expect(f.credentials.values, saved);
      expect(f.transport.disconnects, 1);
      expect(f.transport.calls, isEmpty);
      f.desktop.suspend();
      f.desktop.resume();
      await drainSwitch();
      expect(f.desktop.connected, isFalse);
      expect(f.transport.connects, isEmpty);
      final reconnectStartedAt = DateTime.now().millisecondsSinceEpoch;
      await f.desktop.reconnect();
      expect(f.desktop.connected, isTrue, reason: f.desktop.error);
      expect(f.desktop.active?.macDeviceId, 'A');
      expect(f.transport.connects, ['A']);
      expect(
        f.transport.calls.where(
          (c) => c.method == 'turn/start' || c.method == 'turn/interrupt',
        ),
        isEmpty,
      );
      expectRecordedUseOnly(
        saved['desktop.trusted']!,
        f.credentials.values['desktop.trusted']!,
        reconnectStartedAt,
      );
      expect({
        ...f.credentials.values,
        'desktop.trusted': saved['desktop.trusted'],
      }, saved);
    },
  );

  testWidgets(
    'connected Connections opens code entry and Cancel preserves trust',
    (tester) async {
      final f = await switchFixture();
      final saved = Map.of(f.credentials.values);
      try {
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: f.desktop)),
        );
        await more(tester, 'Connections');
        final calls = List.of(f.transport.calls);
        for (final title in ['Scan QR Code', 'Pair with Code']) {
          final action = find.widgetWithText(ListTile, title);
          await tester.ensureVisible(action);
          await tester.pumpAndSettle();
          expect(tester.widget<ListTile>(action).onTap, isNotNull);
        }
        expect(
          find.text('Disconnect the current desktop before adding a new Mac.'),
          findsNothing,
        );
        await tester.tap(find.widgetWithText(ListTile, 'Pair with Code'));
        await tester.pumpAndSettle();
        expect(find.text('Enter one-time code'), findsOneWidget);
        expect(find.byType(TextField).hitTestable(), findsOneWidget);
        expect(f.desktop.connected, isFalse);
        await tester.tap(find.text('Cancel'));
        await tester.pumpAndSettle();
        expect(find.text('Enter one-time code'), findsNothing);
        expect(f.desktop.active?.macDeviceId, 'A');
        expect(f.desktop.connected, isFalse);
        expect(f.desktop.automaticConnectionAllowed, isFalse);
        expect(f.credentials.values, saved);
        expect(f.transport.calls, calls);
        final reconnect = find.widgetWithText(TextButton, 'Reconnect');
        expect(reconnect.hitTestable(), findsOneWidget);
        final reconnectStartedAt = DateTime.now().millisecondsSinceEpoch;
        await tester.tap(reconnect);
        await tester.pumpAndSettle();
        expect(f.desktop.connected, isTrue, reason: f.desktop.error);
        expect(f.desktop.active?.macDeviceId, 'A');
        expect(f.transport.connects, ['A']);
        expect(find.text('Offline · showing saved chats'), findsNothing);
        expectRecordedUseOnly(
          saved['desktop.trusted']!,
          f.credentials.values['desktop.trusted']!,
          reconnectStartedAt,
        );
        expect({
          ...f.credentials.values,
          'desktop.trusted': saved['desktop.trusted'],
        }, saved);
        expect(
          f.transport.calls.where(
            (c) => c.method == 'turn/start' || c.method == 'turn/interrupt',
          ),
          isEmpty,
        );
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        f.desktop.dispose();
        await tester.pump();
      }
    },
  );
}
