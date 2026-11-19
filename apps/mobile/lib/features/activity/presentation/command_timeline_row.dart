import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../settings/domain/appearance.dart';

/// The inline command slice of CommandExecutionViews.swift. Humanization is
/// display-only: the original command and actual status stay on the button.
class CommandTimelineRow extends StatelessWidget {
  const CommandTimelineRow({
    super.key,
    required this.command,
    required this.status,
    required this.statusLabel,
    required this.onTap,
  });

  final String command, status, statusLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final secondary = Theme.of(context).colorScheme.onSurfaceVariant;
    final scaler = MediaQuery.textScalerOf(context);
    Widget glyph(String asset, double size, Color color) => SvgPicture.asset(
      'assets/icons/command/$asset.svg',
      width: scaler.scale(size),
      height: scaler.scale(size),
      colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
      excludeFromSemantics: true,
    );
    return Semantics(
      container: true,
      button: true,
      label:
          '${command.isEmpty ? 'Command' : command}. Status: $statusLabel. Open command details',
      onTap: onTap,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Row(
          children: [
            glyph(_CommandHumanizer.icon(command), 17, secondary),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                command.isEmpty
                    ? 'Command'
                    : _CommandHumanizer.label(command, status == 'running'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontFamily: DjlAppearance.of(context).font.family,
                  fontSize: 15,
                  fontWeight: FontWeight.w400,
                  color: secondary,
                ),
              ),
            ),
            if (status == 'failed' || status == 'stopped') ...[
              const SizedBox(width: 6),
              glyph('central-exclamation-circle-bold', 15, Colors.red),
            ],
            const SizedBox(width: 8),
            // Source uses an SF fallback. Optical matching awaits native frames.
            Icon(
              Icons.chevron_right,
              size: scaler.scale(8),
              fontWeight: FontWeight.w600,
              color: secondary,
            ),
          ],
        ),
      ),
    );
  }
}

// Bounded port of CommandHumanizer (CommandExecutionViews.swift:667-941).
// In particular, env unwrapping belongs ONLY to icon classification.
abstract final class _CommandHumanizer {
  static List<String> _words(String value) =>
      value.split(' ').where((word) => word.isNotEmpty).toList();

  static String _basename(String value) =>
      value.split('/').where((part) => part.isNotEmpty).lastOrNull ?? value;

  static (String, String) _toolAndArgs(String command) {
    final words = _words(command);
    if (words.isEmpty) return (_basename(command).toLowerCase(), '');
    final first = words.first;
    final end = command.indexOf(first) + first.length;
    return (
      _basename(first).toLowerCase(),
      end < command.length ? command.substring(end + 1) : '',
    );
  }

  static String label(String raw, bool running) {
    final command = _unwrapShell(raw);
    final (tool, args) = _toolAndArgs(command);
    final (verb, target) = switch (tool) {
      'cat' ||
      'nl' ||
      'head' ||
      'tail' ||
      'sed' ||
      'less' ||
      'more' => (running ? 'Reading' : 'Read', _lastPath(args, 'file')),
      'rg' ||
      'grep' ||
      'ag' ||
      'ack' => (running ? 'Searching' : 'Searched', _searchSummary(args)),
      'ls' => (running ? 'Listing' : 'Listed', _lastPath(args, 'directory')),
      'find' ||
      'fd' => (running ? 'Finding' : 'Found', _lastPath(args, 'files')),
      'mkdir' => (
        running ? 'Creating' : 'Created',
        _lastPath(args, 'directory'),
      ),
      'rm' => (running ? 'Removing' : 'Removed', _lastPath(args, 'file')),
      'cp' => (running ? 'Copying' : 'Copied', _lastPath(args, 'file')),
      'mv' => (running ? 'Moving' : 'Moved', _lastPath(args, 'file')),
      'git' => _git(args, running),
      _ => (running ? 'Running' : 'Ran', command),
    };
    return '$verb $target';
  }

  static String icon(String raw) {
    final (tool, _) = _toolAndArgs(_unwrapEnvironment(_unwrapShell(raw)));
    return switch (tool) {
      'cat' ||
      'nl' ||
      'head' ||
      'tail' ||
      'sed' ||
      'less' ||
      'more' ||
      'rg' ||
      'grep' ||
      'ag' ||
      'ack' ||
      'find' ||
      'fd' ||
      'ls' => 'central-magnifying-glass',
      'git' || 'gh' || 'hub' => 'GitHub_Invertocat_Black',
      _ => 'central-console',
    };
  }

  static String _unwrapEnvironment(String raw) {
    final tokens = _words(raw);
    if (tokens.isEmpty || _basename(tokens.first).toLowerCase() != 'env') {
      return raw;
    }
    var index = 1;
    while (index < tokens.length) {
      final token = tokens[index];
      if (token == '--') {
        index++;
        break;
      }
      if (token.startsWith('-')) {
        index++;
        if (token == '-u' || token == '--unset' || token == '-C') index++;
        continue;
      }
      if (token.contains('=')) {
        index++;
        continue;
      }
      break;
    }
    return index < tokens.length ? tokens.skip(index).join(' ') : raw;
  }

  static String _unwrapShell(String raw) {
    var result = raw.trim();
    final lower = result.toLowerCase();
    for (final prefix in [
      '/usr/bin/bash -lc ',
      '/usr/bin/bash -c ',
      '/bin/bash -lc ',
      '/bin/bash -c ',
      'bash -lc ',
      'bash -c ',
      '/bin/sh -c ',
      'sh -c ',
    ]) {
      if (!lower.startsWith(prefix)) continue;
      result = result.substring(prefix.length);
      if ((result.startsWith('"') && result.endsWith('"')) ||
          (result.startsWith("'") && result.endsWith("'"))) {
        result = result.length <= 2
            ? ''
            : result.substring(1, result.length - 1);
      }
      final and = result.indexOf('&&');
      if (and >= 0) result = _trimSpaces(result.substring(and + 2));
      break;
    }
    final pipe = result.indexOf(' | ');
    if (pipe >= 0) result = _trimSpaces(result.substring(0, pipe));
    return result;
  }

  // Swift .whitespaces excludes newlines; shell unwrapping preserves them.
  static String _trimSpaces(String value) => value.replaceAll(
    RegExp(
      r'^[\t \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+|[\t \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+$',
    ),
    '',
  );

  static String _lastPath(String args, String fallback) {
    for (final token in _words(args).reversed) {
      final path = token.replaceAll(RegExp('^["\']+|["\']+\$'), '');
      if (path.isNotEmpty && !path.startsWith('-')) return _compactPath(path);
    }
    return fallback;
  }

  static String _compactPath(String path) {
    final parts = path.split('/').where((part) => part.isNotEmpty).toList();
    return parts.length > 2 ? parts.skip(parts.length - 2).join('/') : path;
  }

  static String _searchSummary(String args) {
    // Swift Array(String) counts extended grapheme clusters, not UTF-16 units.
    final chars = args.characters.toList();
    final tokens = <String>[];
    var i = 0;
    while (i < chars.length) {
      while (i < chars.length && chars[i] == ' ') {
        i++;
      }
      if (i >= chars.length) break;
      final buffer = StringBuffer();
      if (chars[i] == '"' || chars[i] == "'") {
        final quote = chars[i++];
        while (i < chars.length && chars[i] != quote) {
          if (chars[i] == r'\' && i + 1 < chars.length) {
            buffer.write(chars[i + 1]);
            i += 2;
          } else {
            buffer.write(chars[i++]);
          }
        }
        if (i < chars.length) i++;
      } else {
        while (i < chars.length && chars[i] != ' ') {
          buffer.write(chars[i++]);
        }
      }
      tokens.add(buffer.toString());
    }
    String? pattern, path;
    var skipNext = false;
    for (final token in tokens) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (token.startsWith('-')) {
        skipNext = {
          '-t',
          '-g',
          '--type',
          '--glob',
          '--max-count',
        }.contains(token);
        continue;
      }
      if (pattern == null) {
        pattern = token.characters.length > 30
            ? '${token.characters.take(27)}...'
            : token;
      } else {
        path ??= _compactPath(token);
      }
    }
    return 'for ${pattern ?? '...'}${path == null ? '' : ' in $path'}';
  }

  static (String, String) _git(String args, bool running) {
    final parts = _words(args);
    final sub = parts.firstOrNull ?? '';
    return switch (sub) {
      'status' => (running ? 'Checking' : 'Checked', 'git status'),
      'diff' => (running ? 'Comparing' : 'Compared', 'changes'),
      'log' => (running ? 'Viewing' : 'Viewed', 'git log'),
      'add' => (running ? 'Staging' : 'Staged', 'changes'),
      'commit' => (running ? 'Committing' : 'Committed', 'changes'),
      'push' => (running ? 'Pushing' : 'Pushed', 'to remote'),
      'pull' => (running ? 'Pulling' : 'Pulled', 'from remote'),
      'checkout' || 'switch' => (
        running ? 'Switching to' : 'Switched to',
        parts.length > 1 ? parts.last : 'branch',
      ),
      _ => (running ? 'Running' : 'Ran', 'git $args'),
    };
  }
}
