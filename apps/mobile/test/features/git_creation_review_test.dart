import 'package:flutter_test/flutter_test.dart';
import 'package:djl_mobile/features/git/domain/git_models.dart';
import 'package:djl_mobile/features/git/domain/git_creation_review.dart';

GitStatus creationStatus({
  String branch = 'main',
  bool dirty = false,
  int local = 0,
  List<String> files = const [],
}) => GitStatus.fromJson({
  'isRepo': true,
  'branch': branch,
  'dirty': dirty,
  'localOnlyCommitCount': local,
  'files': [
    for (final path in files) {'path': path, 'status': 'M'},
  ],
});

void main() {
  test(
    'created branch names follow the source UI prefix without double-prefixing',
    () {
      expect(
        normalizedGitCreatedBranchName('  feature-name\n'),
        'djl/feature-name',
      );
      expect(normalizedGitCreatedBranchName(' djl/feature '), 'djl/feature');
      expect(normalizedGitCreatedBranchName(' \n'), '');
      expect(normalizedGitCreatedBranchName('djl/'), 'djl/');
      // Full Git validation and whitespace-to-dash normalization remain server-owned.
      expect(
        normalizedGitCreatedBranchName('feature name'),
        'djl/feature name',
      );
    },
  );

  test('clean non-default creation does not invent a warning', () {
    expect(
      gitBranchCreationReview(
        creationStatus(branch: 'feature', local: 2),
        defaultBranch: 'main',
        name: 'djl/new',
      ),
      isNull,
    );
    expect(
      gitBranchCreationReview(
        creationStatus(),
        defaultBranch: 'main',
        name: 'djl/new',
      ),
      isNull,
    );
  });

  test(
    'dirty branch review carries source choices and bounded file preview',
    () {
      final review = gitBranchCreationReview(
        creationStatus(
          dirty: true,
          files: ['one.dart', 'two.dart', 'three.dart', 'four.dart'],
        ),
        defaultBranch: 'main',
        name: 'djl/new',
      )!;
      expect(review.title, "Bring local changes to 'djl/new'?");
      expect(review.acceptLabel, 'Carry to New Branch');
      expect(review.canCommitFirst, isTrue);
      expect(review.message, contains("You're creating 'djl/new' from main."));
      for (final file in ['one.dart', 'two.dart', 'three.dart']) {
        expect(review.message, contains('• $file'));
      }
      expect(review.message, contains('• +1 more files'));
      expect(review.message, isNot(contains('four.dart')));
    },
  );

  test('dirty default branch also explains local commit history', () {
    final review = gitBranchCreationReview(
      creationStatus(dirty: true, local: 2),
      defaultBranch: ' main ',
      name: 'djl/new',
    )!;
    expect(
      review.message,
      startsWith(
        'main already has 2 local commits that are not on the remote.',
      ),
    );
    expect(review.message, contains("Those commits stay on main's history."));
    expect(review.acceptLabel, 'Carry to New Branch');
  });

  for (final count in [1, 2]) {
    test('clean default local history review uses source count $count', () {
      final review = gitBranchCreationReview(
        creationStatus(local: count),
        defaultBranch: 'main',
        name: 'djl/new',
      )!;
      expect(review.title, 'Local commits stay on main');
      expect(
        review.message,
        contains(count == 1 ? '1 local commit that' : '2 local commits that'),
      );
      expect(review.acceptLabel, 'Create Anyway');
      expect(review.canCommitFirst, isFalse);
    });
  }

  for (final transfer in ['move', 'copy']) {
    test('dirty worktree $transfer from another base is blocked', () {
      final review = gitWorktreeCreationReview(
        creationStatus(branch: 'feature', dirty: true),
        defaultBranch: 'main',
        name: 'djl/new',
        base: 'main',
        transfer: transfer,
      )!;
      expect(
        review.title,
        '${transfer == 'move' ? 'Move' : 'Copy'} local changes from the current branch',
      );
      expect(review.message, contains("Switch the base branch to 'feature'"));
      expect(review.acceptLabel, isNull);
      expect(review.canCommitFirst, isFalse);
    });
  }

  test('leaving dirty changes here does not claim to transfer them', () {
    expect(
      gitWorktreeCreationReview(
        creationStatus(branch: 'feature', dirty: true),
        defaultBranch: 'main',
        name: 'djl/new',
        base: 'main',
        transfer: 'none',
      ),
      isNull,
    );
  });

  for (final managed in [false, true]) {
    for (final transfer in ['move', 'copy', 'none']) {
      test(
        'default-history worktree review managed=$managed transfer=$transfer',
        () {
          final review = gitWorktreeCreationReview(
            creationStatus(dirty: true, local: 1),
            defaultBranch: 'main',
            name: 'djl/new',
            base: 'main',
            transfer: transfer,
            managed: managed,
          )!;
          expect(review.title, 'Local commits stay on main');
          expect(
            review.message,
            contains(
              managed ? 'Creating a managed worktree' : "Creating 'djl/new'",
            ),
          );
          expect(review.acceptLabel, 'Create Anyway');
          if (transfer == 'none') {
            expect(review.message, isNot(contains('ignored files stay here')));
          } else {
            expect(
              review.message,
              contains(
                transfer == 'move'
                    ? 'Local changes will move into'
                    : 'Local changes will also be copied into',
              ),
            );
            expect(review.message, contains('ignored files stay here.'));
          }
        },
      );
    }
  }
}
