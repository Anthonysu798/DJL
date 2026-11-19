import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import 'package:djl_mobile/features/pairing/presentation/device_recency_text.dart';
import '../core/trusted_device_preferences_test.dart' show preferencePair;
import 'trusted_device_preferences_widget_test.dart' show fixture;
import 'pairing_presentation_test.dart' show more;

const recencyChannel = MethodChannel('djl.mobile/app-info');

Map<String, dynamic> datedDevice(DateTime date) => {
  'djlTrustedEntry': 1,
  'trustId': 'dated-device',
  'pairing': preferencePair(mac: 'other').data,
  'preferences': {'nickname': '', 'visibleInMenu': true},
  'activity': {'lastUsedAt': date.millisecondsSinceEpoch},
};

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  tearDown(
    () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(recencyChannel, null),
  );

  testWidgets(
    'system locale changes refresh the native label without a request loop',
    (tester) async {
      var label = '2 hr. ago', calls = 0;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(recencyChannel, (call) async {
            calls++;
            return label;
          });
      await tester.pumpWidget(
        MaterialApp(
          home: DeviceRecencyText(
            status: 'Saved',
            date: DateTime.now().subtract(const Duration(hours: 2)),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Saved · 2 hr. ago'), findsOneWidget);
      final previousCalls = calls;
      label = 'il y a 2 h';
      tester.binding.platformDispatcher.localesTestValue = const [Locale('fr')];
      addTearDown(tester.binding.platformDispatcher.clearLocalesTestValue);
      await tester.pumpAndSettle();
      expect(find.text('Saved · il y a 2 h'), findsOneWidget);
      expect(calls, previousCalls + 1);
      await tester.pumpAndSettle();
      expect(calls, previousCalls + 1);
    },
  );

  testWidgets(
    'unknown dates make no native call and unavailable formatting keeps readable age',
    (tester) async {
      var calls = 0;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(recencyChannel, (call) async {
            calls++;
            throw PlatformException(code: 'unavailable');
          });
      await tester.pumpWidget(
        const MaterialApp(home: DeviceRecencyText(status: 'Saved')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Saved'), findsOneWidget);
      expect(calls, 0);
      await tester.pumpWidget(
        MaterialApp(
          home: DeviceRecencyText(
            status: 'Saved',
            date: DateTime.now().subtract(const Duration(hours: 2)),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Saved · 2h ago'), findsOneWidget);
      expect(calls, 1);
    },
  );

  testWidgets(
    'disposed date drops a pending result and unregisters locale observation',
    (tester) async {
      final pending = Completer<String>();
      var calls = 0;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(recencyChannel, (call) {
            calls++;
            return pending.future;
          });
      await tester.pumpWidget(
        MaterialApp(
          home: DeviceRecencyText(
            status: 'Saved',
            date: DateTime.now().subtract(const Duration(hours: 2)),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox());
      pending.complete('late');
      tester.binding.platformDispatcher.localesTestValue = const [Locale('fr')];
      addTearDown(tester.binding.platformDispatcher.clearLocalesTestValue);
      await tester.pumpAndSettle();
      expect(find.textContaining('late'), findsNothing);
      expect(calls, 1);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Connections renders native localized recency and sends exact UTC milliseconds',
    (tester) async {
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(recencyChannel, (call) async {
            calls.add(call);
            return 'il y a 2 h';
          });
      final f = await fixture();
      final date = DateTime.now().toUtc().subtract(const Duration(hours: 2));
      f.store.values['desktop.trusted'] = jsonEncode([
        preferencePair().data,
        datedDevice(date),
      ]);
      await f.desktop.restore();
      final started = DateTime.now().millisecondsSinceEpoch;
      try {
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: f.desktop)),
        );
        await more(tester, 'Connections');
        expect(find.text('Saved · il y a 2 h'), findsOneWidget);
        expect(calls, isNotEmpty);
        for (final call in calls) {
          expect(call.method, 'relativeDate');
          final arguments = call.arguments as Map;
          expect(arguments['date'], date.millisecondsSinceEpoch);
          expect(
            arguments['relativeTo'],
            inInclusiveRange(started, DateTime.now().millisecondsSinceEpoch),
          );
        }
        final settledCalls = calls.length;
        await tester.pumpAndSettle();
        expect(
          calls,
          hasLength(settledCalls),
          reason: 'Native completion must not start another format request',
        );
        expect(tester.takeException(), isNull);
      } finally {
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    },
  );

  testWidgets(
    'a delayed native date cannot overwrite a newer device activity date',
    (tester) async {
      final old = DateTime.now().toUtc().subtract(const Duration(hours: 2));
      final fresh = old.add(const Duration(hours: 1));
      final pending = Completer<String>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(recencyChannel, (call) async {
            return (call.arguments as Map)['date'] == old.millisecondsSinceEpoch
                ? pending.future
                : 'il y a 1 h';
          });
      final f = await fixture();
      f.store.values['desktop.trusted'] = jsonEncode([
        preferencePair().data,
        datedDevice(old),
      ]);
      await f.desktop.restore();
      try {
        await tester.pumpWidget(
          MaterialApp(home: PairingPage(controller: f.desktop)),
        );
        await more(tester, 'Connections');
        f.store.values['desktop.trusted'] = jsonEncode([
          preferencePair().data,
          datedDevice(fresh),
        ]);
        await f.desktop.loadDevicePreferences();
        await tester.pumpAndSettle();
        expect(find.text('Saved · il y a 1 h'), findsOneWidget);
        pending.complete('OLD NATIVE RESULT');
        await tester.pumpAndSettle();
        expect(find.textContaining('OLD NATIVE RESULT'), findsNothing);
        expect(find.text('Saved · il y a 1 h'), findsOneWidget);
        expect(tester.takeException(), isNull);
      } finally {
        if (!pending.isCompleted) pending.complete('disposed');
        await tester.pumpWidget(const SizedBox());
        f.desktop.dispose();
        f.settings.dispose();
      }
    },
  );
}
