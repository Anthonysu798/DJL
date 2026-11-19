import 'package:flutter/material.dart';
import 'response_undo_controller.dart';

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
                'Undo this response',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 12),
              Text('Workspace: ${c.repository.cwd}'),
              const Text(
                'Review the exact changes from this response. Later edits stay in place where the reverse patch can apply. The desktop checks conflicts again when you confirm.',
              ),
              if (widget.overlap)
                const Padding(
                  padding: EdgeInsets.only(top: 12),
                  child: Text(
                    'Other responses touch these files. Review carefully: undo may overlap changes in this or another chat.',
                  ),
                ),
              if (c.entry.uncertain)
                const Padding(
                  padding: EdgeInsets.only(top: 12),
                  child: Text(
                    'A previous undo result is unknown. Refresh this review and inspect the current files before confirming another attempt.',
                  ),
                ),
              if (c.loading || c.applying)
                const Padding(
                  padding: EdgeInsets.all(16),
                  child: CircularProgressIndicator(),
                ),
              if (!c.current && !c.entry.reverted)
                const Text(
                  'This review is no longer current. Close it and reopen the response.',
                ),
              if (c.entry.reverted) const Text('This response was undone.'),
              for (final file in p?.files ?? c.entry.files)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(file),
                ),
              if (p != null) ...[
                if (p.staged.isNotEmpty)
                  Text('Staged files block undo: ${p.staged.join(', ')}'),
                for (final conflict in p.conflicts) Text('Conflict: $conflict'),
                for (final reason in p.reasons) Text(reason),
                if (!p.canRevert &&
                    p.staged.isEmpty &&
                    p.conflicts.isEmpty &&
                    p.reasons.isEmpty)
                  const Text('The desktop cannot safely reverse this patch.'),
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
                    child: const Text('Close'),
                  ),
                  TextButton(
                    onPressed: c.loading || c.applying || !c.current
                        ? null
                        : c.refresh,
                    child: const Text('Refresh review'),
                  ),
                  FilledButton(
                    onPressed: c.canApply ? c.apply : null,
                    child: const Text('Undo response'),
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
