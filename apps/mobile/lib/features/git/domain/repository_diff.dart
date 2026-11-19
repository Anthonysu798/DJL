enum GitDiffLineKind { context, addition, deletion }

class GitDiffLine {
  const GitDiffLine(this.text, this.kind, this.oldNumber, this.newNumber);
  final String text;
  final GitDiffLineKind kind;
  final int? oldNumber, newNumber;
}

class GitDiffHunk {
  const GitDiffHunk(this.lines, {required this.synthetic});
  final List<GitDiffLine> lines;
  final bool synthetic;
  int get additions =>
      lines.where((line) => line.kind == GitDiffLineKind.addition).length;
  int get deletions =>
      lines.where((line) => line.kind == GitDiffLineKind.deletion).length;
  String get label {
    if (synthetic) return 'Patch';
    var numbers = lines.map((line) => line.newNumber).whereType<int>().toList();
    if (numbers.isEmpty) {
      numbers = lines.map((line) => line.oldNumber).whereType<int>().toList();
    }
    if (numbers.isEmpty) return 'Patch';
    return numbers.first == numbers.last
        ? 'Line ${numbers.first}'
        : 'Lines ${numbers.first}-${numbers.last}';
  }
}

class RepositoryDiffFile {
  const RepositoryDiffFile(this.path, this.rawPatch, this.hunks);
  final String path, rawPatch;
  final List<GitDiffHunk> hunks;
  int get additions => hunks.fold(0, (sum, hunk) => sum + hunk.additions);
  int get deletions => hunks.fold(0, (sum, hunk) => sum + hunk.deletions);
}

class RepositoryDiff {
  const RepositoryDiff._(this.rawPatch, this.files);
  final String rawPatch;
  final List<RepositoryDiffFile> files;
  int get additions => files.fold(0, (sum, file) => sum + file.additions);
  int get deletions => files.fold(0, (sum, file) => sum + file.deletions);

  factory RepositoryDiff.parse(String patch) {
    final starts = RegExp(
      r'^diff --git ',
      multiLine: true,
    ).allMatches(patch).map((match) => match.start).toList();
    if (starts.isEmpty) starts.add(0);
    final files = <RepositoryDiffFile>[];
    for (var i = 0; i < starts.length; i++) {
      final raw = patch.substring(
        starts[i],
        i + 1 < starts.length ? starts[i + 1] : patch.length,
      );
      final lines = raw
          .split('\n')
          .map(
            (line) =>
                line.endsWith('\r') ? line.substring(0, line.length - 1) : line,
          )
          .toList();
      final path = _path(lines);
      if (path != null) {
        files.add(RepositoryDiffFile(path, raw, _hunks(lines)));
      } else if (raw.trim().isNotEmpty) {
        return RepositoryDiff._(patch, []);
      }
    }
    return RepositoryDiff._(patch, files);
  }
}

String? _path(List<String> lines) {
  final headers = lines.takeWhile((line) => !line.startsWith('@@')).toList();
  for (final prefix in ['+++ ', '--- ', 'rename to ', 'copy to ']) {
    for (final line in headers.where((line) => line.startsWith(prefix))) {
      var value = line.substring(prefix.length).trim();
      if (value.isEmpty || value == '/dev/null') continue;
      if (value.startsWith('a/') || value.startsWith('b/')) {
        value = value.substring(2);
      }
      return value;
    }
  }
  for (final line in headers.where((line) => line.startsWith('diff --git '))) {
    final match = RegExp(r' b/(.+)$').firstMatch(line);
    if (match != null) return match.group(1);
  }
  return null;
}

bool _metadata(String line) => [
  'diff --git ',
  'index ',
  '--- ',
  '+++ ',
  'new file mode',
  'deleted file mode',
  'old mode ',
  'new mode ',
  'rename from ',
  'rename to ',
  'copy from ',
  'copy to ',
  'similarity index ',
  'dissimilarity index ',
  'Binary files ',
  'GIT binary patch',
].any(line.startsWith);

List<GitDiffHunk> _hunks(List<String> source) {
  if (source.any(
    (line) => line.startsWith('Binary files ') || line == 'GIT binary patch',
  )) {
    return [];
  }
  final hunks = <GitDiffHunk>[];
  var lines = <GitDiffLine>[];
  var oldNumber = 1, newNumber = 1;
  var open = false, synthetic = false;
  void flush() {
    if (lines.isNotEmpty) hunks.add(GitDiffHunk(lines, synthetic: synthetic));
    lines = [];
    open = false;
  }

  final header = RegExp(r'^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@');
  // A final line separator is not an additional source-code context row.
  final end = source.isNotEmpty && source.last.isEmpty
      ? source.length - 1
      : source.length;
  for (final raw in source.take(end)) {
    if (raw.startsWith('@@')) {
      flush();
      final match = header.firstMatch(raw);
      if (match != null) {
        final oldStart = int.tryParse(match.group(1)!);
        final newStart = int.tryParse(match.group(2)!);
        if (oldStart == null || newStart == null) continue;
        oldNumber = oldStart < 1 ? 1 : oldStart;
        newNumber = newStart < 1 ? 1 : newStart;
        open = true;
        synthetic = false;
      }
      continue;
    }
    if ((!open && _metadata(raw)) || raw.startsWith('\\')) continue;
    final change =
        raw.startsWith('+') || raw.startsWith('-') || raw.startsWith(' ');
    if (!open) {
      if (!change) continue;
      open = true;
      synthetic = true;
      oldNumber = newNumber = 1;
    }
    if (raw.startsWith('+')) {
      lines.add(
        GitDiffLine(
          raw.substring(1),
          GitDiffLineKind.addition,
          null,
          newNumber++,
        ),
      );
    } else if (raw.startsWith('-')) {
      lines.add(
        GitDiffLine(
          raw.substring(1),
          GitDiffLineKind.deletion,
          oldNumber++,
          null,
        ),
      );
    } else {
      lines.add(
        GitDiffLine(
          raw.startsWith(' ') ? raw.substring(1) : raw,
          GitDiffLineKind.context,
          oldNumber++,
          newNumber++,
        ),
      );
    }
  }
  flush();
  return hunks;
}
