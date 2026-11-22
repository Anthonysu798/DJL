import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/chat/presentation/assistant_code_block.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_response_footer.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_response_footer.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'desktop_activity_test.dart' show ActivityCacheStore;
import 'desktop_conversation_fidelity_test.dart' show showConversation;
import 'desktop_new_chat_draft_test.dart' show finishDraft;
import 'desktop_reasoning_controller_test.dart'
    show
        ReasoningTransport,
        ReasoningPairings,
        reasoningDesktop,
        reasoningEvent;

const scopeA = AssistantCodeScope(
  mac: 'a',
  pin: 'pin-a',
  thread: 'thread',
  item: 'answer',
);
const scopeB = AssistantCodeScope(
  mac: 'a',
  pin: 'pin-b',
  thread: 'thread',
  item: 'answer',
);

Future<void> showFooter(
  WidgetTester tester, {
  AssistantCodeScope scope = scopeA,
  String text = '  # Raw response\n```dart\n\tcode();\n```\n',
  String? Function()? readText,
  Brightness brightness = Brightness.light,
  double scale = 1,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(brightness: brightness),
      home: Builder(
        builder: (context) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(scale)),
          child: Scaffold(
            body: Align(
              alignment: Alignment.topLeft,
              child: DesktopResponseFooter(
                scope: scope,
                text: text,
                readText: readText ?? () => text,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final calls = <MethodCall>[];
  Future<Object?> Function(MethodCall)? reply;
  setUp(() {
    calls.clear();
    reply = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
          calls.add(call);
          return reply == null ? null : await reply!(call);
        });
  });
  tearDown(
    () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null),
  );

  testWidgets(
    'actual Page exposes response Copy as its own accessible action',
    (tester) async {
      final semantics = tester.ensureSemantics();
      final transport = ReasoningTransport()
        ..history = {
          'id': 'thread',
          'turns': [
            {
              'id': 'turn',
              'status': 'completed',
              'items': [
                {
                  'id': 'answer',
                  'type': 'agentMessage',
                  'text': 'Reply\n```text\ncode\n```',
                },
              ],
            },
          ],
        };
      final desktop = await reasoningDesktop(transport);
      try {
        await showConversation(tester, desktop);
        expect(
          find.bySemanticsLabel(RegExp(r'^Copy response$')),
          findsOneWidget,
        );
        expect(
          find.bySemanticsLabel(
            RegExp(r'^Assistant message.*Copy response', dotAll: true),
          ),
          findsNothing,
        );
      } finally {
        await finishDraft(tester, desktop);
        semantics.dispose();
      }
    },
  );

  testWidgets(
    'settled status-less history exposes raw Copy without claiming completion',
    (tester) async {
      const raw = '  Legacy reply\n\nSecond line.  ';
      final transport = ReasoningTransport()
        ..history = {
          'id': 'thread',
          'turns': [
            {
              'id': 'legacy',
              'items': [
                {'id': 'answer', 'type': 'agentMessage', 'text': raw},
              ],
            },
          ],
        };
      final desktop = await reasoningDesktop(transport);
      try {
        await showConversation(tester, desktop);
        expect(desktop.turnId, isNull);
        expect(
          desktop.selectedResponseFooter.outcome('legacy'),
          DesktopResponseOutcome.unknown,
        );
        expect(find.byTooltip('Copy response'), findsOneWidget);
        await tester.tap(find.byTooltip('Copy response'));
        await tester.pump();
        expect(
          (calls.singleWhere((c) => c.method == 'Clipboard.setData').arguments
              as Map)['text'],
          raw,
        );
      } finally {
        await finishDraft(tester, desktop);
      }
    },
  );

  testWidgets('cached response Copy works offline and rejects a changed peer', (
    tester,
  ) async {
    const raw = 'Cached reply\n\nExact bytes.';
    final transport = ReasoningTransport()
      ..history = {
        'id': 'thread',
        'turns': [
          {
            'id': 'turn',
            'status': 'completed',
            'items': [
              {'id': 'answer', 'type': 'agentMessage', 'text': raw},
            ],
          },
        ],
      };
    final desktop = await reasoningDesktop(transport);
    try {
      await desktop.disconnect();
      await showConversation(tester, desktop);
      expect(desktop.connected, isFalse);
      final copy = find.byTooltip('Copy response');
      expect(copy, findsOneWidget);
      await tester.tap(copy);
      await tester.pump();
      expect(
        (calls.singleWhere((c) => c.method == 'Clipboard.setData').arguments
            as Map)['text'],
        raw,
      );
      calls.clear();
      desktop.active = Pairing({
        ...desktop.active!.data,
        'macIdentityPublicKey': 'replacement-pin',
      });
      await tester.tap(copy);
      await tester.pump();
      expect(calls.where((c) => c.method == 'Clipboard.setData'), isEmpty);
    } finally {
      await finishDraft(tester, desktop);
    }
  });

  for (final status in ['interrupted', 'inProgress']) {
    testWidgets('offline cached $status stays suppressed after reopening', (
      tester,
    ) async {
      final transport = ReasoningTransport()
        ..history = {
          'id': 'thread',
          'turns': [
            {
              'id': 'earlier',
              'status': 'completed',
              'items': [
                {'id': 'first', 'type': 'userMessage', 'text': 'First'},
                {'id': 'answer', 'type': 'agentMessage', 'text': 'Saved reply'},
              ],
            },
            {
              'id': 'latest',
              'status': status,
              'items': [
                {'id': 'next', 'type': 'userMessage', 'text': 'Next'},
                {'id': 'partial', 'type': 'agentMessage', 'text': 'Partial'},
              ],
            },
          ],
        };
      final desktop = await reasoningDesktop(transport);
      try {
        await showConversation(tester, desktop);
        expect(find.byTooltip('Copy response'), findsOneWidget);
        await desktop.disconnect();
        await tester.pump();
        expect(find.byTooltip('Copy response'), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
        desktop.closeThread('thread');
        await desktop.openThread({'id': 'thread'});
        await showConversation(tester, desktop);
        expect(find.byTooltip('Copy response'), findsOneWidget);
        await tester.tap(find.byTooltip('Copy response'));
        await tester.pump();
        expect(
          (calls.singleWhere((c) => c.method == 'Clipboard.setData').arguments
              as Map)['text'],
          'Saved reply',
        );
      } finally {
        await finishDraft(tester, desktop);
      }
    });
  }

  testWidgets(
    'cold cached Copy preserves stopped facts without live authority',
    (tester) async {
      final store = ActivityCacheStore();
      final transport = ReasoningTransport()
        ..history = {
          'id': 'thread',
          'turns': [
            {
              'id': 'stopped',
              'status': 'interrupted',
              'items': [
                {'id': 'answer', 'type': 'agentMessage', 'text': 'Partial'},
              ],
            },
          ],
        };
      final original = await reasoningDesktop(transport, store: store);
      await original.disconnect();
      await finishDraft(tester, original);
      final offline = ReasoningTransport();
      final restored = DesktopController(
        offline.pairings,
        connection: offline,
        localStore: store,
      )..active = (offline.pairings as ReasoningPairings).pair;
      try {
        await restored.restore();
        await restored.openThread({'id': 'thread'});
        expect(restored.connected, isFalse);
        expect(restored.selectedResponseFooter.outcomes, isEmpty);
        expect(
          restored.selectedResponseCopyFacts.outcome('stopped'),
          DesktopResponseOutcome.stopped,
        );
        await showConversation(tester, restored);
        expect(find.text('Partial'), findsOneWidget);
        expect(find.byTooltip('Copy response'), findsNothing);
        expect(offline.calls, isEmpty);
      } finally {
        await finishDraft(tester, restored);
      }
    },
  );

  testWidgets(
    'Copy writes full raw response and resets after repeated feedback',
    (tester) async {
      await showFooter(tester);
      final copy = find.byTooltip('Copy response');
      await tester.tap(copy);
      await tester.pump();
      expect(
        (calls.singleWhere((c) => c.method == 'Clipboard.setData').arguments
            as Map)['text'],
        '  # Raw response\n```dart\n\tcode();\n```\n',
      );
      expect(find.text('Copied'), findsOneWidget);
      expect(
        calls.where((c) => c.method == 'HapticFeedback.vibrate'),
        hasLength(1),
      );
      await tester.pump(const Duration(milliseconds: 1000));
      await tester.tap(copy);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1000));
      expect(find.text('Copied'), findsOneWidget);
      expect(calls.where((c) => c.method == 'Clipboard.setData'), hasLength(2));
      await tester.pump(const Duration(milliseconds: 501));
      await tester.pumpAndSettle();
      expect(find.text('Copied'), findsNothing);
    },
  );

  testWidgets('activation rereads eligibility before writing the clipboard', (
    tester,
  ) async {
    await showFooter(tester, readText: () => null);
    await tester.tap(find.byTooltip('Copy response'));
    await tester.pump();
    expect(calls.where((c) => c.method == 'Clipboard.setData'), isEmpty);
    expect(find.text('Copied'), findsNothing);
  });

  testWidgets('clipboard failure produces neither Copied nor haptic', (
    tester,
  ) async {
    reply = (call) async {
      if (call.method == 'Clipboard.setData') {
        throw PlatformException(code: 'clipboard-denied');
      }
      return null;
    };
    await showFooter(tester);
    await tester.tap(find.byTooltip('Copy response'));
    await tester.pump();
    expect(find.text('Copied'), findsNothing);
    expect(calls.where((c) => c.method == 'HapticFeedback.vibrate'), isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('scope replacement invalidates pending clipboard feedback', (
    tester,
  ) async {
    final pending = Completer<void>();
    reply = (call) async {
      if (call.method == 'Clipboard.setData') await pending.future;
      return null;
    };
    await showFooter(tester);
    await tester.tap(find.byTooltip('Copy response'));
    await tester.pump();
    await showFooter(tester, scope: scopeB);
    pending.complete();
    await tester.pump();
    expect(find.text('Copied'), findsNothing);
    expect(calls.where((c) => c.method == 'Clipboard.setData'), hasLength(1));
    expect(calls.where((c) => c.method == 'HapticFeedback.vibrate'), isEmpty);
  });

  testWidgets('changed eligibility after await cannot publish stale Copied', (
    tester,
  ) async {
    var current = 'Original';
    final pending = Completer<void>();
    reply = (call) async {
      if (call.method == 'Clipboard.setData') await pending.future;
      return null;
    };
    await showFooter(tester, text: 'Original', readText: () => current);
    await tester.tap(find.byTooltip('Copy response'));
    await tester.pump();
    current = 'Replacement';
    pending.complete();
    await tester.pump();
    expect(find.text('Copied'), findsNothing);
    expect(calls.where((c) => c.method == 'Clipboard.setData'), hasLength(1));
    expect(calls.where((c) => c.method == 'HapticFeedback.vibrate'), isEmpty);
  });

  testWidgets('disposed pending Copy cannot update state or repeat the write', (
    tester,
  ) async {
    final pending = Completer<void>();
    reply = (call) async {
      if (call.method == 'Clipboard.setData') await pending.future;
      return null;
    };
    await showFooter(tester);
    await tester.tap(find.byTooltip('Copy response'));
    await tester.pump();
    await tester.pumpWidget(const SizedBox.shrink());
    pending.complete();
    await tester.pump();
    expect(calls.where((c) => c.method == 'Clipboard.setData'), hasLength(1));
    expect(calls.where((c) => c.method == 'HapticFeedback.vibrate'), isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Copy stays accessible in both themes with large text', (
    tester,
  ) async {
    for (final brightness in Brightness.values) {
      await showFooter(tester, brightness: brightness, scale: 2.2);
      final target = find.byTooltip('Copy response');
      expect(tester.getSize(target).width, greaterThanOrEqualTo(44));
      expect(tester.getSize(target).height, greaterThanOrEqualTo(44));
      await tester.tap(target);
      await tester.pump();
      expect(find.text('Copied'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    }
  });

  testWidgets(
    'response footer appears without resetting a code block wrap choice',
    (tester) async {
      final transport = ReasoningTransport()
        ..history = {
          'id': 'thread',
          'turns': [
            {
              'id': 'turn',
              'status': 'running',
              'items': [
                {
                  'id': 'answer',
                  'type': 'agentMessage',
                  'text': '```text\nLong code line\n```',
                },
              ],
            },
          ],
        };
      final desktop = await reasoningDesktop(transport);
      await showConversation(tester, desktop);
      await tester.tap(find.byTooltip('Disable word wrap'));
      await tester.pump();
      expect(find.byTooltip('Enable word wrap'), findsOneWidget);
      expect(find.byTooltip('Copy response'), findsNothing);
      ((transport.history!['turns'] as List).single as Map)['status'] =
          'completed';
      reasoningEvent(
        transport,
        'turn/completed',
        extra: {'status': 'completed'},
      );
      await tester.pumpAndSettle();
      expect(
        desktop.selectedResponseFooter.outcome('turn'),
        DesktopResponseOutcome.completed,
      );
      expect(desktop.turnId, isNull);
      expect(find.byTooltip('Copy response'), findsOneWidget);
      expect(find.byTooltip('Enable word wrap'), findsOneWidget);
      expect(find.byTooltip('Read aloud'), findsNothing);
      await finishDraft(tester, desktop);
    },
  );

  testWidgets('one response Copy stays on the reply before a hidden tool', (
    tester,
  ) async {
    final transport = ReasoningTransport()
      ..history = {
        'id': 'thread',
        'turns': [
          {
            'id': 'turn',
            'status': 'completed',
            'items': [
              {'id': 'user', 'type': 'userMessage', 'text': 'Question'},
              {
                'id': 'first',
                'type': 'agentMessage',
                'phase': 'commentary',
                'text': '  First  ',
              },
              {
                'id': 'second',
                'type': 'agentMessage',
                'phase': 'commentary',
                'text': 'Second',
              },
              {'id': 'tail', 'type': 'unknown-tool', 'text': 'Tool output'},
            ],
          },
        ],
      };
    final desktop = await reasoningDesktop(transport);
    final copied = <String>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'Clipboard.setData') {
          copied.add((call.arguments as Map)['text'] as String);
        }
        return null;
      },
    );
    addTearDown(() {
      desktop.dispose();
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      );
    });
    await showConversation(tester, desktop);
    final copy = find.byTooltip('Copy response');
    expect(copy, findsOneWidget);
    expect(find.byType(ExpansionTile), findsNothing);
    expect(find.text('Tool output'), findsNothing);
    expect(
      tester.getTopLeft(copy).dy,
      greaterThan(tester.getBottomLeft(find.text('Second')).dy),
    );
    await tester.tap(copy);
    await tester.pump();
    expect(copied, ['Second']);
    expect(find.text('Copied'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 1700));
    await tester.pumpAndSettle();
    expect(find.text('Copied'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
