import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';

void main() {
  test(
    'fork project bindings survive stale metadata until the server confirms the target',
    () {
      final state = ThreadLocalState();
      state.noteCreated({
        'id': 'fork',
        'cwd': '/target',
        'name': 'Conversation',
      });
      state.bindProject('fork', '/target');
      state.mergeServer([
        {'id': 'fork', 'cwd': '/stale'},
      ]);
      expect(state.find('fork')?['cwd'], '/target');
      expect(threadTitle(state.find('fork')!), 'Conversation');
      state.mergeServer([]);
      expect(state.find('fork'), isNotNull);
      state.upsert({'id': 'fork', 'cwd': '/target'}, fromServer: true);
      expect(state.projectBindings, isEmpty);
    },
  );
  test(
    'archive and remove cascade to subagents while independent forks remain visible',
    () {
      final state = ThreadLocalState()
        ..mergeServer([
          {'id': 'parent', 'name': 'Parent'},
          {'id': 'child', 'parent_thread_id': 'parent'},
          {'id': 'grandchild', 'parentThreadId': 'child'},
          {'id': 'fork', 'forked_from_thread_id': 'parent'},
        ]);
      state.pin('child', true);
      expect(state.pinned, ['parent']);
      state.archive('parent', true);
      expect(state.visible().map((t) => t['id']), ['fork']);
      expect(state.pinned, isEmpty);
      expect(state.visible(archived: true).length, 3);
      state.archive('parent', false);
      state.remove('parent');
      expect(state.deleted, contains('parent'));
      expect(state.isArchived('child'), isTrue);
      expect(state.visible().map((t) => t['id']), ['fork']);
      state.mergeServer([
        {'id': 'parent'},
        {'id': 'child', 'parentThreadId': 'parent'},
        {'id': 'fork'},
      ]);
      expect(state.visible().any((t) => t['id'] == 'parent'), isFalse);
    },
  );
  test(
    'local title, archive choice, pin snapshots and timelines survive serialization and stale server lists',
    () {
      final state = ThreadLocalState()
        ..mergeServer([
          {
            'id': 't1',
            'name': 'Server old',
            'turns': [
              {'private': 'body'},
            ],
          },
          {'id': 't2', 'name': 'Other'},
        ]);
      state.rename('t1', 'Phone name');
      state.pin('t1', true);
      state.drafts['t1'] = 'Private unsent draft';
      state.timelines['t1'] = [
        {'id': 'm1', 'text': 'Private cached reply'},
      ];
      state.mergeServer([
        {'id': 't2', 'name': 'Other'},
      ]);
      expect(state.visible().first['name'], 'Phone name');
      expect(
        state.snapshots.firstWhere((t) => t['id'] == 't1').containsKey('turns'),
        isFalse,
      );
      final restored = ThreadLocalState.fromJson(state.toJson());
      expect(restored.timelines['t1']!.single['text'], 'Private cached reply');
      expect(restored.drafts['t1'], 'Private unsent draft');
      restored.archive('t1', false);
      restored.mergeServer([
        {'id': 't1', 'name': 'Old title', 'archived': true},
      ]);
      expect(restored.visible().single['name'], 'Phone name');
    },
  );
  test('malformed parent cycles cannot loop pin or subtree traversal', () {
    final state = ThreadLocalState()
      ..mergeServer([
        {'id': 'a', 'parentThreadId': 'b'},
        {'id': 'b', 'parentThreadId': 'a'},
      ]);
    state.archive('a', true);
    expect(state.visible(archived: true), hasLength(2));
    state.pin('a', true);
    expect(state.pinned, hasLength(1));
  });
}
