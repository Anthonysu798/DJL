// These helpers parse references only. WorkspaceRepository validates/reads on explicit tap.
List<String> activityShellTokens(String value) {
  final result = <String>[];
  var buffer = '', escaping = false;
  String? quote;
  for (final rune in value.runes) {
    final char = String.fromCharCode(rune);
    if (escaping) {
      buffer += char;
      escaping = false;
    } else if (char == r'\') {
      escaping = true;
    } else if (quote != null) {
      if (char == quote) {
        quote = null;
      } else {
        buffer += char;
      }
    } else if (char == '"' || char == "'") {
      quote = char;
    } else if (char.trim().isEmpty) {
      if (buffer.isNotEmpty) {
        result.add(buffer);
        buffer = '';
      }
    } else {
      buffer += char;
    }
  }
  if (buffer.isNotEmpty) result.add(buffer);
  return result;
}

String activityUnwrapCommand(String command) {
  final tokens = activityShellTokens(command);
  if (tokens.isEmpty) return command;
  String basename(String token) => token.split('/').last.toLowerCase();
  final shellIndex = tokens.length > 1 && basename(tokens.first) == 'env'
      ? 1
      : 0;
  if (!{'bash', 'zsh', 'sh', 'fish'}.contains(basename(tokens[shellIndex]))) {
    return command;
  }
  for (var index = shellIndex + 1; index < tokens.length; index++) {
    if ({'-c', '-lc', '-cl', '-ic', '-ci'}.contains(tokens[index]) &&
        index + 1 < tokens.length) {
      return tokens.skip(index + 1).join(' ');
    }
  }
  return command;
}

String activityCommandPreview(String command) {
  final value = activityUnwrapCommand(
    command,
  ).replaceAll(RegExp(r'\s+'), ' ').trim();
  return value.length <= 92
      ? value
      : '${value.substring(0, 59)}...${value.substring(value.length - 30)}';
}

String? activityWorkspacePath(String raw, {String? cwd}) {
  var candidate = raw.trim().replaceAll(
    RegExp(r'''^["'`()\[\]{}<>]+|["'`()\[\]{}<>]+$'''),
    '',
  );
  candidate = candidate.replaceAll(RegExp(r'[,.;:]+$'), '');
  if (candidate.isEmpty ||
      candidate.contains('\u0000') ||
      RegExp(r'[*?]').hasMatch(candidate)) {
    return null;
  }
  try {
    // decodeFull expects ASCII URI input. Escape raw Unicode while preserving
    // existing percent escapes, then decode exactly once.
    candidate = Uri.decodeFull(
      Uri.encodeFull(candidate).replaceAll('%25', '%'),
    );
    if (candidate.contains('\u0000') ||
        RegExp(r'[*?]').hasMatch(candidate) ||
        candidate.startsWith('//')) {
      return null;
    }
    final uri = Uri.tryParse(candidate);
    if (uri == null) return null;
    if (uri.hasScheme) {
      if (uri.scheme != 'file' ||
          uri.host.isNotEmpty && uri.host != 'localhost') {
        return null;
      }
      candidate = uri.toFilePath();
    }
    final String resolved;
    if (candidate.startsWith('/')) {
      resolved = Uri.file(candidate).normalizePath().toFilePath();
    } else {
      if (cwd == null || !cwd.startsWith('/')) return null;
      resolved = Uri.file(
        cwd.endsWith('/') ? cwd : '$cwd/',
      ).resolveUri(Uri(path: candidate)).normalizePath().toFilePath();
    }
    // URI resolution can decode a remaining percent escape. Keep the same gates
    // on the final filename as on the input and first decoded candidate.
    return resolved.contains('\u0000') ||
            RegExp(r'[*?]').hasMatch(resolved) ||
            resolved.startsWith('//')
        ? null
        : resolved;
  } on FormatException {
    return null;
  } on ArgumentError {
    return null;
  } on UnsupportedError {
    return null;
  }
}

String? activityImageReference({
  required String command,
  required String outputTail,
  String? cwd,
}) {
  const extensions = {'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'};
  String? image(String value, String? base) {
    final path = activityWorkspacePath(value, cwd: base);
    return path != null &&
            extensions.contains(path.split('.').last.toLowerCase())
        ? path
        : null;
  }

  final tokens = activityShellTokens(activityUnwrapCommand(command));
  var outputBase = cwd;
  if (tokens.isNotEmpty && tokens.first.split('/').last.toLowerCase() == 'ls') {
    final target = tokens
        .skip(1)
        .where((token) => !token.startsWith('-'))
        .lastOrNull;
    if (target != null) {
      final listed = activityWorkspacePath(target, cwd: cwd);
      if (listed != null) {
        outputBase = extensions.contains(listed.split('.').last.toLowerCase())
            ? listed.substring(0, listed.lastIndexOf('/'))
            : listed;
      }
    }
  }
  final candidates = [
    ...RegExp(
      r'!?\[[^\]]*\]\(([^)]+)\)',
    ).allMatches(outputTail).map((m) => m.group(1)!),
    ...outputTail.split('\n'),
    ...RegExp(
      r'''(?:^|[\s\[("'`=:])((?:file://)?/[^\s\]\)"'`]+\.(?:jpg|jpeg|png|gif|webp|heic|heif))''',
      caseSensitive: false,
    ).allMatches(outputTail).map((m) => m.group(1)!),
  ];
  for (final raw in candidates) {
    final path = image(raw, outputBase);
    if (path != null) return path;
  }
  for (final raw in tokens) {
    final path = image(raw, cwd);
    if (path != null) return path;
  }
  return null;
}
