import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'desktop_activity_test.dart' show ActivityCacheStore;
import 'desktop_offline_test.dart' show savedPair;
import 'pairing_presentation_test.dart'
    show ObservedPairingTransport, more, close;

Future<void> showOwner(
  WidgetTester tester,
  DesktopController desktop,
  ValueNotifier<bool> owner,
) => tester.pumpWidget(
  MaterialApp(
    home: ValueListenableBuilder<bool>(
      valueListenable: owner,
      builder: (_, visible, _) => visible
          ? PairingPage(controller: desktop)
          : const Scaffold(body: Text('New root')),
    ),
  ),
);

void main() {
  for (final code in [true, false]) {
    testWidgets(
      '${code ? 'code' : 'secure payload'} editor belongs to its modal route after the invoking page is removed',
      (tester) async {
        final pairs = PairingRepository(TestCredentials());
        final transport = ObservedPairingTransport(pairs);
        final desktop = DesktopController(
          pairs,
          connection: transport,
          localStore: ActivityCacheStore(),
        );
        final owner = ValueNotifier(true);
        try {
          await showOwner(tester, desktop, owner);
          if (code) {
            await tester.tap(find.text('Pair with Code'));
            await tester.pumpAndSettle();
          } else {
            await more(tester, 'Secure pairing details');
          }
          final field = find.byKey(
            Key(code ? 'pairing_code' : 'pairing_payload'),
          );
          await tester.enterText(field, 'original draft');
          owner.value = false;
          await tester.pump();
          await tester.enterText(field, 'current draft');
          await tester.pump();
          expect(tester.takeException(), isNull);
          expect(
            tester.widget<TextField>(field).controller!.text,
            'current draft',
          );
          await close(tester, code ? 'Cancel' : 'Close');
          expect(find.text('New root'), findsOneWidget);
          expect(find.byType(PairingPage), findsNothing);
        } finally {
          await tester.pumpWidget(const SizedBox.shrink());
          desktop.dispose();
          owner.dispose();
          await tester.pump();
        }
      },
    );
  }

  testWidgets(
    'native submit completion keeps the modal lifetime separate from its removed parent',
    (tester) async {
      final response = Completer<http.Response>();
      final pairs = PairingRepository(
        TestCredentials(),
        client: MockClient((_) => response.future),
      );
      final transport = ObservedPairingTransport(pairs)..attempts = 2;
      final desktop = DesktopController(
        pairs,
        connection: transport,
        localStore: ActivityCacheStore(),
      );
      final owner = ValueNotifier(true);
      try {
        await showOwner(tester, desktop, owner);
        await more(tester, 'Secure pairing details');
        await tester.enterText(
          find.byKey(const Key('pairing_relay')),
          'wss://relay.test/relay',
        );
        await close(tester, 'Close');
        await tester.tap(find.text('Pair with Code'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const Key('pairing_code')),
          'ABCDEF2345',
        );
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tester.pump();
        expect(desktop.busy, isTrue);
        owner.value = false;
        await tester.pump();
        response.complete(
          http.Response(jsonEncode({'ok': true, ...savedPair().data}), 200),
        );
        await tester.pumpAndSettle();
        expect(desktop.runtimeReady, isTrue);
        expect(tester.takeException(), isNull);
        expect(find.text('Enter one-time code'), findsNothing);
        expect(find.text('New root'), findsOneWidget);
      } finally {
        await tester.pumpWidget(const SizedBox.shrink());
        desktop.dispose();
        owner.dispose();
        await tester.pump();
      }
    },
  );
}
