import '../../pairing/data/pairing_repository.dart';

class GitFile {
  const GitFile(this.path, this.status);
  final String path, status;
}

class GitDiffTotals {
  const GitDiffTotals({
    this.additions = 0,
    this.deletions = 0,
    this.binaryFiles = 0,
  });
  final int additions, deletions, binaryFiles;
  bool get hasChanges => additions > 0 || deletions > 0 || binaryFiles > 0;
  factory GitDiffTotals.fromJson(Map json) => GitDiffTotals(
    additions: json['additions'] as int? ?? 0,
    deletions: json['deletions'] as int? ?? 0,
    binaryFiles: json['binaryFiles'] as int? ?? 0,
  );
}

class GitStatus {
  const GitStatus({
    required this.isRepo,
    required this.dirty,
    required this.hasRemote,
    required this.canPush,
    required this.hasHead,
    required this.ahead,
    required this.behind,
    required this.files,
    this.root,
    this.branch,
    this.tracking,
    this.state = 'up_to_date',
    this.diffTotals,
    this.localOnlyCommitCount = 0,
    this.publishedToRemote = false,
  });
  final bool isRepo, dirty, hasRemote, canPush, hasHead;
  final int ahead, behind;
  final String? root, branch, tracking;
  final String state;
  final List<GitFile> files;
  final GitDiffTotals? diffTotals;
  final int localOnlyCommitCount;
  final bool publishedToRemote;
  factory GitStatus.fromJson(RemoteJson json) => GitStatus(
    isRepo: json['isRepo'] as bool? ?? true,
    dirty: json['dirty'] as bool? ?? false,
    hasRemote: json['hasPushRemote'] as bool? ?? true,
    canPush: json['canPush'] as bool? ?? false,
    hasHead: json['hasHeadCommit'] as bool? ?? true,
    ahead: json['ahead'] as int? ?? 0,
    behind: json['behind'] as int? ?? 0,
    root: json['repoRoot'] as String?,
    branch: json['branch'] as String?,
    tracking: json['tracking'] as String?,
    state: json['state'] as String? ?? 'up_to_date',
    diffTotals: json['diff'] is Map
        ? GitDiffTotals.fromJson(json['diff'] as Map)
        : null,
    localOnlyCommitCount: json['localOnlyCommitCount'] as int? ?? 0,
    publishedToRemote: json['publishedToRemote'] as bool? ?? false,
    files: (json['files'] as List? ?? [])
        .map(
          (f) => GitFile(
            (f as Map)['path'] as String,
            f['status'] as String? ?? '',
          ),
        )
        .toList(),
  );
}

enum GitToolbarAction {
  initialize,
  changes,
  commit,
  push,
  commitAndPush,
  commitPushPr,
  createPr,
  update;

  String get title => switch (this) {
    initialize => 'Initialize Git',
    changes => 'Changes',
    commit => 'Commit',
    push => 'Push',
    commitAndPush => 'Commit & Push',
    commitPushPr => 'Commit, Push & PR',
    createPr => 'Create PR',
    update => 'Update',
  };
  String? get stackedIdentifier => switch (this) {
    commit => 'commit',
    push => 'push',
    commitAndPush => 'commit_push',
    commitPushPr => 'commit_push_pr',
    createPr => 'create_pr',
    _ => null,
  };
}

typedef GitToolbarSection = ({String title, List<GitToolbarAction> actions});

String gitToolbarStatusLabel(GitStatus? status) => switch (status?.state) {
  'not_initialized' => 'Git is not initialized',
  'up_to_date' => 'Repository up to date',
  'ahead_only' => 'Local branch ahead of remote',
  'behind_only' => 'Remote branch ahead of local branch',
  'diverged' => 'Local and remote branches diverged',
  'dirty' => 'Local repository has uncommitted changes',
  'dirty_and_behind' => 'Local changes exist and remote branch moved ahead',
  'no_upstream' => 'Branch not published yet',
  'detached_head' => 'Current branch unavailable',
  _ => 'Repository status unavailable',
};

List<GitToolbarSection> gitToolbarSections(GitStatus? status) =>
    status?.state == 'not_initialized'
    ? const [
        (title: 'Setup', actions: [GitToolbarAction.initialize]),
      ]
    : const [
        (title: 'Changes', actions: [GitToolbarAction.changes]),
        (
          title: 'Write',
          actions: [
            GitToolbarAction.commit,
            GitToolbarAction.push,
            GitToolbarAction.commitAndPush,
            GitToolbarAction.commitPushPr,
            GitToolbarAction.createPr,
          ],
        ),
        (title: 'Update', actions: [GitToolbarAction.update]),
      ];

bool gitToolbarActionEnabled(
  GitToolbarAction action, {
  GitStatus? status,
  String defaultBranch = '',
  bool enabled = true,
  bool busy = false,
}) {
  if (!enabled || busy) return false;
  final branch = status?.branch?.trim() ?? '', base = defaultBranch.trim();
  return switch (action) {
    GitToolbarAction.initialize => status?.state == 'not_initialized',
    GitToolbarAction.changes => status?.diffTotals?.hasChanges == true,
    GitToolbarAction.commit => status?.isRepo != false,
    GitToolbarAction.push => status?.canPush == true,
    GitToolbarAction.commitAndPush =>
      status != null && status.hasRemote && (status.dirty || status.canPush),
    GitToolbarAction.createPr =>
      status != null &&
          status.isRepo &&
          branch.isNotEmpty &&
          base.isNotEmpty &&
          branch != base &&
          !status.dirty &&
          status.hasRemote &&
          status.behind == 0,
    GitToolbarAction.commitPushPr =>
      status != null &&
          status.isRepo &&
          branch.isNotEmpty &&
          base.isNotEmpty &&
          status.hasRemote &&
          status.behind == 0 &&
          (status.dirty || status.ahead > 0 || !status.publishedToRemote),
    GitToolbarAction.update =>
      status != null &&
          status.isRepo &&
          ['behind_only', 'dirty_and_behind'].contains(status.state),
  };
}
