import 'dart:async';
import 'package:flutter/material.dart';
import '../../desktop/presentation/desktop_controller.dart';
import '../data/workspace_repository.dart';
import 'checkpoint_controller.dart';

import '../../../core/design/djl_icons.dart';
import '../../../l10n/l10n.dart';

class CheckpointPage extends StatefulWidget {
  const CheckpointPage({
    super.key,
    required this.repository,
    required this.desktop,
    required this.turns,
  });
  final WorkspaceRepository repository;
  final DesktopController desktop;
  final List<String> turns;
  @override
  State<CheckpointPage> createState() => _CheckpointPageState();
}

class _CheckpointPageState extends State<CheckpointPage> {
  late final CheckpointController _controller;
  String? _turn;
  @override
  void initState() {
    super.initState();
    _controller = CheckpointController(widget.repository);
    _turn = widget.turns.lastOrNull;
    if (_turn != null) {
      unawaited(_loadDiff(_turn!));
    }
  }

  Future<void> _loadDiff(String turn) async {
    await widget.desktop.waitForCheckpoint(turn, workspace: widget.repository);
    if (mounted) await _controller.loadDiff(turn);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _restore() async {
    final turn = _turn;
    if (turn == null || widget.desktop.turnId != null) {
      return;
    }
    final preview = await _controller.preview(turn);
    if (preview == null || !mounted) {
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.l10n.workspaceRestoreTitle),
        content: SizedBox(
          width: double.maxFinite,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(context.l10n.workspaceRestoreBody),
                const SizedBox(height: 16),
                if (preview.affectedFiles.isEmpty)
                  Text(context.l10n.workspaceNoAffectedFiles),
                for (final path in preview.affectedFiles)
                  Text(
                    path,
                    style: const TextStyle(
                      fontFamily: 'GeistMono',
                      fontSize: 12,
                    ),
                  ),
                if (preview.stagedFiles.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(context.l10n.workspaceStagedFiles),
                  for (final path in preview.stagedFiles) Text(path),
                ],
                if (preview.untrackedFiles.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(context.l10n.workspaceUntrackedFiles),
                  for (final path in preview.untrackedFiles) Text(path),
                ],
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(context.l10n.commonCancel),
          ),
          FilledButton(
            onPressed: preview.canRestore
                ? () => Navigator.pop(context, true)
                : null,
            child: Text(context.l10n.workspaceRestoreFiles),
          ),
        ],
      ),
    );
    if (!mounted || widget.desktop.turnId != null) {
      return;
    }
    final confirmation = preview.confirm(userConfirmed: confirmed == true);
    if (confirmation != null) {
      await _controller.restore(confirmation);
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([_controller, widget.desktop]),
    builder: (context, _) {
      final c = _controller;
      return Scaffold(
        appBar: AppBar(
          title: Text(context.l10n.workspaceTurnChanges),
          actions: [
            IconButton(
              tooltip: context.l10n.workspaceReloadTurnChanges,
              onPressed: _turn == null || c.loading
                  ? null
                  : () => _loadDiff(_turn!),
              icon: const Icon(DjlIcons.refresh),
            ),
          ],
        ),
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: DropdownButtonFormField<String>(
                  initialValue: _turn,
                  decoration: InputDecoration(
                    labelText: context.l10n.workspaceConversationTurn,
                  ),
                  items: [
                    for (var i = 0; i < widget.turns.length; i++)
                      DropdownMenuItem(
                        value: widget.turns[i],
                        child: Text(context.l10n.workspaceTurnNumber(i + 1)),
                      ),
                  ],
                  onChanged: c.loading
                      ? null
                      : (value) {
                          setState(() => _turn = value);
                          if (value != null) {
                            _loadDiff(value);
                          }
                        },
                ),
              ),
              if (c.loading) const LinearProgressIndicator(),
              if (c.error != null)
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    c.error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              if (c.status != null)
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(c.status!),
                ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: SelectableText(
                    (c.diff?.trim().isEmpty == true
                            ? context.l10n.workspaceNoSavedChanges
                            : c.diff) ??
                        (widget.turns.isEmpty
                            ? context.l10n.workspaceNoCompletedTurns
                            : context.l10n.workspaceChooseTurn),
                    style: const TextStyle(
                      fontFamily: 'GeistMono',
                      fontSize: 12,
                    ),
                  ),
                ),
              ),
              if (widget.desktop.turnId != null)
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(context.l10n.workspaceStopBeforeRestore),
                ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: OutlinedButton.icon(
                  onPressed:
                      _turn == null ||
                          c.loading ||
                          !widget.desktop.connected ||
                          widget.desktop.turnId != null
                      ? null
                      : _restore,
                  icon: const Icon(DjlIcons.restore),
                  label: Text(context.l10n.workspacePreviewRestore),
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}
