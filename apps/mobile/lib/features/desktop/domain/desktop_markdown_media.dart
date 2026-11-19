import 'dart:convert';
import '../../activity/domain/activity_preview.dart';

String? desktopMarkdownImagePath(String raw, {String? cwd}) {
  final path = activityWorkspacePath(raw, cwd: cwd);
  if (path == null ||
      !{
        'jpg',
        'jpeg',
        'png',
        'gif',
        'webp',
        'heic',
        'heif',
      }.contains(path.split('.').last.toLowerCase())) {
    return null;
  }
  final normalized = path.toLowerCase();
  if (_temporaryImage(path) ||
      normalized.contains('/.codex/generated_images/')) {
    return path;
  }
  final root = cwd == null ? null : activityWorkspacePath(cwd);
  return root != null &&
          (root == '/' || path == root || path.startsWith('$root/'))
      ? path
      : null;
}

typedef DesktopMarkdownImageReference = ({String path, String alt});

bool _temporaryImage(String path) {
  final value = path.toLowerCase();
  return value.startsWith('/tmp/') ||
      value.startsWith('/private/tmp/') ||
      value.startsWith('/private/var/folders/') && value.contains('/t/');
}

/// Keep screenshots inline in Markdown; put other local previews after prose.
({String markdown, List<DesktopMarkdownImageReference> images})
desktopMarkdownMedia(String text, {String? cwd}) {
  if (text.length > 64000 || utf8.encode(text).length > 64000) {
    return (markdown: text, images: const []);
  }
  final imageSyntax = RegExp(r'!\[([^\]]*)\]\(([^)]+)\)');
  final inlineCode = RegExp(r'`[^`]+`');
  final fence = RegExp(r'^ {0,3}(`{3,}|~{3,})');
  final lines =
      <
        ({
          String text,
          List<({RegExpMatch match, DesktopMarkdownImageReference ref})>
          matches,
        })
      >[];
  String? delimiter;
  var fenceLength = 0;
  for (final line in text.split('\n')) {
    final boundary = fence.firstMatch(line)?.group(1);
    final matches =
        <({RegExpMatch match, DesktopMarkdownImageReference ref})>[];
    if (boundary != null) {
      if (delimiter == null) {
        delimiter = boundary[0];
        fenceLength = boundary.length;
      } else if (boundary[0] == delimiter && boundary.length >= fenceLength) {
        delimiter = null;
      }
    } else if (delimiter == null &&
        !line.startsWith('    ') &&
        !line.startsWith('\t')) {
      final protected = inlineCode.allMatches(line).toList();
      for (final match in imageSyntax.allMatches(line)) {
        if (protected.any(
          (range) => match.start < range.end && match.end > range.start,
        )) {
          continue;
        }
        var escapes = 0;
        for (var i = match.start - 1; i >= 0 && line[i] == r'\'; i--) {
          escapes++;
        }
        if (escapes.isOdd) continue;
        final path = desktopMarkdownImagePath(match.group(2)!, cwd: cwd);
        if (path != null) {
          matches.add((match: match, ref: (path: path, alt: match.group(1)!)));
        }
      }
    }
    lines.add((text: line, matches: matches));
  }
  final hasTemporary = lines.any(
    (line) => line.matches.any((m) => _temporaryImage(m.ref.path)),
  );
  final output = <String>[], images = <DesktopMarkdownImageReference>[];
  for (final line in lines) {
    final trailing = line.matches
        .where((m) => !_temporaryImage(m.ref.path))
        .toList();
    images.addAll(trailing.map((m) => m.ref));
    if (trailing.isEmpty) {
      output.add(line.text);
      continue;
    }
    var withoutImages = line.text;
    for (final entry in trailing.reversed) {
      withoutImages = withoutImages.replaceRange(
        entry.match.start,
        entry.match.end,
        '',
      );
    }
    if (withoutImages.trim().isEmpty) continue;
    var visible = line.text;
    for (final entry in trailing.reversed) {
      final alt = entry.ref.alt.trim();
      visible = visible.replaceRange(
        entry.match.start,
        entry.match.end,
        hasTemporary
            ? ''
            : alt.isNotEmpty
            ? alt
            : entry.ref.path.split('/').last,
      );
    }
    output.add(visible);
  }
  return (markdown: output.join('\n'), images: List.unmodifiable(images));
}
