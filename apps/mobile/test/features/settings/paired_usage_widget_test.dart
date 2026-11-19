import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/app/djl_theme.dart';
import 'package:djl_mobile/features/settings/presentation/paired_usage_card.dart';
import 'package:djl_mobile/features/settings/presentation/paired_usage_controller.dart';
import 'package:djl_mobile/features/settings/presentation/about_djl_page.dart';

Map<String, dynamic> limits(int used) => {
  'primary': {'usedPercent': used, 'windowDurationMins': 300},
};
void bind(
  PairedUsageController c, {
  bool connected = true,
  String session = 's1',
}) => c.bind(mac: 'a', pin: 'pin-a', session: session, connected: connected);
Future<void> show(WidgetTester tester, Widget child, {double scale = 1}) =>
    tester.pumpWidget(
      MaterialApp(
        theme: djlTheme(Brightness.light),
        home: Builder(
          builder: (context) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(scale)),
            child: child,
          ),
        ),
      ),
    );

void main() {
  testWidgets(
    'usage reads once, explicitly refreshes and follows scoped updates',
    (tester) async {
      var calls = 0;
      final c = PairedUsageController((_) async => limits(10 * ++calls));
      bind(c);
      try {
        await show(
          tester,
          Scaffold(
            body: SingleChildScrollView(child: PairedUsageCard(controller: c)),
          ),
        );
        await tester.pumpAndSettle();
        expect(calls, 1);
        expect(find.text('90% left'), findsOneWidget);
        await tester.tap(find.byTooltip('Refresh usage'));
        await tester.pumpAndSettle();
        expect(calls, 2);
        expect(find.text('80% left'), findsOneWidget);
        c.applyUpdate(limits(40));
        await tester.pumpAndSettle();
        expect(find.text('60% left'), findsOneWidget);
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.inactive,
        );
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        await tester.pumpAndSettle();
        expect(calls, 2);
        bind(c, connected: false);
        await tester.pumpAndSettle();
        expect(find.text('60% left'), findsOneWidget);
        expect(
          find.text('Last known limits. Reconnect or refresh to update.'),
          findsOneWidget,
        );
        final button = find.descendant(
          of: find.byTooltip('Refresh usage'),
          matching: find.byWidgetPredicate((w) => w is TextButton),
        );
        expect(tester.widget<TextButton>(button).onPressed, isNull);
        bind(c, session: 's2');
        await tester.pumpAndSettle();
        expect(calls, 3);
        expect(find.text('70% left'), findsOneWidget);
        expect(
          find.text('Last known limits. Reconnect or refresh to update.'),
          findsNothing,
        );
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        c.dispose();
      }
    },
  );

  testWidgets(
    'errors stay retryable and empty valid usage does not autoload forever',
    (tester) async {
      var calls = 0, fail = true;
      final c = PairedUsageController((_) async {
        calls++;
        if (fail) throw StateError('Private detail');
        return {};
      });
      bind(c);
      try {
        await show(tester, Scaffold(body: PairedUsageCard(controller: c)));
        await tester.pumpAndSettle();
        expect(calls, 1);
        expect(
          find.text('Could not load current limits. Try again.'),
          findsOneWidget,
        );
        expect(find.textContaining('Private'), findsNothing);
        fail = false;
        await tester.tap(find.byTooltip('Refresh usage'));
        await tester.pumpAndSettle();
        expect(calls, 2);
        expect(
          find.text('Rate limits are unavailable for this account.'),
          findsOneWidget,
        );
        for (var i = 0; i < 3; i++) {
          tester.binding.handleAppLifecycleStateChanged(
            AppLifecycleState.inactive,
          );
          tester.binding.handleAppLifecycleStateChanged(
            AppLifecycleState.resumed,
          );
          await tester.pumpAndSettle();
        }
        expect(calls, 2);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        c.dispose();
      }
    },
  );

  testWidgets(
    'the real About guide remains scrollable at narrow large-text size',
    (tester) async {
      tester.view.physicalSize = const Size(320, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await show(tester, const AboutDjlPage(), scale: 2.2);
      await tester.pumpAndSettle();
      expect(find.text('About DJL'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('MIT License'),
        500,
        maxScrolls: 60,
      );
      await tester.pumpAndSettle();
      expect(find.text('MIT License').hitTestable(), findsOneWidget);
      expect(find.text('Open source'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
