import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'package:djl_mobile/features/plans/presentation/desktop_plan_card.dart';
import 'desktop_reasoning_controller_test.dart' show ReasoningTransport;
import 'desktop_history_reconciliation_test.dart' show historyDesktop;
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_checkpoint_ownership_test.dart' show ScopedCheckpointTransport;
import 'package:djl_mobile/features/desktop/presentation/desktop_markdown_image.dart';

class PlanActionTransport extends ScopedCheckpointTransport {
  Completer<RemoteJson>? actionGate;
  Completer<RemoteJson>? activeReadGate;
  final activeReadRequested = Completer<void>();
  final actionRequested = Completer<void>();
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (activeReadGate != null &&
        {'thread/turns/list', 'thread/read'}.contains(method)) {
      calls.add({
        'method': method,
        'params': Map<String, dynamic>.from(params),
      });
      if (!activeReadRequested.isCompleted) activeReadRequested.complete();
      return activeReadGate!.future;
    }
    if (method == 'turn/start' || method == 'turn/steer') {
      calls.add({
        'method': method,
        'params': Map<String, dynamic>.from(params),
      });
      if (!actionRequested.isCompleted) actionRequested.complete();
      return actionGate?.future ??
          {
            'turn': {'id': params['expectedTurnId'] ?? 'implemented'},
          };
    }
    return super.request(method, params, timeout: timeout);
  }
}

class PlanImageTransport extends PlanActionTransport {
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (method == 'workspace/readImage') {
      calls.add({
        'method': method,
        'params': Map<String, dynamic>.from(params),
      });
      return {
        'path': params['path'],
        'fileName': 'chart.png',
        'mimeType': 'image/png',
        'byteLength': 68,
        'dataBase64':
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      };
    }
    return super.request(method, params, timeout: timeout);
  }
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('plan Markdown image uses the owned workspace image reader', (
    tester,
  ) async {
    final t = PlanImageTransport();
    final d = (await tester.runAsync(
      () => historyDesktop(t, [
        {
          'id': 'result',
          'type': 'plan',
          'turnId': 'ended',
          'text': '![Chart](chart.png)',
        },
      ]),
    ))!;
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox());
      d.dispose();
    });
    await tester.pumpWidget(MaterialApp(home: DesktopChatPage(controller: d)));
    await tester.pumpAndSettle();
    expect(find.byType(DesktopMarkdownImage), findsOneWidget);
    final reads = t.calls
        .where((call) => call['method'] == 'workspace/readImage')
        .toList();
    expect(reads, hasLength(1));
    expect(reads.single['params'], {
      'path': '/qa/chart.png',
      'cwd': '/qa',
      'includeData': true,
      'maxPixelDimension': 1600,
    });
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'an open plan sheet fails closed when its selected thread changes',
    (tester) async {
      final t = ReasoningTransport();
      final d = (await tester.runAsync(() => historyDesktop(t, [])))!;
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        d.dispose();
      });
      t.events.add({
        'method': 'turn/started',
        'params': {'threadId': 'thread', 'turnId': 'live'},
      });
      t.events.add({
        'method': 'turn/plan/updated',
        'params': {
          'threadId': 'thread',
          'turnId': 'live',
          'plan': [
            {'step': 'Owned plan', 'status': 'in_progress'},
          ],
        },
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: d)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Open active plan'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Owned plan'), findsOneWidget);
      t.history = {'id': 'other', 'cwd': '/qa', 'turns': []};
      await tester.runAsync(
        () => d.openThread({
          'id': 'other',
          'cwd': '/qa',
        }, readOnlyNavigation: true),
      );
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('This plan is no longer available.'), findsOneWidget);
      expect(find.text('Owned plan'), findsNothing);
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      expect(d.thread?['id'], 'other');
      expect(tester.takeException(), isNull);
    },
  );

  for (final profile in [
    (const Size(1080, 2424), 2.625, 0.0, 1.0),
    (const Size(1206, 2622), 3.0, 0.0, 1.0),
    (const Size(320, 600), 1.0, 250.0, 2.2),
  ]) {
    for (final brightness in Brightness.values) {
      testWidgets(
        'plan sheet keeps Done and long steps usable at $profile $brightness',
        (tester) async {
          tester.view.physicalSize = profile.$1;
          tester.view.devicePixelRatio = profile.$2;
          tester.view.viewInsets = FakeViewPadding(
            bottom: profile.$3 * profile.$2,
          );
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          addTearDown(tester.view.resetViewInsets);
          final t = ReasoningTransport();
          final d = (await tester.runAsync(() => historyDesktop(t, [])))!;
          addTearDown(() async {
            await tester.pumpWidget(const SizedBox());
            d.dispose();
          });
          t.events.add({
            'method': 'turn/started',
            'params': {'threadId': 'thread', 'turnId': 'live'},
          });
          t.events.add({
            'method': 'turn/plan/updated',
            'params': {
              'threadId': 'thread',
              'turnId': 'live',
              'plan': List.generate(
                20,
                (i) => {
                  'step': 'Step ${i + 1}: preserve the complete readable plan',
                  'status': i == 0 ? 'in_progress' : 'pending',
                },
              ),
            },
          });
          await tester.pumpWidget(
            MaterialApp(
              theme: ThemeData(brightness: brightness),
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(textScaler: TextScaler.linear(profile.$4)),
                child: child!,
              ),
              home: DesktopChatPage(controller: d),
            ),
          );
          await tester.pumpAndSettle();
          await tester.enterText(
            find.byKey(const Key('desktop_composer')),
            'Keep this draft',
          );
          await tester.pumpAndSettle();
          final input = tester
              .widget<TextField>(find.byKey(const Key('desktop_composer')))
              .controller!;
          final before = input.value;
          await tester.ensureVisible(find.byTooltip('Open active plan'));
          await tester.pumpAndSettle();
          await tester.tap(find.byTooltip('Open active plan'));
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 400));
          await tester.pump(const Duration(milliseconds: 100));
          final bottom = profile.$1.height / profile.$2 - profile.$3;
          expect(
            tester.getRect(find.byType(DraggableScrollableSheet)).bottom,
            lessThanOrEqualTo(bottom + 1),
          );
          await tester.scrollUntilVisible(
            find.text('Step 20: preserve the complete readable plan'),
            400,
            scrollable: find.byType(Scrollable).last,
          );
          expect(
            find.text('Step 20: preserve the complete readable plan'),
            findsOneWidget,
          );
          expect(
            tester.getRect(find.text('Done')).bottom,
            lessThanOrEqualTo(bottom + 1),
          );
          await tester.tap(find.text('Done'));
          await tester.pumpAndSettle();
          expect(input.value, before);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }

  for (final streaming in [false, true]) {
    testWidgets(
      'explicit assistant proposed-plan envelope preserves surrounding prose streaming=$streaming',
      (tester) async {
        final t = PlanActionTransport();
        final d = (await tester.runAsync(
          () => historyDesktop(t, [
            {
              'id': 'assistant',
              'type': 'agentMessage',
              'turnId': 'turn',
              'isStreaming': streaming,
              'text':
                  'Intro outside plan.\n\n<PROPOSED_PLAN>\n## Reviewed approach\n- Preserve ownership\n</PROPOSED_PLAN>\n\nOutro outside plan.',
            },
          ], running: streaming),
        ))!;
        addTearDown(() async {
          await tester.pumpWidget(const SizedBox());
          d.dispose();
        });
        await tester.pumpWidget(
          MaterialApp(home: DesktopChatPage(controller: d)),
        );
        await tester.pumpAndSettle();
        expect(
          find.text('Proposed plan'),
          streaming ? findsNothing : findsOneWidget,
        );
        if (!streaming) {
          expect(find.textContaining('Intro outside plan.'), findsOneWidget);
          expect(find.textContaining('Outro outside plan.'), findsOneWidget);
          expect(find.text('Reviewed approach'), findsOneWidget);
          expect(find.text('Implement'), findsOneWidget);
        }
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final active in [false, true]) {
    testWidgets(
      'explicit Implement exits plan mode through owned ${active ? 'Steer' : 'Start'} once',
      (tester) async {
        final t = PlanActionTransport();
        final d = (await tester.runAsync(
          () => historyDesktop(t, [
            {
              'id': 'result',
              'type': 'plan',
              'turnId': 'ended',
              'text': 'Reviewed body must remain in history',
            },
          ]),
        ))!;
        final gate = Completer<RemoteJson>();
        t.actionGate = gate;
        addTearDown(() async {
          if (!gate.isCompleted) {
            gate.complete({
              'turn': {'id': active ? 'active' : 'implemented'},
            });
          }
          await tester.pumpWidget(const SizedBox());
          d.dispose();
        });
        d.models = [
          {'id': 'qa', 'model': 'provider-model', 'displayName': 'QA'},
        ];
        d.model = 'qa';
        d.plan = true;
        if (active) {
          t.events.add({
            'method': 'turn/started',
            'params': {'threadId': 'thread', 'turnId': 'active'},
          });
        }
        await tester.pumpWidget(
          MaterialApp(home: DesktopChatPage(controller: d)),
        );
        await tester.pumpAndSettle();
        final button = find.ancestor(
          of: find.text('Implement'),
          matching: find.byWidgetPredicate(
            (widget) => widget is ButtonStyleButton,
          ),
        );
        expect(tester.widget<ButtonStyleButton>(button).onPressed, isNotNull);
        await tester.tap(find.text('Implement'));
        await tester.pump(const Duration(milliseconds: 400));
        final calls = t.calls
            .where(
              (call) =>
                  call['method'] == 'turn/start' ||
                  call['method'] == 'turn/steer',
            )
            .toList();
        expect(calls, hasLength(1));
        expect(calls.single['method'], active ? 'turn/steer' : 'turn/start');
        final params = calls.single['params'] as Map;
        expect(params['threadId'], 'thread');
        expect(params['input'], [
          {'type': 'text', 'text': 'Implement plan.'},
        ]);
        expect((params['collaborationMode'] as Map)['mode'], 'default');
        expect(
          ((params['collaborationMode'] as Map)['settings'] as Map)['model'],
          'provider-model',
        );
        if (active) expect(params['expectedTurnId'], 'active');
        expect(
          tester
              .widget<ButtonStyleButton>(
                find.ancestor(
                  of: find.text('Starting...'),
                  matching: find.byWidgetPredicate(
                    (widget) => widget is ButtonStyleButton,
                  ),
                ),
              )
              .onPressed,
          isNull,
        );
        gate.complete({
          'turn': {'id': active ? 'active' : 'implemented'},
        });
        await tester.pump(const Duration(milliseconds: 400));
        await tester.pump(const Duration(milliseconds: 100));
        expect(d.plan, isFalse);
        expect(d.access, 'on-request');
        expect(
          t.calls.where(
            (call) =>
                call['method'] == 'turn/start' ||
                call['method'] == 'turn/steer',
          ),
          hasLength(1),
        );
      },
    );
  }

  testWidgets(
    'actual chat exposes a compact live plan and updating scrollable details',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final t = ReasoningTransport();
      final d = (await tester.runAsync(() => historyDesktop(t, [])))!;
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        d.dispose();
      });
      final scope = {'threadId': 'thread', 'turnId': 'live'};
      t.events.add({'method': 'turn/started', 'params': scope});
      t.events.add({
        'method': 'turn/plan/updated',
        'params': {
          ...scope,
          'explanation': 'Inspect then fix',
          'plan': [
            {'step': 'Inspect the flow', 'status': 'inProgress'},
            {'step': 'Fix the behavior', 'status': 'pending'},
          ],
        },
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: d)),
      );
      await tester.pumpAndSettle();
      expect(find.byTooltip('Open active plan'), findsOneWidget);
      expect(find.text('Step 1 / 2'), findsOneWidget);
      expect(find.text('plan'), findsNothing);
      final before = t.calls.length;
      await tester.tap(find.byTooltip('Open active plan'));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Active plan'), findsOneWidget);
      final initialHeader = tester.getTopLeft(find.text('Active plan')).dy;
      await tester.dragFrom(
        tester.getCenter(find.byKey(const Key('desktop_plan_grabber'))),
        const Offset(0, -300),
      );
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pump(const Duration(milliseconds: 400));
      expect(
        tester.getTopLeft(find.text('Active plan')).dy,
        lessThan(initialHeader - 100),
        reason: 'The source grabber expands its pinned plan sheet',
      );
      expect(find.text('Inspect the flow'), findsOneWidget);
      expect(find.text('Fix the behavior'), findsOneWidget);
      expect(find.text('Pending'), findsOneWidget);
      t.events.add({
        'method': 'turn/plan/updated',
        'params': {
          ...scope,
          'plan': [
            {'step': 'Inspect the flow', 'status': 'completed'},
            {'step': 'Fix the behavior', 'status': 'in_progress'},
          ],
        },
      });
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Completed'), findsOneWidget);
      expect(find.text('In progress'), findsOneWidget);
      expect(
        t.calls.length,
        before,
        reason: 'Plan inspection must not issue RPC actions',
      );
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      expect(find.text('Active plan'), findsNothing);
      expect(find.text('Step 2 / 2'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'completed plan result has the source five-line expansion and explicit action',
    (tester) async {
      final t = ReasoningTransport();
      final d = (await tester.runAsync(
        () => historyDesktop(t, [
          {
            'id': 'result',
            'type': 'plan',
            'turnId': 'ended',
            'text': List.generate(8, (i) => 'Line ${i + 1} content').join('\n'),
          },
        ]),
      ))!;
      addTearDown(() async {
        await tester.pumpWidget(const SizedBox());
        d.dispose();
      });
      await tester.pumpWidget(
        MaterialApp(home: DesktopChatPage(controller: d)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Proposed plan'), findsOneWidget);
      expect(find.byTooltip('Expand plan'), findsOneWidget);
      expect(find.text('Implement'), findsOneWidget);
      final action = find.ancestor(
        of: find.text('Implement'),
        matching: find.byWidgetPredicate(
          (widget) => widget is ButtonStyleButton,
        ),
      );
      expect(
        tester.getSize(action).width,
        closeTo(
          tester.getSize(find.byType(DesktopPlanResultCard)).width - 30,
          1,
        ),
      );
      expect(find.textContaining('Line 8 content'), findsNothing);
      await tester.tap(find.byTooltip('Expand plan'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Line 8 content'), findsOneWidget);
      await tester.tap(find.byTooltip('Collapse plan'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Line 8 content'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
