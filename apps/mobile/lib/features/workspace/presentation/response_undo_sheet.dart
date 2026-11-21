import 'package:flutter/material.dart';
import 'response_undo_controller.dart';
import '../../../l10n/l10n.dart';

class ResponseUndoSheet extends StatefulWidget {
  const ResponseUndoSheet({
    super.key,
    required this.controller,
    this.overlap = false,
    this.scope,
  });
  final ResponseUndoController controller;
  final bool overlap;
  final Listenable? scope;
  @override
  State<ResponseUndoSheet> createState() => _ResponseUndoSheetState();
}

class _ResponseUndoSheetState extends State<ResponseUndoSheet> {
  @override
  void initState() {
    super.initState();
    widget.controller.refresh();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: Listenable.merge([widget.controller, widget.scope]),
    builder: (context, _) {
      final c = widget.controller, p = c.preview;
      return SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
            24,
            24,
            24,
            24 + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                context.l10n.workspaceUndoTitle,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 12),
              Text(context.l10n.workspaceUndoWorkspace(c.repository.cwd)),
              Text(context.l10n.workspaceUndoIntro),
              if (widget.overlap)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(context.l10n.workspaceUndoOverlap),
                ),
              if (c.entry.uncertain)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(context.l10n.workspaceUndoUncertain),
                ),
              if (c.loading || c.applying)
                const Padding(
                  padding: EdgeInsets.all(16),
                  child: CircularProgressIndicator(),
                ),
              if (!c.current && !c.entry.reverted)
                Text(context.l10n.workspaceUndoStale),
              if (c.entry.reverted) Text(context.l10n.workspaceUndoDone),
              for (final file in p?.files ?? c.entry.files)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(file),
                ),
              if (p != null) ...[
                if (p.staged.isNotEmpty)
                  Text(
                    context.l10n.workspaceUndoStagedBlock(p.staged.join(', ')),
                  ),
                for (final conflict in p.conflicts)
                  Text(context.l10n.workspaceUndoConflict(conflict)),
                for (final reason in p.reasons) Text(reason),
                if (!p.canRevert &&
                    p.staged.isEmpty &&
                    p.conflicts.isEmpty &&
                    p.reasons.isEmpty)
                  Text(context.l10n.workspaceUndoCannotReverse),
              ],
              if (c.error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(c.error!),
                ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 12,
                runSpacing: 8,
                children: [
                  TextButton(
                    onPressed: c.applying ? null : () => Navigator.pop(context),
                    child: Text(context.l10n.workspaceClose),
                  ),
                  TextButton(
                    onPressed: c.loading || c.applying || !c.current
                        ? null
                        : c.refresh,
                    child: Text(context.l10n.workspaceRefreshReview),
                  ),
                  FilledButton(
                    onPressed: c.canApply ? c.apply : null,
                    child: Text(context.l10n.workspaceUndoResponse),
                  ),
                ],
              ),
            ],
          ),
        ),
      );
    },
  );
}
