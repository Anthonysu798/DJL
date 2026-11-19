import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';
import 'package:djl_mobile/features/desktop/presentation/desktop_navigation_menu.dart';

void main() {
  test(
    'phone recency decodes wire dates, aliases and fallback with stable id ties',
    () {
      final data = ThreadLocalState.fromJson({
        'threads': [
          {'id': 'missing-z'},
          {'id': 'missing-a'},
          {'id': 'iso', 'updatedAt': '2026-01-01T00:00:00Z'},
          {'id': 'seconds', 'updated_at': 1800000000},
          {'id': 'millis', 'updatedAt': '1800000000000'},
          {'id': 'micros', 'updatedAt': 1800000000000000},
          {'id': 'nanos', 'updated_at': '1800000000000000000'},
          {
            'id': 'fallback',
            'updatedAt': 'invalid',
            'created_at': '2030-01-01T00:00:00Z',
          },
          {
            'id': 'child',
            'parent_thread_id': 'iso',
            'updatedAt': '2040-01-01T00:00:00Z',
          },
          {'id': 'archived', 'syncState': 'archivedLocal'},
          {'id': 'removed'},
        ],
      });
      data.remove('removed');
      data.pin('iso', true);
      data.pin('seconds', true);
      final original = data.snapshots.map((t) => t['id']).toList();
      final projection = desktopPhoneThreads(data);
      expect(projection.map((t) => t['id']), [
        'fallback',
        'micros',
        'millis',
        'nanos',
        'seconds',
        'iso',
        'missing-a',
        'missing-z',
      ]);
      expect(
        projection
            .where((t) => data.isPinned(t['id'] as String))
            .map((t) => t['id']),
        ['seconds', 'iso'],
      );
      expect(data.snapshots.map((t) => t['id']), original);
    },
  );
  test(
    'phone projection retains current local titles and excludes archived rows',
    () {
      final data = ThreadLocalState.fromJson({
        'threads': [
          {'id': 'a', 'title': 'Old', 'cwd': '/Alpha'},
          {'id': 'b', 'title': 'Beta'},
          {'id': 'c', 'title': 'Alpha archived'},
        ],
      });
      data.rename('b', 'ALPHA renamed');
      data.archive('c', true);
      final rows = desktopPhoneThreads(data);
      expect(rows.map((t) => t['id']), ['a', 'b']);
      expect(rows.map(threadTitle), ['Old', 'ALPHA renamed']);
    },
  );
}
