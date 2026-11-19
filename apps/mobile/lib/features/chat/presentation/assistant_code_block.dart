import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:markdown/markdown.dart' as md;
import '../../settings/domain/appearance.dart';

import '../../../core/design/djl_icons.dart';

import '../../../core/design/djl_tokens.dart';

/// Compared privately, never embedded in widget keys or diagnostic strings.
@immutable
class AssistantCodeScope {
  const AssistantCodeScope({
    required String? mac,
    required String? pin,
    required String? thread,
    required Object? item,
  }) : _mac = mac,
       _pin = pin,
       _thread = thread,
       _item = item;
  final String? _mac, _pin, _thread;
  final Object? _item;
  @override
  bool operator ==(Object other) =>
      other is AssistantCodeScope &&
      _mac == other._mac &&
      _pin == other._pin &&
      _thread == other._thread &&
      _item == other._item;
  @override
  int get hashCode => Object.hash(_mac, _pin, _thread, _item);
}

/// Uses the installed parser's pre/code AST without changing prose or inline code.
class AssistantCodeBlockBuilder extends MarkdownElementBuilder {
  AssistantCodeBlockBuilder({required this.scope});
  final AssistantCodeScope scope;
  int _block = 0;
  // The installed builder flushes its pre inline stack only when nonempty.
  // The real content is supplied from the complete code AST below.
  @override
  Widget visitText(md.Text text, TextStyle? preferredStyle) =>
      const SizedBox.shrink();
  @override
  Widget visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) {
    final code = element.children!.whereType<md.Element>().first;
    final parsed = code.textContent;
    final body = parsed.endsWith('\n')
        ? parsed.substring(0, parsed.length - 1)
        : parsed;
    final hint = code.attributes['class'];
    return AssistantCodeBlock(
      key: ValueKey(_block++),
      scope: scope,
      code: body,
      language: hint?.startsWith('language-') == true
          ? hint!.substring('language-'.length)
          : '',
    );
  }
}

class AssistantCodeBlock extends StatefulWidget {
  const AssistantCodeBlock({
    super.key,
    required this.scope,
    required this.code,
    required this.language,
  });
  final AssistantCodeScope scope;
  final String code, language;
  @override
  State<AssistantCodeBlock> createState() => _AssistantCodeBlockState();
}

class _AssistantCodeBlockState extends State<AssistantCodeBlock> {
  bool _wrap = true, _copied = false;
  int _copyGeneration = 0;
  Timer? _timer;
  final _scroll = ScrollController();

  @override
  void didUpdateWidget(AssistantCodeBlock oldWidget) {
    super.didUpdateWidget(oldWidget);
    final changedScope = oldWidget.scope != widget.scope;
    if (changedScope || oldWidget.code != widget.code) {
      _copyGeneration++;
      _timer?.cancel();
      _copied = false;
    }
    if (changedScope) {
      _wrap = true;
      if (_scroll.hasClients) _scroll.jumpTo(0);
    }
  }

  Future<void> _copy() async {
    final generation = ++_copyGeneration;
    _timer?.cancel();
    try {
      await Clipboard.setData(ClipboardData(text: widget.code));
    } catch (_) {
      if (mounted && generation == _copyGeneration) {
        setState(() => _copied = false);
      }
      return;
    }
    if (!mounted || generation != _copyGeneration) return;
    unawaited(HapticFeedback.lightImpact());
    setState(() => _copied = true);
    _timer = Timer(const Duration(milliseconds: 1500), () {
      if (mounted) setState(() => _copied = false);
    });
  }

  @override
  void dispose() {
    _copyGeneration++;
    _timer?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final secondary = DjlColors.of(context).inkMuted;
    const fontSize = 15 * .882;
    final body = SelectableText(
      widget.code,
      style: TextStyle(
        fontFamily: DjlAppearance.of(context).font.codeFamily,
        fontSize: fontSize,
        height: 1.39,
        color: theme.colorScheme.onSurface,
      ),
    );
    return Padding(
      padding: const EdgeInsets.only(top: 15 * .88),
      child: DecoratedBox(
        decoration: BoxDecoration(
          // Neutral material-family fallback; native regular-material optics
          // still require matched device review.
          color: DjlColors.of(context).surfaceRaised,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            width: .5,
            color: Theme.of(context).colorScheme.outlineVariant,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      _displayName(widget.language),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodyMedium!.copyWith(
                        fontSize: 15,
                        fontWeight: FontWeight.w500,
                        color: secondary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  _control(
                    label: _wrap ? 'Disable word wrap' : 'Enable word wrap',
                    onTap: () => setState(() => _wrap = !_wrap),
                    child: Icon(
                      _wrap ? DjlIcons.swap : DjlIcons.textAlign,
                      size: 12,
                      color: secondary,
                    ),
                  ),
                  const SizedBox(width: 4),
                  _control(
                    label: _copied ? 'Copied' : 'Copy code',
                    onTap: _copy,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (_copied)
                          Icon(DjlIcons.check, size: 16, color: secondary)
                        else
                          SvgPicture.asset(
                            'assets/icons/markdown/copy.svg',
                            width: 16,
                            height: 16,
                            colorFilter: ColorFilter.mode(
                              secondary,
                              BlendMode.srcIn,
                            ),
                          ),
                        if (_copied) ...[
                          const SizedBox(width: 4),
                          Text(
                            'Copied',
                            style: theme.textTheme.bodyMedium!.copyWith(
                              fontSize: 11,
                              fontWeight: FontWeight.w500,
                              color: secondary,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
            if (_wrap)
              Padding(
                padding: const EdgeInsets.symmetric(
                  vertical: 10,
                  horizontal: 14,
                ),
                child: body,
              )
            else
              SingleChildScrollView(
                controller: _scroll,
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(
                  vertical: 10,
                  horizontal: 14,
                ),
                child: body,
              ),
          ],
        ),
      ),
    );
  }

  Widget _control({
    required String label,
    required VoidCallback onTap,
    required Widget child,
  }) => Semantics(
    label: label,
    button: true,
    onTap: onTap,
    excludeSemantics: true,
    child: Tooltip(
      message: label,
      excludeFromSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
          child: Center(child: child),
        ),
      ),
    ),
  );
}

String _displayName(String hint) {
  final language = hint.trim();
  if (language.isEmpty) return 'Code';
  const names = {
    'bash': 'Shell',
    'c': 'C',
    'c++': 'C++',
    'cpp': 'C++',
    'cs': 'C#',
    'csharp': 'C#',
    'css': 'CSS',
    'diff': 'Diff',
    'dockerfile': 'Dockerfile',
    'fish': 'Shell',
    'go': 'Go',
    'haskell': 'Haskell',
    'hs': 'Haskell',
    'html': 'HTML',
    'java': 'Java',
    'javascript': 'JavaScript',
    'js': 'JavaScript',
    'json': 'JSON',
    'jsx': 'JSX',
    'kotlin': 'Kotlin',
    'kt': 'Kotlin',
    'lua': 'Lua',
    'makefile': 'Makefile',
    'markdown': 'Markdown',
    'md': 'Markdown',
    'objc': 'Objective-C',
    'objective-c': 'Objective-C',
    'objectivec': 'Objective-C',
    'php': 'PHP',
    'py': 'Python',
    'python': 'Python',
    'rb': 'Ruby',
    'ruby': 'Ruby',
    'rs': 'Rust',
    'rust': 'Rust',
    'scss': 'SCSS',
    'sh': 'Shell',
    'shell': 'Shell',
    'sql': 'SQL',
    'swift': 'Swift',
    'toml': 'TOML',
    'ts': 'TypeScript',
    'tsx': 'TSX',
    'typescript': 'TypeScript',
    'xml': 'XML',
    'yaml': 'YAML',
    'yml': 'YAML',
    'zsh': 'Shell',
  };
  return names[language.toLowerCase()] ??
      language.toLowerCase().replaceAllMapped(
        RegExp(r'(^|[^\p{L}\p{N}])([\p{L}\p{N}])', unicode: true),
        (match) => '${match[1]}${match[2]!.toUpperCase()}',
      );
}
