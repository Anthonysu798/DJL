import '../../pairing/data/pairing_repository.dart';
import 'git_creation_review.dart';

typedef GitBranchChoice = ({String branch, bool create});

class GitBranchSnapshot {
  GitBranchSnapshot.fromJson(RemoteJson json, {String? fallbackCurrent})
    : branches = (json['branches'] as List? ?? [])
          .whereType<String>()
          .map((name) => name.trim())
          .where((name) => name.isNotEmpty)
          .toSet()
          .toList(),
      currentBranch = _text(json['current']) ?? fallbackCurrent?.trim() ?? '',
      _default = _text(json['default']),
      elsewhere = (json['branchesCheckedOutElsewhere'] as List? ?? [])
          .whereType<String>()
          .map((name) => name.trim())
          .toSet(),
      worktreePaths = {
        for (final entry
            in (json['worktreePathByBranch'] as Map? ?? {}).entries)
          if (_text(entry.key) != null && _text(entry.value) != null)
            _text(entry.key)!: _text(entry.value)!,
      };
  final List<String> branches;
  final String currentBranch;
  final String? _default;
  final Set<String> elsewhere;
  final Map<String, String> worktreePaths;

  String? get defaultBranch => branches.contains(_default) ? _default : null;
  List<String> otherBranches(String query) {
    final search = query.trim().toLowerCase();
    final values = branches
        .where(
          (branch) =>
              branch != defaultBranch &&
              (search.isEmpty || branch.toLowerCase().contains(search)),
        )
        .toList();
    if (search.isEmpty && values.remove(currentBranch)) {
      values.insert(0, currentBranch);
    }
    return values;
  }

  String? suggestedCreation(String query) {
    final name = normalizedGitCreatedBranchName(query);
    return name.isEmpty ||
            name == 'djl/' ||
            branches.any((branch) => branch.toLowerCase() == name.toLowerCase())
        ? null
        : name;
  }

  bool selectable(String branch) =>
      branches.contains(branch) &&
      (!elsewhere.contains(branch) || worktreePaths.containsKey(branch));
  String? badge(String branch) => !elsewhere.contains(branch)
      ? null
      : worktreePaths.containsKey(branch)
      ? 'Open worktree'
      : 'Open elsewhere';
}

String? _text(Object? value) =>
    value is String && value.trim().isNotEmpty ? value.trim() : null;
