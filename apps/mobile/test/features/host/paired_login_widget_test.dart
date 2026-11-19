import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/host/data/paired_login_store.dart';
import 'package:djl_mobile/features/host/domain/paired_login.dart';
import 'package:djl_mobile/features/host/presentation/paired_login_controller.dart';
import 'package:djl_mobile/features/host/presentation/host_controller.dart';
import 'package:djl_mobile/features/host/presentation/host_controls.dart';
import 'paired_login_test.dart' show LoginCredentials;
import 'host_controller_test.dart' show HostStore, HostTransport;

void main() {
  testWidgets(
    'host recovery actions load, reopen, cancel and confirm logout at large text',
    (tester) async {
      final transport = HostTransport();
      final host = HostController(transport, store: HostStore());
      final login = PairedLoginController(
        host,
        PairedLoginStore(LoginCredentials()),
      );
      addTearDown(() {
        login.dispose();
        host.dispose();
      });
      transport.status['hostCapabilities'] = {'hostBrowserLogin': true};
      transport.status['status'] = 'not_logged_in';
      transport.handler = (m, p) async => m == 'account/status/read'
          ? transport.status
          : m == 'account/login/start'
          ? {
              'type': 'chatgpt',
              'loginId': 'one',
              'authUrl': 'https://auth.example/login',
            }
          : {};
      host.bind(device: 'a', session: 's', connected: true, trusted: true);
      login.bind(const LoginIdentity('a', 'pin'));
      await login.load();
      await host.refresh();
      await tester.binding.setSurfaceSize(const Size(360, 600));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: HostPage(controller: host, login: login),
        ),
      );
      Future<void> reveal(String text) async {
        for (
          var i = 0;
          i < 20 && find.text(text).hitTestable().evaluate().isEmpty;
          i++
        ) {
          await tester.drag(find.byType(ListView), const Offset(0, -180));
          await tester.pumpAndSettle();
        }
      }

      await reveal('Sign in on paired Mac');
      final gate = Completer<Map<String, dynamic>>();
      transport.handler = (m, p) =>
          m == 'account/login/start' ? gate.future : Future.value({});
      await tester.tap(find.text('Sign in on paired Mac'));
      await tester.pump();
      expect(find.byType(LinearProgressIndicator), findsWidgets);
      expect(find.text('Starting or checking paired sign-in…'), findsOneWidget);
      gate.complete({
        'type': 'chatgpt',
        'loginId': 'one',
        'authUrl': 'https://auth.example/login',
      });
      await tester.pumpAndSettle();
      expect(find.text('Reopen sign-in on paired Mac'), findsOneWidget);
      await reveal('Cancel pending sign-in');
      await tester.tap(find.text('Cancel pending sign-in'));
      await tester.pumpAndSettle();
      expect(login.pending, isNull);
      await reveal('Sign out paired ChatGPT');
      await tester.tap(find.text('Sign out paired ChatGPT'));
      await tester.pumpAndSettle();
      expect(transport.calls.where((c) => c.$1 == 'account/logout'), isEmpty);
      expect(
        find.text('Sign out ChatGPT on the paired device?'),
        findsOneWidget,
      );
      await tester.tap(find.text('Sign out'));
      await tester.pumpAndSettle();
      expect(transport.calls.where((c) => c.$1 == 'account/logout').length, 1);
      expect(tester.takeException(), isNull);
    },
  );
}
