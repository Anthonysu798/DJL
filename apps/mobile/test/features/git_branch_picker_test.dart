import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/git/domain/git_branch_picker_models.dart';
import 'package:djl_mobile/features/desktop/domain/desktop_worktree_routing.dart';
import 'package:djl_mobile/features/desktop/domain/thread_local_state.dart';

void main() {
  test(
    'branch snapshot uses real local default and prioritizes current until filtering',
    () {
      final value = GitBranchSnapshot.fromJson({
        'branches': ['other', 'main', 'feature', 'djl/existing'],
        'current': ' feature ',
        'default': ' main ',
      }, fallbackCurrent: 'old');
      expect(value.currentBranch, 'feature');
      expect(value.defaultBranch, 'main');
      expect(value.otherBranches(''), ['feature', 'other', 'djl/existing']);
      expect(value.otherBranches(' OTH '), ['other']);
      expect(value.otherBranches('not-found'), isEmpty);
      expect(value.defaultBranch, 'main');
    },
  );

  test('missing local default cannot invent a selectable branch', () {
    final value = GitBranchSnapshot.fromJson({
      'branches': ['feature'],
      'default': 'main',
    }, fallbackCurrent: 'feature');
    expect(value.defaultBranch, isNull);
    expect(value.currentBranch, 'feature');
    expect(value.selectable('main'), isFalse);
    expect(value.selectable('feature'), isTrue);
  });

  test(
    'elsewhere mapping controls source badges and selection availability',
    () {
      final value = GitBranchSnapshot.fromJson({
        'branches': ['main', 'mapped', 'blocked'],
        'current': 'main',
        'default': 'main',
        'branchesCheckedOutElsewhere': ['mapped', 'blocked'],
        'worktreePathByBranch': {'mapped': ' /repo/mapped ', 'blocked': ' '},
      });
      expect(value.selectable('main'), isTrue);
      expect(value.selectable('mapped'), isTrue);
      expect(value.selectable('blocked'), isFalse);
      expect(value.badge('mapped'), 'Open worktree');
      expect(value.badge('blocked'), 'Open elsewhere');
      expect(value.badge('main'), isNull);
      expect(value.worktreePaths['mapped'], '/repo/mapped');
    },
  );

  test(
    'normalized quick-create follows source case-insensitive existence checks',
    () {
      final value = GitBranchSnapshot.fromJson({
        'branches': ['main', 'other', 'djl/existing'],
        'default': 'main',
      });
      expect(value.suggestedCreation('new'), 'djl/new');
      expect(value.suggestedCreation('other'), 'djl/other');
      expect(value.suggestedCreation('EXISTING'), isNull);
      expect(value.suggestedCreation('djl/existing'), isNull);
      expect(value.suggestedCreation(' \n'), isNull);
      expect(value.suggestedCreation('djl/'), isNull);
    },
  );

  test(
    'comparable worktree paths normalize lexical remote paths without guessing aliases',
    () {
      expect(
        comparableWorktreePath(' /repo/a/../worktree/// '),
        '/repo/worktree',
      );
      expect(
        comparableWorktreePath('/repo//./目录/name%2Freal'),
        '/repo/目录/name%2Freal',
      );
      expect(comparableWorktreePath('/'), '/');
      expect(comparableWorktreePath('~/project/'), '~/project');
      expect(comparableWorktreePath(r'C:\'), 'C:/');
      expect(comparableWorktreePath('server'), isNull);
      expect(comparableWorktreePath(null), isNull);
      expect(
        comparableWorktreePath('/var/worktree'),
        isNot(comparableWorktreePath('/private/var/worktree')),
      );
    },
  );

  test('worktree chat matches are live, exact-path, newest then stable ID', () {
    final state = ThreadLocalState();
    state.snapshots.addAll([
      {'id': 'old-pinned', 'cwd': '/repo/worktree', 'updatedAt': 100},
      {'id': 'z-new', 'cwd': '/repo/worktree/./', 'updatedAt': 200},
      {'id': 'a-new', 'cwd': '/repo/worktree/', 'updatedAt': 200},
      {'id': 'other-path', 'cwd': '/repo/worktree-copy', 'updatedAt': 999},
      {
        'id': 'archived',
        'cwd': '/repo/worktree',
        'updatedAt': 999,
        'archived': true,
      },
      {
        'id': 'local-archive',
        'cwd': '/repo/worktree',
        'updatedAt': 999,
        'syncState': 'archivedLocal',
      },
      {'id': 'override', 'cwd': '/repo/worktree', 'updatedAt': 999},
      {'id': 'deleted', 'cwd': '/repo/worktree', 'updatedAt': 999},
    ]);
    state.pinned.add('old-pinned');
    state.archiveOverrides['override'] = true;
    state.deleted.add('deleted');
    expect(liveWorktreeChats(state, '/repo/worktree').map((t) => t['id']), [
      'a-new',
      'z-new',
      'old-pinned',
    ]);
    expect(liveWorktreeChats(state, '/repo/unknown'), isEmpty);
    expect(liveWorktreeChats(state, 'server'), isEmpty);
  });

  test(
    'worktree recency supports source numeric/ISO dates and created fallback',
    () {
      final older = DateTime.utc(2026, 1, 1), newer = DateTime.utc(2026, 1, 2);
      final state = ThreadLocalState();
      state.snapshots.addAll([
        {
          'id': 'seconds',
          'cwd': '/repo/w',
          'updatedAt': older.millisecondsSinceEpoch / 1000,
        },
        {
          'id': 'milliseconds',
          'cwd': '/repo/w',
          'updatedAt': newer.millisecondsSinceEpoch,
        },
        {
          'id': 'iso',
          'cwd': '/repo/w',
          'createdAt': newer.add(const Duration(days: 1)).toIso8601String(),
        },
        {
          'id': 'snake',
          'cwd': '/repo/w',
          'updated_at':
              newer.add(const Duration(days: 2)).millisecondsSinceEpoch / 1000,
        },
      ]);
      expect(liveWorktreeChats(state, '/repo/w').map((t) => t['id']), [
        'snake',
        'iso',
        'milliseconds',
        'seconds',
      ]);
    },
  );
}
