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

String _commits(int count) =>
    count == 1 ? '1 local commit' : '$count local commits';

GitCreationReview? gitBranchCreationReview(
  GitStatus status, {
  required String defaultBranch,
  required String name,
}) {
  final current = status.branch?.trim() ?? '', base = defaultBranch.trim();
  final onDefault = current.isNotEmpty && current == base;
  final local = status.localOnlyCommitCount;
  if (status.dirty) {
    final source = current.isEmpty ? 'the current branch' : current;
    var message =
        "You're creating '$name' from $source. Carry your local changes onto the new branch, or commit first and then create + switch.";
    if (onDefault && local > 0) {
      message =
          "$base already has ${_commits(local)} that are not on the remote. Those commits stay on $base's history. $message";
    }
    if (status.files.isNotEmpty) {
      final preview = status.files
          .take(3)
          .map((file) => '• ${file.path}')
          .join('\n');
      final remaining = status.files.length - 3;
      message +=
          '\n\nFiles with local changes:\n$preview${remaining > 0 ? '\n• +$remaining more files' : ''}';
    }
    return GitCreationReview(
      title: "Bring local changes to '$name'?",
      message: message,
      acceptLabel: 'Carry to New Branch',
      canCommitFirst: true,
    );
  }
  if (onDefault && local > 0) {
    return GitCreationReview(
      title: 'Local commits stay on $base',
      message:
          "$base already has ${_commits(local)} that are not on the remote. Creating '$name' now starts the new branch from the current HEAD, but those commits stay in $base's history.",
      acceptLabel: 'Create Anyway',
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
  final titleNoun = managed ? 'a managed worktree' : "'$name'";
  final worktreeNoun = managed ? 'the managed worktree' : 'the new worktree';
  if (status.dirty && transfer != 'none' && current != baseName) {
    final verb = transfer == 'copy' ? 'copy' : 'move';
    return GitCreationReview(
      title:
          '${verb == 'copy' ? 'Copy' : 'Move'} local changes from the current branch',
      message:
          "Creating $titleNoun can $verb local changes only from the current branch. Switch the base branch to '$current' or clean up local changes before creating the worktree.",
    );
  }
  if (current.isNotEmpty &&
      current == defaultName &&
      current == baseName &&
      status.localOnlyCommitCount > 0) {
    final suffix = !status.dirty || transfer == 'none'
        ? ''
        : transfer == 'copy'
        ? ' Local changes will also be copied into $worktreeNoun; ignored files stay here.'
        : ' Local changes will move into $worktreeNoun; ignored files stay here.';
    return GitCreationReview(
      title: 'Local commits stay on $defaultName',
      message:
          "$defaultName already has ${_commits(status.localOnlyCommitCount)} that are not on the remote. Creating $titleNoun from $baseName starts from the current HEAD, but those commits stay in $defaultName's history too.$suffix",
      acceptLabel: 'Create Anyway',
    );
  }
  return null;
}
