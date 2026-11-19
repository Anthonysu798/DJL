import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_focus_timeline.dart';
import 'package:djl_mobile/features/guardian/domain/guardian_review.dart';
import 'package:djl_mobile/features/guardian/presentation/guardian_review_card.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/pairing/presentation/pairing_page.dart';
import '../../integration_test/threads_test.dart'
    show reveal, securePairingEntry;
import '../features/desktop_subagents_test.dart' show SubagentTransport;
import '../features/desktop_activity_test.dart' show ActivityCacheStore;

const _child = Key('fixture-child');

GuardianReviewCard _guardian() => GuardianReviewCard(
  review: GuardianReview(
    reviewId: 'fixture-review',
    turnId: 'fixture-turn',
    status: 'denied',
    summary: 'Disposable action',
    startedAtMs: 1,
    rationale: 'Disposable native review fixture.',
    retryUnavailableReason: guardianLiveReason,
  ),
);

Future<void> _pumpLazyCards(
  WidgetTester tester, {
  bool guardianPresent = true,
}) async {
  tester.view.physicalSize = const Size(360, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData.dark().copyWith(
        textTheme: ThemeData.dark().textTheme.apply(fontFamily: 'monospace'),
      ),
      home: Scaffold(
        body: DesktopFocusTimeline(
          count: 65,
          target: 0,
          itemBuilder: (context, index) {
            if (index == 4 && guardianPresent) return _guardian();
            if (index == 52) {
              return const Card(
                key: _child,
                child: SizedBox(height: 180, child: Text('Fixture Scout')),
              );
            }
            return SizedBox(height: 110, child: Text('Fixture row $index'));
          },
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'native reveal recovers a lazily evicted Guardian above the child',
    (tester) async {
      await _pumpLazyCards(tester);
      final guardian = find.byType(GuardianReviewCard);
      final child = find.byKey(_child);
      expect(guardian, findsOneWidget);
      await reveal(tester, child);
      expect(child.hitTestable(), findsOneWidget);
      expect(guardian, findsNothing);
      final position = tester
          .state<ScrollableState>(find.byType(Scrollable))
          .position;
      final afterChild = position.pixels;
      expect(afterChild, greaterThan(1000));
      await reveal(tester, guardian);
      expect(guardian.hitTestable(), findsOneWidget);
      expect(position.pixels, lessThan(afterChild));
      await tester.tap(find.text('Auto-review · Denied'));
      await tester.pumpAndSettle();
      expect(find.text('Disposable native review fixture.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('native reveal reaches an unbuilt child below the viewport', (
    tester,
  ) async {
    await _pumpLazyCards(tester);
    final child = find.byKey(_child);
    expect(child, findsNothing);
    await reveal(tester, child);
    expect(child.hitTestable(), findsOneWidget);
    expect(
      tester.state<ScrollableState>(find.byType(Scrollable)).position.pixels,
      greaterThan(1000),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('native reveal retains forward reach below a deep origin', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = ScrollController(initialScrollOffset: 30000);
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ListView.builder(
            controller: controller,
            itemCount: 500,
            itemBuilder: (context, index) => index == 350
                ? _guardian()
                : SizedBox(height: 100, child: Text('Fixture row $index')),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final guardian = find.byType(GuardianReviewCard);
    expect(controller.position.pixels, 30000);
    expect(guardian, findsNothing);
    await reveal(tester, guardian);
    expect(guardian.hitTestable(), findsOneWidget);
    expect(controller.position.pixels, greaterThan(30000));
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'native reveal reaches older history from the normal latest anchor',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: DesktopFocusTimeline(
              count: 65,
              itemBuilder: (_, index) => index == 4
                  ? _guardian()
                  : SizedBox(height: 110, child: Text('Older row $index')),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final guardian = find.byType(GuardianReviewCard);
      expect(guardian, findsNothing);
      await reveal(tester, guardian);
      expect(guardian.hitTestable(), findsOneWidget);
      expect(
        tester.state<ScrollableState>(find.byType(Scrollable)).position.pixels,
        lessThan(0),
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('native reveal still fails for a truly absent Guardian', (
    tester,
  ) async {
    await _pumpLazyCards(tester, guardianPresent: false);
    await reveal(tester, find.byKey(_child));
    final guardian = find.byType(GuardianReviewCard);
    await expectLater(
      () => reveal(tester, guardian),
      throwsA(isA<StateError>()),
    );
    expect(guardian, findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'native reveal keeps built-target ensureVisible without a scroll page',
    (tester) async {
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: _guardian())));
      final guardian = find.byType(GuardianReviewCard);
      await reveal(tester, guardian);
      expect(guardian.hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'native reveal refuses a missing scroll page for an unbuilt target',
    (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: Text('Public no-scroll fixture')),
        ),
      );
      await expectLater(
        () => reveal(tester, find.byType(GuardianReviewCard)),
        throwsA(isA<StateError>()),
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('native reveal refuses an ambiguous built target', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: Column(children: [_guardian(), _guardian()])),
      ),
    );
    expect(find.byType(GuardianReviewCard), findsNWidgets(2));
    await expectLater(
      () => reveal(tester, find.byType(GuardianReviewCard)),
      throwsA(isA<StateError>()),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'native reveal retains cached history and explicitly opens secure pairing',
    (tester) async {
      final transport = SubagentTransport()..online = false;
      final desktop =
          DesktopController(
              transport.pairings,
              connection: transport,
              localStore: ActivityCacheStore(),
            )
            ..active = Pairing({
              'macDeviceId': 'mac-a',
              'sessionId': 'fixture-session',
            });
      await desktop.threadList.attach('mac-a');
      for (var index = 0; index < 30; index++) {
        desktop.threadList.data.upsert({
          'id': 'saved-$index',
          'title': 'Saved fixture $index',
          'cwd': '/tmp/qa',
        });
      }
      await tester.pumpWidget(
        MaterialApp(home: PairingPage(controller: desktop)),
      );
      await tester.pumpAndSettle();
      final field = find.byKey(const Key('pairing_payload'));
      expect(find.byType(TextField), findsWidgets);
      expect(
        field,
        findsNothing,
        reason: 'Secure entry is a secondary surface.',
      );
      await tester.tap(find.text('Projects'));
      await tester.pumpAndSettle();
      await reveal(tester, find.text('Saved fixture 29'));
      expect(find.text('Saved fixture 29').hitTestable(), findsOneWidget);
      expect(await securePairingEntry(tester), same(desktop));
      await reveal(tester, field);
      expect(field.hitTestable(), findsOneWidget);
      await tester.enterText(field, 'Disposable visible field');
      expect(
        tester.widget<TextField>(field).controller!.text,
        'Disposable visible field',
      );
      expect(transport.calls, isEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
      await tester.pump();
      expect(tester.takeException(), isNull);
    },
  );
}
