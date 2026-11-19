import 'package:flutter/material.dart';
import '../domain/desktop_attention.dart';

class DesktopAttentionList extends StatelessWidget {
  const DesktopAttentionList({
    super.key,
    required this.items,
    required this.onOpen,
    required this.isFiltering,
  });
  final List<DesktopAttentionItem> items;
  final ValueChanged<DesktopAttentionItem> onOpen;
  final bool isFiltering;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context), scheme = theme.colorScheme;
    if (items.isEmpty) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(18, 46, 18, 20),
        child: Column(
          children: [
            ExcludeSemantics(
              child: Icon(
                isFiltering ? Icons.search : Icons.check_circle_outline,
                size: 30,
                color: isFiltering ? scheme.onSurfaceVariant : Colors.green,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              isFiltering
                  ? 'No matching attention items'
                  : "You're all caught up",
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyLarge?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              isFiltering
                  ? 'Try a different project, chat, or status.'
                  : 'Approvals, agent questions, failed runs, and completed work will appear here.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final section in DesktopAttentionSection.values)
          if (items.any((item) => item.section == section)) ...[
            Padding(
              padding: EdgeInsets.fromLTRB(
                16,
                section == DesktopAttentionSection.needsYou ? 10 : 22,
                16,
                6,
              ),
              child: Semantics(
                header: true,
                child: Text(
                  section == DesktopAttentionSection.needsYou
                      ? 'NEEDS YOU'
                      : 'READY TO REVIEW',
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                    fontWeight: FontWeight.w600,
                    letterSpacing: .6,
                  ),
                ),
              ),
            ),
            for (final item in items.where((item) => item.section == section))
              _AttentionRow(item: item, onOpen: () => onOpen(item)),
          ],
      ],
    );
  }
}

class _AttentionRow extends StatelessWidget {
  const _AttentionRow({required this.item, required this.onOpen});
  final DesktopAttentionItem item;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context), scheme = theme.colorScheme;
    final (icon, color) = switch (item.kind) {
      DesktopAttentionKind.approval => (Icons.front_hand, Colors.orange),
      DesktopAttentionKind.question => (Icons.question_answer, Colors.orange),
      DesktopAttentionKind.failedRun => (Icons.warning_rounded, Colors.red),
      DesktopAttentionKind.blockedGoal => (
        Icons.pause_circle_filled,
        Colors.purple,
      ),
      DesktopAttentionKind.completedRun => (Icons.check_circle, Colors.green),
    };
    final elapsed = (DateTime.now().millisecondsSinceEpoch / 1000 - item.date)
        .clamp(0, double.infinity);
    final relative = !item.date.isFinite
        ? null
        : elapsed < 60
        ? 'now'
        : elapsed < 3600
        ? '${elapsed ~/ 60}m ago'
        : elapsed < 86400
        ? '${elapsed ~/ 3600}h ago'
        : '${elapsed ~/ 86400}d ago';
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: TextButton(
        key: ValueKey('attention.item.${item.id}'),
        style: TextButton.styleFrom(
          foregroundColor: scheme.onSurface,
          backgroundColor: scheme.surfaceContainerLow.withValues(alpha: .7),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          alignment: Alignment.topLeft,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        onPressed: onOpen,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ExcludeSemantics(
              child: Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: .14),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: color, size: 16),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        flex: 3,
                        child: Text(
                          item.kind.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodyLarge?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      if (relative != null) ...[
                        const SizedBox(width: 8),
                        Flexible(
                          child: Text(
                            relative,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    item.threadTitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    item.summary,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  if (item.projectTitle != null) ...[
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        const ExcludeSemantics(
                          child: Icon(Icons.folder_outlined, size: 12),
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            item.projectTitle!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            ExcludeSemantics(
              child: Icon(
                Icons.chevron_right,
                size: 13,
                color: scheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
