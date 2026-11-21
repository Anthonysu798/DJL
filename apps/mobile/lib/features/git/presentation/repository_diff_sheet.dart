import 'package:flutter/material.dart';
import '../domain/repository_diff.dart';
import '../../../l10n/l10n.dart';

import '../../../core/design/djl_icons.dart';
import '../../../core/design/djl_tokens.dart';

class RepositoryDiffSheet extends StatefulWidget {
  const RepositoryDiffSheet({
    super.key,
    required this.diff,
    this.isCurrent,
    this.scopeChanges,
  });
  final RepositoryDiff diff;
  final bool Function()? isCurrent;
  final Listenable? scopeChanges;
  @override
  State<RepositoryDiffSheet> createState() => _RepositoryDiffSheetState();
}

class _RepositoryDiffSheetState extends State<RepositoryDiffSheet> {
  final _collapsed = <(int, int)>{};
  bool _allCollapsed = false;

  void _done() {
    if (ModalRoute.of(context)?.isCurrent == true) Navigator.pop(context);
  }

  void _toggleAll() => setState(() {
    _allCollapsed = !_allCollapsed;
    _collapsed.clear();
    if (_allCollapsed) {
      for (var f = 0; f < widget.diff.files.length; f++) {
        for (var h = 0; h < widget.diff.files[f].hunks.length; h++) {
          _collapsed.add((f, h));
        }
      }
    }
  });

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: Listenable.merge([widget.scopeChanges]),
    builder: (context, _) {
      final current = widget.isCurrent?.call() ?? true;
      final theme = Theme.of(context);
      return DraggableScrollableSheet(
        initialChildSize: .94,
        minChildSize: .5,
        maxChildSize: .98,
        expand: false,
        builder: (context, scroll) => SafeArea(
          top: false,
          child: Column(
            children: [
              Stack(
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 80,
                      vertical: 14,
                    ),
                    child: Center(
                      child: Text(
                        context.l10n.gitRepositoryChanges,
                        textAlign: TextAlign.center,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                  PositionedDirectional(
                    end: 8,
                    top: 0,
                    bottom: 0,
                    child: Center(
                      child: TextButton(
                        onPressed: _done,
                        child: Text(context.l10n.gitDone),
                      ),
                    ),
                  ),
                ],
              ),
              Expanded(
                child: ListView(
                  controller: scroll,
                  padding: const EdgeInsets.fromLTRB(12, 16, 12, 16),
                  children: !current
                      ? [Text(context.l10n.gitDesktopChanged)]
                      : widget.diff.files.isEmpty
                      ? [
                          SelectableText(
                            widget.diff.rawPatch,
                            style: _mono(context),
                          ),
                        ]
                      : [
                          Wrap(
                            alignment: WrapAlignment.spaceBetween,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            spacing: 12,
                            runSpacing: 8,
                            children: [
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    context.l10n.gitFilesChanged(
                                      widget.diff.files.length,
                                    ),
                                    style: theme.textTheme.bodyMedium?.copyWith(
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  if (widget.diff.additions > 0 ||
                                      widget.diff.deletions > 0)
                                    _Counts(
                                      widget.diff.additions,
                                      widget.diff.deletions,
                                    ),
                                ],
                              ),
                              if (widget.diff.files.any(
                                (file) => file.hunks.isNotEmpty,
                              ))
                                TextButton(
                                  onPressed: _toggleAll,
                                  child: Text(
                                    _allCollapsed
                                        ? context.l10n.gitExpandAll
                                        : context.l10n.gitCollapseAll,
                                    style: _mono(context),
                                  ),
                                ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          for (var f = 0; f < widget.diff.files.length; f++)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: _file(context, f),
                            ),
                        ],
                ),
              ),
            ],
          ),
        ),
      );
    },
  );

  Widget _file(BuildContext context, int index) {
    final file = widget.diff.files[index];
    final colors = Theme.of(context).colorScheme;
    final parts = file.path.split('/');
    final directory = parts.take(parts.length - 1).join('/');
    return Material(
      color: colors.surfaceContainerLow,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: colors.outlineVariant.withValues(alpha: .35),
          width: .5,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        parts.last,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (directory.isNotEmpty)
                        Text(
                          directory,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: _mono(context).copyWith(
                            fontSize: 11,
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                if (file.additions > 0 || file.deletions > 0)
                  _Counts(file.additions, file.deletions),
                const SizedBox(width: 8),
                Icon(
                  DjlIcons.arrowUpRight,
                  size: 11,
                  color: colors.onSurfaceVariant,
                ),
              ],
            ),
          ),
          if (file.hunks.isEmpty)
            Padding(
              padding: const EdgeInsets.all(12),
              child: SelectableText(file.rawPatch, style: _mono(context)),
            )
          else
            for (var h = 0; h < file.hunks.length; h++)
              _hunk(context, index, h),
        ],
      ),
    );
  }

  Widget _hunk(BuildContext context, int fileIndex, int hunkIndex) {
    final hunks = widget.diff.files[fileIndex].hunks;
    final hunk = hunks[hunkIndex];
    final syntheticCount = hunks.where((hunk) => hunk.synthetic).length;
    final label = hunk.synthetic && syntheticCount > 1
        ? context.l10n.gitPatchIndex(
            hunks.take(hunkIndex + 1).where((hunk) => hunk.synthetic).length,
            syntheticCount,
          )
        : hunk.label;
    var digits = 2;
    for (final line in hunk.lines) {
      for (final number in [line.oldNumber, line.newNumber].whereType<int>()) {
        if (number.toString().length > digits) {
          digits = number.toString().length;
        }
      }
    }
    final gutterWidth =
        ((digits + 2) * 7 + 10) *
        MediaQuery.textScalerOf(context).scale(11) /
        11;
    final key = (fileIndex, hunkIndex);
    final collapsed = _collapsed.contains(key);
    final colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (hunkIndex > 0) const Divider(height: .5, thickness: .5),
        Semantics(
          button: true,
          expanded: !collapsed,
          child: InkWell(
            onTap: () => setState(() {
              if (collapsed) {
                _collapsed.remove(key);
              } else {
                _collapsed.add(key);
              }
            }),
            child: Container(
              constraints: const BoxConstraints(minHeight: 44),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Row(
                children: [
                  Icon(
                    collapsed ? DjlIcons.chevronRight : DjlIcons.chevronDown,
                    size: 14,
                    color: colors.onSurfaceVariant,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      label,
                      style: _mono(
                        context,
                      ).copyWith(color: colors.onSurfaceVariant),
                    ),
                  ),
                  const SizedBox(width: 8),
                  _Counts(hunk.additions, hunk.deletions),
                ],
              ),
            ),
          ),
        ),
        if (!collapsed)
          for (final line in hunk.lines)
            _DiffRow(line: line, gutterWidth: gutterWidth),
      ],
    );
  }
}

TextStyle _mono(BuildContext context) => Theme.of(
  context,
).textTheme.bodySmall!.copyWith(fontFamily: 'GeistMono', fontSize: 12);

// Monochrome diff: added lines are full ink on a light wash, removed lines are
// muted; the +/- sign in the gutter carries the meaning, not a colour.
Color _changeColor(BuildContext context, bool added) =>
    added ? DjlColors.of(context).ink : DjlColors.of(context).inkMuted;

class _Counts extends StatelessWidget {
  const _Counts(this.additions, this.deletions);
  final int additions, deletions;
  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 6,
      children: [
        Text(
          '+$additions',
          style: _mono(context).copyWith(color: _changeColor(context, true)),
        ),
        Text(
          '-$deletions',
          style: _mono(context).copyWith(color: _changeColor(context, false)),
        ),
      ],
    );
  }
}

class _DiffRow extends StatelessWidget {
  const _DiffRow({required this.line, required this.gutterWidth});
  final GitDiffLine line;
  final double gutterWidth;
  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final ink = DjlColors.of(context).ink;
    final added = line.kind == GitDiffLineKind.addition;
    final changed = line.kind != GitDiffLineKind.context;
    final row = !changed
        ? colors.surface
        : ink.withValues(alpha: added ? .08 : .03);
    final gutter = !changed
        ? colors.surfaceContainerLow
        : ink.withValues(alpha: added ? .14 : .07);
    final number = line.kind == GitDiffLineKind.deletion
        ? line.oldNumber
        : line.newNumber;
    final sign = !changed
        ? ' '
        : added
        ? '+'
        : '−';
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            color: gutter,
            width: gutterWidth,
            alignment: Alignment.topRight,
            padding: const EdgeInsets.fromLTRB(4, 3, 6, 3),
            child: Text(
              '${number?.toString() ?? ''} $sign',
              style: _mono(context).copyWith(
                fontSize: 11,
                fontWeight: added ? FontWeight.w600 : null,
                color: changed
                    ? _changeColor(context, added)
                    : colors.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: ColoredBox(
              color: row,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                child: SelectableText(
                  line.text.isEmpty ? ' ' : line.text,
                  style: _mono(context).copyWith(
                    color: line.kind == GitDiffLineKind.deletion
                        ? DjlColors.of(context).inkMuted
                        : null,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
