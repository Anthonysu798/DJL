import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/git/domain/git_models.dart';

GitStatus menuStatus([Map<String, dynamic> values = const {}]) =>
    GitStatus.fromJson({
      'isRepo': true,
      'branch': 'feature',
      'hasHeadCommit': true,
      'hasPushRemote': true,
      'publishedToRemote': true,
      'state': 'up_to_date',
      ...values,
    });

void main() {
  test('Git toolbar retains source diff and publication fields', () {
    final value = menuStatus({
      'localOnlyCommitCount': 3,
      'publishedToRemote': false,
      'diff': {'additions': 12, 'deletions': 4, 'binaryFiles': 2},
    });
    expect(value.localOnlyCommitCount, 3);
    expect(value.publishedToRemote, isFalse);
    expect(value.diffTotals?.additions, 12);
    expect(value.diffTotals?.deletions, 4);
    expect(value.diffTotals?.binaryFiles, 2);
    expect(value.diffTotals?.hasChanges, isTrue);
    expect(menuStatus().diffTotals, isNull);
    expect(
      menuStatus({'diff': <String, dynamic>{}}).diffTotals?.hasChanges,
      isFalse,
    );
  });

  test(
    'Git toolbar matches source groups and action ordering while loading',
    () {
      final sections = gitToolbarSections(null);
      expect(sections.map((section) => section.title), [
        'Changes',
        'Write',
        'Update',
      ]);
      expect(sections[0].actions, [GitToolbarAction.changes]);
      expect(sections[1].actions, [
        GitToolbarAction.commit,
        GitToolbarAction.push,
        GitToolbarAction.commitAndPush,
        GitToolbarAction.commitPushPr,
        GitToolbarAction.createPr,
      ]);
      expect(sections[2].actions, [GitToolbarAction.update]);
      expect(gitToolbarActionEnabled(GitToolbarAction.commit), isTrue);
      for (final action in [
        GitToolbarAction.changes,
        GitToolbarAction.push,
        GitToolbarAction.commitAndPush,
        GitToolbarAction.commitPushPr,
        GitToolbarAction.createPr,
        GitToolbarAction.update,
      ]) {
        expect(gitToolbarActionEnabled(action), isFalse);
      }
    },
  );

  test('uninitialized Git shows only the source Setup action', () {
    final status = menuStatus({'isRepo': false, 'state': 'not_initialized'});
    final sections = gitToolbarSections(status);
    expect(sections.single.title, 'Setup');
    expect(sections.single.actions, [GitToolbarAction.initialize]);
    expect(
      gitToolbarActionEnabled(GitToolbarAction.initialize, status: status),
      isTrue,
    );
    expect(
      gitToolbarActionEnabled(GitToolbarAction.commit, status: status),
      isFalse,
    );
  });

  test(
    'Git toolbar titles and stacked identifiers preserve the source contract',
    () {
      expect(
        {for (final action in GitToolbarAction.values) action: action.title},
        {
          GitToolbarAction.initialize: 'Initialize Git',
          GitToolbarAction.changes: 'Changes',
          GitToolbarAction.commit: 'Commit',
          GitToolbarAction.push: 'Push',
          GitToolbarAction.commitAndPush: 'Commit & Push',
          GitToolbarAction.commitPushPr: 'Commit, Push & PR',
          GitToolbarAction.createPr: 'Create PR',
          GitToolbarAction.update: 'Update',
        },
      );
      expect(GitToolbarAction.commit.stackedIdentifier, 'commit');
      expect(GitToolbarAction.push.stackedIdentifier, 'push');
      expect(GitToolbarAction.commitAndPush.stackedIdentifier, 'commit_push');
      expect(GitToolbarAction.commitPushPr.stackedIdentifier, 'commit_push_pr');
      expect(GitToolbarAction.createPr.stackedIdentifier, 'create_pr');
      expect(GitToolbarAction.update.stackedIdentifier, isNull);
    },
  );

  test(
    'Changes distinguishes unavailable, no changes and binary-only changes',
    () {
      for (final values in [
        <String, dynamic>{},
        {
          'diff': {'additions': 0, 'deletions': 0, 'binaryFiles': 0},
        },
      ]) {
        expect(
          gitToolbarActionEnabled(
            GitToolbarAction.changes,
            status: menuStatus(values),
          ),
          isFalse,
        );
      }
      expect(
        gitToolbarActionEnabled(
          GitToolbarAction.changes,
          status: menuStatus({
            'diff': {'binaryFiles': 1},
          }),
        ),
        isTrue,
      );
    },
  );

  test('source Update permits only fast-forwardable behind states', () {
    for (final state in [
      'behind_only',
      'dirty_and_behind',
      'up_to_date',
      'dirty',
      'diverged',
      'ahead_only',
      'no_upstream',
      'detached_head',
      'not_initialized',
    ]) {
      expect(
        gitToolbarActionEnabled(
          GitToolbarAction.update,
          status: menuStatus({'state': state}),
        ),
        ['behind_only', 'dirty_and_behind'].contains(state),
        reason: state,
      );
    }
  });

  test('source Push and Commit & Push retain distinct availability', () {
    for (final row in [
      ({'canPush': true}, true, true),
      ({'dirty': true}, false, true),
      (<String, dynamic>{}, false, false),
      ({'hasPushRemote': false, 'dirty': true}, false, false),
    ]) {
      final status = menuStatus(row.$1);
      expect(
        gitToolbarActionEnabled(GitToolbarAction.push, status: status),
        row.$2,
      );
      expect(
        gitToolbarActionEnabled(GitToolbarAction.commitAndPush, status: status),
        row.$3,
      );
    }
  });

  test(
    'Create PR needs a known clean feature branch, remote and no behind commits',
    () {
      expect(
        gitToolbarActionEnabled(
          GitToolbarAction.createPr,
          status: menuStatus(),
          defaultBranch: 'main',
        ),
        isTrue,
      );
      for (final values in [
        {'branch': 'main'},
        {'branch': '  '},
        {'dirty': true},
        {'hasPushRemote': false},
        {'behind': 1},
      ]) {
        expect(
          gitToolbarActionEnabled(
            GitToolbarAction.createPr,
            status: menuStatus(values),
            defaultBranch: 'main',
          ),
          isFalse,
          reason: '$values',
        );
      }
      expect(
        gitToolbarActionEnabled(
          GitToolbarAction.createPr,
          status: menuStatus(),
          defaultBranch: '  ',
        ),
        isFalse,
      );
    },
  );

  test(
    'combined PR can prepare a default branch but needs publishable work',
    () {
      for (final values in [
        {'branch': 'main', 'dirty': true},
        {'ahead': 1},
        {'publishedToRemote': false},
      ]) {
        expect(
          gitToolbarActionEnabled(
            GitToolbarAction.commitPushPr,
            status: menuStatus(values),
            defaultBranch: 'main',
          ),
          isTrue,
          reason: '$values',
        );
      }
      for (final values in [
        <String, dynamic>{},
        {'dirty': true, 'behind': 1},
        {'dirty': true, 'hasPushRemote': false},
        {'branch': '', 'dirty': true},
      ]) {
        expect(
          gitToolbarActionEnabled(
            GitToolbarAction.commitPushPr,
            status: menuStatus(values),
            defaultBranch: 'main',
          ),
          isFalse,
          reason: '$values',
        );
      }
    },
  );

  test('disabled or busy toolbar cannot enable any action', () {
    final status = menuStatus({
      'dirty': true,
      'canPush': true,
      'state': 'dirty_and_behind',
      'diff': {'additions': 1},
    });
    for (final action in GitToolbarAction.values) {
      expect(
        gitToolbarActionEnabled(
          action,
          status: status,
          defaultBranch: 'main',
          enabled: false,
        ),
        isFalse,
      );
      expect(
        gitToolbarActionEnabled(
          action,
          status: status,
          defaultBranch: 'main',
          busy: true,
        ),
        isFalse,
      );
    }
  });
}
