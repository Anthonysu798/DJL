import 'package:flutter/material.dart';
import 'package:markdown/markdown.dart' as md;
import '../../settings/domain/appearance.dart';
import '../domain/thinking_disclosure.dart';

import '../../../core/design/djl_icons.dart';

class ThinkingTimelineRow extends StatefulWidget {
  const ThinkingTimelineRow({
    super.key,
    required this.messageId,
    required this.text,
  });
  final String messageId, text;
  @override
  State<ThinkingTimelineRow> createState() => _ThinkingTimelineRowState();
}

class _ThinkingTimelineRowState extends State<ThinkingTimelineRow> {
  final _expanded = <String>{};
  @override
  void didUpdateWidget(ThinkingTimelineRow oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.messageId != widget.messageId) _expanded.clear();
  }

  @override
  Widget build(BuildContext context) {
    final parsed = ThinkingDisclosureParser.parse(widget.text);
    if (parsed.fallbackText.isEmpty) return const SizedBox.shrink();
    final secondary = Theme.of(context).colorScheme.onSurfaceVariant;
    final font = DjlAppearance.of(context).font.family;
    Widget detail(String text) => SelectableText.rich(
      TextSpan(
        children: _inline(md.Document(encodeHtml: false).parseInline(text)),
      ),
      style: TextStyle(
        fontFamily: font,
        fontSize: 11,
        height: 13 / 11,
        fontWeight: FontWeight.w400,
        color: secondary.withValues(alpha: .85),
      ),
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (parsed.sections.isEmpty) detail(parsed.fallbackText),
          for (var i = 0; i < parsed.sections.length; i++) ...[
            if (i > 0) const SizedBox(height: 8),
            if (parsed.sections[i].detail.isEmpty)
              Text(
                parsed.sections[i].title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontFamily: font,
                  fontSize: 15,
                  fontWeight: FontWeight.w400,
                  color: secondary,
                ),
              )
            else ...[
              _heading(parsed.sections[i], secondary, font),
              if (_expanded.contains(parsed.sections[i].id)) ...[
                const SizedBox(height: 6),
                Padding(
                  padding: const EdgeInsets.only(left: 18),
                  child: detail(parsed.sections[i].detail),
                ),
              ],
            ],
          ],
        ],
      ),
    );
  }

  Widget _heading(
    ThinkingDisclosureSection section,
    Color color,
    String? font,
  ) {
    final expanded = _expanded.contains(section.id);
    void toggle() => setState(() {
      if (!_expanded.remove(section.id)) _expanded.add(section.id);
    });
    return Semantics(
      button: true,
      expanded: expanded,
      label: section.title,
      onTap: toggle,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: toggle,
        child: Row(
          children: [
            SizedBox(
              width: 10,
              child: Icon(
                expanded ? DjlIcons.chevronDown : DjlIcons.chevronRight,
                size: 10,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                section.title,
                style: TextStyle(
                  fontFamily: font,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: color.withValues(alpha: .95),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<InlineSpan> _inline(List<md.Node> nodes) => [
    for (final node in nodes)
      if (node is md.Element)
        if (node.tag == 'br')
          const TextSpan(text: '\n')
        else
          TextSpan(
            style: switch (node.tag) {
              'strong' => const TextStyle(fontWeight: FontWeight.w700),
              'em' => const TextStyle(fontStyle: FontStyle.italic),
              'code' => TextStyle(
                fontFamily: DjlAppearance.of(context).font.codeFamily,
              ),
              'del' => const TextStyle(decoration: TextDecoration.lineThrough),
              'a' => const TextStyle(decoration: TextDecoration.underline),
              _ => null,
            },
            children: _inline(node.children ?? []),
          )
      else
        TextSpan(text: node.textContent),
  ];
}
