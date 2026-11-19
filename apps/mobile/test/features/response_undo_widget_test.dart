import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/workspace/data/workspace_repository.dart';
import 'package:djl_mobile/features/workspace/presentation/response_undo_controller.dart';
import 'package:djl_mobile/features/workspace/presentation/response_undo_sheet.dart';
import 'response_undo_controller_test.dart' show UndoTransport, ready;

void main() {
  testWidgets(
    'review scrolls with large text, shows overlap and staged reasons, closing never applies',
    (tester) async {
      tester.view.physicalSize = const Size(390, 600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final t = UndoTransport()
        ..preview = {
          'canRevert': true,
          'affectedFiles': List.generate(
            24,
            (i) => 'very/long/file/path/number-$i.dart',
          ),
          'stagedFiles': ['a.txt'],
          'conflicts': [
            {'path': 'a.txt', 'message': 'later edit overlaps'},
          ],
          'unsupportedReasons': ['Mode change is unsupported'],
        };
      final c = ResponseUndoController(
        WorkspaceRepository(t, cwd: '/repo', threadId: 't'),
        ready(),
        isCurrent: () => true,
        blocked: () => null,
        onChanged: () {},
        onSuccess: () async {},
      );
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) =>
                      ResponseUndoSheet(controller: c, overlap: true),
                ),
                child: const Text('Review'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Review'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), null);
      expect(find.textContaining('Other responses touch'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('Undo response'),
        400,
        scrollable: find.byType(Scrollable).last,
      );
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Undo response'),
            )
            .onPressed,
        null,
      );
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
      expect(
        t.calls.where((call) => (call['method'] as String).endsWith('Apply')),
        isEmpty,
      );
      c.dispose();
    },
  );
}
