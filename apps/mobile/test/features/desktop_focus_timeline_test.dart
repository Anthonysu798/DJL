import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_focus_timeline.dart';
import 'package:djl_mobile/app/desktop_deep_link.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_chat_page.dart';
import 'desktop_subagents_test.dart' show SubagentTransport, subagentDesktop;

void main() {
  for (final family in ['activity', 'raw']) {
    testWidgets('item-only far focus uses real $family history projection', (
      tester,
    ) async {
      final transport = SubagentTransport();
      final projected = subagentDesktop(transport);
      await projected.threadList.attach('mac-a');
      transport.histories['focused'] = {
        'id': 'focused',
        'turns': [
          {
            'id': 'history-turn',
            'items': List.generate(
              1000,
              (index) => index == 950
                  ? {
                      'id': 'wire-command',
                      'type': 'commandExecution',
                      'command': 'echo focused command',
                      'status': 'completed',
                    }
                  : index == 949
                  ? {
                      'id': 'wire-949',
                      'type': 'agentMessage',
                      'text': 'Projected raw row 949',
                    }
                  : {
                      'id': 'wire-$index',
                      'type': 'userMessage',
                      'content': [
                        {'type': 'text', 'text': 'Projected raw row $index'},
                      ],
                    },
            ),
          },
        ],
      };
      await projected.openThread({'id': 'focused'});
      final source = family == 'activity' ? 'wire-command' : 'wire-951',
          // A command row stays on the desktop; its link lands on the reply
          // before it.
          label = family == 'activity'
              ? 'Projected raw row 949'
              : 'Projected raw row 951';
      expect(projected.timeline[950]['sourceItemId'], 'wire-command');
      expect(projected.timeline[951]['id'], 'wire-951');
      await tester.pumpWidget(
        MaterialApp(
          home: DesktopChatPage(
            controller: projected,
            focusTarget: DesktopLinkTarget('focused', item: source),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text(label, findRichText: true), findsOneWidget);
      expect(
        tester
            .getRect(find.text(label, findRichText: true))
            .overlaps(const Rect.fromLTWH(0, 0, 800, 600)),
        isTrue,
      );
      expect(find.text('Projected raw row 0'), findsNothing);
      expect(find.textContaining('echo focused command'), findsNothing);
      expect(
        find.text('Linked position is not available in the loaded history.'),
        findsNothing,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      projected.dispose();
    });
  }

  testWidgets(
    'late actual history reveals anchor and linked failure stays visible in its chat',
    (tester) async {
      final desktop = subagentDesktop(SubagentTransport());
      await desktop.threadList.attach('mac-a');
      desktop.timeline = List.generate(
        100,
        (index) => <String, dynamic>{
          'id': 'm-$index',
          'type': 'userMessage',
          'text': 'History row $index',
        },
      );
      await tester.pumpWidget(
        MaterialApp(
          home: DesktopChatPage(
            controller: desktop,
            focusTarget: const DesktopLinkTarget('parent', message: 'late'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('Linked position is not available in the loaded history.'),
        findsOneWidget,
      );
      desktop.timeline.add({
        'id': 'late',
        'type': 'userMessage',
        'text': 'Late actual anchor',
      });
      desktop.notifyListeners();
      await tester.pumpAndSettle();
      expect(find.text('Late actual anchor'), findsOneWidget);
      expect(
        find.text('Linked position is not available in the loaded history.'),
        findsNothing,
      );
      desktop.navigationError =
          'The linked desktop conversation is unavailable.';
      desktop.notifyListeners();
      await tester.pumpAndSettle();
      expect(
        find.text('The linked desktop conversation is unavailable.'),
        findsOneWidget,
      );
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
    },
  );

  testWidgets(
    'actual chat renders far focused message and keeps missing-anchor history honest',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(400, 500));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final desktop = subagentDesktop(SubagentTransport());
      await desktop.threadList.attach('mac-a');
      desktop.timeline = List.generate(
        1000,
        (index) => <String, dynamic>{
          'id': 'm-$index',
          'type': 'userMessage',
          'text': 'Visible target row $index',
        },
      );
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(2)),
            child: DesktopChatPage(
              controller: desktop,
              focusTarget: const DesktopLinkTarget('parent', message: 'm-950'),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Visible target row 950'), findsOneWidget);
      expect(
        tester
            .getRect(find.text('Visible target row 950'))
            .overlaps(const Rect.fromLTWH(0, 0, 400, 500)),
        isTrue,
      );
      expect(find.text('Visible target row 0'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      desktop.dispose();
    },
  );
  testWidgets(
    'far unbuilt uneven row is revealed lazily at large text in short viewport',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(360, 400));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      var built = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(2)),
            child: Scaffold(
              body: DesktopFocusTimeline(
                count: 2000,
                target: 1800,
                itemBuilder: (context, index) {
                  built++;
                  return SizedBox(
                    height: index % 2 == 0 ? 170 : 950,
                    child: Text('Actual row $index', key: ValueKey(index)),
                  );
                },
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Actual row 1800'), findsOneWidget);
      expect(
        tester
            .getRect(find.text('Actual row 1800'))
            .overlaps(const Rect.fromLTWH(0, 0, 360, 400)),
        isTrue,
      );
      expect(built, lessThan(30));
      expect(find.text('Actual row 0'), findsNothing);
    },
  );
  testWidgets('late target can appear without assuming row already mounted', (
    tester,
  ) async {
    int? target;
    late StateSetter update;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) {
              update = setState;
              return DesktopFocusTimeline(
                count: 300,
                target: target,
                itemBuilder: (context, index) =>
                    SizedBox(height: 140, child: Text('row $index')),
              );
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('row 250'), findsNothing);
    update(() => target = 250);
    await tester.pumpAndSettle();
    expect(find.text('row 250'), findsOneWidget);
    expect(
      tester
          .getRect(find.text('row 250'))
          .overlaps(const Rect.fromLTWH(0, 0, 800, 600)),
      isTrue,
    );
  });
}
