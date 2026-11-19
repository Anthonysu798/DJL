import 'dart:async';
import 'package:djl_mobile/features/guardian/domain/guardian_review.dart';
import 'package:djl_mobile/features/guardian/presentation/guardian_review_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import '../core/cloud_client_test.dart' show TestCredentials;
import 'guardian_review_test.dart'
    show GuardianTransport, guardianDesktop, guardianParams, emitGuardian;

void main() {
  testWidgets(
    'guardian card shows rationale and explicit one-shot submission without claiming approval before acknowledgement',
    (tester) async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()))
        ..retry = Completer<RemoteJson>();
      final desktop = guardianDesktop(transport);
      emitGuardian(transport, guardianParams());
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Auto-review · Denied'), findsOneWidget);
      await tester.tap(find.text('Auto-review · Denied'));
      await tester.pumpAndSettle();
      expect(find.text('curl https://example.com'), findsOneWidget);
      expect(find.text('High risk'), findsOneWidget);
      expect(find.text('Authorization: low'), findsOneWidget);
      expect(find.text('Writes outside workspace'), findsOneWidget);
      await tester.tap(find.text('Approve one retry'));
      await tester.pump();
      expect(transport.calls, hasLength(1));
      expect(
        find.text('Approval recorded; the retry will still be reviewed'),
        findsNothing,
      );
      expect(find.text('Approve one retry'), findsNothing);
      transport.retry!.complete({});
      await tester.pumpAndSettle();
      expect(
        find.text('Approval recorded; the retry will still be reviewed'),
        findsOneWidget,
      );
      emitGuardian(transport, guardianParams());
      await tester.pumpAndSettle();
      expect(find.text('Approve one retry'), findsNothing);
      expect(transport.calls, hasLength(1));
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
    },
  );
  testWidgets(
    'failed or refused retry acknowledgement leaves accurate uncertainty and no repeat button',
    (tester) async {
      final transport = GuardianTransport(PairingRepository(TestCredentials()))
        ..retry = Completer<RemoteJson>();
      final desktop = guardianDesktop(transport);
      emitGuardian(transport, guardianParams());
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Auto-review · Denied'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Approve one retry'));
      await tester.pump();
      transport.retry!.complete({'success': false});
      await tester.pumpAndSettle();
      expect(
        find.text('Approval recorded; the retry will still be reviewed'),
        findsNothing,
      );
      expect(find.text('Approve one retry'), findsNothing);
      expect(
        find.text(
          'Retry approval may not have reached Codex. Check Codex before trying again.',
        ),
        findsOneWidget,
      );
      emitGuardian(transport, guardianParams());
      await tester.pumpAndSettle();
      expect(find.text('Approve one retry'), findsNothing);
      expect(transport.calls, hasLength(1));
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
    },
  );
  for (final state in ['mirror', 'cached', 'unknown']) {
    testWidgets(
      '$state guardian details scroll at large text and never expose retry authority',
      (tester) async {
        tester.view.physicalSize = const Size(360, 260);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        var review = GuardianReview.decode(
          guardianParams(status: state == 'unknown' ? 'futureState' : 'denied')
            ..['djlDesktopIpcMirror'] = state == 'mirror',
        )!;
        if (state == 'cached') {
          review = GuardianReview.fromRow(
            review.toRow('thread-1', forStorage: true),
          )!;
        }
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
                child: GuardianReviewCard(review: review),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Auto-review · ${review.statusLabel}'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Writes outside workspace'));
        expect(find.text('Writes outside workspace'), findsOneWidget);
        expect(find.text('Approve one retry'), findsNothing);
        expect(find.byType(CircularProgressIndicator), findsNothing);
        if (state != 'unknown') {
          final message = find.text(
            state == 'mirror' ? guardianDesktopReason : guardianLiveReason,
          );
          await tester.ensureVisible(message);
          expect(message, findsOneWidget);
        }
        expect(tester.takeException(), isNull);
      },
    );
  }
  for (final changedWhilePending in [true, false]) {
    testWidgets(
      'replacement action ${changedWhilePending ? 'during' : 'after'} acknowledgement never displays the earlier action approval',
      (tester) async {
        final transport = GuardianTransport(
          PairingRepository(TestCredentials()),
        )..retry = Completer<RemoteJson>();
        final desktop = guardianDesktop(transport);
        emitGuardian(transport, guardianParams());
        await tester.pumpWidget(
          MaterialApp(home: DesktopChatPage(controller: desktop)),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text('Auto-review · Denied'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Approve one retry'));
        await tester.pump();
        if (!changedWhilePending) {
          transport.retry!.complete({});
          await tester.pumpAndSettle();
          expect(
            find.text('Approval recorded; the retry will still be reviewed'),
            findsOneWidget,
          );
        }
        emitGuardian(
          transport,
          guardianParams(
            action: {
              'type': 'command',
              'source': 'unifiedExec',
              'command': 'different replacement action',
              'cwd': '/tmp',
            },
          ),
        );
        await tester.pumpAndSettle();
        if (changedWhilePending) {
          transport.retry!.complete({});
          await tester.pumpAndSettle();
        }
        expect(find.text('different replacement action'), findsOneWidget);
        expect(
          find.text('Approval recorded; the retry will still be reviewed'),
          findsNothing,
        );
        expect(find.text('Submitting retry approval…'), findsNothing);
        expect(find.text('Approve one retry'), findsNothing);
        expect(transport.calls, hasLength(1));
        await tester.pumpWidget(const SizedBox());
        desktop.dispose();
      },
    );
  }
}
