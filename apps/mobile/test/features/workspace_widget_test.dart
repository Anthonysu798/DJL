import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_controller.dart';
import 'package:djl_mobile/features/workspace/data/workspace_repository.dart';
import 'package:djl_mobile/features/workspace/presentation/checkpoint_page.dart';
import 'package:djl_mobile/features/workspace/presentation/workspace_file_page.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'workspace_repository_test.dart' show WorkspaceTransport;
import '../core/cloud_client_test.dart' show TestCredentials;

class WorkspaceUiTransport extends WorkspaceTransport {
  String diff = 'saved patch';
  @override
  Future<RemoteJson> request(
    String method,
    RemoteJson params, {
    Duration timeout = const Duration(seconds: 30),
  }) async {
    calls.add({'method': method, 'params': params});
    return switch (method) {
      'workspace/checkpointDiff' => {'diff': diff},
      'workspace/readImage' => {
        'path': '/repo/preview.svg',
        'fileName': 'preview.svg',
        'mimeType': 'image/svg+xml',
        'byteLength': 80,
        'dataBase64': base64Encode(
          utf8.encode(
            '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>',
          ),
        ),
      },
      'workspace/checkpointRestorePreview' => {
        'canRestore': true,
        'checkpointRef': 'refs/djl/qa',
        'commit': 'abc',
        'affectedFiles': ['a.dart'],
        'untrackedFiles': ['new.txt'],
      },
      'workspace/checkpointRestoreApply' => {
        'success': true,
        'backupCheckpointRef': 'refs/djl/backup',
        'restoredFiles': ['a.dart'],
      },
      _ => {
        'path': '/repo/a.dart',
        'fileName': 'a.dart',
        'content': 'read-only content',
        'byteLength': 17,
      },
    };
  }
}

void main() {
  for (final diff in ['', '  \n']) {
    for (final brightness in Brightness.values) {
      testWidgets(
        'empty saved diff has explicit feedback in $brightness with whitespace=${diff.isNotEmpty}',
        (tester) async {
          final transport = WorkspaceUiTransport()..diff = diff;
          final desktop = DesktopController(
            PairingRepository(TestCredentials()),
            connection: transport,
          )..thread = {'id': 't1'};
          addTearDown(desktop.dispose);
          await tester.pumpWidget(
            MaterialApp(
              theme: ThemeData(brightness: brightness),
              home: CheckpointPage(
                repository: WorkspaceRepository(
                  transport,
                  cwd: '/repo',
                  threadId: 't1',
                ),
                desktop: desktop,
                turns: const ['u1'],
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(find.text('No saved changes for this turn.'), findsOneWidget);
          expect(
            find.text('Choose a turn to view its saved workspace changes.'),
            findsNothing,
          );
          expect(
            transport.calls.where(
              (c) => c['method'] == 'workspace/checkpointDiff',
            ),
            hasLength(1),
          );
          expect(
            transport.calls.where(
              (c) => c['method'] == 'workspace/checkpointRestoreApply',
            ),
            isEmpty,
          );
          expect(tester.takeException(), isNull);
        },
      );
    }
  }

  testWidgets('switching text preview to an image uses the edited file path', (
    tester,
  ) async {
    final transport = WorkspaceUiTransport();
    await tester.pumpWidget(
      MaterialApp(
        home: WorkspaceFilePage(
          repository: WorkspaceRepository(
            transport,
            cwd: '/repo',
            threadId: 't1',
          ),
          initialPath: 'a.dart',
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Image'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('workspace_file_path')),
      'preview.svg',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    expect((transport.calls.last['params'] as Map)['path'], 'preview.svg');
    expect(find.byType(SvgPicture), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'restore preview can be cancelled and apply requires the explicit confirmation button',
    (tester) async {
      final transport = WorkspaceUiTransport();
      final desktop = DesktopController(
        PairingRepository(TestCredentials()),
        connection: transport,
      )..thread = {'id': 't1'};
      await tester.pumpWidget(
        MaterialApp(
          home: CheckpointPage(
            repository: WorkspaceRepository(
              transport,
              cwd: '/repo',
              threadId: 't1',
            ),
            desktop: desktop,
            turns: const ['u1'],
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Preview restore before this turn'));
      await tester.pumpAndSettle();
      expect(find.text('a.dart'), findsOneWidget);
      expect(find.text('new.txt'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.where(
          (c) => c['method'] == 'workspace/checkpointRestoreApply',
        ),
        isEmpty,
      );
      await tester.tap(find.text('Preview restore before this turn'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Restore files'));
      await tester.pumpAndSettle();
      expect(
        transport.calls.where(
          (c) => c['method'] == 'workspace/checkpointRestoreApply',
        ),
        hasLength(1),
      );
      expect(find.textContaining('Restored 1 files.'), findsOneWidget);
      transport.events.add({
        'method': 'turn/started',
        'params': {
          'threadId': 't1',
          'turn': {'id': 'running'},
        },
      });
      await tester.pump();
      expect(
        tester
            .widget<OutlinedButton>(
              find.widgetWithText(
                OutlinedButton,
                'Preview restore before this turn',
              ),
            )
            .onPressed,
        isNull,
      );
      await tester.pumpWidget(const SizedBox());
      desktop.dispose();
    },
  );
  testWidgets(
    'workspace preview is read-only and retains visible file content',
    (tester) async {
      final transport = WorkspaceUiTransport();
      await tester.pumpWidget(
        MaterialApp(
          home: WorkspaceFilePage(
            repository: WorkspaceRepository(
              transport,
              cwd: '/repo',
              threadId: 't1',
            ),
            initialPath: 'a.dart',
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('read-only content'), findsOneWidget);
      expect(find.byType(SelectableText), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
