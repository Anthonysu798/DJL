import 'package:flutter/material.dart';
import '../../../core/design/djl_tokens.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:url_launcher/url_launcher.dart';
import '../data/cloud_repository.dart';
import '../../settings/domain/appearance.dart';
import '../domain/cloud_models.dart';
import '../../images/presentation/image_preview_page.dart';

import '../../../core/design/djl_icons.dart';

class MessageView extends StatelessWidget {
  const MessageView({
    super.key,
    required this.message,
    required this.repository,
    this.onRegenerate,
    this.onEdit,
    this.siblings = const [],
    this.onSibling,
    this.onSpeak,
    this.speaking = false,
    this.isStreaming = false,
    this.emptyText = 'No response content.',
  });
  final ChatMessage message;
  final CloudRepository repository;
  final VoidCallback? onRegenerate, onEdit, onSpeak;
  final bool speaking, isStreaming;
  final String emptyText;
  final List<ChatMessage> siblings;
  final ValueChanged<ChatMessage>? onSibling;
  int get _branchIndex => siblings.indexWhere((m) => m.id == message.id);
  bool get _hasBranches => siblings.length > 1 && _branchIndex >= 0;

  @override
  Widget build(BuildContext context) {
    final user = message.role == 'user';
    final scheme = Theme.of(context).colorScheme;
    final appearance = DjlAppearance.of(context);
    if (user) {
      return Padding(
        padding: const EdgeInsets.only(left: 48, bottom: 18),
        child: Align(
          alignment: Alignment.centerRight,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              for (final part in message.parts)
                if (part['type'] == 'image_ref' || part['type'] == 'file_ref')
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: _part(context, part),
                  ),
              if (message.text.isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: scheme.primary,
                    borderRadius: BorderRadius.circular(DjlRadius.lg),
                  ),
                  child: SelectableText(
                    message.text,
                    style: TextStyle(
                      fontFamily: appearance.font.family,
                      fontSize: 15,
                      height: 1.2,
                      color: scheme.onPrimary,
                    ),
                    contextMenuBuilder: (context, editable) =>
                        AdaptiveTextSelectionToolbar.buttonItems(
                          anchors: editable.contextMenuAnchors,
                          buttonItems: [
                            ContextMenuButtonItem(
                              type: ContextMenuButtonType.copy,
                              onPressed: () {
                                Clipboard.setData(
                                  ClipboardData(text: message.text),
                                );
                                editable.hideToolbar();
                              },
                            ),
                            if (onEdit != null)
                              ContextMenuButtonItem(
                                label: 'Edit',
                                onPressed: () {
                                  editable.hideToolbar();
                                  onEdit!();
                                },
                              ),
                          ],
                        ),
                  ),
                ),
              if (_hasBranches)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: _branches(context),
                ),
            ],
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final part in message.parts)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _part(context, part),
            ),
          if (message.parts.isEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Text(emptyText),
            ),
          if (!isStreaming) _assistantActions(context),
        ],
      ),
    );
  }

  Widget _action(
    BuildContext context,
    String label,
    IconData icon,
    VoidCallback? action, {
    bool branch = false,
  }) => IconButton(
    tooltip: label,
    onPressed: action,
    padding: EdgeInsets.zero,
    constraints: BoxConstraints.tightFor(
      width: branch ? 24 : 28,
      height: branch ? 24 : 28,
    ),
    style: IconButton.styleFrom(
      minimumSize: Size(branch ? 24 : 28, branch ? 24 : 28),
      maximumSize: Size(branch ? 24 : 28, branch ? 24 : 28),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
    ),
    icon: Icon(
      icon,
      size: branch ? 12 : 14,
      color: Theme.of(context).colorScheme.onSurfaceVariant,
    ),
  );

  String get _branchLabel => '${_branchIndex + 1} / ${siblings.length}';

  Widget _branches(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      _action(
        context,
        'Previous branch',
        DjlIcons.chevronLeft,
        _branchIndex > 0 && onSibling != null
            ? () => onSibling!(siblings[_branchIndex - 1])
            : null,
        branch: true,
      ),
      const SizedBox(width: 6),
      Text(
        _branchLabel,
        style: TextStyle(
          fontSize: 11,
          height: 1.2,
          fontWeight: FontWeight.w500,
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
      const SizedBox(width: 6),
      _action(
        context,
        'Next branch',
        DjlIcons.chevronRight,
        _branchIndex < siblings.length - 1 && onSibling != null
            ? () => onSibling!(siblings[_branchIndex + 1])
            : null,
        branch: true,
      ),
    ],
  );

  Widget _assistantActions(BuildContext context) {
    final actions = <Widget>[
      _action(
        context,
        'Copy message',
        DjlIcons.copy,
        () => Clipboard.setData(ClipboardData(text: message.text)),
      ),
      if (onRegenerate != null)
        _action(context, 'Regenerate reply', DjlIcons.refresh, onRegenerate),
      if (onSpeak != null)
        _action(
          context,
          speaking ? 'Stop reading' : 'Read aloud',
          speaking ? DjlIcons.stopCircle : DjlIcons.speaker,
          onSpeak,
        ),
    ];
    final model = message.model;
    final captionStyle = TextStyle(
      fontFamily: DjlAppearance.of(context).font.family,
      fontSize: 11,
      height: 1.2,
      color: Theme.of(
        context,
      ).colorScheme.onSurfaceVariant.withValues(alpha: .65),
    );
    return LayoutBuilder(
      builder: (context, bounds) {
        double textWidth(String text, TextStyle style) {
          final painter = TextPainter(
            text: TextSpan(
              text: text,
              style: DefaultTextStyle.of(context).style.merge(style),
            ),
            textDirection: Directionality.of(context),
            textScaler: MediaQuery.textScalerOf(context),
          )..layout();
          final width = painter.width;
          painter.dispose();
          return width;
        }

        final branchWidth = _hasBranches
            ? 60 +
                  textWidth(
                    _branchLabel,
                    const TextStyle(
                      fontSize: 11,
                      height: 1.2,
                      fontWeight: FontWeight.w500,
                    ),
                  )
            : 0;
        final controlsWidth =
            actions.length * 28 +
            (actions.length - 1) * 16 +
            (_hasBranches ? 16 + branchWidth : 0);
        final captionWidth = model == null
            ? 0
            : textWidth(model, captionStyle) + 8;
        final controls = <Widget>[
          for (var i = 0; i < actions.length; i++) ...[
            if (i > 0) const SizedBox(width: 16),
            actions[i],
          ],
          if (_hasBranches) ...[const SizedBox(width: 16), _branches(context)],
        ];
        if (controlsWidth + captionWidth <= bounds.maxWidth) {
          return Row(
            children: [
              ...controls,
              const Spacer(),
              if (model != null) Text(model, style: captionStyle),
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: 16,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [...actions, if (_hasBranches) _branches(context)],
            ),
            if (model != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  model,
                  textAlign: TextAlign.end,
                  style: captionStyle,
                ),
              ),
          ],
        );
      },
    );
  }

  Widget _part(BuildContext context, Json part) => switch (part['type']) {
    'text' => MarkdownBody(
      data: part['text'] as String,
      selectable: true,
      styleSheet: DjlAppearance.of(context).markdown(
        context,
        foreground: message.role == 'user'
            ? Theme.of(context).colorScheme.onPrimary
            : null,
      ),
      onTapLink: (_, url, _) {
        if (url != null) {
          launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
        }
      },
    ),
    'tool_call' => ExpansionTile(
      tilePadding: EdgeInsets.zero,
      title: Text(part['name'] as String),
      leading: const Icon(DjlIcons.tool, size: 18),
      children: [
        SelectableText(
          part['arguments'] as String,
          style: TextStyle(
            fontFamily: DjlAppearance.of(context).font.codeFamily,
            fontSize: 12,
          ),
        ),
      ],
    ),
    'tool_result' => ExpansionTile(
      tilePadding: EdgeInsets.zero,
      title: Text(
        '${part['name']} · ${part['isError'] == true ? 'Failed' : 'Done'}',
      ),
      children: [SelectableText(part['content'] as String)],
    ),
    'citation' => TextButton.icon(
      onPressed: () => launchUrl(
        Uri.parse(part['url'] as String),
        mode: LaunchMode.externalApplication,
      ),
      icon: const Icon(DjlIcons.link, size: 16),
      label: Text(part['title'] as String? ?? part['url'] as String),
    ),
    'image_ref' => InkWell(
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute<void>(
          fullscreenDialog: true,
          builder: (_) => ImagePreviewPage(
            repository: repository,
            fileId: part['fileId'] as String,
            mimeType: part['mimeType'] as String,
          ),
        ),
      ),
      child: CloudImage(
        repository: repository,
        fileId: part['fileId'] as String,
      ),
    ),
    'file_ref' => TextButton.icon(
      onPressed: () async {
        final url = await repository.fileUrl(part['fileId'] as String);
        await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      },
      icon: const Icon(DjlIcons.document),
      label: Text(part['name'] as String),
    ),
    _ => const Text('This message contains content requiring a newer version.'),
  };
}

class CloudImage extends StatefulWidget {
  const CloudImage({super.key, required this.repository, required this.fileId});
  final CloudRepository repository;
  final String fileId;
  @override
  State<CloudImage> createState() => _CloudImageState();
}

class _CloudImageState extends State<CloudImage> {
  late Future<String> _url;
  @override
  void initState() {
    super.initState();
    _url = widget.repository.fileUrl(widget.fileId);
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<String>(
    future: _url,
    builder: (context, snapshot) {
      if (snapshot.hasError) {
        return TextButton(
          onPressed: () => setState(() {
            _url = widget.repository.fileUrl(widget.fileId);
            // A failed retry can finish before FutureBuilder's next frame.
            _url.ignore();
          }),
          child: const Text('Image unavailable · Retry'),
        );
      }
      if (!snapshot.hasData) {
        return const SizedBox(
          height: 100,
          child: Center(child: CircularProgressIndicator()),
        );
      }
      return ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Image.network(
          snapshot.data!,
          semanticLabel: 'Conversation image',
          fit: BoxFit.contain,
          errorBuilder: (_, _, _) =>
              const Text('Could not display this image.'),
        ),
      );
    },
  );
}
