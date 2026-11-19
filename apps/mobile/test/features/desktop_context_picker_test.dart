import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/data/desktop_composer_repository.dart';
import 'package:djl_mobile/features/desktop/data/remote_transport.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_composer.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_context_picker.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'desktop_composer_repository_test.dart' show ComposerTransport;

void main() {
  testWidgets(
    'picker shows loading, disabled skills, plugin unsupported, and file search only in project root',
    (tester) async {
      final gate = Completer<RemoteJson>();
      final transport = ComposerTransport()
        ..results['skills/list'] = [
          gate,
          {'skills': []},
        ]
        ..results['plugin/list'] = [
          const RemoteRpcException(-32601, 'Method not found', null),
        ]
        ..results['fuzzyFileSearch'] = [
          {
            'files': [
              {
                'root': '/repo',
                'path': '/repo/lib/a.dart',
                'file_name': 'a.dart',
              },
              {'root': '/elsewhere', 'path': '/elsewhere/secret.dart'},
            ],
          },
        ];
      DesktopComposerContext? selected;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  selected = await showModalBottomSheet<DesktopComposerContext>(
                    context: context,
                    isScrollControlled: true,
                    builder: (_) => DesktopContextPicker(
                      repository: DesktopComposerRepository(
                        transport,
                        cwd: '/repo',
                      ),
                      isCurrent: () => true,
                    ),
                  );
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      gate.complete({
        'skills': [
          {'name': 'disabled', 'enabled': false},
          {'name': 'review', 'path': '/skills/review/SKILL.md'},
        ],
      });
      await tester.pumpAndSettle();
      final disabled = tester.widget<ListTile>(
        find.widgetWithText(ListTile, 'disabled'),
      );
      expect(disabled.onTap, isNull);
      await tester.tap(find.text('Plugins'));
      await tester.pumpAndSettle();
      expect(
        find.text('Plugins are not supported by this desktop runtime.'),
        findsOneWidget,
      );
      await tester.tap(find.text('Files'));
      await tester.pumpAndSettle();
      expect(find.text('Search files in /repo'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('desktop_context_search')),
        ' a ',
      );
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pumpAndSettle();
      expect(find.text('lib/a.dart'), findsOneWidget);
      expect(find.text('/elsewhere/secret.dart'), findsNothing);
      await tester.tap(find.text('lib/a.dart'));
      await tester.pumpAndSettle();
      expect(selected?.path, 'lib/a.dart');
      final call = transport.calls.last;
      expect(call['method'], 'fuzzyFileSearch');
      expect((call['params'] as Map)['roots'], ['/repo']);
    },
  );
  testWidgets(
    'context discovery remains scrollable on a small screen with the keyboard open',
    (tester) async {
      tester.view.physicalSize = const Size(320, 480);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final transport = ComposerTransport()
        ..results['skills/list'] = [
          {
            'skills': [
              for (var i = 0; i < 80; i++) {'name': 'skill-$i'},
            ],
          },
        ];
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(
              size: Size(320, 480),
              viewInsets: EdgeInsets.only(bottom: 280),
            ),
            child: Scaffold(
              resizeToAvoidBottomInset: false,
              body: DesktopContextPicker(
                repository: DesktopComposerRepository(transport),
                isCurrent: () => true,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(
        find.text('skill-79'),
        250,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('skill-79'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('a late file-search result cannot replace the newer query', (
    tester,
  ) async {
    final old = Completer<RemoteJson>();
    final transport = ComposerTransport()
      ..results['skills/list'] = [
        {'skills': []},
        {'skills': []},
      ]
      ..results['fuzzyFileSearch'] = [
        old,
        {
          'files': [
            {'root': '/repo', 'path': 'new.dart'},
          ],
        },
      ];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: DesktopContextPicker(
            repository: DesktopComposerRepository(transport, cwd: '/repo'),
            isCurrent: () => true,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Files'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('desktop_context_search')),
      'old',
    );
    await tester.pump(const Duration(milliseconds: 200));
    await tester.enterText(
      find.byKey(const Key('desktop_context_search')),
      'new',
    );
    await tester.pump(const Duration(milliseconds: 200));
    await tester.pumpAndSettle();
    old.complete({
      'files': [
        {'root': '/repo', 'path': 'old.dart'},
      ],
    });
    await tester.pumpAndSettle();
    expect(find.text('new.dart'), findsOneWidget);
    expect(find.text('old.dart'), findsNothing);
  });
  testWidgets(
    'empty/error states are visible and changing scope disables late entries',
    (tester) async {
      final changes = ValueNotifier(0);
      var current = true;
      final transport = ComposerTransport()
        ..results['skills/list'] = [
          {'skills': []},
          {'skills': []},
        ]
        ..results['plugin/list'] = [StateError('Discovery unavailable')];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: DesktopContextPicker(
              repository: DesktopComposerRepository(transport, cwd: '/repo'),
              isCurrent: () => current,
              scopeChanges: changes,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('No skills found.'), findsOneWidget);
      await tester.tap(find.text('Plugins'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Discovery unavailable'), findsOneWidget);
      current = false;
      changes.value++;
      await tester.pumpAndSettle();
      expect(
        find.text('The conversation changed. Reopen the context picker.'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      changes.dispose();
    },
  );
}
