import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/workspace/data/workspace_repository.dart';
import 'package:djl_mobile/features/workspace/presentation/project_picker_page.dart';
import 'project_controller_test.dart' show FolderTransport;

Future<void> folderBrowser(
  WidgetTester tester,
  FolderTransport wire, {
  ValueChanged<String?>? onSelected,
  double scale = 1,
  GlobalKey<NavigatorState>? navigatorKey,
  bool sheet = false,
}) async {
  final repository = ProjectRepository(wire);
  await tester.pumpWidget(
    MaterialApp(
      navigatorKey: navigatorKey,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () async {
              final selected = sheet
                  ? await showProjectPicker(
                      context,
                      repository: repository,
                      initialPath: '/qa/dev',
                    )
                  : await Navigator.push<String>(
                      context,
                      MaterialPageRoute(
                        builder: (_) => ProjectPickerPage(
                          repository: repository,
                          initialPath: '/qa/dev',
                        ),
                      ),
                    );
              onSelected?.call(selected);
            },
            child: const Text('Open browser'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open browser'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('empty folder copy aligns with the full-width source list row', (
    tester,
  ) async {
    await folderBrowser(tester, FolderTransport()..entries = []);
    expect(
      tester.getRect(find.text('No child folders here.')).left,
      closeTo(32, 1),
    );
  });
  testWidgets('folder section headings have their own accessible labels', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    try {
      await folderBrowser(tester, FolderTransport());
      expect(tester.getSemantics(find.text('Locations')).label, 'Locations');
      expect(
        tester.getSemantics(find.text('Current Folder')).label,
        'Current Folder',
      );
    } finally {
      semantics.dispose();
    }
  });
  testWidgets(
    'source folder icons are declared in the Flutter asset manifest',
    (tester) async {
      final manifest = await AssetManifest.loadFromAssetBundle(rootBundle);
      expect(
        manifest.listAssets(),
        containsAll([
          'assets/icons/command/central-folder-2.svg',
          'assets/icons/command/central-folder-restricted.svg',
          'assets/icons/command/central-folder-add-right.svg',
          'assets/icons/command/central-folder-open-reversed.svg',
        ]),
      );
    },
  );
  testWidgets(
    'a query entered during initial loading searches when its directory is ready',
    (tester) async {
      final wire = FolderTransport()..directoryReply = Completer();
      await tester.pumpWidget(
        MaterialApp(
          home: ProjectPickerPage(
            repository: ProjectRepository(wire),
            initialPath: '/qa/dev',
          ),
        ),
      );
      await tester.pump();
      await tester.enterText(find.byType(EditableText).first, 'found');
      await tester.pump(const Duration(milliseconds: 300));
      expect(
        wire.calls.where((v) => v['method'] == 'project/searchDirectories'),
        isEmpty,
      );
      wire.directoryReply!.complete({
        'path': '/qa/dev',
        'parentPath': '/qa',
        'entries': [],
      });
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 249));
      expect(
        wire.calls.where((v) => v['method'] == 'project/searchDirectories'),
        isEmpty,
      );
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pumpAndSettle();
      expect(
        wire.calls.where((v) => v['method'] == 'project/searchDirectories'),
        hasLength(1),
      );
      expect(find.text('Found folder'), findsOneWidget);
    },
  );
  testWidgets('an owned modal does not strand a pending folder search', (
    tester,
  ) async {
    final wire = FolderTransport();
    await folderBrowser(tester, wire);
    await tester.enterText(find.byType(EditableText).first, 'found');
    await tester.pump(const Duration(milliseconds: 100));
    unawaited(
      showDialog<void>(
        context: tester.element(find.byType(ProjectPickerPage)),
        builder: (dialog) => AlertDialog(
          title: const Text('Temporary overlay'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialog),
              child: const Text('Continue'),
            ),
          ],
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 250));
    await tester.pump();
    expect(
      wire.calls.where((v) => v['method'] == 'project/searchDirectories'),
      hasLength(1),
    );
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Found folder'), findsOneWidget);
  });

  testWidgets('closing during folder creation cannot pop a later route', (
    tester,
  ) async {
    final wire = FolderTransport()..createReply = Completer();
    final navigator = GlobalKey<NavigatorState>();
    String? selected;
    await folderBrowser(
      tester,
      wire,
      navigatorKey: navigator,
      onSelected: (value) => selected = value,
    );
    await tester.tap(find.byTooltip('Create folder on Mac'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(EditableText).last, 'late');
    await tester.tap(find.text('Create'));
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 60));
    }
    expect(
      wire.calls.where((v) => v['method'] == 'project/createDirectory'),
      hasLength(1),
    );
    await tester.tap(find.text('Close'));
    await tester.pump(const Duration(milliseconds: 20));
    unawaited(
      navigator.currentState!.push<void>(
        MaterialPageRoute(
          builder: (_) => const Scaffold(body: Text('Later screen')),
        ),
      ),
    );
    wire.createReply!.complete({'path': '/qa/dev/late'});
    await tester.pumpAndSettle();
    expect(find.text('Later screen'), findsOneWidget);
    expect(selected, isNull);
    expect(
      wire.calls.where((v) => v['method'] == 'project/createDirectory'),
      hasLength(1),
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'folder browser shows the source toolbar, sections and directory subtitles',
    (tester) async {
      await folderBrowser(tester, FolderTransport());
      for (final label in [
        'Add Local Folder',
        'Close',
        'Use',
        'Locations',
        'Current Folder',
        'Folders',
        'Search folders',
      ]) {
        expect(find.text(label), findsOneWidget);
      }
      expect(find.text('Use this folder'), findsNothing);
      expect(find.text('/qa/dev/child'), findsOneWidget);
    },
  );

  testWidgets(
    'folder name search waits250ms, uses the current root and clears without a request',
    (tester) async {
      final wire = FolderTransport();
      await folderBrowser(tester, wire);
      await tester.enterText(find.byType(EditableText).first, ' found ');
      await tester.pump(const Duration(milliseconds: 249));
      expect(
        wire.calls.where((v) => v['method'] == 'project/searchDirectories'),
        isEmpty,
      );
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pumpAndSettle();
      final searches = wire.calls.where(
        (v) => v['method'] == 'project/searchDirectories',
      );
      expect(searches, hasLength(1));
      expect(searches.single['params'], {
        'path': '/qa/dev',
        'query': 'found',
        'limit': 80,
      });
      expect(find.text('Matching Folders'), findsOneWidget);
      expect(find.text('Found folder'), findsOneWidget);
      await tester.enterText(find.byType(EditableText).first, '');
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();
      expect(
        wire.calls.where((v) => v['method'] == 'project/searchDirectories'),
        hasLength(1),
      );
      expect(find.text('Folders'), findsOneWidget);
      expect(find.text('Directory child'), findsOneWidget);
    },
  );

  testWidgets(
    'no child folders and no matching folders have distinct source messages',
    (tester) async {
      final wire = FolderTransport()
        ..entries = []
        ..searchEntries = [];
      await folderBrowser(tester, wire);
      expect(find.text('No child folders here.'), findsOneWidget);
      await tester.enterText(find.byType(EditableText).first, 'missing');
      await tester.pump(const Duration(milliseconds: 250));
      await tester.pumpAndSettle();
      expect(
        find.text('No matching folders under this folder.'),
        findsOneWidget,
      );
      expect(find.text('No child folders here.'), findsNothing);
    },
  );

  testWidgets(
    'failed live search hides directory rows until the search is cleared',
    (tester) async {
      final wire = FolderTransport()..failSearch = true;
      await folderBrowser(tester, wire);
      await tester.enterText(find.byType(EditableText).first, 'failed');
      await tester.pump(const Duration(milliseconds: 250));
      await tester.pumpAndSettle();
      expect(find.textContaining('Folder search failed'), findsOneWidget);
      expect(find.text('Directory child'), findsNothing);
      await tester.enterText(find.byType(EditableText).first, '');
      await tester.pumpAndSettle();
      expect(find.textContaining('Folder search failed'), findsNothing);
      expect(find.text('Directory child'), findsOneWidget);
    },
  );

  testWidgets('closing before the debounce expires issues no search', (
    tester,
  ) async {
    final wire = FolderTransport();
    await folderBrowser(tester, wire);
    await tester.enterText(find.byType(EditableText).first, 'cancelled');
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    expect(
      wire.calls.where((v) => v['method'] == 'project/searchDirectories'),
      isEmpty,
    );
    expect(find.text('Open browser'), findsOneWidget);
  });

  testWidgets(
    'New Folder Cancel does not write or dispose an active dialog controller',
    (tester) async {
      final wire = FolderTransport();
      await folderBrowser(tester, wire);
      await tester.tap(find.byTooltip('Create folder on Mac'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(EditableText).last, 'cancelled');
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(
        wire.calls.where((v) => v['method'] == 'project/createDirectory'),
        isEmpty,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'New Folder creates once and returns the created path without an extra browse',
    (tester) async {
      final wire = FolderTransport();
      String? selected;
      await folderBrowser(
        tester,
        wire,
        onSelected: (value) => selected = value,
      );
      await tester.tap(find.byTooltip('Create folder on Mac'));
      await tester.pumpAndSettle();
      expect(find.text('New Folder'), findsOneWidget);
      expect(
        find.text('Create this folder on your device and start a chat there.'),
        findsOneWidget,
      );
      await tester.enterText(find.byType(EditableText).last, 'new-qa');
      await tester.tap(find.text('Create'));
      await tester.pumpAndSettle();
      expect(selected, '/qa/dev/new-qa');
      expect(find.byType(ProjectPickerPage), findsNothing);
      expect(
        wire.calls.where((v) => v['method'] == 'project/createDirectory'),
        hasLength(1),
      );
      expect(
        wire.calls.where((v) => v['method'] == 'project/listDirectory'),
        hasLength(1),
      );
      expect(tester.takeException(), isNull);
    },
  );

  for (final sheet in [false, true]) {
    testWidgets(
      'source folder controls stay reachable with keyboard and2.2 text sheet=$sheet',
      (tester) async {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = const Size(360, 640);
        tester.view.viewPadding = const FakeViewPadding(top: 44, bottom: 34);
        tester.view.padding = const FakeViewPadding(top: 44);
        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        addTearDown(tester.view.reset);
        await folderBrowser(
          tester,
          FolderTransport(),
          scale: 2.2,
          sheet: sheet,
        );
        expect(tester.takeException(), isNull);
        expect(find.text('Close').hitTestable(), findsOneWidget);
        expect(find.text('Use').hitTestable(), findsOneWidget);
        expect(tester.getRect(find.text('Use')).bottom, lessThanOrEqualTo(340));
        await tester.scrollUntilVisible(
          find.text('Current Folder'),
          180,
          scrollable: find.byWidgetPredicate(
            (widget) =>
                widget is Scrollable &&
                widget.axisDirection == AxisDirection.down,
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Current Folder').hitTestable(), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
