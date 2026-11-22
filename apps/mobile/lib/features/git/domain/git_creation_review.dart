import '../../../l10n/l10n.dart';
import 'git_models.dart';

String normalizedGitCreatedBranchName(String raw) {
  final name = raw.trim();
  return name.isEmpty || name.startsWith('djl/') ? name : 'djl/$name';
}

class GitCreationReview {
  const GitCreationReview({
    required this.title,
    required this.message,
    this.acceptLabel,
    this.canCommitFirst = false,
  });
  final String title, message;
  final String? acceptLabel;
  final bool canCommitFirst;
}

String _commits(int count) => appStrings.gitReviewLocalCommits(count);

GitCreationReview? gitBranchCreationReview(
  GitStatus status, {
  required String defaultBranch,
  required String name,
}) {
  final current = status.branch?.trim() ?? '', base = defaultBranch.trim();
  final onDefault = current.isNotEmpty && current == base;
  final local = status.localOnlyCommitCount;
  if (status.dirty) {
    final source = current.isEmpty
        ? appStrings.gitReviewTheCurrentBranch
        : current;
    var message = appStrings.gitReviewCreatingFrom(name, source);
    if (onDefault && local > 0) {
      message = appStrings.gitReviewCommitsStayPrefix(
        base,
        _commits(local),
        message,
      );
    }
    if (status.files.isNotEmpty) {
      final preview = status.files
          .take(3)
          .map((file) => '• ${file.path}')
          .join('\n');
      final remaining = status.files.length - 3;
      message +=
          '\n\n${appStrings.gitReviewFilesWithChanges}\n$preview${remaining > 0 ? '\n• ${appStrings.gitReviewMoreFiles(remaining)}' : ''}';
    }
    return GitCreationReview(
      title: appStrings.gitReviewBringChangesTitle(name),
      message: message,
      acceptLabel: appStrings.gitReviewCarryToNewBranch,
      canCommitFirst: true,
    );
  }
  if (onDefault && local > 0) {
    return GitCreationReview(
      title: appStrings.gitReviewCommitsStayTitle(base),
      message: appStrings.gitReviewBranchCommitsStay(
        base,
        _commits(local),
        name,
      ),
      acceptLabel: appStrings.gitReviewCreateAnyway,
    );
  }
  return null;
}

GitCreationReview? gitWorktreeCreationReview(
  GitStatus status, {
  required String defaultBranch,
  required String name,
  required String base,
  required String transfer,
  bool managed = false,
}) {
  final current = status.branch?.trim() ?? '';
  final defaultName = defaultBranch.trim();
  final baseName = base.trim();
  final titleNoun = managed
      ? appStrings.gitReviewManagedWorktreeNoun
      : appStrings.gitReviewQuotedName(name);
  final worktreeNoun = managed
      ? appStrings.gitReviewTheManagedWorktree
      : appStrings.gitReviewTheNewWorktree;
  if (status.dirty && transfer != 'none' && current != baseName) {
    final copy = transfer == 'copy';
    return GitCreationReview(
      title: copy
          ? appStrings.gitReviewCopyTitle
          : appStrings.gitReviewMoveTitle,
      message: appStrings.gitReviewOnlyCurrentBranch(
        titleNoun,
        copy ? appStrings.gitReviewVerbCopy : appStrings.gitReviewVerbMove,
        current,
      ),
    );
  }
  if (current.isNotEmpty &&
      current == defaultName &&
      current == baseName &&
      status.localOnlyCommitCount > 0) {
    final suffix = !status.dirty || transfer == 'none'
        ? ''
        : transfer == 'copy'
        ? appStrings.gitReviewCopiedInto(worktreeNoun)
        : appStrings.gitReviewMovedInto(worktreeNoun);
    return GitCreationReview(
      title: appStrings.gitReviewCommitsStayTitle(defaultName),
      message: appStrings.gitReviewWorktreeCommitsStay(
        defaultName,
        _commits(status.localOnlyCommitCount),
        titleNoun,
        baseName,
        suffix,
      ),
      acceptLabel: appStrings.gitReviewCreateAnyway,
    );
  }
  return null;
}
