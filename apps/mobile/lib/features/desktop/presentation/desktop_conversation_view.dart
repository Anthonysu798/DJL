import 'package:flutter/material.dart';
import '../../../core/design/djl_tokens.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:markdown/markdown.dart' as md;
import '../../pairing/data/pairing_repository.dart';
import '../../chat/presentation/assistant_code_block.dart';
import '../../settings/domain/appearance.dart';
import '../domain/desktop_composer.dart';
import 'desktop_composer_widgets.dart';
import '../../../l10n/l10n.dart';
export '../domain/desktop_overview.dart'
    show
        desktopConversationPath,
        desktopConversationFolder,
        desktopConversationPathLabel;

class DesktopConversationTitle extends StatelessWidget {
  const DesktopConversationTitle({
    super.key,
    required this.title,
    this.subtitle,
    this.onTap,
    this.accessibilityHint,
  });
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;
  final String? accessibilityHint;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final titleStyle = theme.textTheme.bodyMedium!.copyWith(
      fontSize: 14,
      fontWeight: FontWeight.w500,
      height: 1.2,
    );
    final subtitleStyle = theme.textTheme.bodyMedium!.copyWith(
      fontSize: 11,
      fontWeight: FontWeight.w400,
      height: 1.2,
      color: theme.colorScheme.onSurfaceVariant,
    );
    return Semantics(
      label: [title, ?subtitle].join(', '),
      hint: accessibilityHint,
      button: onTap != null,
      onTap: onTap,
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        excludeFromSemantics: true,
        behavior: HitTestBehavior.opaque,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Text(
              title,
              style: titleStyle,
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 1),
              LayoutBuilder(
                builder: (context, constraints) {
                  final scaler = MediaQuery.textScalerOf(context);
                  bool fits(String value) =>
                      (TextPainter(
                        text: TextSpan(text: value, style: subtitleStyle),
                        textDirection: Directionality.of(context),
                        textScaler: scaler,
                      )..layout()).width <=
                      constraints.maxWidth;
                  var displayed = subtitle!;
                  if (!fits(displayed)) {
                    final chars = displayed.characters.toList();
                    var low = 0, high = chars.length;
                    while (low < high) {
                      final count = (low + high + 1) ~/ 2;
                      final candidate =
                          '${chars.take((count + 1) ~/ 2).join()}…${chars.skip(chars.length - count ~/ 2).join()}';
                      if (fits(candidate)) {
                        low = count;
                      } else {
                        high = count - 1;
                      }
                    }
                    displayed =
                        '${chars.take((low + 1) ~/ 2).join()}…${chars.skip(chars.length - low ~/ 2).join()}';
                  }
                  return Center(
                    widthFactor: 1,
                    child: Text(
                      displayed,
                      style: subtitleStyle,
                      textAlign: TextAlign.center,
                      maxLines: 1,
                      overflow: TextOverflow.clip,
                    ),
                  );
                },
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class DesktopConversationHero extends StatelessWidget {
  const DesktopConversationHero({
    super.key,
    required this.draft,
    this.generalDraft = false,
    this.folder,
    this.folderPicker,
  });
  final bool draft, generalDraft;
  final String? folder;
  final Widget? folderPicker;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context),
        secondary = theme.colorScheme.onSurfaceVariant;
    final iosSystem =
        theme.platform == TargetPlatform.iOS &&
        DjlAppearance.of(context).font == AppFontStyle.system;
    List<FontVariation>? axes(double size) {
      if (!iosSystem) return null;
      final scaled = MediaQuery.textScalerOf(context).scale(size);
      return [FontVariation.opticalSize(scaled < 17 ? 17 : scaled)];
    }

    final titleStyle = theme.textTheme.bodyMedium!.copyWith(
      fontSize: 20,
      fontWeight: FontWeight.w400,
      height: 1.2,
      fontVariations: axes(20),
      letterSpacing: iosSystem ? -.45 : null,
    );
    final captionStyle = theme.textTheme.bodyMedium!.copyWith(
      fontSize: 11,
      fontWeight: FontWeight.w400,
      height: 1.2,
      fontVariations: axes(11),
      letterSpacing: iosSystem ? .06 : null,
      color: secondary,
    );
    final title = TextSpan(
      style: titleStyle,
      children: [
        if (generalDraft)
          TextSpan(text: context.l10n.chatUiEmptyGeneralTitle)
        else if (folder != null) ...[
          TextSpan(text: context.l10n.chatUiEmptyFolderPrefix),
          TextSpan(
            text: folder,
            style: TextStyle(color: secondary),
          ),
          TextSpan(text: context.l10n.chatUiEmptyFolderSuffix),
        ] else
          TextSpan(text: context.l10n.chatUiEmptyGreeting),
      ],
    );
    final caption = context.l10n.chatUiEncryptedCaption;
    final size = draft ? 50.0 : 56.0;
    final gap = generalDraft ? 8.0 : 12.0;
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = (constraints.maxWidth - 88).clamp(0.0, double.infinity);
        double textHeight(InlineSpan span) => (TextPainter(
          text: span,
          textDirection: Directionality.of(context),
          textScaler: MediaQuery.textScalerOf(context),
        )..layout(maxWidth: width)).height;
        final height =
            32 +
            size +
            12 +
            gap +
            textHeight(title) +
            (folderPicker == null
                ? 0
                : MediaQuery.textScalerOf(context).scale(22) * 1.2 + 16) +
            textHeight(TextSpan(text: caption, style: captionStyle));
        final content = Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: size,
                height: size,
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: theme.colorScheme.onSurface,
                  borderRadius: BorderRadius.circular(draft ? 16 : 18),
                ),
                child: Image.asset(
                  'assets/djl-logo.png',
                  color: theme.colorScheme.surface,
                  colorBlendMode: BlendMode.srcIn,
                  excludeFromSemantics: true,
                ),
              ),
              const SizedBox(height: 12),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 28),
                child: Text.rich(title, textAlign: TextAlign.center),
              ),
              if (folderPicker != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: IconTheme.merge(
                    data: IconThemeData(color: secondary),
                    child: DefaultTextStyle.merge(
                      style: TextStyle(color: secondary),
                      child: folderPicker!,
                    ),
                  ),
                ),
              SizedBox(height: gap),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 28),
                child: Text(
                  caption,
                  style: captionStyle,
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        );
        return height > constraints.maxHeight
            ? SingleChildScrollView(child: content)
            : Center(child: content);
      },
    );
  }
}

({Color background, Color foreground}) desktopConversationPalette(
  BuildContext context,
) {
  final colors = DjlColors.of(context);
  return (background: colors.ink, foreground: colors.onInk);
}

// Port only MarkdownTextFormatter's heading normalization. Keep fence lines,
// fenced contents, destinations and literal user paths untouched.
String desktopAssistantHeadings(String text) {
  String? fence;
  final heading = RegExp(r'^#{1,6}\s+(.+)$');
  return text
      .split('\n')
      .map((line) {
        final trimmed = line.trim();
        if (fence != null) {
          if (trimmed.startsWith(fence!)) fence = null;
          return line;
        }
        for (final marker in ['```', '~~~']) {
          if (trimmed.startsWith(marker)) {
            fence = marker;
            return line;
          }
        }
        return line.replaceFirstMapped(heading, (match) => '**${match[1]}**');
      })
      .join('\n');
}

final _orderedListLine = RegExp(r'^\s*\d+[.)]\s', multiLine: true);
final _lastListMarkers = <String, int?>{};

/// The largest number an ordered list in [markdown] counts to, used to size
/// the list gutter. Most messages have no numbered list, so the extra parse is
/// skipped for them, and settled messages are answered from a small cache
/// instead of being parsed again on every rebuild.
int? _lastListMarker(String markdown) {
  if (!_orderedListLine.hasMatch(markdown)) return null;
  if (_lastListMarkers.containsKey(markdown)) return _lastListMarkers[markdown];
  int? last;
  void inspect(md.Node node) {
    if (node is! md.Element) return;
    final children = node.children ?? const <md.Node>[];
    if (node.tag == 'ol') {
      final count = children
          .whereType<md.Element>()
          .where((n) => n.tag == 'li')
          .length;
      if (count > 0) {
        final end =
            (int.tryParse(node.attributes['start'] ?? '1') ?? 1) + count - 1;
        if (last == null || end > last!) last = end;
      }
    }
    for (final child in children) {
      inspect(child);
    }
  }

  for (final node in md.Document(
    extensionSet: md.ExtensionSet.gitHubFlavored,
  ).parseLines(markdown.split('\n'))) {
    inspect(node);
  }
  if (_lastListMarkers.length >= 64) {
    _lastListMarkers.remove(_lastListMarkers.keys.first);
  }
  return _lastListMarkers[markdown] = last;
}

class DesktopConversationMessage extends StatelessWidget {
  const DesktopConversationMessage({
    super.key,
    required this.item,
    required this.text,
    required this.user,
    required this.onTapLink,
    this.accessories = const [],
    this.codeScope,
    this.imageBuilder,
    this.trailingImages = const [],
  });
  final RemoteJson item;
  final String text;
  final bool user;
  final MarkdownTapLinkCallback onTapLink;
  final List<Widget> accessories;
  final AssistantCodeScope? codeScope;
  final MarkdownImageBuilder? imageBuilder;
  final List<Widget> trailingImages;
  @override
  Widget build(BuildContext context) {
    final appearance = DjlAppearance.of(context), theme = Theme.of(context);
    final palette = desktopConversationPalette(context);
    final foreground = user ? palette.foreground : theme.colorScheme.onSurface;
    final markdownText = desktopAssistantHeadings(text);
    final markdownStyle = appearance.markdown(context, foreground: foreground);
    final lastMarker = _lastListMarker(markdownText);
    var listIndent = markdownStyle.listIndent!;
    if (lastMarker != null) {
      final painter = TextPainter(
        text: TextSpan(text: '$lastMarker.', style: markdownStyle.listBullet),
        textDirection: Directionality.of(context),
        textScaler: MediaQuery.textScalerOf(context),
      )..layout();
      if (painter.width > listIndent) listIndent = painter.width.ceilToDouble();
      painter.dispose();
    }
    final hasAttachments =
        (item['content'] as List? ?? []).whereType<Map>().any(
          (part) =>
              desktopIsImage(part) ||
              {'skill', 'mention'}.contains(part['type']),
        ) ||
        (item['fileMentions'] as List? ?? []).isNotEmpty;
    final markdown = MarkdownBody(
      data: markdownText,
      selectable: true,
      sizedImageBuilder: imageBuilder == null
          ? null
          : (image) => imageBuilder!(image.uri, image.title, image.alt),
      builders: {
        'pre': AssistantCodeBlockBuilder(
          scope:
              codeScope ??
              AssistantCodeScope(
                mac: null,
                pin: null,
                thread: null,
                item: item['id'],
              ),
        ),
      },
      styleSheet: markdownStyle.copyWith(
        listIndent: listIndent,
        codeblockDecoration: const BoxDecoration(),
        // Setext headings retain the source text kit's hierarchy. ATX
        // headings use the compact normalization above for both roles.
        h1: theme.textTheme.bodyMedium!.copyWith(
          fontSize: 15 * 2.353,
          fontWeight: FontWeight.w600,
          height: 1.22,
          color: foreground,
        ),
        h2: theme.textTheme.bodyMedium!.copyWith(
          fontSize: 15 * 1.882,
          fontWeight: FontWeight.w600,
          height: 1.3,
          color: foreground,
        ),
        p: theme.textTheme.bodyMedium!.copyWith(
          fontSize: 15,
          color: foreground,
        ),
        a: TextStyle(
          color: foreground,
          decoration: TextDecoration.underline,
          decorationStyle: TextDecorationStyle.dotted,
        ),
      ),
      onTapLink: onTapLink,
    );
    return Semantics(
      container: true,
      label: user
          ? context.l10n.chatUiUserMessage
          : context.l10n.chatUiAssistantMessage,
      child: Padding(
        padding: EdgeInsets.only(left: user ? 60 : 0),
        child: Column(
          crossAxisAlignment: user
              ? CrossAxisAlignment.end
              : CrossAxisAlignment.start,
          children: [
            if (hasAttachments) DesktopMessageAttachments(item: item),
            if (hasAttachments && text.trim().isNotEmpty)
              const SizedBox(height: 4),
            if (text.trim().isNotEmpty)
              if (user)
                Container(
                  key: const ValueKey('desktop-user-bubble'),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: palette.background,
                    borderRadius: BorderRadius.circular(22),
                  ),
                  child: markdown,
                )
              else
                markdown,
            if (trailingImages.isNotEmpty) ...[
              if (text.trim().isNotEmpty) const SizedBox(height: 6),
              for (var i = 0; i < trailingImages.length; i++) ...[
                if (i > 0) const SizedBox(height: 6),
                trailingImages[i],
              ],
            ],
            ...accessories,
          ],
        ),
      ),
    );
  }
}
