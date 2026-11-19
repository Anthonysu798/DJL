import 'package:djl_mobile/features/desktop/domain/desktop_overview.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/pairing/data/pairing_repository.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  List<String> ids(List<DesktopOverviewGroup> groups) =>
      groups.expand((g) => g.threads).map((t) => t['id'] as String).toList();

  test('source scope precedence includes a project without a usable cwd', () {
    final rows = <RemoteJson>[
      {'id': 'studio', 'cwd': '/work/project', 'djlScope': 'studio'},
      {'id': 'project', 'cwd': '/h/.codex/threads/x', 'djlScope': 'project'},
      {'id': 'missing', 'djlScope': 'project'},
      {'id': 'relative', 'cwd': 'relative/folder', 'djlScope': 'project'},
    ];
    final projects = projectDesktopOverview(
      rows,
      scope: DesktopOverviewScope.projects,
    );
    expect(ids(projects).toSet(), {'project', 'missing', 'relative'});
    expect(projects.where((g) => g.label == 'No Project'), hasLength(1));
    expect(
      ids(projectDesktopOverview(rows, scope: DesktopOverviewScope.studio)),
      ['studio'],
    );
  });

  test('generated and custom Studio paths use source component boundaries', () {
    final rows = <RemoteJson>[
      {'id': 'generated', 'cwd': '/h/.codex/threads/one'},
      {'id': 'documents', 'cwd': '/h/Documents/Codex/2026-10-29/name'},
      {'id': 'custom', 'cwd': '/CUSTOM/Chats/session'},
      {'id': 'lookalike', 'cwd': '/custom/chats-other/project'},
    ];
    expect(
      ids(
        projectDesktopOverview(
          rows,
          scope: DesktopOverviewScope.studio,
          projectlessRoots: ['/custom/chats/'],
        ),
      ).toSet(),
      {'generated', 'documents', 'custom'},
    );
    expect(
      ids(
        projectDesktopOverview(
          rows,
          scope: DesktopOverviewScope.projects,
          projectlessRoots: ['/custom/chats/'],
        ),
      ),
      ['lookalike'],
    );
  });

  test(
    'recent projects normalize every Unix timestamp unit accepted by Swift',
    () {
      final rows = <RemoteJson>[
        {'id': 'iso', 'cwd': '/work/iso', 'updatedAt': '2020-01-01T00:00:00Z'},
        {'id': 'seconds', 'cwd': '/work/sec', 'updatedAt': 1609459200},
        {'id': 'milliseconds', 'cwd': '/work/ms', 'updatedAt': 1640995200000},
        {
          'id': 'microseconds',
          'cwd': '/work/us',
          'updatedAt': 1672531200000000,
        },
        {
          'id': 'nanoseconds',
          'cwd': '/work/ns',
          'updatedAt': 1546300800000000000,
        },
      ];
      expect(
        ids(projectDesktopOverview(rows, scope: DesktopOverviewScope.projects)),
        ['microseconds', 'milliseconds', 'seconds', 'iso', 'nanoseconds'],
      );
    },
  );

  test(
    'pinned descendants stay together once and search includes preview/path',
    () {
      final rows = <RemoteJson>[
        {'id': 'parent', 'name': 'Parent', 'cwd': '/work/Alpha'},
        {
          'id': 'child',
          'name': 'Child',
          'cwd': '/work/Alpha',
          'parentThreadId': 'parent',
        },
        {
          'id': 'other',
          'name': 'Other',
          'cwd': '/work/Beta',
          'preview': 'Needle detail',
        },
      ];
      final groups = projectDesktopOverview(
        rows,
        scope: DesktopOverviewScope.projects,
        pinned: ['parent', 'child'],
      );
      expect(groups.first.pinned, isTrue);
      expect(groups.first.threads.map((t) => t['id']), ['parent', 'child']);
      expect(ids(groups).toSet(), {'parent', 'child', 'other'});
      expect(
        ids(
          projectDesktopOverview(
            rows,
            scope: DesktopOverviewScope.projects,
            query: 'needle',
          ),
        ),
        ['other'],
      );
      expect(
        ids(
          projectDesktopOverview(
            rows,
            scope: DesktopOverviewScope.projects,
            query: '/work/Beta',
          ),
        ),
        ['other'],
      );
      final state = ThreadLocalState();
      for (final row in rows) {
        state.upsert(row);
      }
      state.archive('parent', true);
      state.remove('other');
      expect(
        projectDesktopOverview(
          state.visible(),
          scope: DesktopOverviewScope.projects,
        ),
        isEmpty,
      );
    },
  );
}
